import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Announcement } from '../models/Announcement';
import { Incident, INCIDENT_CATEGORIES, type IncidentCategory } from '../models/Incident';
import { Membership } from '../models/Membership';
import { StageRundown, type IStageExecution, type StageRundownDoc } from '../models/StageRundown';
import { User } from '../models/User';
import { WorkModule } from '../models/WorkModule';
import { logActivity } from '../services/activity';
import { notify, projectManagerIds } from '../services/notifications';
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

const INCIDENT_LABELS: Record<IncidentCategory, string> = {
  equipment: '设备故障',
  staff: '人员缺席',
  material: '物料缺失',
  venue: '场地问题',
  safety: '安全事件',
  other: '其他',
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

/** 逐项累加 durationMin 得目标节目计划开始时刻（与前端 computeSchedule 同算法） */
function plannedStartOf(doc: StageRundownDoc, itemId: Types.ObjectId): Date | null {
  let t = doc.startAt.getTime();
  for (const it of doc.items) {
    if (it._id.equals(itemId)) return new Date(t);
    t += it.durationMin * 60000;
  }
  return null;
}

onsiteRouter.get(
  '/',
  ah(async (req, res) => {
    const projectId = req.project!._id;
    const userId = req.userId!;
    const permissions = req.myPermissions!;
    const now = new Date();
    const viewer: Viewer = { userId, roleName: req.membership?.roleName ?? null, isSuperAdmin: req.user?.isSuperAdmin ?? false };

    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const dayAhead = new Date(now.getTime() + 24 * 3600_000);

    const [moduleDocs, announcementDocs, memberships, incidents, rundownDocs] = await Promise.all([
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
      // 执行中的 rundown 恒在列；未开始的仅取 ±24h 窗口内（旧文档无 execution 字段按 idle 对待）
      StageRundown.find({
        projectId,
        $or: [
          { 'execution.status': 'running' },
          {
            startAt: { $gte: dayAgo, $lte: dayAhead },
            $or: [{ 'execution.status': 'idle' }, { execution: { $exists: false } }],
          },
        ],
      }).sort({ startAt: 1 }),
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

    const rundowns = rundownDocs.slice(0, 5).map((d) => {
      // 旧文档无 execution 字段按 idle 对待（不落库）
      const e: IStageExecution = d.execution ?? {
        status: 'idle',
        currentItemId: null,
        startedAt: null,
        finishedAt: null,
        shiftMin: 0,
        actuals: [],
      };
      const running = e.status === 'running';
      const idx = running && e.currentItemId ? d.items.findIndex((it) => it._id.equals(e.currentItemId!)) : -1;
      const cur = idx >= 0 ? d.items[idx] : null;
      const actual = cur ? e.actuals.find((a) => a.itemId.equals(cur._id)) : null;
      return {
        id: String(d._id),
        name: d.name,
        status: running ? ('running' as const) : ('idle' as const),
        startAt: d.startAt.toISOString(),
        itemCount: d.items.length,
        currentIndex: cur ? idx : null,
        currentItemId: cur ? String(cur._id) : null,
        currentItemName: cur ? cur.name : null,
        currentPlannedStart: cur ? plannedStartOf(d, cur._id)?.toISOString() : null,
        currentActualStart: actual ? actual.startedAt.toISOString() : null,
        shiftMin: running ? e.shiftMin : 0,
      };
    });

    res.json({ now: now.toISOString(), myModules, emergency, contacts, incidents, rundowns, myPermissions: [...permissions] });
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
    const managerIds = await projectManagerIds(projectId);
    notify({
      projectId,
      type: 'incident:reported',
      title: `现场异常上报：${INCIDENT_LABELS[cat as IncidentCategory]}`,
      body: `${req.user!.name} 上报了现场异常（${INCIDENT_LABELS[cat as IncidentCategory]}）：${n}`,
      link: `/p/${String(projectId)}?tab=work`,
      metadata: { incidentId: inc._id.toString() },
      recipients: managerIds,
      actorId: req.userId!,
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
