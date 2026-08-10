import { Router } from 'express';
import { Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { File } from '../models/File';
import { StageRundown, type IStageParticipant } from '../models/StageRundown';
import { StageSignup, type IStageSignupItem, type StageSignupDoc } from '../models/StageSignup';
import { User } from '../models/User';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const stageSignupsRouter = Router({ mergeParams: true });
stageSignupsRouter.use(authRequired, loadMembership);

// ---------- helpers ----------

type FileMeta = { id: string; filename: string; mime: string; size: number };

async function buildUserMap(items: IStageSignupItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.flatMap((it) => it.reviews.map((r) => r.userId.toString())))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

function itemJson(it: IStageSignupItem, userMap: Map<string, string>) {
  return {
    id: it._id.toString(),
    name: it.name,
    durationMin: it.durationMin,
    participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
    note: it.note,
    status: it.status,
    reviews: it.reviews.map((r) => ({
      userId: r.userId.toString(),
      userName: userMap.get(r.userId.toString()) ?? '未知用户',
      decision: r.decision,
      comment: r.comment,
      updatedAt: r.updatedAt,
    })),
  };
}

async function signupJson(doc: StageSignupDoc) {
  const userMap = await buildUserMap(doc.items);
  return {
    id: doc._id.toString(),
    name: doc.name,
    startAt: doc.startAt,
    endAt: doc.endAt,
    note: doc.note,
    items: doc.items.map((it) => itemJson(it, userMap)),
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function summaryJson(doc: StageSignupDoc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    startAt: doc.startAt,
    endAt: doc.endAt,
    note: doc.note,
    itemCount: doc.items.length,
    approvedCount: doc.items.filter((it) => it.status === 'approved').length,
    totalDurationMin: doc.items.reduce((sum, it) => sum + it.durationMin, 0),
    availableMin: Math.round((doc.endAt.getTime() - doc.startAt.getTime()) / 60000),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** 导入后返回的 rundown 序列化（与 stageRundowns 路由同形；附件经 File 批量解析，缺失跳过） */
async function rundownJson(rid: Types.ObjectId) {
  const doc = await StageRundown.findById(rid);
  if (!doc) throw new AppError(404, 'not_found', 'Rundown 不存在');
  const attachmentIds = [...new Set(doc.items.flatMap((it) => it.attachmentIds.map((id) => id.toString())))];
  const files = attachmentIds.length ? await File.find({ _id: { $in: attachmentIds } }).lean() : [];
  const fileMap = new Map<string, FileMeta>(
    files.map((f) => [f._id.toString(), { id: f._id.toString(), filename: f.filename, mime: f.mime, size: f.size }]),
  );
  return {
    id: doc._id.toString(),
    name: doc.name,
    startAt: doc.startAt,
    note: doc.note,
    items: doc.items.map((it) => ({
      id: it._id.toString(),
      name: it.name,
      durationMin: it.durationMin,
      participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
      attachments: it.attachmentIds
        .map((id) => fileMap.get(id.toString()))
        .filter((x): x is FileMeta => !!x),
      note: it.note,
    })),
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function assertDurationMin(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1440) {
    throw new AppError(400, 'bad_request', '时长必须为 1–1440 分钟的整数');
  }
  return n;
}

function parseTime(v: unknown, field: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', `${field}格式无效`);
  return d;
}

/** participants 直接接受 JSON 数组：每项取 cn/contact trim，过滤空 cn */
function parseParticipants(v: unknown): IStageParticipant[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(400, 'bad_request', 'participants 格式无效');
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

async function loadSignup(sid: string, projectId: Types.ObjectId) {
  const doc = await StageSignup.findOne({ _id: sid, projectId });
  if (!doc) throw new AppError(404, 'not_found', '报名批次不存在');
  return doc;
}

function loadItem(doc: StageSignupDoc, itemId: string) {
  const item = doc.items.id(itemId);
  if (!item) throw new AppError(404, 'not_found', '节目不存在');
  return item;
}

// ---------- 报名批次 ----------

stageSignupsRouter.get(
  '/',
  ah(async (req, res) => {
    const docs = await StageSignup.find({ projectId: req.project!._id }).sort({ startAt: 1, createdAt: 1 });
    res.json({ signups: docs.map(summaryJson) });
  }),
);

stageSignupsRouter.post(
  '/',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
    const startAt = parseTime(b.startAt, '时间');
    const endAt = parseTime(b.endAt, '时间');
    if (endAt.getTime() <= startAt.getTime()) throw new AppError(400, 'bad_request', '结束时间必须晚于开始时间');
    const doc = await StageSignup.create({
      projectId: req.project!._id,
      name,
      startAt,
      endAt,
      note: String(b.note ?? '').trim(),
      items: [],
      createdBy: req.userId,
    });
    res.status(201).json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.get(
  '/:sid',
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    res.json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.patch(
  '/:sid',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
      doc.name = name;
    }
    if (b.startAt !== undefined) doc.startAt = parseTime(b.startAt, '时间');
    if (b.endAt !== undefined) doc.endAt = parseTime(b.endAt, '时间');
    if (doc.endAt.getTime() <= doc.startAt.getTime()) {
      throw new AppError(400, 'bad_request', '结束时间必须晚于开始时间');
    }
    if (b.note !== undefined) doc.note = String(b.note).trim();
    await doc.save();
    res.json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.delete(
  '/:sid',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    await doc.deleteOne();
    res.json({ ok: true });
  }),
);

// ---------- 报名节目 ----------

stageSignupsRouter.post(
  '/:sid/items',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '节目名称不能为空');
    doc.items.push({
      name,
      durationMin: assertDurationMin(b.durationMin),
      participants: parseParticipants(b.participants),
      note: String(b.note ?? '').trim(),
    } as IStageSignupItem);
    await doc.save();
    res.status(201).json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.patch(
  '/:sid/items/:itemId',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const item = loadItem(doc, req.params.itemId);
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new AppError(400, 'bad_request', '节目名称不能为空');
      item.name = name;
    }
    if (b.durationMin !== undefined) item.durationMin = assertDurationMin(b.durationMin);
    if (b.participants !== undefined) item.participants = parseParticipants(b.participants);
    if (b.note !== undefined) item.note = String(b.note).trim();
    await doc.save();
    res.json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.delete(
  '/:sid/items/:itemId',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const item = loadItem(doc, req.params.itemId);
    doc.items.pull({ _id: item._id });
    await doc.save();
    res.json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.patch(
  '/:sid/items/:itemId/status',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const item = loadItem(doc, req.params.itemId);
    const status = req.body?.status;
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
      throw new AppError(400, 'bad_request', '无效的状态');
    }
    item.status = status;
    await doc.save();
    res.json({ signup: await signupJson(doc) });
  }),
);

// ---------- 投票 ----------

stageSignupsRouter.put(
  '/:sid/items/:itemId/review',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const item = loadItem(doc, req.params.itemId);
    const b = req.body ?? {};
    const decision = b.decision;
    if (decision !== 'approve' && decision !== 'reject') throw new AppError(400, 'bad_request', '无效的投票');
    const comment = String(b.comment ?? '').trim();
    const userId = req.userId!;
    const existing = item.reviews.find((r) => r.userId.toString() === userId);
    if (existing) {
      existing.decision = decision;
      existing.comment = comment;
      existing.updatedAt = new Date();
    } else {
      item.reviews.push({ userId: new Types.ObjectId(userId), decision, comment, updatedAt: new Date() });
    }
    await doc.save();
    res.json({ signup: await signupJson(doc) });
  }),
);

stageSignupsRouter.delete(
  '/:sid/items/:itemId/review',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const item = loadItem(doc, req.params.itemId);
    const idx = item.reviews.findIndex((r) => r.userId.toString() === req.userId!);
    if (idx >= 0) {
      item.reviews.splice(idx, 1);
      await doc.save();
    }
    res.json({ signup: await signupJson(doc) });
  }),
);

// ---------- 导入 Rundown ----------

stageSignupsRouter.post(
  '/:sid/import',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadSignup(req.params.sid, req.project!._id);
    const rundown = await StageRundown.findOne({ _id: String(req.body?.rundownId ?? ''), projectId: req.project!._id });
    if (!rundown) throw new AppError(404, 'not_found', 'Rundown 不存在');
    const approved = doc.items.filter((it) => it.status === 'approved');
    if (approved.length === 0) throw new AppError(400, 'bad_request', '没有已通过的节目可导入');
    for (const it of approved) {
      rundown.items.push({
        name: it.name,
        durationMin: it.durationMin,
        participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
        note: it.note,
        attachmentIds: [],
      } as never);
    }
    await rundown.save();
    res.json({ rundown: await rundownJson(rundown._id) });
  }),
);
