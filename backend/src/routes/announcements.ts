import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Announcement } from '../models/Announcement';
import { AnnouncementConfirmation } from '../models/AnnouncementConfirmation';
import { Membership } from '../models/Membership';
import { User } from '../models/User';
import { logActivity } from '../services/activity';
import { notify } from '../services/notifications';
import { canSee, type Viewer } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const announcementsRouter = Router({ mergeParams: true });
announcementsRouter.use(authRequired, loadMembership);

const TYPES = ['normal', 'important', 'emergency'] as const;

function parseVisibility(v: unknown): { userIds: string[]; roleNames: string[] } | undefined {
  if (v === undefined) return undefined;
  const o = (v ?? {}) as { userIds?: unknown; roleNames?: unknown };
  return {
    userIds: Array.isArray(o.userIds) ? o.userIds.map(String) : [],
    roleNames: Array.isArray(o.roleNames) ? o.roleNames.map(String) : [],
  };
}

function parseExpiresAt(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '截止时间无效');
  return d;
}

function viewerOf(req: Express.Request): Viewer {
  return {
    userId: req.userId!,
    roleName: req.membership?.roleName ?? null,
    isSuperAdmin: req.user?.isSuperAdmin ?? false,
  };
}

announcementsRouter.get(
  '/',
  ah(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const includeExpired = req.query.includeExpired === 'true';
    const viewer = viewerOf(req);

    const filter: Record<string, unknown> = { projectId: req.project!._id };
    if (!includeExpired) filter.$or = [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }];

    // 先取全部匹配再按可见性过滤：total=当前用户可见总数，且不泄露不可见公告数量
    const docs = await Announcement.find(filter).sort({ isPinned: -1, publishedAt: -1 }).lean();
    const visible = docs.filter((a) => canSee(viewer, a.visibility));
    const total = visible.length;
    const paged = visible.slice((page - 1) * limit, page * limit);

    const pubIds = [...new Set(paged.map((a) => a.publishedBy.toString()))];
    const users = await User.find({ _id: { $in: pubIds } }).lean();
    const nameMap = new Map(users.map((u) => [u._id.toString(), u.name]));

    const myConfirms = await AnnouncementConfirmation.find({
      announcementId: { $in: paged.map((a) => a._id) },
      userId: req.userId,
    }).lean();
    const confirmedSet = new Set(myConfirms.map((c) => c.announcementId.toString()));

    const announcements = paged.map((a) => ({
      id: a._id.toString(),
      title: a.title,
      content: a.content,
      type: a.type,
      isPinned: a.isPinned,
      requireConfirmation: a.requireConfirmation,
      publishedBy: { userId: a.publishedBy.toString(), name: nameMap.get(a.publishedBy.toString()) ?? '未知' },
      publishedAt: a.publishedAt.toISOString(),
      expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
      confirmedByMe: confirmedSet.has(a._id.toString()),
    }));

    res.json({ announcements, total, page });
  }),
);

announcementsRouter.post(
  '/',
  ...requirePermission('announcement:manage'),
  ah(async (req, res) => {
    const { title, content, type, isPinned, requireConfirmation, visibility, expiresAt } = req.body ?? {};
    if (!title || !String(title).trim()) throw new AppError(400, 'bad_request', '标题必填');
    if (type !== undefined && !TYPES.includes(type)) throw new AppError(400, 'bad_request', '公告类型无效');
    const a = await Announcement.create({
      projectId: req.project!._id,
      title: String(title).trim(),
      content: String(content ?? ''),
      type: type ?? 'normal',
      isPinned: !!isPinned,
      requireConfirmation: !!requireConfirmation,
      visibility: parseVisibility(visibility) ?? { userIds: [], roleNames: [] },
      publishedBy: req.userId,
      publishedAt: new Date(),
      expiresAt: parseExpiresAt(expiresAt),
    });
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'announcement:publish', message: `${req.user!.name}发布了公告「${a.title}」`, sourceType: 'announcement', sourceId: a._id });
    if (a.type === 'important' || a.type === 'emergency') {
      const vis = a.visibility ?? {};
      const roleNames = (vis.roleNames ?? []).map(String);
      const userIds = (vis.userIds ?? []).map(String);
      const filter: Record<string, unknown> = { projectId: req.project!._id };
      const or: Record<string, unknown>[] = [];
      if (roleNames.length) or.push({ roleName: { $in: roleNames } });
      if (userIds.length) or.push({ userId: { $in: userIds } });
      if (or.length) filter.$or = or;
      const memberships = await Membership.find(filter).lean();
      notify({
        projectId: req.project!._id,
        type: 'announcement:published',
        title: `${a.type === 'emergency' ? '【紧急】' : '【重要】'}公告：${a.title}`,
        body: a.content ? `${a.title}\n\n${a.content}` : a.title,
        link: `/p/${String(req.project!._id)}?tab=dashboard`,
        metadata: { announcementId: a._id.toString() },
        recipients: memberships.map((m) => m.userId.toString()),
        actorId: req.userId!,
      });
    }
    res.status(201).json({ announcement: { id: a._id.toString(), title: a.title } });
  }),
);

announcementsRouter.patch(
  '/:announcementId',
  ...requirePermission('announcement:manage'),
  ah(async (req, res) => {
    const a = await Announcement.findOne({ _id: req.params.announcementId, projectId: req.project!._id });
    if (!a) throw new AppError(404, 'not_found', '公告不存在');
    const { title, content, type, isPinned, requireConfirmation, visibility, expiresAt } = req.body ?? {};
    if (title !== undefined) a.title = String(title).trim();
    if (content !== undefined) a.content = String(content);
    if (type !== undefined) {
      if (!TYPES.includes(type)) throw new AppError(400, 'bad_request', '公告类型无效');
      a.type = type;
    }
    if (isPinned !== undefined) a.isPinned = !!isPinned;
    if (requireConfirmation !== undefined) a.requireConfirmation = !!requireConfirmation;
    if (visibility !== undefined) {
      const parsed = parseVisibility(visibility); // null → 空数组（全员可见），结构正规化
      if (parsed) a.visibility = parsed as never; // mongoose 运行期把 string[] cast 成 ObjectId[]（同 materials.ts）
    }
    if (expiresAt !== undefined) a.expiresAt = parseExpiresAt(expiresAt);
    await a.save();
    res.json({ ok: true });
  }),
);

announcementsRouter.delete(
  '/:announcementId',
  ...requirePermission('announcement:manage'),
  ah(async (req, res) => {
    const r = await Announcement.deleteOne({ _id: req.params.announcementId, projectId: req.project!._id });
    if (!r.deletedCount) throw new AppError(404, 'not_found', '公告不存在');
    await AnnouncementConfirmation.deleteMany({ announcementId: req.params.announcementId });
    res.json({ ok: true });
  }),
);

announcementsRouter.post(
  '/:announcementId/confirm',
  ah(async (req, res) => {
    const a = await Announcement.findOne({ _id: req.params.announcementId, projectId: req.project!._id }).lean();
    if (!a) throw new AppError(404, 'not_found', '公告不存在');
    const viewer = viewerOf(req);
    if (!canSee(viewer, a.visibility)) throw new AppError(403, 'forbidden', '无权查看此公告');
    const conf = await AnnouncementConfirmation.findOneAndUpdate(
      { announcementId: a._id, userId: req.userId },
      { $setOnInsert: { projectId: req.project!._id, confirmedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ ok: true, confirmedAt: conf.confirmedAt.toISOString() });
  }),
);

announcementsRouter.get(
  '/:announcementId/confirmations',
  ...requirePermission('announcement:manage'),
  ah(async (req, res) => {
    const a = await Announcement.findOne({ _id: req.params.announcementId, projectId: req.project!._id }).lean();
    if (!a) throw new AppError(404, 'not_found', '公告不存在');
    const confs = await AnnouncementConfirmation.find({ announcementId: a._id }).lean();
    const confirmedIds = new Set(confs.map((c) => c.userId.toString()));
    const members = await Membership.find({ projectId: req.project!._id }).lean();
    const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
    const confirmed = users.filter((u) => confirmedIds.has(u._id.toString())).map((u) => ({ userId: u._id.toString(), name: u.name }));
    const unconfirmed = users.filter((u) => !confirmedIds.has(u._id.toString())).map((u) => ({ userId: u._id.toString(), name: u.name }));
    res.json({ confirmed, unconfirmed });
  }),
);
