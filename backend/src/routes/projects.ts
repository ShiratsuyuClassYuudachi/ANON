import crypto from 'crypto';
import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { Project } from '../models/Project';
import { ProjectInvite } from '../models/ProjectInvite';
import { User } from '../models/User';
import { ALL_PERMISSIONS, PRESET_ROLES } from '../services/permissions';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const projectsRouter = Router();
projectsRouter.use(authRequired);

function projectJson(p: InstanceType<typeof Project>) {
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    location: p.location,
    timezone: p.timezone,
    currentStage: p.currentStage,
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
    });
    await Membership.create({ projectId: project._id, userId: req.userId, roleName: '主办' });
    res.status(201).json({ project: projectJson(project) });
  }),
);

projectsRouter.get(
  '/',
  ah(async (req, res) => {
    const ms = await Membership.find({ userId: req.userId }).lean();
    const projects = await Project.find({ _id: { $in: ms.map((m) => m.projectId) } }).lean();
    const roleByPid = new Map(ms.map((m) => [m.projectId.toString(), m.roleName]));
    res.json({
      projects: projects.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        description: p.description,
        status: p.status,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        myRole: roleByPid.get(p._id.toString()) ?? null,
      })),
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
    if (name !== undefined) p.name = String(name).trim();
    if (description !== undefined) p.description = String(description);
    if (startDate !== undefined) p.startDate = startDate ? new Date(startDate) : undefined;
    if (endDate !== undefined) p.endDate = endDate ? new Date(endDate) : undefined;
    if (status !== undefined) p.status = status;
    if (location !== undefined) p.location = String(location);
    if (timezone !== undefined) p.timezone = String(timezone);
    if (currentStage !== undefined) p.currentStage = String(currentStage);
    await p.save();
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
    const token = crypto.randomBytes(24).toString('hex');
    await ProjectInvite.create({
      projectId: req.project!._id,
      token,
      targetUserId: targetUserId || undefined,
      roleName: String(roleName),
      expiresAt: new Date(Date.now() + Number(expiresInHours ?? 72) * 3600_000),
    });
    res.status(201).json({ token, url: `/invite/${token}` });
  }),
);
