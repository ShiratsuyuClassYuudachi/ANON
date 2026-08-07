import { Router } from 'express';
import { Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { upload } from '../middleware/upload';
import { File } from '../models/File';
import { StageRundown, type IStageParticipant, type IStageRundownItem, type StageRundownDoc } from '../models/StageRundown';
import { deleteStored, persistUploads } from '../services/storage';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const stageRundownsRouter = Router({ mergeParams: true });
stageRundownsRouter.use(authRequired, loadMembership);

// ---------- helpers ----------

type FileMeta = { id: string; filename: string; mime: string; size: number };
type FileMap = Map<string, FileMeta>;

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
    await deleteFiles(doc.items.flatMap((it) => it.attachmentIds));
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
    const item = doc.items.id(req.params.itemId);
    if (!item) throw new AppError(404, 'not_found', '节目不存在');
    await deleteFiles([...item.attachmentIds]);
    doc.items.pull({ _id: item._id });
    await doc.save();
    res.json({ ok: true });
  }),
);
