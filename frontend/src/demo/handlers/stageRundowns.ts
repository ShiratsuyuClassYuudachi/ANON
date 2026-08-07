import { badRequest, bodyObj, form, formFiles, formStr, json, notFound, nowIso, requireProject, storeUpload, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbStageRundown, DbStageRundownItem } from '../types';

function itemJson(db: Db, it: DbStageRundownItem) {
  return {
    id: it.id,
    name: it.name,
    durationMin: it.durationMin,
    participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
    attachments: it.attachmentIds
      .map((id) => {
        const f = db.files[id];
        return f ? { id, filename: f.filename, mime: f.mime, size: f.size } : null;
      })
      .filter((x): x is { id: string; filename: string; mime: string; size: number } => !!x),
    note: it.note,
  };
}

function rundownJson(db: Db, r: DbStageRundown) {
  return {
    id: r.id,
    name: r.name,
    startAt: r.startAt,
    note: r.note,
    items: r.items.map((it) => itemJson(db, it)),
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function summaryJson(r: DbStageRundown) {
  return {
    id: r.id,
    name: r.name,
    startAt: r.startAt,
    note: r.note,
    itemCount: r.items.length,
    totalDurationMin: r.items.reduce((sum, it) => sum + it.durationMin, 0),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function findRundown(ctx: Ctx): DbStageRundown {
  const r = ctx.db.stageRundowns.find((x) => x.id === ctx.params.rid && x.projectId === ctx.params.pid);
  if (!r) throw notFound('Rundown 不存在');
  return r;
}

function assertDurationMin(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1440) {
    throw badRequest('时长必须为 1–1440 分钟的整数');
  }
  return n;
}

function parseStartAt(v: unknown): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('开始时间格式无效');
  return d.toISOString();
}

function parseParticipants(v: string): { cn: string; contact: string }[] {
  if (!v) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(v);
  } catch {
    throw badRequest('participants 格式无效');
  }
  if (!Array.isArray(arr)) throw badRequest('participants 格式无效');
  return arr
    .map((p) => {
      const o: Record<string, unknown> = p !== null && typeof p === 'object' ? p : {};
      return {
        cn: String(o.cn ?? '').trim(),
        contact: String(o.contact ?? '').trim(),
      };
    })
    .filter((p) => p.cn);
}

function parseIdArray(v: string, field: string): string[] {
  if (!v) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(v);
  } catch {
    throw badRequest(`${field} 格式无效`);
  }
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) throw badRequest(`${field} 格式无效`);
  return arr as string[];
}

/** 演示站文件即 db.files 条目，级联直接从记录中移除 */
function dropFiles(db: Db, ids: string[]) {
  for (const id of ids) delete db.files[id];
}

async function saveAttachments(db: Db, fd: FormData): Promise<string[]> {
  const ids: string[] = [];
  for (const f of formFiles(fd)) ids.push(await storeUpload(db, f));
  return ids;
}

export const stageRundownRoutes: Route[] = [
  def('GET', '/api/projects/:pid/stage-rundowns', async (ctx) => {
    requireProject(ctx);
    const rundowns = ctx.db.stageRundowns
      .filter((r) => r.projectId === ctx.params.pid)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.createdAt.localeCompare(b.createdAt));
    return json({ rundowns: rundowns.map(summaryJson) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns', async (ctx) => {
    requireProject(ctx);
    const b = bodyObj(ctx);
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('名称不能为空');
    const startAt = parseStartAt(b.startAt);
    const now = nowIso();
    const rundown: DbStageRundown = {
      id: uid(),
      projectId: ctx.params.pid,
      name,
      startAt,
      note: String(b.note ?? '').trim(),
      items: [],
      createdBy: ctx.db.currentUserId,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.stageRundowns.push(rundown);
    return json({ rundown: rundownJson(ctx.db, rundown) }, 201);
  }),

  def('GET', '/api/projects/:pid/stage-rundowns/:rid', async (ctx) => {
    requireProject(ctx);
    return json({ rundown: rundownJson(ctx.db, findRundown(ctx)) });
  }),

  def('PATCH', '/api/projects/:pid/stage-rundowns/:rid', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const b = bodyObj(ctx);
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw badRequest('名称不能为空');
      r.name = name;
    }
    if (b.startAt !== undefined) r.startAt = parseStartAt(b.startAt);
    if (b.note !== undefined) r.note = String(b.note).trim();
    r.updatedAt = nowIso();
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('DELETE', '/api/projects/:pid/stage-rundowns/:rid', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    dropFiles(ctx.db, r.items.flatMap((it) => it.attachmentIds));
    ctx.db.stageRundowns = ctx.db.stageRundowns.filter((x) => x.id !== r.id);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/items', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const fd = form(ctx);
    const name = formStr(fd, 'name').trim();
    if (!name) throw badRequest('节目名称不能为空');
    const durationMin = assertDurationMin(formStr(fd, 'durationMin'));
    const item: DbStageRundownItem = {
      id: uid(),
      name,
      durationMin,
      participants: parseParticipants(formStr(fd, 'participants')),
      attachmentIds: await saveAttachments(ctx.db, fd),
      note: formStr(fd, 'note').trim(),
    };
    r.items.push(item);
    r.updatedAt = nowIso();
    return json({ item: itemJson(ctx.db, item) }, 201);
  }),

  // 注意：items/reorder 必须注册在 items/:itemId 之前，否则会被 :itemId 捕获
  def('PATCH', '/api/projects/:pid/stage-rundowns/:rid/items/reorder', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const order = bodyObj(ctx).order;
    const current = r.items.map((it) => it.id);
    const bad = badRequest('order 必须与现有节目一一对应');
    if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) throw bad;
    if (order.length !== current.length) throw bad;
    const set = new Set(order as string[]);
    if (set.size !== current.length || !current.every((id) => set.has(id))) throw bad;
    const byId = new Map(r.items.map((it) => [it.id, it]));
    r.items = (order as string[]).map((id) => byId.get(id)!);
    r.updatedAt = nowIso();
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('PATCH', '/api/projects/:pid/stage-rundowns/:rid/items/:itemId', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const item = r.items.find((x) => x.id === ctx.params.itemId);
    if (!item) throw notFound('节目不存在');
    const fd = form(ctx);
    if (fd.has('name')) {
      const name = formStr(fd, 'name').trim();
      if (!name) throw badRequest('节目名称不能为空');
      item.name = name;
    }
    if (fd.has('durationMin')) item.durationMin = assertDurationMin(formStr(fd, 'durationMin'));
    if (fd.has('participants')) item.participants = parseParticipants(formStr(fd, 'participants'));
    if (fd.has('note')) item.note = formStr(fd, 'note').trim();
    const removeIds = parseIdArray(formStr(fd, 'removeAttachmentIds'), 'removeAttachmentIds');
    if (removeIds.length) {
      const removeSet = new Set(removeIds);
      dropFiles(ctx.db, item.attachmentIds.filter((id) => removeSet.has(id)));
      item.attachmentIds = item.attachmentIds.filter((id) => !removeSet.has(id));
    }
    item.attachmentIds.push(...(await saveAttachments(ctx.db, fd)));
    r.updatedAt = nowIso();
    return json({ item: itemJson(ctx.db, item) });
  }),

  def('DELETE', '/api/projects/:pid/stage-rundowns/:rid/items/:itemId', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const item = r.items.find((x) => x.id === ctx.params.itemId);
    if (!item) throw notFound('节目不存在');
    dropFiles(ctx.db, item.attachmentIds);
    r.items = r.items.filter((x) => x.id !== item.id);
    r.updatedAt = nowIso();
    return json({ ok: true });
  }),
];
