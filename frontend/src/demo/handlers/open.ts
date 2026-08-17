import { badRequest, bodyObj, currentUser, err, json, myPermissions, notFound, nowIso, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbApiKey } from '../types';

const THIRTY_DAYS_MS = 30 * 86400000;

function keyJson(db: Db, k: DbApiKey) {
  const project = db.projects.find((p) => p.id === k.projectId);
  const tool = k.toolId ? db.customTools.find((t) => t.id === k.toolId) : undefined;
  return {
    id: k.id,
    name: k.name,
    projectId: k.projectId,
    projectName: project?.name ?? '已删除项目',
    toolId: k.toolId ?? null,
    toolName: k.toolId ? (tool?.name ?? '已删除工具') : null,
    scopes: k.scopes,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
  };
}

function newKey(fields: Omit<DbApiKey, 'id' | 'key' | 'createdAt' | 'lastUsedAt'>): DbApiKey {
  return { id: uid(), key: 'anonk_demo_' + uid(), createdAt: nowIso(), lastUsedAt: null, ...fields };
}

/** demo 镜像后端 open 路由：OpenAPI 模式（exchange / me / keys） */
export const openRoutes: Route[] = [
  def('POST', '/api/open/exchange', async (ctx) => {
    const launchToken = String(bodyObj(ctx).launchToken ?? '');
    const tool = launchToken.startsWith('demo-launch-')
      ? ctx.db.customTools.find((t) => launchToken.startsWith(`demo-launch-${t.id}-`))
      : undefined;
    if (!tool) throw err(401, 'invalid_launch_token', '启动令牌无效或已过期');
    const project = ctx.db.projects.find((p) => p.id === tool.projectId);
    if (!project) throw notFound('项目不存在');
    const user = currentUser(ctx.db);
    const membership = ctx.db.memberships.find(
      (m) => m.projectId === project.id && m.userId === user.id,
    );
    if (!membership) throw err(403, 'forbidden', '不是项目成员');
    const perms = myPermissions(ctx.db, project, membership);
    const scopes = tool.scopes.filter((s) => perms.has(s));
    // 顶替语义：同 (user, tool) 重复兑换使旧 key 失效
    ctx.db.apiKeys = ctx.db.apiKeys.filter((k) => !(k.userId === user.id && k.toolId === tool.id));
    const key = newKey({
      userId: user.id,
      projectId: project.id,
      toolId: tool.id,
      name: tool.name,
      scopes,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    });
    ctx.db.apiKeys.push(key);
    return json(
      { apiKey: key.key, expiresAt: key.expiresAt, scopes, projectId: project.id, user: { id: user.id, name: user.name } },
      201,
    );
  }),

  def('GET', '/api/open/me', async (ctx) => {
    const token = ctx.authorization.startsWith('Bearer ') ? ctx.authorization.slice(7) : '';
    const key = token.startsWith('anonk_demo_') ? ctx.db.apiKeys.find((k) => k.key === token) : undefined;
    if (!key) throw err(401, 'unauthorized', 'API 密钥无效或已过期');
    key.lastUsedAt = nowIso();
    const project = ctx.db.projects.find((p) => p.id === key.projectId);
    if (!project) throw notFound('项目不存在');
    const user = ctx.db.users.find((u) => u.id === key.userId) ?? currentUser(ctx.db);
    return json({
      user: { id: user.id, name: user.name },
      project: { id: project.id, name: project.name },
      permissions: key.scopes,
      expiresAt: key.expiresAt,
    });
  }),

  def('POST', '/api/open/keys', async (ctx) => {
    const b = bodyObj(ctx);
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('名称不能为空');
    const project = ctx.db.projects.find((p) => p.id === String(b.projectId ?? ''));
    if (!project) throw notFound('项目不存在');
    const user = currentUser(ctx.db);
    const membership = ctx.db.memberships.find(
      (m) => m.projectId === project.id && m.userId === user.id,
    );
    if (!membership) throw err(403, 'forbidden', '不是项目成员');
    const perms = myPermissions(ctx.db, project, membership);
    const scopes = (Array.isArray(b.scopes) ? b.scopes : []).map((s) => String(s)).filter((s) => perms.has(s));
    const key = newKey({
      userId: user.id,
      projectId: project.id,
      name,
      scopes,
      expiresAt: b.permanent === true ? null : new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    });
    ctx.db.apiKeys.push(key);
    return json({ apiKey: key.key, key: keyJson(ctx.db, key) }, 201);
  }),

  def('GET', '/api/open/keys', async (ctx) => {
    const keys = ctx.db.apiKeys
      .filter((k) => k.userId === ctx.db.currentUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ keys: keys.map((k) => keyJson(ctx.db, k)) });
  }),

  def('DELETE', '/api/open/keys/:keyId', async (ctx) => {
    const key = ctx.db.apiKeys.find((k) => k.id === ctx.params.keyId && k.userId === ctx.db.currentUserId);
    if (!key) throw notFound('密钥不存在');
    ctx.db.apiKeys = ctx.db.apiKeys.filter((k) => k.id !== key.id);
    return json({ ok: true });
  }),
];
