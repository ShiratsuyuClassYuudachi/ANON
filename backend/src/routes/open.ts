import crypto from 'crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { ApiKey, type ApiKeyDoc } from '../models/ApiKey';
import { CustomTool } from '../models/CustomTool';
import { Membership } from '../models/Membership';
import { Project } from '../models/Project';
import { User, type UserDoc } from '../models/User';
import { ALL_PERMISSIONS } from '../services/permissions';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';
import { verifyToolLaunchToken } from '../utils/jwt';

export const openRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

/** 与 loadMembership 对齐：超管 = 全权限，否则按成员角色计算 */
async function projectPermissionsOf(user: UserDoc, projectId: string, roleNames: Map<string, string[]>) {
  if (user.isSuperAdmin) return [...ALL_PERMISSIONS];
  const membership = await Membership.findOne({ projectId, userId: user._id }).lean();
  if (!membership) return null;
  return roleNames.get(membership.roleName) ?? [];
}

function roleMapOf(project: { roles: { name: string; permissions: string[] }[] }) {
  return new Map(project.roles.map((r) => [r.name, r.permissions]));
}

/** 生成匿名密钥原文（仅此一次可见），入库仅存 sha256 */
async function createApiKey(fields: {
  userId: unknown;
  projectId: unknown;
  toolId?: unknown;
  name: string;
  scopes: string[];
  permanent: boolean;
}): Promise<{ raw: string; doc: ApiKeyDoc }> {
  const raw = 'anonk_' + crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
  const doc = await ApiKey.create({
    userId: fields.userId,
    projectId: fields.projectId,
    toolId: fields.toolId,
    name: fields.name,
    keyHash,
    scopes: fields.scopes,
    expiresAt: fields.permanent ? undefined : new Date(Date.now() + THIRTY_DAYS_MS),
  });
  return { raw, doc };
}

function keyJson(doc: ApiKeyDoc, projectName: string, toolName: string | null) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    projectId: doc.projectId.toString(),
    projectName,
    toolId: doc.toolId ? doc.toolId.toString() : null,
    toolName,
    scopes: doc.scopes,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
  };
}

// 启动令牌兑换限流：60 次/15 分钟/IP
const exchangeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试' } },
});

openRouter.post(
  '/exchange',
  exchangeLimiter,
  ah(async (req, res) => {
    const launch = verifyToolLaunchToken(String(req.body?.launchToken ?? ''));
    if (!launch) throw new AppError(401, 'invalid_launch_token', '启动令牌无效或已过期');
    const tool = await CustomTool.findById(launch.toolId);
    if (!tool) throw new AppError(404, 'not_found', '工具不存在或已删除');
    const project = await Project.findById(launch.projectId);
    if (!project) throw new AppError(404, 'not_found', '项目不存在');
    const user = await User.findById(launch.userId);
    if (!user) throw new AppError(401, 'unauthorized', '用户不存在');
    const perms = await projectPermissionsOf(user, launch.projectId, roleMapOf(project));
    if (!perms) throw new AppError(403, 'forbidden', '不是项目成员');
    const effectiveScopes = tool.scopes.filter((s) => perms.includes(s));
    // 顶替语义：同 (user, tool) 重复兑换使旧 key 立即失效
    await ApiKey.deleteMany({ userId: user._id, toolId: tool._id });
    const { raw, doc } = await createApiKey({
      userId: user._id,
      projectId: project._id,
      toolId: tool._id,
      name: tool.name,
      scopes: effectiveScopes,
      permanent: false,
    });
    res.status(201).json({
      apiKey: raw,
      expiresAt: doc.expiresAt!.toISOString(),
      scopes: effectiveScopes,
      projectId: launch.projectId,
      user: { id: user._id.toString(), name: user.name },
    });
  }),
);

openRouter.get(
  '/me',
  authRequired,
  ah(async (req, res) => {
    if (!req.apiKey) throw new AppError(403, 'api_key_required', '需要 API 密钥');
    const project = await Project.findById(req.apiKey.projectId);
    if (!project) throw new AppError(404, 'not_found', '项目不存在');
    const perms = (await projectPermissionsOf(req.user!, req.apiKey.projectId, roleMapOf(project))) ?? [];
    const key = await ApiKey.findById(req.apiKey.keyId).lean();
    res.json({
      user: { id: req.user!._id.toString(), name: req.user!.name },
      project: { id: project._id.toString(), name: project.name },
      permissions: req.apiKey.scopes.filter((s) => perms.includes(s)),
      expiresAt: key?.expiresAt ? key.expiresAt.toISOString() : null,
    });
  }),
);

openRouter.post(
  '/keys',
  authRequired,
  rejectApiKey,
  ah(async (req, res) => {
    const { projectId, scopes, permanent } = req.body ?? {};
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
    if (name.length > 50) throw new AppError(400, 'bad_request', '名称过长');
    const project = await Project.findById(String(projectId ?? ''));
    if (!project) throw new AppError(404, 'not_found', '项目不存在');
    const perms = await projectPermissionsOf(req.user!, project._id.toString(), roleMapOf(project));
    if (!perms) throw new AppError(403, 'forbidden', '不是项目成员');
    // 超集静默收窄：仅保留合法且用户实际持有的权限点
    const storedScopes = (Array.isArray(scopes) ? scopes : [])
      .map((s) => String(s))
      .filter((s) => (ALL_PERMISSIONS as readonly string[]).includes(s) && perms.includes(s));
    const { raw, doc } = await createApiKey({
      userId: req.user!._id,
      projectId: project._id,
      name,
      scopes: storedScopes,
      permanent: permanent === true,
    });
    res.status(201).json({ apiKey: raw, key: keyJson(doc, project.name, null) });
  }),
);

openRouter.get(
  '/keys',
  authRequired,
  rejectApiKey,
  ah(async (req, res) => {
    const keys = await ApiKey.find({ userId: req.userId }).sort({ createdAt: -1 });
    const projectIds = [...new Set(keys.map((k) => k.projectId.toString()))];
    const toolIds = [...new Set(keys.filter((k) => k.toolId).map((k) => k.toolId!.toString()))];
    const [projects, tools] = await Promise.all([
      projectIds.length ? Project.find({ _id: { $in: projectIds } }).lean() : [],
      toolIds.length ? CustomTool.find({ _id: { $in: toolIds } }).lean() : [],
    ]);
    const projectNameById = new Map(projects.map((p) => [p._id.toString(), p.name]));
    const toolNameById = new Map(tools.map((t) => [t._id.toString(), t.name]));
    res.json({
      keys: keys.map((k) =>
        keyJson(
          k,
          projectNameById.get(k.projectId.toString()) ?? '已删除项目',
          k.toolId ? (toolNameById.get(k.toolId.toString()) ?? '已删除工具') : null,
        ),
      ),
    });
  }),
);

openRouter.delete(
  '/keys/:keyId',
  authRequired,
  rejectApiKey,
  ah(async (req, res) => {
    const doc = await ApiKey.findOneAndDelete({ _id: req.params.keyId, userId: req.userId });
    if (!doc) throw new AppError(404, 'not_found', '密钥不存在');
    res.json({ ok: true });
  }),
);
