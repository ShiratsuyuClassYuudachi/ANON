import { badRequest, bodyObj, err, form, formFiles, formStr, json, notFound, nowIso, requireProject, storeUpload, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbScreenShare, DbStageRundown, DbStageRundownItem } from '../types';

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
    execution: r.execution,
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
    executionStatus: r.execution.status,
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

/** 惰性创建大屏分享（每 Rundown 一份） */
function loadOrCreateShare(db: Db, r: DbStageRundown): DbScreenShare {
  const existing = db.screenShares.find((s) => s.rundownId === r.id);
  if (existing) return existing;
  const share: DbScreenShare = { id: uid(), projectId: r.projectId, rundownId: r.id, token: uid(), enabled: false };
  db.screenShares.push(share);
  return share;
}

/** 执行中锁定编排（与后端 assertNotRunning 一致） */
function assertNotRunning(r: DbStageRundown) {
  if (r.execution.status === 'running') throw err(409, 'EXECUTION_RUNNING', '执行中，请先结束或重置执行');
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
      execution: { status: 'idle', currentItemId: null, startedAt: null, finishedAt: null, shiftMin: 0, actuals: [] },
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
    if (b.startAt !== undefined) assertNotRunning(r);
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
    assertNotRunning(r);
    dropFiles(ctx.db, r.items.flatMap((it) => it.attachmentIds));
    ctx.db.stageRundowns = ctx.db.stageRundowns.filter((x) => x.id !== r.id);
    ctx.db.screenShares = ctx.db.screenShares.filter((s) => s.rundownId !== r.id);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/items', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    assertNotRunning(r);
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
    assertNotRunning(r);
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
    assertNotRunning(r);
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
    assertNotRunning(r);
    const item = r.items.find((x) => x.id === ctx.params.itemId);
    if (!item) throw notFound('节目不存在');
    dropFiles(ctx.db, item.attachmentIds);
    r.items = r.items.filter((x) => x.id !== item.id);
    r.updatedAt = nowIso();
    return json({ ok: true });
  }),

  // ---------- 执行控制（语义同后端 stageRundowns.ts） ----------

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/start', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const e = r.execution;
    if (e.status === 'running') throw err(409, 'ALREADY_RUNNING', '已在执行中');
    if (r.items.length === 0) throw badRequest('请先添加节目');
    let target = r.items[0];
    const b = bodyObj(ctx);
    if (b.itemId !== undefined) {
      const found = r.items.find((x) => x.id === String(b.itemId));
      if (!found) throw badRequest('节目不存在');
      target = found;
    }
    // 总是重置后重记：idle→开始；finished→重新执行（清旧记录）
    const now = nowIso();
    r.execution = {
      status: 'running',
      currentItemId: target.id,
      startedAt: now,
      finishedAt: null,
      shiftMin: 0,
      actuals: [{ itemId: target.id, startedAt: now, endedAt: null }],
    };
    r.updatedAt = now;
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/advance', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const e = r.execution;
    if (e.status !== 'running') throw err(409, 'NOT_RUNNING', '当前不在执行中');
    const now = nowIso();
    const cur = e.actuals.find((a) => a.itemId === e.currentItemId);
    if (cur) cur.endedAt = now;
    const idx = r.items.findIndex((it) => it.id === e.currentItemId);
    if (idx >= 0 && idx + 1 < r.items.length) {
      const next = r.items[idx + 1];
      e.currentItemId = next.id;
      e.actuals = e.actuals.filter((a) => a.itemId !== next.id);
      e.actuals.push({ itemId: next.id, startedAt: now, endedAt: null });
    } else {
      e.status = 'finished';
      e.finishedAt = now;
      e.currentItemId = null;
    }
    r.updatedAt = now;
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/jump', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const b = bodyObj(ctx);
    const itemId = String(b.itemId ?? '');
    if (!itemId) throw badRequest('缺少节目');
    const e = r.execution;
    if (e.status !== 'running') throw err(409, 'NOT_RUNNING', '当前不在执行中');
    const target = r.items.find((x) => x.id === itemId);
    if (!target) throw badRequest('节目不存在');
    if (e.currentItemId === target.id) return json({ rundown: rundownJson(ctx.db, r) }); // 幂等
    const now = nowIso();
    const cur = e.actuals.find((a) => a.itemId === e.currentItemId);
    if (cur) cur.endedAt = now;
    e.actuals = e.actuals.filter((a) => a.itemId !== target.id);
    e.actuals.push({ itemId: target.id, startedAt: now, endedAt: null });
    e.currentItemId = target.id;
    r.updatedAt = now;
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/shift', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const e = r.execution;
    if (e.status !== 'running') throw err(409, 'NOT_RUNNING', '当前不在执行中');
    const minutes = Number(bodyObj(ctx).minutes);
    if (!Number.isInteger(minutes) || Math.abs(minutes) > 240) throw badRequest('顺延分钟数必须为 ±240 内的整数');
    const next = e.shiftMin + minutes;
    if (Math.abs(next) > 1440) throw badRequest('顺延累计超出 ±1440 分钟');
    e.shiftMin = next;
    r.updatedAt = nowIso();
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/finish', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    const e = r.execution;
    if (e.status !== 'running') throw err(409, 'NOT_RUNNING', '当前不在执行中');
    const now = nowIso();
    const cur = e.actuals.find((a) => a.itemId === e.currentItemId);
    if (cur && !cur.endedAt) cur.endedAt = now;
    e.status = 'finished';
    e.finishedAt = now;
    e.currentItemId = null;
    r.updatedAt = now;
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  def('POST', '/api/projects/:pid/stage-rundowns/:rid/execution/reset', async (ctx) => {
    requireProject(ctx);
    const r = findRundown(ctx);
    r.execution = { status: 'idle', currentItemId: null, startedAt: null, finishedAt: null, shiftMin: 0, actuals: [] };
    r.updatedAt = nowIso();
    return json({ rundown: rundownJson(ctx.db, r) });
  }),

  // ---------- 现场大屏分享 ----------

  def('GET', '/api/projects/:pid/stage-rundowns/:rid/screen-share', async (ctx) => {
    requireProject(ctx);
    const share = loadOrCreateShare(ctx.db, findRundown(ctx));
    return json({ share: { enabled: share.enabled, token: share.token } });
  }),

  def('PUT', '/api/projects/:pid/stage-rundowns/:rid/screen-share', async (ctx) => {
    requireProject(ctx);
    const share = loadOrCreateShare(ctx.db, findRundown(ctx));
    const b = bodyObj(ctx);
    if (typeof b.enabled === 'boolean') share.enabled = b.enabled;
    if (b.regenerate === true) share.token = uid();
    return json({ share: { enabled: share.enabled, token: share.token } });
  }),

  // ---------- 对外免登录公开端点（白名单：无 contact/note/attachments） ----------

  def('GET', '/api/public/rundown-screen/:token', async (ctx) => {
    const share = ctx.db.screenShares.find((s) => s.token === ctx.params.token);
    if (!share || !share.enabled) throw notFound('链接不存在或已关闭');
    const r = ctx.db.stageRundowns.find((x) => x.id === share.rundownId && x.projectId === share.projectId);
    if (!r) throw notFound('链接不存在或已关闭');
    const project = ctx.db.projects.find((p) => p.id === share.projectId);
    if (!project) throw notFound('链接不存在或已关闭');
    const nowMs = Date.now();
    const announcements = ctx.db.announcements
      .filter((a) => a.projectId === share.projectId && a.type === 'emergency')
      .filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > nowMs)
      .filter((a) => a.visibility.userIds.length === 0 && a.visibility.roleNames.length === 0)
      .sort(
        (a, b) =>
          Number(b.isPinned) - Number(a.isPinned) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      )
      .slice(0, 5)
      .map((a) => ({ id: a.id, title: a.title, content: a.content, publishedAt: a.publishedAt }));
    return json({
      projectName: project.name,
      now: nowIso(),
      rundown: {
        name: r.name,
        startAt: r.startAt,
        items: r.items.map((it) => ({
          id: it.id,
          name: it.name,
          durationMin: it.durationMin,
          participants: it.participants.map((p) => ({ cn: p.cn })),
        })),
        execution: r.execution,
      },
      announcements,
    });
  }),
];
