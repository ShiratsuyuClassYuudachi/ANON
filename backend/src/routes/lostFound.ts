import crypto from 'crypto';
import fs from 'fs';
import { Router } from 'express';
import type { Response } from 'express';
import type { Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { upload } from '../middleware/upload';
import { File } from '../models/File';
import { LostFoundItem, type LostFoundItemDoc } from '../models/LostFoundItem';
import { LostFoundShare, type LostFoundShareDoc } from '../models/LostFoundShare';
import { Project } from '../models/Project';
import { generatePreview } from '../services/preview';
import { deleteStored, persistUploads, sendStoredFile } from '../services/storage';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const lostFoundRouter = Router({ mergeParams: true });
lostFoundRouter.use(authRequired, loadMembership);

// ---------- helpers ----------

function itemJson(it: LostFoundItemDoc) {
  return {
    id: it._id.toString(),
    name: it.name,
    note: it.note,
    foundAt: it.foundAt,
    foundLocation: it.foundLocation,
    status: it.status,
    claimedAt: it.claimedAt,
    claimNote: it.claimNote,
    hasPhoto: !!it.photoId,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  };
}

/** 公开响应显式白名单：不含 claimNote/createdBy 等内部字段 */
function publicItemJson(it: LostFoundItemDoc) {
  return {
    id: it._id.toString(),
    name: it.name,
    note: it.note,
    foundAt: it.foundAt,
    foundLocation: it.foundLocation,
    status: it.status,
    claimedAt: it.claimedAt,
    hasPhoto: !!it.photoId,
  };
}

function shareJson(share: LostFoundShareDoc) {
  return { enabled: share.enabled, token: share.token };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** q 命中名称/描述/捡到地点（大小写不敏感）；status 仅 pending|claimed 生效，非法值忽略 */
function buildFilter(projectId: Types.ObjectId, query: { q?: unknown; status?: unknown }) {
  const filter: Record<string, unknown> = { projectId };
  const status = typeof query.status === 'string' ? query.status : '';
  if (status === 'pending' || status === 'claimed') filter.status = status;
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ name: rx }, { note: rx }, { foundLocation: rx }];
  }
  return filter;
}

function parseFoundAt(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '无效的时间');
  return d;
}

function parseName(v: unknown): string {
  const name = String(v ?? '').trim();
  if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
  return name;
}

/** multer 已落暂存；非图片须清孤儿暂存再 400 */
function assertImageFile(file: Express.Multer.File | undefined) {
  if (!file) return;
  if (!file.mimetype.startsWith('image/')) {
    void fs.promises.unlink(file.path).catch(() => {});
    throw new AppError(400, 'bad_request', '仅支持图片文件');
  }
}

async function loadItem(itemId: string, projectId: Types.ObjectId): Promise<LostFoundItemDoc> {
  const doc = await LostFoundItem.findOne({ _id: itemId, projectId });
  if (!doc) throw new AppError(404, 'not_found', '物品不存在');
  return doc;
}

/** 预览图优先，原图兜底；不传 downloadName 以便 <img> 内联展示 */
async function streamPhoto(res: Response, item: LostFoundItemDoc) {
  if (item.photoPreviewPath) {
    await sendStoredFile(res, item.photoPreviewPath);
    return;
  }
  if (!item.photoId) throw new AppError(404, 'not_found', '物品没有照片');
  const f = await File.findById(item.photoId);
  if (!f) throw new AppError(404, 'not_found', '物品没有照片');
  await sendStoredFile(res, f.path);
}

/** 删除照片原图/预览图存储对象与 File 文档；存储删除失败不阻断 */
async function deletePhoto(item: LostFoundItemDoc) {
  if (item.photoPreviewPath) {
    await deleteStored(item.photoPreviewPath).catch(() => {});
    item.photoPreviewPath = null;
  }
  if (item.photoId) {
    const f = await File.findById(item.photoId);
    if (f) {
      await deleteStored(f.path).catch(() => {});
      await f.deleteOne();
    }
    item.photoId = null;
  }
}

/** 接收照片：先生成 WebP 预览再 persist（S3 模式 persist 会删除暂存文件，顺序不能反） */
async function acceptPhoto(file: Express.Multer.File, projectId: Types.ObjectId, userId: string | Types.ObjectId | undefined, item: LostFoundItemDoc) {
  const previewRef = await generatePreview(file.path);
  const [doc] = await persistUploads([file], projectId, userId);
  item.photoId = doc._id;
  item.photoPreviewPath = previewRef;
}

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** 惰性创建分享文档；token 唯一索引冲突重试至多 3 次 */
async function loadOrCreateShare(projectId: Types.ObjectId): Promise<LostFoundShareDoc> {
  const existing = await LostFoundShare.findOne({ projectId });
  if (existing) return existing;
  for (let i = 0; i < 3; i++) {
    try {
      return await LostFoundShare.create({ projectId, token: newToken(), enabled: false });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || i === 2) throw e;
    }
  }
  throw new AppError(500, 'internal', '服务器内部错误');
}

async function loadEnabledShare(token: string): Promise<LostFoundShareDoc> {
  const share = await LostFoundShare.findOne({ token });
  if (!share || !share.enabled) throw new AppError(404, 'not_found', '链接不存在或已关闭');
  return share;
}

// ---------- 分享开关（字面量路由须先于 /:itemId 注册） ----------

lostFoundRouter.get(
  '/share',
  ...requirePermission('lostfound:manage'),
  ah(async (req, res) => {
    const share = await loadOrCreateShare(req.project!._id);
    res.json({ share: shareJson(share) });
  }),
);

lostFoundRouter.put(
  '/share',
  ...requirePermission('lostfound:manage'),
  ah(async (req, res) => {
    const share = await loadOrCreateShare(req.project!._id);
    const { enabled, regenerate } = req.body ?? {};
    if (typeof enabled === 'boolean') share.enabled = enabled;
    if (regenerate === true) share.token = newToken();
    await share.save();
    res.json({ share: shareJson(share) });
  }),
);

// ---------- 物品 ----------

lostFoundRouter.get(
  '/',
  ah(async (req, res) => {
    const items = await LostFoundItem.find(buildFilter(req.project!._id, req.query))
      .sort({ foundAt: -1 })
      .limit(200);
    res.json({ items: items.map(itemJson) });
  }),
);

lostFoundRouter.post(
  '/',
  ...requirePermission('lostfound:manage'),
  upload.single('photo'),
  ah(async (req, res) => {
    assertImageFile(req.file);
    const item = new LostFoundItem({
      projectId: req.project!._id,
      name: parseName(req.body?.name),
      note: String(req.body?.note ?? '').trim(),
      foundAt: parseFoundAt(req.body?.foundAt) ?? new Date(),
      foundLocation: String(req.body?.foundLocation ?? '').trim(),
      createdBy: req.userId,
    });
    if (req.file) await acceptPhoto(req.file, req.project!._id, req.userId, item);
    await item.save();
    res.status(201).json({ item: itemJson(item) });
  }),
);

lostFoundRouter.get(
  '/:itemId',
  ah(async (req, res) => {
    const item = await loadItem(req.params.itemId, req.project!._id);
    res.json({ item: itemJson(item) });
  }),
);

lostFoundRouter.get(
  '/:itemId/photo',
  ah(async (req, res) => {
    const item = await loadItem(req.params.itemId, req.project!._id);
    await streamPhoto(res, item);
  }),
);

lostFoundRouter.patch(
  '/:itemId',
  ...requirePermission('lostfound:manage'),
  upload.single('photo'),
  ah(async (req, res) => {
    assertImageFile(req.file);
    const item = await loadItem(req.params.itemId, req.project!._id);
    if (req.body?.name !== undefined) item.name = parseName(req.body.name);
    if (req.body?.note !== undefined) item.note = String(req.body.note).trim();
    if (req.body?.foundLocation !== undefined) item.foundLocation = String(req.body.foundLocation).trim();
    const foundAt = parseFoundAt(req.body?.foundAt);
    if (foundAt) item.foundAt = foundAt;
    // 先持久化新照片再删旧照片，避免新照片入库失败时旧照片已丢
    if (req.file) {
      const oldPhotoId = item.photoId;
      const oldPreview = item.photoPreviewPath;
      item.photoId = null;
      item.photoPreviewPath = null;
      await acceptPhoto(req.file, req.project!._id, req.userId, item);
      if (oldPreview) await deleteStored(oldPreview).catch(() => {});
      if (oldPhotoId) {
        const old = await File.findById(oldPhotoId);
        if (old) {
          await deleteStored(old.path).catch(() => {});
          await old.deleteOne();
        }
      }
    } else if (req.body?.removePhoto === '1') {
      await deletePhoto(item);
    }
    await item.save();
    res.json({ item: itemJson(item) });
  }),
);

lostFoundRouter.delete(
  '/:itemId',
  ...requirePermission('lostfound:manage'),
  ah(async (req, res) => {
    const item = await loadItem(req.params.itemId, req.project!._id);
    await deletePhoto(item);
    await item.deleteOne();
    res.json({ ok: true });
  }),
);

lostFoundRouter.patch(
  '/:itemId/status',
  ...requirePermission('lostfound:manage'),
  ah(async (req, res) => {
    const item = await loadItem(req.params.itemId, req.project!._id);
    const { status, claimNote } = req.body ?? {};
    if (status !== 'pending' && status !== 'claimed') {
      throw new AppError(400, 'bad_request', '无效的状态');
    }
    if (status === 'claimed') {
      item.status = 'claimed';
      item.claimedAt = new Date();
      if (claimNote !== undefined) item.claimNote = String(claimNote).trim();
    } else {
      item.status = 'pending';
      item.claimedAt = null;
      item.claimNote = '';
    }
    await item.save();
    res.json({ item: itemJson(item) });
  }),
);

// ---------- 对外免登录公开端点（不挂 authRequired） ----------

export const publicLostFoundRouter = Router();

publicLostFoundRouter.get(
  '/:token',
  ah(async (req, res) => {
    const share = await loadEnabledShare(req.params.token);
    const project = await Project.findById(share.projectId);
    if (!project) throw new AppError(404, 'not_found', '链接不存在或已关闭');
    const items = await LostFoundItem.find(buildFilter(share.projectId, req.query))
      .sort({ foundAt: -1 })
      .limit(200);
    res.json({ projectName: project.name, items: items.map(publicItemJson) });
  }),
);

publicLostFoundRouter.get(
  '/:token/items/:itemId/photo',
  ah(async (req, res) => {
    const share = await loadEnabledShare(req.params.token);
    // item 必须属于该分享的项目，防跨项目猜 id
    const item = await LostFoundItem.findOne({ _id: req.params.itemId, projectId: share.projectId });
    if (!item) throw new AppError(404, 'not_found', '物品不存在');
    await streamPhoto(res, item);
  }),
);
