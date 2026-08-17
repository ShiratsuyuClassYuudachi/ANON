import crypto from 'crypto';
import { Router } from 'express';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { Project, defaultStages } from '../models/Project';
import { ProjectInvite } from '../models/ProjectInvite';
import { RiskInstance } from '../models/RiskInstance';
import { Todo } from '../models/Todo';
import { User } from '../models/User';
import { logActivity } from '../services/activity';
import { ALL_PERMISSIONS, PRESET_ROLES } from '../services/permissions';
import { computeHealth } from '../services/risk';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const projectsRouter = Router();
projectsRouter.use(authRequired);

function projectJson(p: InstanceType<typeof Project>) {
  const stages = [...(p.stages ?? [])].sort((a, b) => a.order - b.order);
  const currentStage = stages.find((s) => !s.completedAt)?.name ?? p.currentStage ?? '';
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    location: p.location,
    timezone: p.timezone,
    currentStage,
    stages: stages.map((s) => ({ id: s._id.toString(), name: s.name, order: s.order, completedAt: s.completedAt?.toISOString() ?? null, note: s.note ?? '' })),
    roles: p.roles,
    createdBy: p.createdBy.toString(),
  };
}

async function membersJson(projectId: unknown) {
  const ms = await Membership.find({ projectId }).lean();
  const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return ms.map((m) => ({
    userId: m.userId.toString(),
    roleName: m.roleName,
    name: byId.get(m.userId.toString())?.name ?? '未知',
    email: byId.get(m.userId.toString())?.email ?? '',
  }));
}

projectsRouter.post(
  '/',
  rejectApiKey,
  ah(async (req, res) => {
    const { name, description, startDate, endDate } = req.body ?? {};
    if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '项目名称必填');
    const project = await Project.create({
      name: String(name).trim(),
      description: String(description ?? ''),
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      createdBy: req.userId,
      roles: PRESET_ROLES.map((r) => ({ ...r, permissions: [...r.permissions] })),
      stages: defaultStages(),
    });
    await Membership.create({ projectId: project._id, userId: req.userId, roleName: '主办' });
    res.status(201).json({ project: projectJson(project) });
  }),
);

projectsRouter.get(
  '/',
  rejectApiKey,
  ah(async (req, res) => {
    const ms = await Membership.find({ userId: req.userId }).lean();
    const projectIds = ms.map((m) => m.projectId);
    const projects = await Project.find({ _id: { $in: projectIds } }).lean();
    const roleByPid = new Map(ms.map((m) => [m.projectId.toString(), m.roleName]));

    const [todoStats, riskCounts] = await Promise.all([
      Todo.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } },
      ]),
      RiskInstance.aggregate([
        { $match: { projectId: { $in: projectIds }, status: 'active' } },
        { $group: { _id: '$projectId', count: { $sum: 1 }, levels: { $push: '$level' } } },
      ]),
    ]);

    const todoByPid = new Map(todoStats.map((t) => [t._id.toString(), t]));
    const riskByPid = new Map(riskCounts.map((r) => [r._id.toString(), r]));

    res.json({
      projects: projects.map((p) => {
        const pid = p._id.toString();
        const todo = todoByPid.get(pid);
        const risk = riskByPid.get(pid);
        const completionRate = todo && todo.total > 0 ? Math.round((todo.done / todo.total) * 100) : 0;
        const activeRiskLevels = (risk?.levels ?? []) as string[];
        const health = computeHealth(activeRiskLevels.map((level) => ({ level } as any)));
        const stages = [...(p.stages ?? [])].sort((a, b) => a.order - b.order);
        const currentStage = stages.find((s) => !s.completedAt)?.name ?? p.currentStage ?? '';
        return {
          id: pid,
          name: p.name,
          description: p.description,
          status: p.status,
          startDate: p.startDate ?? null,
          endDate: p.endDate ?? null,
          myRole: roleByPid.get(pid) ?? null,
          currentStage,
          stageProgress: { completed: stages.filter((s) => s.completedAt).length, total: stages.length },
          health,
          todoCompletionRate: completionRate,
          activeRiskCount: activeRiskLevels.length,
        };
      }),
    });
  }),
);

projectsRouter.get(
  '/:id',
  ah(async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      loadMembership(req, res, (err?: unknown) => (err ? reject(err) : resolve())),
    );
    res.json({
      project: projectJson(req.project!),
      members: await membersJson(req.project!._id),
      myRole: req.user!.isSuperAdmin ? '超级管理员' : req.membership!.roleName,
      myPermissions: [...req.myPermissions!],
    });
  }),
);

projectsRouter.patch(
  '/:id',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const p = req.project!;
    const { name, description, startDate, endDate, status, location, timezone, currentStage } = req.body ?? {};
    const oldStatus = p.status;
    if (name !== undefined) p.name = String(name).trim();
    if (description !== undefined) p.description = String(description);
    if (startDate !== undefined) p.startDate = startDate ? new Date(startDate) : undefined;
    if (endDate !== undefined) p.endDate = endDate ? new Date(endDate) : undefined;
    if (status !== undefined) p.status = status;
    if (location !== undefined) p.location = String(location);
    if (timezone !== undefined) p.timezone = String(timezone);
    if (currentStage !== undefined) p.currentStage = String(currentStage);
    await p.save();
    if (status !== undefined && status !== oldStatus) {
      logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'project:status_change', message: `${req.user!.name}将项目状态变更为「${status}」`, sourceType: 'project', sourceId: p._id });
    }
    res.json({ project: projectJson(p) });
  }),
);

// ---- 角色 ----
projectsRouter.post(
  '/:id/roles',
  ...requirePermission('role:manage'),
  ah(async (req, res) => {
    const p = req.project!;
    const { name, permissions } = req.body ?? {};
    if (!name || !Array.isArray(permissions)) throw new AppError(400, 'bad_request', '角色名与权限数组必填');
    const invalid = permissions.filter((x: string) => !(ALL_PERMISSIONS as readonly string[]).includes(x));
    if (invalid.length) throw new AppError(400, 'bad_request', `未知权限点: ${invalid.join(',')}`);
    if (p.roles.some((r) => r.name === name)) throw new AppError(409, 'role_exists', '角色已存在');
    p.roles.push({ name: String(name), permissions });
    await p.save();
    res.status(201).json({ roles: p.roles });
  }),
);

projectsRouter.patch(
  '/:id/roles/:roleName',
  ...requirePermission('role:manage'),
  ah(async (req, res) => {
    const p = req.project!;
    const role = p.roles.find((r) => r.name === req.params.roleName);
    if (!role) throw new AppError(404, 'not_found', '角色不存在');
    const { permissions } = req.body ?? {};
    if (!Array.isArray(permissions)) throw new AppError(400, 'bad_request', '权限数组必填');
    const invalid = permissions.filter((x: string) => !(ALL_PERMISSIONS as readonly string[]).includes(x));
    if (invalid.length) throw new AppError(400, 'bad_request', `未知权限点: ${invalid.join(',')}`);
    role.permissions = permissions;
    await p.save();
    res.json({ roles: p.roles });
  }),
);

projectsRouter.delete(
  '/:id/roles/:roleName',
  ...requirePermission('role:manage'),
  ah(async (req, res) => {
    const p = req.project!;
    const inUse = await Membership.exists({ projectId: p._id, roleName: req.params.roleName });
    if (inUse) throw new AppError(409, 'role_in_use', '仍有成员使用该角色');
    const before = p.roles.length;
    p.roles = p.roles.filter((r) => r.name !== req.params.roleName);
    if (p.roles.length === before) throw new AppError(404, 'not_found', '角色不存在');
    await p.save();
    res.json({ roles: p.roles });
  }),
);

// ---- 成员 ----
projectsRouter.patch(
  '/:id/members/:userId',
  ...requirePermission('member:manage'),
  ah(async (req, res) => {
    const { roleName } = req.body ?? {};
    if (!req.project!.roles.some((r) => r.name === roleName)) {
      throw new AppError(400, 'bad_request', '角色不存在');
    }
    const m = await Membership.findOne({ projectId: req.project!._id, userId: req.params.userId });
    if (!m) throw new AppError(404, 'not_found', '成员不存在');
    m.roleName = String(roleName);
    await m.save();
    res.json({ members: await membersJson(req.project!._id) });
  }),
);

projectsRouter.delete(
  '/:id/members/:userId',
  ...requirePermission('member:manage'),
  ah(async (req, res) => {
    if (req.params.userId === req.userId) throw new AppError(400, 'bad_request', '不能移除自己');
    const m = await Membership.findOneAndDelete({
      projectId: req.project!._id,
      userId: req.params.userId,
    });
    if (!m) throw new AppError(404, 'not_found', '成员不存在');
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'member:leave', message: `${req.user!.name}将一名成员移出了项目`, sourceType: 'member' });
    res.json({ members: await membersJson(req.project!._id) });
  }),
);

// ---- 邀请 ----
projectsRouter.post(
  '/:id/invites',
  ...requirePermission('member:manage'),
  ah(async (req, res) => {
    const { roleName, targetUserId, expiresInHours } = req.body ?? {};
    if (!req.project!.roles.some((r) => r.name === roleName)) {
      throw new AppError(400, 'bad_request', '角色不存在');
    }
    if (targetUserId && !(await User.exists({ _id: targetUserId }))) {
      throw new AppError(400, 'bad_request', '目标用户不存在');
    }
    const hours = Number(expiresInHours ?? 72);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 720) {
      throw new AppError(400, 'bad_request', '有效期需为 1~720 小时');
    }
    const token = crypto.randomBytes(24).toString('hex');
    await ProjectInvite.create({
      projectId: req.project!._id,
      token,
      targetUserId: targetUserId || undefined,
      roleName: String(roleName),
      expiresAt: new Date(Date.now() + hours * 3600_000),
    });
    res.status(201).json({ token, url: `/invite/${token}` });
  }),
);
