import { badRequest, bodyObj, fileResponse, form, formStr, getFileOr404, json, notFound, nowIso, parseVis, requireProject, storeUpload, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbResource, DbResourceVersion } from '../types';

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
  // ---------- 类型（须先于 /materials/:rid 注册） ----------
  def('GET', '/api/projects/:pid/materials/types', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const types = db.resourceTypes
      .filter((t) => t.projectId === params.pid)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return json({ types: types.map((t) => ({ id: t.id, name: t.name, visibility: t.visibility })) });
  }),

  def('POST', '/api/projects/:pid/materials/types', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.name || !String(b.name).trim()) return badRequest('类型名称必填');
    const t = { id: uid(), projectId: params.pid, name: String(b.name).trim(), visibility: parseVis(b.visibility), createdAt: nowIso() };
    db.resourceTypes.push(t);
    return json({ type: { id: t.id, name: t.name, visibility: t.visibility } }, 201);
  }),

  def('PATCH', '/api/projects/:pid/materials/types/:typeId', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const t = db.resourceTypes.find((x) => x.id === params.typeId && x.projectId === params.pid);
    if (!t) return notFound('资源类型不存在');
    const b = bodyObj(ctx);
    if (b.name !== undefined) t.name = String(b.name).trim();
    if (b.visibility !== undefined) t.visibility = parseVis(b.visibility);
    return json({ type: { id: t.id, name: t.name, visibility: t.visibility } });
  }),

  def('DELETE', '/api/projects/:pid/materials/types/:typeId', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const t = db.resourceTypes.find((x) => x.id === params.typeId && x.projectId === params.pid);
    if (!t) return notFound('资源类型不存在');
    if (db.resources.some((r) => r.typeId === t.id)) return badRequest('类型下仍有资源，无法删除');
    db.resourceTypes.splice(db.resourceTypes.indexOf(t), 1);
    return json({ ok: true });
  }),

  // ---------- 资源 ----------
  def('GET', '/api/projects/:pid/materials', async (ctx) => {
    const { db, params, query } = ctx;
    requireProject(ctx);
    const typeId = query.get('typeId');
    const resources = db.resources
      .filter((r) => r.projectId === params.pid)
      .filter((r) => !typeId || r.typeId === typeId)
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
    db.resources.push(resource);
    const file = isForm ? (form(ctx).get('file') as File | null) : null;
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
    const fd = form(ctx);
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return badRequest('缺少文件');
    const fileId = await storeUpload(db, file);
    const version: DbResourceVersion = {
      id: uid(),
      resourceId: resource.id,
      version: (latestVersionOf(db, resource.id)?.version ?? 0) + 1,
      note: formStr(fd, 'note'),
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
