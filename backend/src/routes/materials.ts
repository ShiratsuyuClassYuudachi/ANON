import { Router, type Request } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { upload } from '../middleware/upload';
import { File, type FileDoc } from '../models/File';
import { Resource, type ResourceDoc } from '../models/Resource';
import { ResourceType, type ResourceTypeDoc } from '../models/ResourceType';
import { ResourceVersion, type ResourceVersionDoc } from '../models/ResourceVersion';
import { logActivity } from '../services/activity';
import { generatePreview } from '../services/preview';
import { deleteStored, persistUploads, sendStoredFile } from '../services/storage';
import { canSee, type Viewer } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

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
  return { id: t._id.toString(), name: t.name, visibility: visibilityJson(t.visibility) };
}

function resourceJson(r: ResourceDoc, latest: ResourceVersionDoc | null) {
  return {
    id: r._id.toString(),
    typeId: r.typeId.toString(),
    name: r.name,
    description: r.description,
    visibility: visibilityJson(r.visibility),
    latestVersion: latest?.version ?? 0,
    hasPreview: !!latest?.previewPath,
    createdAt: (r as unknown as { createdAt: Date }).createdAt,
  };
}

async function versionJson(v: ResourceVersionDoc) {
  const file = await File.findById(v.fileId).lean();
  return {
    version: v.version,
    note: v.note,
    hasPreview: !!v.previewPath,
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
  const type = await ResourceType.findById(resource.typeId);
  if (!canSee(viewerOf(req), resource.visibility, type?.visibility)) {
    throw new AppError(403, 'forbidden', '该资源对你不可见');
  }
  return { resource, type };
}

async function latestVersionOf(resourceId: unknown) {
  return ResourceVersion.findOne({ resourceId }).sort({ version: -1 });
}

// ---------- 资源类型 ----------

materialsRouter.get(
  '/types',
  ah(async (req, res) => {
    const viewer = viewerOf(req);
    const types = await ResourceType.find({ projectId: req.project!._id }).sort({ createdAt: 1 });
    res.json({ types: types.filter((t) => canSee(viewer, t.visibility)).map(typeJson) });
  }),
);

materialsRouter.post(
  '/types',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const { name } = req.body ?? {};
    if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '类型名称必填');
    const t = await ResourceType.create({
      projectId: req.project!._id,
      name: String(name).trim(),
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
    const { name } = req.body ?? {};
    if (name !== undefined) t.name = String(name).trim();
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
    if (req.query.typeId) filter.typeId = String(req.query.typeId);
    const resources = await Resource.find(filter).sort({ createdAt: -1 });
    const typeIds = [...new Set(resources.map((r) => r.typeId.toString()))];
    const types = await ResourceType.find({ _id: { $in: typeIds } });
    const typeMap = new Map(types.map((t) => [t._id.toString(), t]));
    const versions = await ResourceVersion.find({
      resourceId: { $in: resources.map((r) => r._id) },
    }).sort({ version: -1 });
    const latestMap = new Map<string, ResourceVersionDoc>();
    for (const v of versions) {
      const key = v.resourceId.toString();
      if (!latestMap.has(key)) latestMap.set(key, v);
    }
    const visible = resources.filter((r) =>
      canSee(viewer, r.visibility, typeMap.get(r.typeId.toString())?.visibility),
    );
    res.json({
      resources: visible.map((r) => resourceJson(r, latestMap.get(r._id.toString()) ?? null)),
    });
  }),
);

materialsRouter.post(
  '/',
  ...requirePermission('materials:manage'),
  upload.single('file'),
  ah(async (req, res) => {
    const { typeId, name, description } = req.body ?? {};
    if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '资源名称必填');
    const type = await ResourceType.findOne({ _id: typeId, projectId: req.project!._id });
    if (!type) throw new AppError(400, 'bad_request', '资源类型不存在');

    let fileDoc: FileDoc | null = null;
    let resourceDoc: ResourceDoc | null = null;
    let previewRef: string | null = null;
    try {
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
        previewRef = req.file.mimetype.startsWith('image/')
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
      res.status(201).json({ resource: resourceJson(r, latest) });
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
    res.json({ resource: resourceJson(resource, await latestVersionOf(resource._id)) });
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
    if (typeId !== undefined) {
      const type = await ResourceType.findOne({ _id: typeId, projectId: req.project!._id });
      if (!type) throw new AppError(400, 'bad_request', '资源类型不存在');
      resource.typeId = type._id;
    }
    const vis = parseVisibility(req.body?.visibility);
    if (vis) resource.visibility = vis as never;
    await resource.save();
    res.json({ resource: resourceJson(resource, await latestVersionOf(resource._id)) });
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
  upload.single('file'),
  ah(async (req, res) => {
    // multer 已落盘，后续任何失败都要清理上传文件（及已建的 File 文档），避免孤儿文件
    let fileDoc: FileDoc | null = null;
    let previewRef: string | null = null;
    try {
      const resource = await Resource.findOne({
        _id: req.params.resourceId,
        projectId: req.project!._id,
      });
      if (!resource) throw new AppError(404, 'not_found', '资源不存在');
      if (!req.file) throw new AppError(400, 'bad_request', '缺少文件');
      previewRef = req.file.mimetype.startsWith('image/')
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
    const file = await File.findById(v.fileId);
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
    const file = await File.findById(v.fileId);
    if (file?.mime.startsWith('image/')) {
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
    const file = await File.findById(latest.fileId);
    if (file?.mime.startsWith('image/')) {
      await sendStoredFile(res, file.path);
      return;
    }
    throw new AppError(404, 'not_found', '该资源没有预览图');
  }),
);
