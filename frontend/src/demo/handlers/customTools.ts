import { badRequest, bodyObj, err, json, nameOf, notFound, nowIso, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, DbCustomTool } from '../types';

function toolJson(db: Parameters<typeof nameOf>[0], t: DbCustomTool) {
  return {
    id: t.id,
    name: t.name,
    url: t.url,
    description: t.description,
    mode: t.mode,
    passToken: t.passToken,
    scopes: t.scopes,
    createdBy: { userId: t.createdBy, name: nameOf(db, t.createdBy) },
    createdAt: t.createdAt,
  };
}

function findTool(ctx: Ctx): DbCustomTool {
  const t = ctx.db.customTools.find((x) => x.id === ctx.params.toolId && x.projectId === ctx.params.pid);
  if (!t) throw notFound('工具不存在');
  return t;
}

function parseToolBody(ctx: Ctx, existing?: DbCustomTool) {
  const b = bodyObj(ctx);
  const name = b.name === undefined ? (existing?.name ?? '') : String(b.name ?? '').trim();
  if (!name) throw badRequest('名称不能为空');
  const url = b.url === undefined ? (existing?.url ?? '') : String(b.url ?? '').trim();
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    throw err(400, 'invalid_url', '链接仅支持 http/https');
  }
  const mode = b.mode === undefined ? (existing?.mode ?? 'embed') : String(b.mode);
  if (mode !== 'embed' && mode !== 'link') throw badRequest('无效的打开方式');
  const description = b.description === undefined ? (existing?.description ?? '') : String(b.description ?? '').trim();
  const passToken = b.passToken === undefined ? (existing?.passToken ?? false) : b.passToken === true;
  const scopes = (Array.isArray(b.scopes) ? b.scopes : (existing?.scopes ?? [])).map((s) => String(s));
  return { name, url, description, mode: mode as 'embed' | 'link', passToken, scopes };
}

/** demo 镜像后端 customTools 路由：不门控权限（同 stageSignups demo 先例） */
export const customToolRoutes: Route[] = [
  def('GET', '/api/projects/:pid/custom-tools', async (ctx) => {
    requireProject(ctx);
    const tools = ctx.db.customTools
      .filter((t) => t.projectId === ctx.params.pid)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return json({ tools: tools.map((t) => toolJson(ctx.db, t)) });
  }),

  def('POST', '/api/projects/:pid/custom-tools', async (ctx) => {
    requireProject(ctx);
    const body = parseToolBody(ctx);
    const tool: DbCustomTool = {
      id: uid(),
      projectId: ctx.params.pid,
      ...body,
      createdBy: ctx.db.currentUserId,
      createdAt: nowIso(),
    };
    ctx.db.customTools.push(tool);
    return json({ tool: toolJson(ctx.db, tool) }, 201);
  }),

  def('PATCH', '/api/projects/:pid/custom-tools/:toolId', async (ctx) => {
    requireProject(ctx);
    const tool = findTool(ctx);
    Object.assign(tool, parseToolBody(ctx, tool));
    return json({ tool: toolJson(ctx.db, tool) });
  }),

  def('DELETE', '/api/projects/:pid/custom-tools/:toolId', async (ctx) => {
    requireProject(ctx);
    const tool = findTool(ctx);
    ctx.db.customTools = ctx.db.customTools.filter((t) => t.id !== tool.id);
    ctx.db.apiKeys = ctx.db.apiKeys.filter((k) => k.toolId !== tool.id);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/custom-tools/:toolId/launch', async (ctx) => {
    requireProject(ctx);
    const tool = findTool(ctx);
    if (!tool.passToken) throw badRequest('该工具未开启身份携带');
    return json({ launchToken: `demo-launch-${tool.id}-${uid()}` });
  }),
];
