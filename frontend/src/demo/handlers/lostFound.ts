import { badRequest, bodyObj, form, formStr, json, notFound, nowIso, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, DbLostFoundItem, DbLostFoundShare } from '../types';

/** demo 简化：上传的照片不入库（hasPhoto 恒 false），其余语义与后端一致 */

function itemJson(it: DbLostFoundItem) {
  return {
    id: it.id,
    name: it.name,
    note: it.note,
    foundAt: it.foundAt,
    foundLocation: it.foundLocation,
    status: it.status,
    claimedAt: it.claimedAt,
    claimNote: it.claimNote,
    hasPhoto: it.hasPhoto,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  };
}

function publicItemJson(it: DbLostFoundItem) {
  return {
    id: it.id,
    name: it.name,
    note: it.note,
    foundAt: it.foundAt,
    foundLocation: it.foundLocation,
    status: it.status,
    claimedAt: it.claimedAt,
    hasPhoto: it.hasPhoto,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filterItems(items: DbLostFoundItem[], ctx: Ctx): DbLostFoundItem[] {
  let out = items;
  const status = ctx.query.get('status') ?? '';
  if (status === 'pending' || status === 'claimed') out = out.filter((it) => it.status === status);
  const q = (ctx.query.get('q') ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    out = out.filter((it) => rx.test(it.name) || rx.test(it.note) || rx.test(it.foundLocation));
  }
  return [...out].sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 200);
}

function parseFoundAt(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest('无效的时间');
  return d.toISOString();
}

function parseName(v: string): string {
  const name = v.trim();
  if (!name) throw badRequest('名称不能为空');
  return name;
}

function findItem(ctx: Ctx): DbLostFoundItem {
  const it = ctx.db.lostFoundItems.find((x) => x.id === ctx.params.itemId && x.projectId === ctx.params.pid);
  if (!it) throw notFound('物品不存在');
  return it;
}

function loadOrCreateShare(ctx: Ctx): DbLostFoundShare {
  let share = ctx.db.lostFoundShares.find((x) => x.projectId === ctx.params.pid);
  if (!share) {
    share = { projectId: ctx.params.pid, token: uid(), enabled: false };
    ctx.db.lostFoundShares.push(share);
  }
  return share;
}

function loadEnabledShare(ctx: Ctx): DbLostFoundShare {
  const share = ctx.db.lostFoundShares.find((x) => x.token === ctx.params.token);
  if (!share || !share.enabled) throw notFound('链接不存在或已关闭');
  return share;
}

export const lostFoundRoutes: Route[] = [
  def('GET', '/api/projects/:pid/lostfound/share', async (ctx) => {
    requireProject(ctx);
    const share = loadOrCreateShare(ctx);
    return json({ share: { enabled: share.enabled, token: share.token } });
  }),

  def('PUT', '/api/projects/:pid/lostfound/share', async (ctx) => {
    requireProject(ctx);
    const share = loadOrCreateShare(ctx);
    const b = bodyObj(ctx);
    if (typeof b.enabled === 'boolean') share.enabled = b.enabled;
    if (b.regenerate === true) share.token = uid();
    return json({ share: { enabled: share.enabled, token: share.token } });
  }),

  def('GET', '/api/projects/:pid/lostfound', async (ctx) => {
    requireProject(ctx);
    const items = filterItems(ctx.db.lostFoundItems.filter((x) => x.projectId === ctx.params.pid), ctx);
    return json({ items: items.map(itemJson) });
  }),

  def('POST', '/api/projects/:pid/lostfound', async (ctx) => {
    requireProject(ctx);
    const fd = form(ctx);
    const now = nowIso();
    const it: DbLostFoundItem = {
      id: uid(),
      projectId: ctx.params.pid,
      name: parseName(formStr(fd, 'name')),
      note: formStr(fd, 'note').trim(),
      hasPhoto: false,
      foundAt: parseFoundAt(formStr(fd, 'foundAt')) ?? now,
      foundLocation: formStr(fd, 'foundLocation').trim(),
      status: 'pending',
      claimedAt: null,
      claimNote: '',
      createdBy: ctx.db.currentUserId,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.lostFoundItems.push(it);
    return json({ item: itemJson(it) }, 201);
  }),

  def('GET', '/api/projects/:pid/lostfound/:itemId', async (ctx) => {
    requireProject(ctx);
    return json({ item: itemJson(findItem(ctx)) });
  }),

  def('PATCH', '/api/projects/:pid/lostfound/:itemId', async (ctx) => {
    requireProject(ctx);
    const it = findItem(ctx);
    const fd = form(ctx);
    if (fd.has('name')) it.name = parseName(formStr(fd, 'name'));
    if (fd.has('note')) it.note = formStr(fd, 'note').trim();
    if (fd.has('foundLocation')) it.foundLocation = formStr(fd, 'foundLocation').trim();
    const foundAt = parseFoundAt(formStr(fd, 'foundAt'));
    if (foundAt) it.foundAt = foundAt;
    it.updatedAt = nowIso();
    return json({ item: itemJson(it) });
  }),

  def('DELETE', '/api/projects/:pid/lostfound/:itemId', async (ctx) => {
    requireProject(ctx);
    const it = findItem(ctx);
    ctx.db.lostFoundItems = ctx.db.lostFoundItems.filter((x) => x.id !== it.id);
    return json({ ok: true });
  }),

  def('PATCH', '/api/projects/:pid/lostfound/:itemId/status', async (ctx) => {
    requireProject(ctx);
    const it = findItem(ctx);
    const b = bodyObj(ctx);
    if (b.status !== 'pending' && b.status !== 'claimed') throw badRequest('无效的状态');
    if (b.status === 'claimed') {
      it.status = 'claimed';
      it.claimedAt = nowIso();
      if (b.claimNote !== undefined) it.claimNote = String(b.claimNote).trim();
    } else {
      it.status = 'pending';
      it.claimedAt = null;
      it.claimNote = '';
    }
    it.updatedAt = nowIso();
    return json({ item: itemJson(it) });
  }),

  def('GET', '/api/public/lostfound/:token', async (ctx) => {
    const share = loadEnabledShare(ctx);
    const project = ctx.db.projects.find((p) => p.id === share.projectId);
    if (!project) throw notFound('链接不存在或已关闭');
    const items = filterItems(ctx.db.lostFoundItems.filter((x) => x.projectId === share.projectId), ctx);
    return json({ projectName: project.name, items: items.map(publicItemJson) });
  }),
];
