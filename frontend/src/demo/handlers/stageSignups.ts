import { badRequest, bodyObj, json, nameOf, notFound, nowIso, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbStageRundown, DbStageSignup, DbStageSignupItem } from '../types';

function itemJson(db: Db, it: DbStageSignupItem) {
  return {
    id: it.id,
    name: it.name,
    durationMin: it.durationMin,
    participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
    note: it.note,
    status: it.status,
    reviews: it.reviews.map((r) => ({
      userId: r.userId,
      userName: nameOf(db, r.userId),
      decision: r.decision,
      comment: r.comment,
      updatedAt: r.updatedAt,
    })),
  };
}

function signupJson(db: Db, s: DbStageSignup) {
  return {
    id: s.id,
    name: s.name,
    startAt: s.startAt,
    endAt: s.endAt,
    note: s.note,
    items: s.items.map((it) => itemJson(db, it)),
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function summaryJson(s: DbStageSignup) {
  return {
    id: s.id,
    name: s.name,
    startAt: s.startAt,
    endAt: s.endAt,
    note: s.note,
    itemCount: s.items.length,
    approvedCount: s.items.filter((it) => it.status === 'approved').length,
    totalDurationMin: s.items.reduce((sum, it) => sum + it.durationMin, 0),
    availableMin: Math.round((new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 60000),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** 与 demo stageRundowns 同形的 rundown 序列化（import 响应用） */
function rundownJson(db: Db, r: DbStageRundown) {
  return {
    id: r.id,
    name: r.name,
    startAt: r.startAt,
    note: r.note,
    items: r.items.map((it) => ({
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
    })),
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function findSignup(ctx: Ctx): DbStageSignup {
  const s = ctx.db.stageSignups.find((x) => x.id === ctx.params.sid && x.projectId === ctx.params.pid);
  if (!s) throw notFound('报名批次不存在');
  return s;
}

function findItem(s: DbStageSignup, itemId: string): DbStageSignupItem {
  const it = s.items.find((x) => x.id === itemId);
  if (!it) throw notFound('节目不存在');
  return it;
}

function assertDurationMin(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1440) {
    throw badRequest('时长必须为 1–1440 分钟的整数');
  }
  return n;
}

function parseTime(v: unknown): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('时间格式无效');
  return d.toISOString();
}

/** participants 直接接受 JSON 数组：每项取 cn/contact trim，过滤空 cn */
function parseParticipants(v: unknown): { cn: string; contact: string }[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest('participants 格式无效');
  return v
    .map((p) => {
      const o: Record<string, unknown> = p !== null && typeof p === 'object' ? p : {};
      return {
        cn: String(o.cn ?? '').trim(),
        contact: String(o.contact ?? '').trim(),
      };
    })
    .filter((p) => p.cn);
}

export const stageSignupRoutes: Route[] = [
  def('GET', '/api/projects/:pid/stage-signups', async (ctx) => {
    requireProject(ctx);
    const signups = ctx.db.stageSignups
      .filter((s) => s.projectId === ctx.params.pid)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.createdAt.localeCompare(b.createdAt));
    return json({ signups: signups.map(summaryJson) });
  }),

  def('POST', '/api/projects/:pid/stage-signups', async (ctx) => {
    requireProject(ctx);
    const b = bodyObj(ctx);
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('名称不能为空');
    const startAt = parseTime(b.startAt);
    const endAt = parseTime(b.endAt);
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) throw badRequest('结束时间必须晚于开始时间');
    const now = nowIso();
    const signup: DbStageSignup = {
      id: uid(),
      projectId: ctx.params.pid,
      name,
      startAt,
      endAt,
      note: String(b.note ?? '').trim(),
      items: [],
      createdBy: ctx.db.currentUserId,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.stageSignups.push(signup);
    return json({ signup: signupJson(ctx.db, signup) }, 201);
  }),

  def('GET', '/api/projects/:pid/stage-signups/:sid', async (ctx) => {
    requireProject(ctx);
    return json({ signup: signupJson(ctx.db, findSignup(ctx)) });
  }),

  def('PATCH', '/api/projects/:pid/stage-signups/:sid', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const b = bodyObj(ctx);
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw badRequest('名称不能为空');
      s.name = name;
    }
    if (b.startAt !== undefined) s.startAt = parseTime(b.startAt);
    if (b.endAt !== undefined) s.endAt = parseTime(b.endAt);
    if (new Date(s.endAt).getTime() <= new Date(s.startAt).getTime()) throw badRequest('结束时间必须晚于开始时间');
    if (b.note !== undefined) s.note = String(b.note).trim();
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('DELETE', '/api/projects/:pid/stage-signups/:sid', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    ctx.db.stageSignups = ctx.db.stageSignups.filter((x) => x.id !== s.id);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/stage-signups/:sid/items', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const b = bodyObj(ctx);
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('节目名称不能为空');
    const item: DbStageSignupItem = {
      id: uid(),
      name,
      durationMin: assertDurationMin(b.durationMin),
      participants: parseParticipants(b.participants),
      note: String(b.note ?? '').trim(),
      status: 'pending',
      reviews: [],
    };
    s.items.push(item);
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) }, 201);
  }),

  def('PATCH', '/api/projects/:pid/stage-signups/:sid/items/:itemId', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const item = findItem(s, ctx.params.itemId);
    const b = bodyObj(ctx);
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw badRequest('节目名称不能为空');
      item.name = name;
    }
    if (b.durationMin !== undefined) item.durationMin = assertDurationMin(b.durationMin);
    if (b.participants !== undefined) item.participants = parseParticipants(b.participants);
    if (b.note !== undefined) item.note = String(b.note).trim();
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('DELETE', '/api/projects/:pid/stage-signups/:sid/items/:itemId', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    findItem(s, ctx.params.itemId);
    s.items = s.items.filter((x) => x.id !== ctx.params.itemId);
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('PATCH', '/api/projects/:pid/stage-signups/:sid/items/:itemId/status', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const item = findItem(s, ctx.params.itemId);
    const status = bodyObj(ctx).status;
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') throw badRequest('无效的状态');
    item.status = status;
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('PUT', '/api/projects/:pid/stage-signups/:sid/items/:itemId/review', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const item = findItem(s, ctx.params.itemId);
    const b = bodyObj(ctx);
    const decision = b.decision;
    if (decision !== 'approve' && decision !== 'reject') throw badRequest('无效的投票');
    const comment = String(b.comment ?? '').trim();
    const existing = item.reviews.find((r) => r.userId === ctx.db.currentUserId);
    if (existing) {
      existing.decision = decision;
      existing.comment = comment;
      existing.updatedAt = nowIso();
    } else {
      item.reviews.push({ userId: ctx.db.currentUserId, decision, comment, updatedAt: nowIso() });
    }
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('DELETE', '/api/projects/:pid/stage-signups/:sid/items/:itemId/review', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const item = findItem(s, ctx.params.itemId);
    item.reviews = item.reviews.filter((r) => r.userId !== ctx.db.currentUserId);
    s.updatedAt = nowIso();
    return json({ signup: signupJson(ctx.db, s) });
  }),

  def('POST', '/api/projects/:pid/stage-signups/:sid/import', async (ctx) => {
    requireProject(ctx);
    const s = findSignup(ctx);
    const rundown = ctx.db.stageRundowns.find(
      (x) => x.id === String(bodyObj(ctx).rundownId ?? '') && x.projectId === ctx.params.pid,
    );
    if (!rundown) throw notFound('Rundown 不存在');
    const approved = s.items.filter((it) => it.status === 'approved');
    if (approved.length === 0) throw badRequest('没有已通过的节目可导入');
    for (const it of approved) {
      rundown.items.push({
        id: uid(),
        name: it.name,
        durationMin: it.durationMin,
        participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
        attachmentIds: [],
        note: it.note,
      });
    }
    rundown.updatedAt = nowIso();
    return json({ rundown: rundownJson(ctx.db, rundown) });
  }),
];
