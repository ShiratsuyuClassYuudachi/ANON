import { Router, type Request } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { materialChunkUpload, materialUpload } from '../middleware/upload';
import { File, type FileDoc } from '../models/File';
import { Resource, type ResourceDoc } from '../models/Resource';
import { ResourceType, type ResourceTypeDoc } from '../models/ResourceType';
import { ResourceVersion, type ResourceVersionDoc } from '../models/ResourceVersion';
import { logActivity } from '../services/activity';
import { canSeeMaterialCategory, canSeeMaterialResource, indexMaterialCategories } from '../services/materialVisibility';
import { generatePreview } from '../services/preview';
import { appendMaterialChunk, cancelMaterialUpload, startMaterialUpload, takeMaterialUpload } from '../services/materialUploads';
import { deleteStored, persistUploads, sendStoredFile } from '../services/storage';
import type { Viewer } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

// 仅位图格式生成 WebP 缩略预览；SVG 等 image/* 可携带脚本，避免同源存储型 XSS 面
const BITMAP_MIMES: Record<string, true> = { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true };
// 允许内联预览的原文件格式：位图 + PDF + Markdown + 常见音视频。PDF 由浏览器内置查看器沙箱渲染、
// 音视频经 <video>/<audio> 解码、Markdown 由前端 react-markdown 渲染（转义原始 HTML），均无同源脚本执行面；
// 其余格式一律仅附件下载。mov 为容器，能否播放取决于内部编码（iPhone H.264/AAC 可播）
const INLINE_PREVIEW_MIMES: Record<string, true> = {
  ...BITMAP_MIMES,
  'application/pdf': true,
  'text/markdown': true,
  'video/mp4': true, 'video/webm': true, 'video/quicktime': true,
  'audio/mpeg': true, 'audio/wav': true, 'audio/ogg': true,
};
// 部分浏览器对 .md 上报 text/plain / 空 mime，按扩展名兜底
const MARKDOWN_EXT = /\.(md|markdown)$/i;
/** 版本文件是否可内联预览（hasPreview 契约与 preview 端点共用判定） */
function inlinePreviewable(mime: string | undefined, filename?: string): boolean {
  // Object.hasOwn：客户端可控 mimetype 经原型链（'constructor' 等）取到真值的绕过面必须堵死
  if (mime && Object.hasOwn(INLINE_PREVIEW_MIMES, mime)) return true;
  if (filename && MARKDOWN_EXT.test(filename) && (!mime || mime === 'text/plain' || mime === 'text/markdown' || mime === 'application/octet-stream')) return true;
  return false;
}

export const materialsRouter = Router({ mergeParams: true });
materialsRouter.use(authRequired, loadMembership);

function viewerOf(req: Request): Viewer {
  return {
    userId: req.userId!,
    roleName: req.membership?.roleName ?? null,
    isSuperAdmin: req.user?.isSuperAdmin ?? false,
  };
}

function visibilityJson(v: { userIds: { toString(): string }[]; roleNames: string[] }) {
  return { userIds: v.userIds.map((id) => id.toString()), roleNames: v.roleNames };
}

function parseVisibility(v: unknown): { userIds: string[]; roleNames: string[] } | undefined {
  if (v === undefined) return undefined;
  const o = (v ?? {}) as { userIds?: unknown; roleNames?: unknown };
  return {
    userIds: Array.isArray(o.userIds) ? o.userIds.map(String) : [],
    roleNames: Array.isArray(o.roleNames) ? o.roleNames.map(String) : [],
  };
}

function typeJson(t: ResourceTypeDoc) {
  return { id: t._id.toString(), name: t.name, parentId: t.parentId?.toString() ?? null, visibility: visibilityJson(t.visibility) };
}

function resourceJson(r: ResourceDoc, latest: ResourceVersionDoc | null, latestFile?: { mime: string; filename: string } | null) {
  return {
    id: r._id.toString(),
    typeId: r.typeId.toString(),
    name: r.name,
    description: r.description,
    visibility: visibilityJson(r.visibility),
    latestVersion: latest?.version ?? 0,
    hasPreview: !!latest?.previewPath || (latestFile != null && inlinePreviewable(latestFile.mime, latestFile.filename)),
    createdAt: (r as unknown as { createdAt: Date }).createdAt,
  };
}

async function versionJson(v: ResourceVersionDoc) {
  // fileId 判空：filePath 时代的历史版本文档没有 fileId
  const file = v.fileId ? await File.findById(v.fileId).lean() : null;
  return {
    version: v.version,
    note: v.note,
    hasPreview: !!v.previewPath || (file ? inlinePreviewable(file.mime, file.filename) : false),
    createdBy: v.createdBy.toString(),
    createdAt: (v as unknown as { createdAt: Date }).createdAt,
    file: file
      ? { id: file._id.toString(), filename: file.filename, mime: file.mime, size: file.size }
      : null,
  };
}

/** 加载资源及其类型，并校验可见范围（资源 visibility 优先于类型） */
async function loadVisibleResource(req: Request) {
  const resource = await Resource.findOne({ _id: req.params.resourceId, projectId: req.project!._id });
  if (!resource) throw new AppError(404, 'not_found', '资源不存在');
  const [type, categories] = await Promise.all([
    ResourceType.findOne({ _id: resource.typeId, projectId: req.project!._id }),
    ResourceType.find({ projectId: req.project!._id }),
  ]);
  if (!canSeeMaterialResource(viewerOf(req), resource.visibility, type, indexMaterialCategories(categories))) {
    throw new AppError(403, 'forbidden', '该资源对你不可见');
  }
  return { resource, type };
}

async function latestVersionOf(resourceId: unknown) {
  return ResourceVersion.findOne({ resourceId }).sort({ version: -1 });
}

// 分片请求保持在 8 MB 内，兼容边缘代理的单请求大小限制。
materialsRouter.post(
  '/uploads',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    res.status(201).json(await startMaterialUpload(req.project!._id.toString(), req.userId!, req.body ?? {}));
  }),
);

materialsRouter.put(
  '/uploads/:uploadId',
  ...requirePermission('materials:manage'),
  materialChunkUpload.single('file'),
  ah(async (req, res) => {
    try {
      if (!req.file) throw new AppError(400, 'bad_request', '缺少文件分片');
      res.json(await appendMaterialChunk(req.params.uploadId, req.project!._id.toString(), req.userId!, Number(req.body?.offset), req.file));
    } finally {
      if (req.file) await deleteStored(req.file.path);
    }
  }),
);

materialsRouter.delete(
  '/uploads/:uploadId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    await cancelMaterialUpload(req.params.uploadId, req.project!._id.toString(), req.userId!);
    res.json({ ok: true });
  }),
);

async function receiveCompletedUpload(req: Request) {
  if (req.body?.uploadId !== undefined) {
    if (req.file || typeof req.body.uploadId !== 'string') throw new AppError(400, 'bad_request', '文件与上传会话不能同时提交');
    req.file = await takeMaterialUpload(req.body.uploadId, req.project!._id.toString(), req.userId!);
  }
}

// ---------- 资源类型 ----------

materialsRouter.get(
  '/types',
  ah(async (req, res) => {
    const viewer = viewerOf(req);
    const types = await ResourceType.find({ projectId: req.project!._id }).sort({ createdAt: 1 });
    const categoryMap = indexMaterialCategories(types);
    res.json({ types: types.filter((t) => canSeeMaterialCategory(viewer, t, categoryMap)).map(typeJson) });
  }),
);

materialsRouter.post(
  '/types',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const { name, parentId } = req.body ?? {};
    if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '类型名称必填');
    let parent: ResourceTypeDoc | null = null;
    if (parentId !== undefined && parentId !== null) {
      if (typeof parentId !== 'string') throw new AppError(400, 'bad_request', '上级类别无效');
      parent = await ResourceType.findOne({ _id: parentId, projectId: req.project!._id });
      if (!parent) throw new AppError(400, 'bad_request', '上级类别不存在');
      if (parent.parentId) throw new AppError(400, 'bad_request', '类别最多支持两层');
      const categories = await ResourceType.find({ projectId: req.project!._id });
      if (!canSeeMaterialCategory(viewerOf(req), parent, indexMaterialCategories(categories))) {
        throw new AppError(403, 'forbidden', '上级类别对你不可见');
      }
    }
    const t = await ResourceType.create({
      projectId: req.project!._id,
      name: String(name).trim(),
      parentId: parent?._id ?? null,
      visibility: parseVisibility(req.body?.visibility) ?? { userIds: [], roleNames: [] },
    });
    res.status(201).json({ type: typeJson(t) });
  }),
);

materialsRouter.patch(
  '/types/:typeId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const t = await ResourceType.findOne({ _id: req.params.typeId, projectId: req.project!._id });
    if (!t) throw new AppError(404, 'not_found', '资源类型不存在');
    const { name, parentId } = req.body ?? {};
    if (name !== undefined) {
      const normalizedName = String(name).trim();
      if (!normalizedName) throw new AppError(400, 'bad_request', '类型名称必填');
      t.name = normalizedName;
    }
    if (parentId !== undefined) {
      let parent: ResourceTypeDoc | null = null;
      if (parentId !== null) {
        if (typeof parentId !== 'string') throw new AppError(400, 'bad_request', '上级类别无效');
        parent = await ResourceType.findOne({ _id: parentId, projectId: req.project!._id });
        if (!parent) throw new AppError(400, 'bad_request', '上级类别不存在');
        if (parent.parentId) throw new AppError(400, 'bad_request', '类别最多支持两层');
        if (parent._id.equals(t._id)) throw new AppError(400, 'bad_request', '不能将类别设为自己的上级');
        if (!t.parentId?.equals(parent._id)) {
          const categories = await ResourceType.find({ projectId: req.project!._id });
          if (!canSeeMaterialCategory(viewerOf(req), parent, indexMaterialCategories(categories))) {
            throw new AppError(403, 'forbidden', '上级类别对你不可见');
          }
        }
      }
      const oldParentId = t.parentId?.toString() ?? null;
      const newParentId = parent?._id.toString() ?? null;
      if (oldParentId !== newParentId && await ResourceType.exists({ projectId: req.project!._id, parentId: t._id })) {
        throw new AppError(400, 'bad_request', '含有子类别的一级类别不能调整为二级');
      }
      t.parentId = parent?._id ?? null;
    }
    const vis = parseVisibility(req.body?.visibility);
    if (vis) t.visibility = vis as never;
    await t.save();
    res.json({ type: typeJson(t) });
  }),
);

materialsRouter.delete(
  '/types/:typeId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const t = await ResourceType.findOne({ _id: req.params.typeId, projectId: req.project!._id });
    if (!t) throw new AppError(404, 'not_found', '资源类型不存在');
    const inUse = await Resource.exists({ typeId: t._id });
    if (inUse) throw new AppError(400, 'bad_request', '类型下仍有资源，无法删除');
    if (await ResourceType.exists({ projectId: req.project!._id, parentId: t._id })) {
      throw new AppError(400, 'bad_request', '类别下仍有子类别，无法删除');
    }
    await t.deleteOne();
    res.json({ ok: true });
  }),
);

// ---------- 资源 ----------

materialsRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = viewerOf(req);
    const filter: Record<string, unknown> = { projectId: req.project!._id };
    const requestedTypeId = req.query.typeId ? String(req.query.typeId) : '';
    let scopedTypeIds: string[] | null = null;
    if (requestedTypeId) {
      if (req.query.includeChildren === 'true') {
        const selectedType = await ResourceType.findOne({ _id: requestedTypeId, projectId: req.project!._id });
        if (selectedType) {
          const children = await ResourceType.find({ projectId: req.project!._id, parentId: selectedType._id }).select('_id');
          scopedTypeIds = [selectedType._id.toString(), ...children.map((child) => child._id.toString())];
        } else {
          scopedTypeIds = [];
        }
      } else {
        filter.typeId = requestedTypeId;
      }
    }
    if (scopedTypeIds) filter.typeId = { $in: scopedTypeIds };
    const resources = await Resource.find(filter).sort({ createdAt: -1 });
    const types = await ResourceType.find({ projectId: req.project!._id });
    const typeMap = indexMaterialCategories(types);
    const versions = await ResourceVersion.find({
      resourceId: { $in: resources.map((r) => r._id) },
    }).sort({ version: -1 });
    const latestMap = new Map<string, ResourceVersionDoc>();
    for (const v of versions) {
      const key = v.resourceId.toString();
      if (!latestMap.has(key)) latestMap.set(key, v);
    }
    const visible = resources.filter((r) => canSeeMaterialResource(
      viewer,
      r.visibility,
      typeMap.get(r.typeId.toString()) ?? null,
      typeMap,
    ));
    // 无缩略预览的最新版本批量取一次文件信息，供 hasPreview 按内联白名单据实回报
    // （fileId 判空：filePath 时代的历史版本文档没有 fileId，缺文件不应拖垮整个列表）
    const fileIds = [...latestMap.values()].filter((v) => !v.previewPath && v.fileId).map((v) => v.fileId);
    const files = await File.find({ _id: { $in: fileIds } }).lean();
    const fileMap = new Map(files.map((f) => [f._id.toString(), { mime: f.mime, filename: f.filename }]));
    res.json({
      resources: visible.map((r) => {
        const latest = latestMap.get(r._id.toString()) ?? null;
        const latestFile = latest?.fileId ? fileMap.get(latest.fileId.toString()) ?? null : null;
        return resourceJson(r, latest, latestFile);
      }),
    });
  }),
);

materialsRouter.post(
  '/',
  ...requirePermission('materials:manage'),
  materialUpload.single('file'),
  ah(async (req, res) => {
    let fileDoc: FileDoc | null = null;
    let resourceDoc: ResourceDoc | null = null;
    let previewRef: string | null = null;
    try {
      const { typeId, name, description } = req.body ?? {};
      if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '资源名称必填');
      const type = await ResourceType.findOne({ _id: typeId, projectId: req.project!._id });
      if (!type) throw new AppError(400, 'bad_request', '资源类型不存在');
      const categories = await ResourceType.find({ projectId: req.project!._id });
      if (!canSeeMaterialCategory(viewerOf(req), type, indexMaterialCategories(categories))) {
        throw new AppError(403, 'forbidden', '该资源类型对你不可见');
      }
      await receiveCompletedUpload(req);
      const r = await Resource.create({
        projectId: req.project!._id,
        typeId: type._id,
        name: String(name).trim(),
        description: String(description ?? ''),
        visibility: parseVisibility(req.body?.visibility) ?? { userIds: [], roleNames: [] },
      });
      resourceDoc = r;

      let latest: ResourceVersionDoc | null = null;
      if (req.file) {
        // 预览生成需要读本地暂存文件，必须在 persistUploads（S3 模式会删除暂存）之前
        previewRef = Object.hasOwn(BITMAP_MIMES, req.file.mimetype)
          ? await generatePreview(req.file.path)
          : null;
        [fileDoc] = await persistUploads([req.file], req.project!._id, req.userId);
        latest = await ResourceVersion.create({
          resourceId: r._id,
          version: 1,
          fileId: fileDoc._id,
          previewPath: previewRef,
          note: String(req.body?.note ?? ''),
          createdBy: req.userId,
        });
      }

      logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'material:create', message: `${req.user!.name}创建了资源「${r.name}」`, sourceType: 'material', sourceId: r._id });
      res.status(201).json({ resource: resourceJson(r, latest, fileDoc ?? null) });
    } catch (err) {
      if (previewRef) await deleteStored(previewRef);
      if (fileDoc) await deleteStored(fileDoc.path);
      else if (req.file) await deleteStored(req.file.path);
      if (fileDoc) await fileDoc.deleteOne().catch(() => {});
      if (resourceDoc) await resourceDoc.deleteOne().catch(() => {});
      throw err;
    }
  }),
);

materialsRouter.get(
  '/:resourceId',
  ah(async (req, res) => {
    const { resource } = await loadVisibleResource(req);
    const latest = await latestVersionOf(resource._id);
    const latestFile = latest && !latest.previewPath && latest.fileId ? await File.findById(latest.fileId).lean() : null;
    res.json({ resource: resourceJson(resource, latest, latestFile) });
  }),
);

materialsRouter.patch(
  '/:resourceId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const resource = await Resource.findOne({
      _id: req.params.resourceId,
      projectId: req.project!._id,
    });
    if (!resource) throw new AppError(404, 'not_found', '资源不存在');
    const { name, description, typeId } = req.body ?? {};
    if (name !== undefined) resource.name = String(name).trim();
    if (description !== undefined) resource.description = String(description);
    if (typeId !== undefined && String(typeId) !== resource.typeId.toString()) {
      const type = await ResourceType.findOne({ _id: typeId, projectId: req.project!._id });
      if (!type) throw new AppError(400, 'bad_request', '资源类型不存在');
      const categories = await ResourceType.find({ projectId: req.project!._id });
      if (!canSeeMaterialCategory(viewerOf(req), type, indexMaterialCategories(categories))) {
        throw new AppError(403, 'forbidden', '该资源类型对你不可见');
      }
      resource.typeId = type._id;
    }
    const vis = parseVisibility(req.body?.visibility);
    if (vis) resource.visibility = vis as never;
    await resource.save();
    const latest = await latestVersionOf(resource._id);
    const latestFile = latest && !latest.previewPath && latest.fileId ? await File.findById(latest.fileId).lean() : null;
    res.json({ resource: resourceJson(resource, latest, latestFile) });
  }),
);

materialsRouter.delete(
  '/:resourceId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const resource = await Resource.findOne({
      _id: req.params.resourceId,
      projectId: req.project!._id,
    });
    if (!resource) throw new AppError(404, 'not_found', '资源不存在');
    const name = resource.name;
    const versions = await ResourceVersion.find({ resourceId: resource._id });
    const files = await File.find({ _id: { $in: versions.map((v) => v.fileId) } });
    for (const f of files) await deleteStored(f.path);
    for (const v of versions) {
      if (v.previewPath) await deleteStored(v.previewPath);
    }
    await File.deleteMany({ _id: { $in: versions.map((v) => v.fileId) } });
    await ResourceVersion.deleteMany({ resourceId: resource._id });
    await resource.deleteOne();
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'material:delete', message: `${req.user!.name}删除了资源「${name}」`, sourceType: 'material' });
    res.json({ ok: true });
  }),
);

// ---------- 版本 ----------

materialsRouter.post(
  '/:resourceId/versions',
  ...requirePermission('materials:manage'),
  materialUpload.single('file'),
  ah(async (req, res) => {
    // multer 已落盘，后续任何失败都要清理上传文件（及已建的 File 文档），避免孤儿文件
    let fileDoc: FileDoc | null = null;
    let previewRef: string | null = null;
    try {
      const { resource } = await loadVisibleResource(req);
      await receiveCompletedUpload(req);
      if (!req.file) throw new AppError(400, 'bad_request', '缺少文件');
      previewRef = Object.hasOwn(BITMAP_MIMES, req.file.mimetype)
        ? await generatePreview(req.file.path)
        : null;
      [fileDoc] = await persistUploads([req.file], req.project!._id, req.userId);
      const latest = await latestVersionOf(resource._id);
      const v = await ResourceVersion.create({
        resourceId: resource._id,
        version: (latest?.version ?? 0) + 1,
        fileId: fileDoc._id,
        previewPath: previewRef,
        note: String(req.body?.note ?? ''),
        createdBy: req.userId,
      });
      logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'material:upload_version', message: `${req.user!.name}上传了「${resource.name}」的新版本`, sourceType: 'material', sourceId: resource._id });
      res.status(201).json({ version: await versionJson(v) });
    } catch (err) {
      if (previewRef) await deleteStored(previewRef);
      if (fileDoc) await deleteStored(fileDoc.path);
      else if (req.file) await deleteStored(req.file.path);
      if (fileDoc) await fileDoc.deleteOne().catch(() => {});
      throw err;
    }
  }),
);

materialsRouter.get(
  '/:resourceId/versions',
  ah(async (req, res) => {
    const { resource } = await loadVisibleResource(req);
    const versions = await ResourceVersion.find({ resourceId: resource._id }).sort({ version: -1 });
    res.json({ versions: await Promise.all(versions.map(versionJson)) });
  }),
);

materialsRouter.get(
  '/:resourceId/versions/:version/download',
  ah(async (req, res) => {
    const { resource } = await loadVisibleResource(req);
    const v = await ResourceVersion.findOne({
      resourceId: resource._id,
      version: Number(req.params.version),
    });
    if (!v) throw new AppError(404, 'not_found', '版本不存在');
    const file = v.fileId ? await File.findById(v.fileId) : null;
    if (!file) throw new AppError(404, 'not_found', '文件不存在');
    await sendStoredFile(res, file.path, file.filename);
  }),
);

materialsRouter.get(
  '/:resourceId/versions/:version/preview',
  ah(async (req, res) => {
    const { resource } = await loadVisibleResource(req);
    const v = await ResourceVersion.findOne({
      resourceId: resource._id,
      version: Number(req.params.version),
    });
    if (!v) throw new AppError(404, 'not_found', '版本不存在');
    if (v.previewPath) {
      await sendStoredFile(res, v.previewPath);
      return;
    }
    const file = v.fileId ? await File.findById(v.fileId) : null;
    if (file && inlinePreviewable(file.mime, file.filename)) {
      await sendStoredFile(res, file.path);
      return;
    }
    throw new AppError(404, 'not_found', '该版本没有预览图');
  }),
);

materialsRouter.get(
  '/:resourceId/preview',
  ah(async (req, res) => {
    const { resource } = await loadVisibleResource(req);
    const latest = await latestVersionOf(resource._id);
    if (!latest) throw new AppError(404, 'not_found', '资源尚无版本');
    if (latest.previewPath) {
      await sendStoredFile(res, latest.previewPath);
      return;
    }
    const file = latest.fileId ? await File.findById(latest.fileId) : null;
    if (file && inlinePreviewable(file.mime, file.filename)) {
      await sendStoredFile(res, file.path);
      return;
    }
    throw new AppError(404, 'not_found', '该资源没有预览图');
  }),
);
