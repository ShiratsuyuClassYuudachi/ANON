import { badRequest, bodyObj, err, fileResponse, form, getFileOr404, json, notFound, nowIso, parseVis, requireProject, storeUpload, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbResource, DbResourceVersion } from '../types';
import { MATERIAL_MAX_BYTES } from '../../api/client';

interface DemoUpload {
  projectId: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  received: number;
  chunks: Blob[];
  touchedAt: number;
}
const uploads = new WeakMap<Db, Map<string, DemoUpload>>();
const CHUNK_SIZE = 8 * 1024 * 1024;
function uploadSessions(db: Db) {
  let sessions = uploads.get(db);
  if (!sessions) { sessions = new Map(); uploads.set(db, sessions); }
  for (const [id, session] of sessions) if (session.touchedAt < Date.now() - 24 * 60 * 60 * 1000) sessions.delete(id);
  return sessions;
}
function ownUpload(ctx: Ctx, id: string) {
  const session = uploadSessions(ctx.db).get(id);
  if (!session || session.projectId !== ctx.params.pid || session.userId !== ctx.db.currentUserId) throw notFound('上传会话不存在或已过期，请重新上传');
  return session;
}
function receivedFile(ctx: Ctx, fields: Record<string, unknown>): File | null {
  const file = ctx.body instanceof FormData ? form(ctx).get('file') : null;
  if (fields.uploadId !== undefined) {
    if (file || typeof fields.uploadId !== 'string') throw badRequest('文件与上传会话不能同时提交');
    const session = ownUpload(ctx, fields.uploadId);
    if (session.received !== session.size) throw badRequest('文件尚未上传完整');
    uploadSessions(ctx.db).delete(fields.uploadId);
    return new File(session.chunks, session.filename, { type: session.mime });
  }
  if (file instanceof File && file.size > MATERIAL_MAX_BYTES) throw badRequest('单个物料文件不能超过 1 GB（1024 MB）');
  return file instanceof File ? file : null;
}

function latestVersionOf(db: Db, resourceId: string): DbResourceVersion | null {
  const vs = db.versions.filter((v) => v.resourceId === resourceId).sort((a, b) => b.version - a.version);
  return vs[0] ?? null;
}

function resourceJson(db: Db, r: DbResource) {
  const latest = latestVersionOf(db, r.id);
  return {
    id: r.id,
    typeId: r.typeId,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    latestVersion: latest?.version ?? 0,
    hasPreview: !!latest?.hasPreview,
    createdAt: r.createdAt,
  };
}

function versionJson(db: Db, v: DbResourceVersion) {
  const f = db.files[v.fileId];
  return {
    version: v.version,
    note: v.note,
    hasPreview: v.hasPreview,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    file: f ? { id: v.fileId, filename: f.filename, mime: f.mime, size: f.size } : null,
  };
}

function findResource(ctx: Ctx): DbResource {
  const { db, params } = ctx;
  const r = db.resources.find((x) => x.id === params.rid && x.projectId === params.pid);
  if (!r) throw notFound('资源不存在');
  return r;
}

function findVersion(db: Db, resourceId: string, v: number): DbResourceVersion {
  const version = db.versions.find((x) => x.resourceId === resourceId && x.version === v);
  if (!version) throw notFound('版本不存在');
  return version;
}

/** 预览：版本有预览（图片 mime）则直接给文件内容；否则 404（对应后端 previewPath/image 回退） */
async function previewOf(ctx: Ctx, v: DbResourceVersion): Promise<Response> {
  if (!v.hasPreview) return notFound('该版本没有预览图');
  const f = getFileOr404(ctx.db, v.fileId);
  return fileResponse(f, ctx.origFetch);
}

const VIS_EMPTY = { userIds: [], roleNames: [] };

/** 对齐后端内联白名单语义；演示资产可信，image/* 放宽保留（SVG 种子资产照常可预览） */
const previewable = (mime: string, filename?: string) =>
  mime.startsWith('image/') || mime === 'application/pdf' || mime === 'text/markdown' ||
  mime.startsWith('video/') || mime.startsWith('audio/') ||
  (filename != null && /\.(md|markdown)$/i.test(filename) && (!mime || mime.startsWith('text/')));

export const materialRoutes: Route[] = [
  def('POST', '/api/projects/:pid/materials/uploads', async (ctx) => {
    requireProject(ctx);
    const b = bodyObj(ctx);
    if (typeof b.filename !== 'string' || !b.filename.trim() || b.filename.length > 255) return badRequest('文件名无效');
    if (typeof b.size !== 'number' || !Number.isSafeInteger(b.size) || b.size <= 0) return badRequest('文件大小无效');
    if (b.size > MATERIAL_MAX_BYTES) return err(413, 'file_too_large', '单个物料文件不能超过 1 GB（1024 MB）');
    const sessions = uploadSessions(ctx.db);
    if (sessions.size >= 3) return err(429, 'upload_limit', '同时上传的文件过多，请完成或取消其他上传后重试');
    const uploadId = uid();
    sessions.set(uploadId, { projectId: ctx.params.pid, userId: ctx.db.currentUserId, filename: b.filename, mime: typeof b.mime === 'string' ? b.mime : 'application/octet-stream', size: b.size, received: 0, chunks: [], touchedAt: Date.now() });
    return json({ uploadId, chunkSize: CHUNK_SIZE }, 201);
  }),
  def('PUT', '/api/projects/:pid/materials/uploads/:uploadId', async (ctx) => {
    requireProject(ctx);
    const session = ownUpload(ctx, ctx.params.uploadId);
    const fd = form(ctx);
    const file = fd.get('file');
    if (Number(fd.get('offset')) !== session.received) return err(409, 'upload_offset', '文件分片顺序不正确，请重新上传');
    const expected = Math.min(CHUNK_SIZE, session.size - session.received);
    if (!(file instanceof Blob) || expected === 0 || file.size !== expected) return badRequest('文件分片大小不正确');
    session.chunks.push(file);
    session.received += file.size;
    session.touchedAt = Date.now();
    return json({ received: session.received });
  }),
  def('DELETE', '/api/projects/:pid/materials/uploads/:uploadId', async (ctx) => {
    requireProject(ctx);
    ownUpload(ctx, ctx.params.uploadId);
    uploadSessions(ctx.db).delete(ctx.params.uploadId);
    return json({ ok: true });
  }),
  // ---------- 类型（须先于 /materials/:rid 注册） ----------
  def('GET', '/api/projects/:pid/materials/types', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const types = db.resourceTypes
      .filter((t) => t.projectId === params.pid)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return json({ types: types.map((t) => ({ id: t.id, name: t.name, parentId: t.parentId ?? null, visibility: t.visibility })) });
  }),

  def('POST', '/api/projects/:pid/materials/types', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.name || !String(b.name).trim()) return badRequest('类型名称必填');
    const parentId = b.parentId === undefined || b.parentId === null ? null : String(b.parentId);
    const parent = parentId ? db.resourceTypes.find((x) => x.id === parentId && x.projectId === params.pid) : null;
    if (parentId && !parent) return badRequest('上级类别不存在');
    if (parent?.parentId) return badRequest('类别最多支持两层');
    const t = { id: uid(), projectId: params.pid, name: String(b.name).trim(), parentId, visibility: parseVis(b.visibility), createdAt: nowIso() };
    db.resourceTypes.push(t);
    return json({ type: { id: t.id, name: t.name, parentId: t.parentId, visibility: t.visibility } }, 201);
  }),

  def('PATCH', '/api/projects/:pid/materials/types/:typeId', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const t = db.resourceTypes.find((x) => x.id === params.typeId && x.projectId === params.pid);
    if (!t) return notFound('资源类型不存在');
    const b = bodyObj(ctx);
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return badRequest('类型名称必填');
      t.name = name;
    }
    if (b.parentId !== undefined) {
      const oldParentId = t.parentId ?? null;
      const parentId = b.parentId === null ? null : String(b.parentId);
      const parent = parentId ? db.resourceTypes.find((x) => x.id === parentId && x.projectId === params.pid) : null;
      if (parentId && !parent) return badRequest('上级类别不存在');
      if (parent?.parentId) return badRequest('类别最多支持两层');
      if (parent?.id === t.id) return badRequest('不能将类别设为自己的上级');
      if (oldParentId !== parentId && db.resourceTypes.some((x) => x.parentId === t.id)) return badRequest('含有子类别的一级类别不能调整为二级');
      t.parentId = parentId;
    }
    if (b.visibility !== undefined) t.visibility = parseVis(b.visibility);
    return json({ type: { id: t.id, name: t.name, parentId: t.parentId ?? null, visibility: t.visibility } });
  }),

  def('DELETE', '/api/projects/:pid/materials/types/:typeId', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const t = db.resourceTypes.find((x) => x.id === params.typeId && x.projectId === params.pid);
    if (!t) return notFound('资源类型不存在');
    if (db.resources.some((r) => r.typeId === t.id)) return badRequest('类型下仍有资源，无法删除');
    if (db.resourceTypes.some((x) => x.parentId === t.id)) return badRequest('类别下仍有子类别，无法删除');
    db.resourceTypes.splice(db.resourceTypes.indexOf(t), 1);
    return json({ ok: true });
  }),

  // ---------- 资源 ----------
  def('GET', '/api/projects/:pid/materials', async (ctx) => {
    const { db, params, query } = ctx;
    requireProject(ctx);
    const typeId = query.get('typeId');
    const includeChildren = query.get('includeChildren') === 'true';
    const matchingTypeIds = includeChildren
      ? db.resourceTypes.filter((t) => t.id === typeId || t.parentId === typeId).map((t) => t.id)
      : null;
    const resources = db.resources
      .filter((r) => r.projectId === params.pid)
      .filter((r) => !typeId || (includeChildren ? matchingTypeIds?.includes(r.typeId) : r.typeId === typeId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return json({ resources: resources.map((r) => resourceJson(db, r)) });
  }),

  def('POST', '/api/projects/:pid/materials', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const isForm = ctx.body instanceof FormData;
    const fields = isForm ? Object.fromEntries([...form(ctx).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])) : bodyObj(ctx);
    const name = String(fields.name ?? '').trim();
    if (!name) return badRequest('资源名称必填');
    const typeId = String(fields.typeId ?? '');
    if (!db.resourceTypes.some((t) => t.id === typeId && t.projectId === params.pid)) return badRequest('资源类型不存在');
    const resource: DbResource = {
      id: uid(),
      projectId: params.pid,
      typeId,
      name,
      description: String(fields.description ?? ''),
      visibility: isForm ? { ...VIS_EMPTY } : parseVis(fields.visibility),
      createdAt: nowIso(),
    };
    const file = receivedFile(ctx, fields);
    if (file instanceof File && file.size > 0) {
      const fileId = await storeUpload(db, file);
      db.versions.push({
        id: uid(),
        resourceId: resource.id,
        version: 1,
        note: String(fields.note ?? ''),
        fileId,
        hasPreview: previewable(file.type || '', file.name),
        createdBy: db.currentUserId,
        createdAt: nowIso(),
      });
    }
    db.resources.push(resource);
    return json({ resource: resourceJson(db, resource) }, 201);
  }),

  def('GET', '/api/projects/:pid/materials/:rid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    return json({ resource: resourceJson(db, findResource(ctx)) });
  }),

  def('PATCH', '/api/projects/:pid/materials/:rid', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const resource = findResource(ctx);
    const b = bodyObj(ctx);
    if (b.name !== undefined) resource.name = String(b.name).trim();
    if (b.description !== undefined) resource.description = String(b.description);
    if (b.typeId !== undefined) {
      if (!db.resourceTypes.some((t) => t.id === b.typeId && t.projectId === params.pid)) return badRequest('资源类型不存在');
      resource.typeId = String(b.typeId);
    }
    if (b.visibility !== undefined) resource.visibility = parseVis(b.visibility);
    return json({ resource: resourceJson(db, resource) });
  }),

  def('DELETE', '/api/projects/:pid/materials/:rid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const resource = findResource(ctx);
    db.versions = db.versions.filter((v) => v.resourceId !== resource.id);
    db.resources.splice(db.resources.indexOf(resource), 1);
    return json({ ok: true });
  }),

  // ---------- 版本 ----------
  def('GET', '/api/projects/:pid/materials/:rid/versions', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const resource = findResource(ctx);
    const versions = db.versions
      .filter((v) => v.resourceId === resource.id)
      .sort((a, b) => b.version - a.version);
    return json({ versions: versions.map((v) => versionJson(db, v)) });
  }),

  def('POST', '/api/projects/:pid/materials/:rid/versions', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const resource = findResource(ctx);
    const fields = ctx.body instanceof FormData ? Object.fromEntries(form(ctx).entries()) : bodyObj(ctx);
    const file = receivedFile(ctx, fields);
    if (!(file instanceof File) || file.size === 0) return badRequest('缺少文件');
    const fileId = await storeUpload(db, file);
    const version: DbResourceVersion = {
      id: uid(),
      resourceId: resource.id,
      version: (latestVersionOf(db, resource.id)?.version ?? 0) + 1,
      note: String(fields.note ?? ''),
      fileId,
      hasPreview: previewable(file.type || '', file.name),
      createdBy: db.currentUserId,
      createdAt: nowIso(),
    };
    db.versions.push(version);
    return json({ version: versionJson(db, version) }, 201);
  }),

  def('GET', '/api/projects/:pid/materials/:rid/versions/:v/download', async (ctx) => {
    requireProject(ctx);
    const resource = findResource(ctx);
    const version = findVersion(ctx.db, resource.id, Number(ctx.params.v));
    const f = getFileOr404(ctx.db, version.fileId);
    return fileResponse(f, ctx.origFetch, { download: true });
  }),

  def('GET', '/api/projects/:pid/materials/:rid/versions/:v/preview', async (ctx) => {
    requireProject(ctx);
    const resource = findResource(ctx);
    const version = findVersion(ctx.db, resource.id, Number(ctx.params.v));
    return previewOf(ctx, version);
  }),

  def('GET', '/api/projects/:pid/materials/:rid/preview', async (ctx) => {
    requireProject(ctx);
    const resource = findResource(ctx);
    const latest = latestVersionOf(ctx.db, resource.id);
    if (!latest) return notFound('资源尚无版本');
    return previewOf(ctx, latest);
  }),
];
