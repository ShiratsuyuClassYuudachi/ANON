import { Router, type Request } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { WorkModule } from '../models/WorkModule';
import { logActivity } from '../services/activity';
import { memberNameMap, moduleJson } from '../services/workModules';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const workModulesRouter = Router({ mergeParams: true });
workModulesRouter.use(authRequired, loadMembership);

interface BodyShape {
  name?: unknown;
  description?: unknown;
  location?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  requiredCount?: unknown;
  assigneeIds?: unknown;
}

/** 解析并校验 body；返回净化后的字段（assigneeIds 已校验全是项目成员）。 */
async function parseBody(projectId: Types.ObjectId, body: BodyShape) {
  const out: {
    name?: string;
    description?: string;
    location?: string;
    startAt?: Date | null;
    endAt?: Date | null;
    requiredCount?: number;
    assigneeIds?: Types.ObjectId[];
  } = {};
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 100) throw new AppError(400, 'bad_request', '名称必填且不超过 100 字');
    out.name = name;
  }
  if (body.description !== undefined) out.description = String(body.description ?? '').trim();
  if (body.location !== undefined) out.location = String(body.location ?? '').trim();
  if (body.startAt !== undefined || body.endAt !== undefined) {
    const s = body.startAt ? new Date(String(body.startAt)) : null;
    const e = body.endAt ? new Date(String(body.endAt)) : null;
    if (s && Number.isNaN(s.getTime())) throw new AppError(400, 'bad_request', 'startAt 非法');
    if (e && Number.isNaN(e.getTime())) throw new AppError(400, 'bad_request', 'endAt 非法');
    if (s && e && s.getTime() > e.getTime()) throw new AppError(400, 'bad_request', '开始时间不能晚于结束时间');
    out.startAt = s;
    out.endAt = e;
  }
  if (body.requiredCount !== undefined) {
    const n = Number(body.requiredCount);
    if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'bad_request', '所需人力须为 ≥1 的整数');
    out.requiredCount = n;
  }
  if (body.assigneeIds !== undefined) {
    if (!Array.isArray(body.assigneeIds)) throw new AppError(400, 'bad_request', 'assigneeIds 须为数组');
    const ids = [...new Set(body.assigneeIds.map(String))];
    if (ids.some((x) => !isValidObjectId(x))) throw new AppError(400, 'bad_request', 'assigneeIds 含非法 ID');
    const cnt = await Membership.countDocuments({ projectId, userId: { $in: ids } });
    if (cnt !== ids.length) throw new AppError(400, 'bad_request', 'assigneeIds 含非项目成员');
    out.assigneeIds = ids.map((x) => new Types.ObjectId(x));
  }
  return out;
}

async function findInProject(req: Request) {
  const m = await WorkModule.findOne({ _id: req.params.mid, projectId: req.project!._id });
  if (!m) throw new AppError(404, 'not_found', '任务模块不存在');
  return m;
}

workModulesRouter.get(
  '/',
  ah(async (req, res) => {
    const [modules, names] = await Promise.all([
      WorkModule.find({ projectId: req.project!._id }).sort({ createdAt: 1 }),
      memberNameMap(req.project!._id),
    ]);
    res.json({ modules: modules.map((m) => moduleJson(m, names)) });
  }),
);

workModulesRouter.post(
  '/',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const p = await parseBody(req.project!._id, req.body);
    if (!p.name) throw new AppError(400, 'bad_request', '名称必填');
    const m = await WorkModule.create({
      projectId: req.project!._id,
      name: p.name,
      description: p.description,
      location: p.location,
      startAt: p.startAt ?? undefined,
      endAt: p.endAt ?? undefined,
      requiredCount: p.requiredCount ?? 1,
      assignees: (p.assigneeIds ?? []).map((userId) => ({ userId })),
      createdBy: new Types.ObjectId(req.userId!),
    });
    const names = await memberNameMap(req.project!._id);
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:create', message: `${req.user!.name}创建了现场任务「${m.name}」`, sourceType: 'work', sourceId: m._id });
    res.status(201).json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.patch(
  '/:mid',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const m = await findInProject(req);
    const p = await parseBody(req.project!._id, req.body);
    if (p.name !== undefined) m.name = p.name;
    if (p.description !== undefined) m.description = p.description;
    if (p.location !== undefined) m.location = p.location;
    if (p.startAt !== undefined) m.startAt = p.startAt ?? undefined;
    if (p.endAt !== undefined) m.endAt = p.endAt ?? undefined;
    if (p.requiredCount !== undefined) m.requiredCount = p.requiredCount;
    if (p.assigneeIds !== undefined) {
      // 留任成员保留确认记录，被移除者清除
      m.assignees = p.assigneeIds.map((userId) => {
        const kept = m.assignees.find((a) => String(a.userId) === String(userId));
        return kept
          ? {
              userId: kept.userId,
              confirmedAt: kept.confirmedAt,
              confirmedBy: kept.confirmedBy,
              checkedInAt: kept.checkedInAt,
              completedAt: kept.completedAt,
            }
          : { userId };
      });
    }
    await m.save();
    const names = await memberNameMap(req.project!._id);
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:update', message: `${req.user!.name}调整了现场任务「${m.name}」`, sourceType: 'work', sourceId: m._id });
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.delete(
  '/:mid',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const m = await findInProject(req);
    const name = m.name;
    await m.deleteOne();
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:delete', message: `${req.user!.name}删除了现场任务「${name}」`, sourceType: 'work' });
    res.json({ ok: true });
  }),
);

/** confirm/checkin/finish 等共用：解析目标 userId 并做权限判断，返回模块与目标 assignee */
async function resolveConfirmTarget(req: Request, action = '确认') {
  const m = await findInProject(req);
  const target = req.body.userId ? String(req.body.userId) : req.userId!;
  const managing = target !== req.userId;
  if (managing) {
    const perms = req.myPermissions ?? new Set<string>();
    if (!perms.has('project:manage') && !perms.has('work:manage')) {
      throw new AppError(403, 'forbidden', `无权代他人${action}`);
    }
  }
  const a = m.assignees.find((x) => String(x.userId) === target);
  if (!a) throw new AppError(400, 'bad_request', '该成员未被分配到此模块');
  return { m, a, target };
}

workModulesRouter.post(
  '/:mid/confirm',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req);
    if (!a.confirmedAt) {
      a.confirmedAt = new Date();
      a.confirmedBy = new Types.ObjectId(req.userId!);
      await m.save();
    }
    const names = await memberNameMap(req.project!._id);
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:confirm', message: `${req.user!.name}确认了现场任务「${m.name}」`, sourceType: 'work', sourceId: m._id });
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.post(
  '/:mid/unconfirm',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req);
    a.confirmedAt = undefined;
    a.confirmedBy = undefined;
    await m.save();
    const names = await memberNameMap(req.project!._id);
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.post(
  '/:mid/checkin',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req, '签到');
    if (!a.checkedInAt) {
      a.checkedInAt = new Date();
      await m.save();
    }
    const names = await memberNameMap(req.project!._id);
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:checkin', message: `${req.user!.name}签到现场任务「${m.name}」`, sourceType: 'work', sourceId: m._id });
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.post(
  '/:mid/finish',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req, '完成');
    if (!a.completedAt) {
      const now = new Date();
      // 未签到的同时补签到
      if (!a.checkedInAt) a.checkedInAt = now;
      a.completedAt = now;
      await m.save();
    }
    const names = await memberNameMap(req.project!._id);
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'work:finish', message: `${req.user!.name}完成了现场任务「${m.name}」`, sourceType: 'work', sourceId: m._id });
    res.json({ module: moduleJson(m, names) });
  }),
);
