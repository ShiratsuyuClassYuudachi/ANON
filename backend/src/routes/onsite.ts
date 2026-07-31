import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Announcement } from '../models/Announcement';
import { Incident, INCIDENT_CATEGORIES, type IncidentCategory } from '../models/Incident';
import { Membership } from '../models/Membership';
import { User } from '../models/User';
import { WorkModule } from '../models/WorkModule';
import { logActivity } from '../services/activity';
import { canSee, type Viewer } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const onsiteRouter = Router({ mergeParams: true });
onsiteRouter.use(authRequired, loadMembership);

type IncidentLean = {
  _id: Types.ObjectId;
  moduleId?: Types.ObjectId;
  category: IncidentCategory;
  note: string;
  reporterId: Types.ObjectId;
  status: 'open' | 'resolved';
  createdAt: Date;
};

function incidentJson(i: IncidentLean, moduleNames: Map<string, string>, userNames: Map<string, string>) {
  return {
    id: String(i._id),
    category: i.category,
    note: i.note,
    moduleId: i.moduleId ? String(i.moduleId) : null,
    moduleName: i.moduleId ? (moduleNames.get(String(i.moduleId)) ?? null) : null,
    reporter: { userId: String(i.reporterId), name: userNames.get(String(i.reporterId)) ?? '未知' },
    status: i.status,
    createdAt: i.createdAt.toISOString(),
  };
}

/** 联查 module/user 姓名后输出 incident 列表 JSON */
async function incidentsWithNames(docs: IncidentLean[]) {
  const moduleIds = [...new Set(docs.filter((d) => d.moduleId).map((d) => String(d.moduleId)))];
  const modules = moduleIds.length ? await WorkModule.find({ _id: { $in: moduleIds } }).lean() : [];
  const moduleNames = new Map(modules.map((m) => [String(m._id), m.name]));
  const reporterIds = [...new Set(docs.map((d) => String(d.reporterId)))];
  const users = reporterIds.length ? await User.find({ _id: { $in: reporterIds } }).lean() : [];
  const userNames = new Map(users.map((u) => [String(u._id), u.name]));
  return docs.map((d) => incidentJson(d, moduleNames, userNames));
}

/** 可见范围：work:manage / project:manage 看全部，普通成员仅看自己上报的 */
async function buildIncidents(projectId: Types.ObjectId, userId: string, permissions: Set<string>) {
  const manageAll = permissions.has('work:manage') || permissions.has('project:manage');
  const filter = manageAll ? { projectId } : { projectId, reporterId: new Types.ObjectId(userId) };
  const docs = await Incident.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  return incidentsWithNames(docs as unknown as IncidentLean[]);
}

type ModuleState = 'current' | 'upcoming' | 'done';
const STATE_ORDER: Record<ModuleState, number> = { current: 0, upcoming: 1, done: 2 };

onsiteRouter.get(
  '/',
  ah(async (req, res) => {
    const projectId = req.project!._id;
    const userId = req.userId!;
    const permissions = req.myPermissions!;
    const now = new Date();
    const viewer: Viewer = { userId, roleName: req.membership?.roleName ?? null, isSuperAdmin: req.user?.isSuperAdmin ?? false };

    const [moduleDocs, announcementDocs, memberships, incidents] = await Promise.all([
      WorkModule.find({ projectId, 'assignees.userId': userId }).lean(),
      Announcement.find({
        projectId,
        type: { $in: ['emergency', 'important'] },
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      })
        .sort({ isPinned: -1, publishedAt: -1 })
        .limit(20)
        .lean(),
      Membership.find({ projectId }).populate<{
        userId: { _id: Types.ObjectId; name: string; contacts: { platform: string; value: string }[] };
      }>('userId', 'name contacts'),
      buildIncidents(projectId, userId, permissions),
    ]);

    const myModules = moduleDocs
      .map((m) => {
        const mine = m.assignees.find((a) => String(a.userId) === userId);
        const state: ModuleState = mine?.completedAt
          ? 'done'
          : m.startAt && m.startAt <= now && (!m.endAt || m.endAt >= now)
            ? 'current'
            : 'upcoming';
        return {
          id: String(m._id),
          name: m.name,
          location: m.location ?? null,
          startAt: m.startAt ? m.startAt.toISOString() : null,
          endAt: m.endAt ? m.endAt.toISOString() : null,
          myAssignee: mine
            ? {
                confirmedAt: mine.confirmedAt ? mine.confirmedAt.toISOString() : null,
                checkedInAt: mine.checkedInAt ? mine.checkedInAt.toISOString() : null,
                completedAt: mine.completedAt ? mine.completedAt.toISOString() : null,
              }
            : null,
          state,
          // 仅排序用，不输出
          startAtTs: m.startAt ? m.startAt.getTime() : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.startAtTs - b.startAtTs)
      .map(({ startAtTs: _startAtTs, ...rest }) => rest);

    const emergency = announcementDocs
      .filter((a) => canSee(viewer, a.visibility))
      .slice(0, 5)
      .map((a) => ({
        id: String(a._id),
        title: a.title,
        content: a.content,
        type: a.type as 'emergency' | 'important',
        publishedAt: a.publishedAt.toISOString(),
      }));

    const contacts = memberships
      .filter((m) => (m.userId.contacts?.length ?? 0) > 0)
      .map((m) => ({
        userId: String(m.userId._id),
        name: m.userId.name,
        roleName: m.roleName ?? null,
        contacts: m.userId.contacts.map((c) => ({ platform: c.platform, value: c.value })),
      }));

    res.json({ now: now.toISOString(), myModules, emergency, contacts, incidents });
  }),
);

onsiteRouter.post(
  '/incidents',
  ah(async (req, res) => {
    const projectId = req.project!._id;
    const { category, note, moduleId } = req.body ?? {};
    const cat = String(category ?? '');
    if (!(INCIDENT_CATEGORIES as readonly string[]).includes(cat)) {
      throw new AppError(400, 'bad_request', `category 须为 ${INCIDENT_CATEGORIES.join('/')}`);
    }
    const n = String(note ?? '').trim();
    if (!n || n.length > 500) throw new AppError(400, 'bad_request', '备注必填且不超过 500 字');
    let mid: Types.ObjectId | undefined;
    if (moduleId !== undefined && moduleId !== null && moduleId !== '') {
      if (!isValidObjectId(moduleId)) throw new AppError(400, 'bad_request', 'moduleId 非法');
      const mod = await WorkModule.findOne({ _id: moduleId, projectId });
      if (!mod) throw new AppError(400, 'bad_request', '关联模块不存在');
      mid = mod._id as Types.ObjectId;
    }
    const inc = await Incident.create({
      projectId,
      moduleId: mid,
      category: cat as IncidentCategory,
      note: n,
      reporterId: new Types.ObjectId(req.userId!),
    });
    logActivity({
      projectId,
      actorId: req.userId!,
      type: 'incident:create',
      message: `${req.user!.name}上报了现场异常`,
      sourceType: 'incident',
      sourceId: inc._id as Types.ObjectId,
    });
    const [json] = await incidentsWithNames([inc as unknown as IncidentLean]);
    res.status(201).json({ incident: json });
  }),
);

onsiteRouter.get(
  '/incidents',
  ah(async (req, res) => {
    const incidents = await buildIncidents(req.project!._id, req.userId!, req.myPermissions!);
    res.json({ incidents });
  }),
);

onsiteRouter.post(
  '/incidents/:iid/resolve',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const inc = await Incident.findOne({ _id: req.params.iid, projectId: req.project!._id });
    if (!inc) throw new AppError(404, 'not_found', '异常记录不存在');
    if (inc.status !== 'resolved') {
      inc.status = 'resolved';
      inc.resolvedBy = new Types.ObjectId(req.userId!);
      inc.resolvedAt = new Date();
      await inc.save();
      logActivity({
        projectId: req.project!._id,
        actorId: req.userId!,
        type: 'incident:resolve',
        message: `${req.user!.name}处理了一条现场异常`,
        sourceType: 'incident',
        sourceId: inc._id as Types.ObjectId,
      });
    }
    const [json] = await incidentsWithNames([inc as unknown as IncidentLean]);
    res.json({ incident: json });
  }),
);
