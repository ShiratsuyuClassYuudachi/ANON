import crypto from 'crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { upload } from '../middleware/upload';
import { Announcement } from '../models/Announcement';
import { File } from '../models/File';
import { Project } from '../models/Project';
import { StageRundown, type IStageExecution, type IStageParticipant, type IStageRundownItem, type StageRundownDoc } from '../models/StageRundown';
import { StageScreenShare, type StageScreenShareDoc } from '../models/StageScreenShare';
import { deleteStored, persistUploads } from '../services/storage';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const stageRundownsRouter = Router({ mergeParams: true });
stageRundownsRouter.use(authRequired, loadMembership);

// ---------- helpers ----------

type FileMeta = { id: string; filename: string; mime: string; size: number };
type FileMap = Map<string, FileMeta>;

/** 旧文档无 execution 字段（Mongoose hydrate 不补 default），读取一律经此归一化 */
function execOf(doc: StageRundownDoc): IStageExecution {
  if (!doc.execution) {
    doc.execution = { status: 'idle', currentItemId: null, startedAt: null, finishedAt: null, shiftMin: 0, actuals: [] } as IStageExecution;
  }
  return doc.execution;
}

/** 执行中锁定编排：节目增删改/排序/startAt 修改/删除 Rundown 一律 409 */
function assertNotRunning(doc: StageRundownDoc) {
  if (execOf(doc).status === 'running') throw new AppError(409, 'EXECUTION_RUNNING', '执行中，请先结束或重置执行');
}

function executionJson(doc: StageRundownDoc) {
  const e = execOf(doc);
  return {
    status: e.status,
    currentItemId: e.currentItemId ? String(e.currentItemId) : null,
    startedAt: e.startedAt ? e.startedAt.toISOString() : null,
    finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
    shiftMin: e.shiftMin,
    actuals: e.actuals.map((a) => ({
      itemId: String(a.itemId),
      startedAt: a.startedAt.toISOString(),
      endedAt: a.endedAt ? a.endedAt.toISOString() : null,
    })),
  };
}

function itemJson(it: IStageRundownItem, fileMap: FileMap) {
  return {
    id: it._id.toString(),
    name: it.name,
    durationMin: it.durationMin,
    participants: it.participants.map((p) => ({ cn: p.cn, contact: p.contact })),
    attachments: it.attachmentIds
      .map((id) => fileMap.get(id.toString()))
      .filter((x): x is FileMeta => !!x),
    note: it.note,
  };
}

async function buildFileMap(items: IStageRundownItem[]): Promise<FileMap> {
  const ids = [...new Set(items.flatMap((it) => it.attachmentIds.map((id) => id.toString())))];
  if (ids.length === 0) return new Map();
  const files = await File.find({ _id: { $in: ids } }).lean();
  return new Map(
    files.map((f) => [
      f._id.toString(),
      { id: f._id.toString(), filename: f.filename, mime: f.mime, size: f.size },
    ]),
  );
}

async function rundownJson(doc: StageRundownDoc) {
  const fileMap = await buildFileMap(doc.items);
  return {
    id: doc._id.toString(),
    name: doc.name,
    startAt: doc.startAt,
    note: doc.note,
    items: doc.items.map((it) => itemJson(it, fileMap)),
    execution: executionJson(doc),
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function summaryJson(doc: StageRundownDoc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    startAt: doc.startAt,
    note: doc.note,
    itemCount: doc.items.length,
    totalDurationMin: doc.items.reduce((sum, it) => sum + it.durationMin, 0),
    executionStatus: execOf(doc).status,
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

function parseStartAt(v: unknown): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '开始时间格式无效');
  return d;
}

function parseParticipants(v: unknown): IStageParticipant[] {
  if (v === undefined || v === null || v === '') return [];
  let arr: unknown;
  try {
    arr = JSON.parse(String(v));
  } catch {
    throw new AppError(400, 'bad_request', 'participants 格式无效');
  }
  if (!Array.isArray(arr)) throw new AppError(400, 'bad_request', 'participants 格式无效');
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

function parseIdArray(v: unknown, field: string): string[] {
  if (v === undefined || v === null || v === '') return [];
  let arr: unknown;
  try {
    arr = JSON.parse(String(v));
  } catch {
    throw new AppError(400, 'bad_request', `${field} 格式无效`);
  }
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
    throw new AppError(400, 'bad_request', `${field} 格式无效`);
  }
  return arr as string[];
}

async function loadRundown(rid: string, projectId: Types.ObjectId) {
  const doc = await StageRundown.findOne({ _id: rid, projectId });
  if (!doc) throw new AppError(404, 'not_found', 'Rundown 不存在');
  return doc;
}

/** 删除存储对象与 File 文档；存储删除失败不阻断 */
async function deleteFiles(ids: Types.ObjectId[]) {
  if (ids.length === 0) return;
  const files = await File.find({ _id: { $in: ids } });
  for (const f of files) await deleteStored(f.path).catch(() => {});
  await File.deleteMany({ _id: { $in: files.map((f) => f._id) } });
}

// ---------- Rundown ----------

stageRundownsRouter.get(
  '/',
  ah(async (req, res) => {
    const docs = await StageRundown.find({ projectId: req.project!._id }).sort({ startAt: 1, createdAt: 1 });
    res.json({ rundowns: docs.map(summaryJson) });
  }),
);

stageRundownsRouter.post(
  '/',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
    const startAt = parseStartAt(b.startAt);
    const doc = await StageRundown.create({
      projectId: req.project!._id,
      name,
      startAt,
      note: String(b.note ?? '').trim(),
      items: [],
      createdBy: req.userId,
    });
    res.status(201).json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.get(
  '/:rid',
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.patch(
  '/:rid',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const b = req.body ?? {};
    if (b.startAt !== undefined) assertNotRunning(doc);
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
      doc.name = name;
    }
    if (b.startAt !== undefined) doc.startAt = parseStartAt(b.startAt);
    if (b.note !== undefined) doc.note = String(b.note).trim();
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.delete(
  '/:rid',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    assertNotRunning(doc);
    await deleteFiles(doc.items.flatMap((it) => it.attachmentIds));
    await StageScreenShare.deleteOne({ rundownId: doc._id });
    await doc.deleteOne();
    res.json({ ok: true });
  }),
);

// ---------- 节目条目 ----------

stageRundownsRouter.post(
  '/:rid/items',
  ...requirePermission('tools:manage'),
  upload.array('files', 10),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    assertNotRunning(doc);
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '节目名称不能为空');
    const durationMin = assertDurationMin(b.durationMin);
    const participants = parseParticipants(b.participants);
    const uploaded = (req.files as Express.Multer.File[]) ?? [];
    const fileDocs = await persistUploads(uploaded, req.project!._id, req.userId);
    doc.items.push({
      name,
      durationMin,
      participants,
      attachmentIds: fileDocs.map((f) => f._id),
      note: String(b.note ?? '').trim(),
    } as IStageRundownItem);
    await doc.save();
    const item = doc.items[doc.items.length - 1];
    res.status(201).json({ item: itemJson(item, await buildFileMap([item])) });
  }),
);

// 注意：/:rid/items/reorder 必须注册在 /:rid/items/:itemId 之前，否则会被 :itemId 捕获
stageRundownsRouter.patch(
  '/:rid/items/reorder',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const order = req.body?.order;
    const current = doc.items.map((it) => it._id.toString());
    const bad = new AppError(400, 'bad_request', 'order 必须与现有节目一一对应');
    if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) throw bad;
    if (order.length !== current.length) throw bad;
    const set = new Set(order as string[]);
    if (set.size !== current.length || !current.every((id) => set.has(id))) throw bad;
    // 执行中仅允许在未执行节目槽位内重排：有实际记录或为当前节目的位置必须原样
    const e = execOf(doc);
    if (e.status === 'running') {
      const locked = (id: string) =>
        (e.currentItemId !== null && String(e.currentItemId) === id) ||
        e.actuals.some((a) => String(a.itemId) === id);
      for (let i = 0; i < current.length; i++) {
        if (locked(current[i]) && (order as string[])[i] !== current[i]) {
          throw new AppError(409, 'EXECUTION_RUNNING', '执行中仅可调整未执行节目的顺序');
        }
      }
    }
    const byId = new Map(doc.items.map((it) => [it._id.toString(), it]));
    doc.items = (order as string[]).map((id) => byId.get(id)!) as unknown as typeof doc.items;
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.patch(
  '/:rid/items/:itemId',
  ...requirePermission('tools:manage'),
  upload.array('files', 10),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    assertNotRunning(doc);
    const item = doc.items.id(req.params.itemId);
    if (!item) throw new AppError(404, 'not_found', '节目不存在');
    const b = req.body ?? {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new AppError(400, 'bad_request', '节目名称不能为空');
      item.name = name;
    }
    if (b.durationMin !== undefined) item.durationMin = assertDurationMin(b.durationMin);
    if (b.participants !== undefined) item.participants = parseParticipants(b.participants);
    if (b.note !== undefined) item.note = String(b.note).trim();

    const removeIds = parseIdArray(b.removeAttachmentIds, 'removeAttachmentIds');
    if (removeIds.length) {
      const removeSet = new Set(removeIds);
      const toDelete = item.attachmentIds.filter((id) => removeSet.has(id.toString()));
      item.attachmentIds = item.attachmentIds.filter((id) => !removeSet.has(id.toString())) as unknown as typeof item.attachmentIds;
      await deleteFiles(toDelete);
    }

    const uploaded = (req.files as Express.Multer.File[]) ?? [];
    if (uploaded.length) {
      const fileDocs = await persistUploads(uploaded, req.project!._id, req.userId);
      item.attachmentIds.push(...fileDocs.map((f) => f._id));
    }
    await doc.save();
    res.json({ item: itemJson(item, await buildFileMap([item])) });
  }),
);

stageRundownsRouter.delete(
  '/:rid/items/:itemId',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    assertNotRunning(doc);
    const item = doc.items.id(req.params.itemId);
    if (!item) throw new AppError(404, 'not_found', '节目不存在');
    await deleteFiles([...item.attachmentIds]);
    doc.items.pull({ _id: item._id });
    await doc.save();
    res.json({ ok: true });
  }),
);

// ---------- 执行控制 ----------

/** 当前节目对应的 actual 记录（running 时必有，防御性查找） */
function currentActual(e: IStageExecution) {
  return e.currentItemId ? e.actuals.find((a) => a.itemId.equals(e.currentItemId)) : undefined;
}

function assertRunning(e: IStageExecution) {
  if (e.status !== 'running') throw new AppError(409, 'NOT_RUNNING', '当前不在执行中');
}

stageRundownsRouter.post(
  '/:rid/execution/start',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const e = execOf(doc);
    if (e.status === 'running') throw new AppError(409, 'ALREADY_RUNNING', '已在执行中');
    if (doc.items.length === 0) throw new AppError(400, 'bad_request', '请先添加节目');
    let target = doc.items[0];
    if (req.body?.itemId !== undefined) {
      const found = doc.items.id(String(req.body.itemId));
      if (!found) throw new AppError(400, 'bad_request', '节目不存在');
      target = found;
    }
    // 总是重置后重记：idle→开始；finished→重新执行（清旧记录）
    const now = new Date();
    e.status = 'running';
    e.startedAt = now;
    e.finishedAt = null;
    e.shiftMin = 0;
    e.actuals = [{ itemId: target._id, startedAt: now, endedAt: null }];
    e.currentItemId = target._id;
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.post(
  '/:rid/execution/advance',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const e = execOf(doc);
    assertRunning(e);
    const now = new Date();
    const cur = currentActual(e);
    if (cur) cur.endedAt = now;
    const idx = e.currentItemId ? doc.items.findIndex((it) => it._id.equals(e.currentItemId!)) : -1;
    if (idx >= 0 && idx + 1 < doc.items.length) {
      const next = doc.items[idx + 1];
      e.currentItemId = next._id;
      e.actuals = e.actuals.filter((a) => !a.itemId.equals(next._id));
      e.actuals.push({ itemId: next._id, startedAt: now, endedAt: null });
    } else {
      e.status = 'finished';
      e.finishedAt = now;
      e.currentItemId = null;
    }
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.post(
  '/:rid/execution/jump',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const itemId = String(req.body?.itemId ?? '');
    if (!itemId) throw new AppError(400, 'bad_request', '缺少节目');
    const e = execOf(doc);
    assertRunning(e);
    const target = doc.items.id(itemId);
    if (!target) throw new AppError(400, 'bad_request', '节目不存在');
    if (e.currentItemId && target._id.equals(e.currentItemId)) {
      res.json({ rundown: await rundownJson(doc) }); // 幂等，不写库
      return;
    }
    const now = new Date();
    const cur = currentActual(e);
    if (cur) cur.endedAt = now;
    e.actuals = e.actuals.filter((a) => !a.itemId.equals(target._id));
    e.actuals.push({ itemId: target._id, startedAt: now, endedAt: null });
    e.currentItemId = target._id;
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.post(
  '/:rid/execution/shift',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const e = execOf(doc);
    assertRunning(e);
    const minutes = Number(req.body?.minutes);
    if (!Number.isInteger(minutes) || Math.abs(minutes) > 240) {
      throw new AppError(400, 'bad_request', '顺延分钟数必须为 ±240 内的整数');
    }
    const next = e.shiftMin + minutes;
    if (Math.abs(next) > 1440) throw new AppError(400, 'bad_request', '顺延累计超出 ±1440 分钟');
    e.shiftMin = next;
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.post(
  '/:rid/execution/finish',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const e = execOf(doc);
    assertRunning(e);
    const now = new Date();
    const cur = currentActual(e);
    if (cur && !cur.endedAt) cur.endedAt = now;
    e.status = 'finished';
    e.finishedAt = now;
    e.currentItemId = null;
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

stageRundownsRouter.post(
  '/:rid/execution/reset',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const e = execOf(doc);
    e.status = 'idle';
    e.currentItemId = null;
    e.startedAt = null;
    e.finishedAt = null;
    e.shiftMin = 0;
    e.actuals = [];
    await doc.save();
    res.json({ rundown: await rundownJson(doc) });
  }),
);

// ---------- 现场大屏分享（字面量段 /:rid/screen-share 与既有路由无冲突） ----------

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function shareJson(s: StageScreenShareDoc) {
  return { enabled: s.enabled, token: s.token };
}

/** 惰性创建分享文档；token 唯一索引冲突重试至多 3 次 */
async function loadOrCreateShare(projectId: Types.ObjectId, rundownId: Types.ObjectId): Promise<StageScreenShareDoc> {
  const existing = await StageScreenShare.findOne({ rundownId });
  if (existing) return existing;
  for (let i = 0; i < 3; i++) {
    try {
      return await StageScreenShare.create({ projectId, rundownId, token: newToken(), enabled: false });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || i === 2) throw e;
    }
  }
  throw new AppError(500, 'internal', '服务器内部错误');
}

stageRundownsRouter.get(
  '/:rid/screen-share',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const share = await loadOrCreateShare(req.project!._id, doc._id);
    res.json({ share: shareJson(share) });
  }),
);

stageRundownsRouter.put(
  '/:rid/screen-share',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const doc = await loadRundown(req.params.rid, req.project!._id);
    const share = await loadOrCreateShare(req.project!._id, doc._id);
    const { enabled, regenerate } = req.body ?? {};
    if (typeof enabled === 'boolean') share.enabled = enabled;
    if (regenerate === true) share.token = newToken();
    await share.save();
    res.json({ share: shareJson(share) });
  }),
);

// ---------- 对外免登录公开端点（不挂 authRequired） ----------

export const publicRundownScreenRouter = Router();

publicRundownScreenRouter.get(
  '/:token',
  ah(async (req, res) => {
    const share = await StageScreenShare.findOne({ token: req.params.token });
    if (!share || !share.enabled) throw new AppError(404, 'not_found', '链接不存在或已关闭');
    // rundown 必须属于该分享的项目，防跨项目猜 id
    const doc = await StageRundown.findOne({ _id: share.rundownId, projectId: share.projectId });
    if (!doc) throw new AppError(404, 'not_found', '链接不存在或已关闭');
    const project = await Project.findById(share.projectId);
    if (!project) throw new AppError(404, 'not_found', '链接不存在或已关闭');
    const now = new Date();
    // 白名单：仅紧急 + 未过期 + 全员可见（visibility 双空）的前 5 条
    const anns = await Announcement.find({
      projectId: share.projectId,
      type: 'emergency',
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      'visibility.userIds': { $size: 0 },
      'visibility.roleNames': { $size: 0 },
    })
      .sort({ isPinned: -1, publishedAt: -1 })
      .limit(5)
      .lean();
    res.json({
      projectName: project.name,
      now: now.toISOString(),
      rundown: {
        name: doc.name,
        startAt: doc.startAt.toISOString(),
        items: doc.items.map((it) => ({
          id: it._id.toString(),
          name: it.name,
          durationMin: it.durationMin,
          participants: it.participants.map((p) => ({ cn: p.cn })),
        })),
        execution: executionJson(doc),
      },
      announcements: anns.map((a) => ({
        id: String(a._id),
        title: a.title,
        content: a.content,
        publishedAt: a.publishedAt.toISOString(),
      })),
    });
  }),
);
