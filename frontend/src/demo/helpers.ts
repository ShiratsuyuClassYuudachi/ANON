import type { Visibility } from '../types';
import type { Ctx, Db, DbFile, DbMembership, DbProject, DbUser } from './types';

/** 与后端一致的错误信封：{ error: { code, message } }（api() 读取 error.message 抛出） */
export function err(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const notFound = (message = 'Not Found') => err(404, 'not_found', message);
export const badRequest = (message: string) => err(400, 'bad_request', message);

export function uid(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const nowIso = () => new Date().toISOString();

// ---------- 常用查询 ----------

export function currentUser(db: Db): DbUser {
  return db.users.find((u) => u.id === db.currentUserId)!;
}

export function nameOf(db: Db, userId: string): string {
  return db.users.find((u) => u.id === userId)?.name ?? '未知';
}

/** 按路径 :pid 取项目并校验当前用户是成员；失败抛 Response（route 统一捕获） */
export function requireProject(ctx: Ctx): { project: DbProject; membership: DbMembership } {
  const { db, params } = ctx;
  const project = db.projects.find((p) => p.id === params.pid);
  if (!project) throw notFound('项目不存在');
  const membership = db.memberships.find((m) => m.projectId === project.id && m.userId === db.currentUserId);
  if (!membership) throw notFound('项目不存在');
  return { project, membership };
}

/** 当前用户在该项目的权限点：按成员角色现算（角色被编辑/删除后随之变化） */
export function myPermissions(db: Db, project: DbProject, membership: DbMembership): Set<string> {
  const role = project.roles.find((r) => r.name === membership.roleName);
  return new Set(role?.permissions ?? []);
}

export function membersOf(db: Db, projectId: string): DbMembership[] {
  return db.memberships.filter((m) => m.projectId === projectId);
}

/** Member[]（项目成员联查用户表，与后端 membersJson 同 shape） */
export function membersJson(db: Db, projectId: string) {
  return membersOf(db, projectId).map((m) => {
    const u = db.users.find((x) => x.id === m.userId);
    return { userId: m.userId, roleName: m.roleName, name: u?.name ?? '未知', email: u?.email ?? '' };
  });
}

/** 财务汇总用：成员（userId 升序，保证余数分摊确定性） */
export function memberInfos(db: Db, projectId: string): { userId: string; name: string }[] {
  return membersJson(db, projectId)
    .map((m) => ({ userId: m.userId, name: m.name }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

/** 可见范围：userIds/roleNames 均空 = 全员可见（与后端 services/visibility 一致） */
export function canSee(visibility: Visibility | undefined, userId: string, roleName: string | null): boolean {
  const v = visibility ?? { userIds: [], roleNames: [] };
  if (v.userIds.length === 0 && v.roleNames.length === 0) return true;
  if (v.userIds.includes(userId)) return true;
  return roleName !== null && v.roleNames.includes(roleName);
}

/** 请求体里的 visibility 字段净化（非对象/缺字段 → 空可见范围 = 全员） */
export function parseVis(v: unknown): Visibility {
  if (v === undefined || v === null || typeof v !== 'object') return { userIds: [], roleNames: [] };
  const o = v as Record<string, unknown>;
  return {
    userIds: Array.isArray(o.userIds) ? o.userIds.map(String) : [],
    roleNames: Array.isArray(o.roleNames) ? o.roleNames.map(String) : [],
  };
}

/** 重算 currentStage：stages 按 order 排序后第一个未完成阶段的 name（R2） */
export function currentStageOf(p: DbProject): string {
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  return stages.find((s) => !s.completedAt)?.name ?? '';
}

// ---------- 请求体解析 ----------

/** JSON body（api() 已 stringify）；非对象返回 {} */
export function bodyObj(ctx: Ctx): Record<string, unknown> {
  const b = ctx.body;
  return b !== null && typeof b === 'object' && !(b instanceof FormData) ? (b as Record<string, unknown>) : {};
}

export function form(ctx: Ctx): FormData {
  return ctx.body instanceof FormData ? ctx.body : new FormData();
}

export function formStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

export function formFiles(fd: FormData, key = 'files'): File[] {
  return fd.getAll(key).filter((x): x is File => x instanceof File && x.size >= 0);
}

/** 解析可能为空的日期字段：'' / null / undefined → null（清除），其余转 ISO；非法抛 400 */
export function parseDateField(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('时间格式无效');
  return d.toISOString();
}

// ---------- 文件存取 ----------

/** 大文件放入浏览器文件库，避免展开为数 GB 的 base64 字符串。 */
async function demoFileStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('anon-demo-files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const req = operation(tx.objectStore('files'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally {
    db.close();
  }
}

// 活跃页面为引用的文件持有共享锁；刷新时先恢复引用，再回收无人引用的 Blob。
// 关闭标签页后浏览器自动释放锁，下次进入演示站时即可回收遗留文件。
const retainedFiles = new Map<string, () => Promise<void>>();
const FILE_LOCK_PREFIX = 'anon-demo-file:';

async function retainDemoFile(id: string): Promise<void> {
  if (retainedFiles.has(id) || !navigator.locks) return;
  await new Promise<void>((resolve, reject) => {
    const held = navigator.locks.request(FILE_LOCK_PREFIX + id, { mode: 'shared' }, async () => {
      await new Promise<void>((release) => {
        retainedFiles.set(id, async () => { release(); await held; });
        resolve();
      });
    });
    void held.catch(reject);
  });
}

async function releaseDemoFile(id: string) {
  const release = retainedFiles.get(id);
  retainedFiles.delete(id);
  await release?.();
}

function storedFileId(file: DbFile): string | null {
  return file.dataUrl?.startsWith('indexeddb:') ? file.dataUrl.slice('indexeddb:'.length) : null;
}

async function removeUnusedDemoFile(id: IDBValidKey): Promise<void> {
  const remove = () => demoFileStore('readwrite', (store) => store.delete(id));
  if (!navigator.locks) return;
  await navigator.locks.request(FILE_LOCK_PREFIX + String(id), { ifAvailable: true }, async (lock) => {
    if (lock) await remove();
  });
}

/** 恢复当前标签页的引用；其他活跃演示标签页的文件由各自的锁保护。 */
export async function restoreDemoFiles(db: Db): Promise<void> {
  await Promise.all(Object.values(db.files).map((file) => {
    const id = storedFileId(file);
    return id ? retainDemoFile(id) : Promise.resolve();
  }));
  const keys = await demoFileStore('readonly', (store) => store.getAllKeys());
  await Promise.all(keys.map(removeUnusedDemoFile));
}

/** 资源删除和重置共用回收路径；失败时保留元数据，允许用户重试。 */
export async function deleteDemoFiles(db: Db, ids: string[]): Promise<void> {
  for (const id of ids) {
    const storedId = db.files[id] && storedFileId(db.files[id]);
    if (!storedId) continue;
    await releaseDemoFile(storedId);
    try {
      if (navigator.locks) await removeUnusedDemoFile(storedId);
      else await demoFileStore('readwrite', (store) => store.delete(storedId));
    } catch (error) {
      await retainDemoFile(storedId);
      throw error;
    }
  }
  for (const id of ids) delete db.files[id];
}

/** 小文件沿用 data URL；大文件单独存储，刷新后仍可读取。 */
export async function storeUpload(db: Db, file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) {
    const id = uid();
    try {
      await retainDemoFile(id);
      await demoFileStore('readwrite', (store) => store.put(file, id));
    } catch {
      await releaseDemoFile(id);
      throw badRequest('浏览器存储空间不足或不可用，无法保存文件，请释放空间后重试');
    }
    db.files[id] = { filename: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl: `indexeddb:${id}` };
    return id;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const mime = file.type || 'application/octet-stream';
  const id = uid();
  db.files[id] = {
    filename: file.name || 'unnamed',
    mime,
    size: file.size,
    dataUrl: `data:${mime};base64,${btoa(bin)}`,
  } satisfies DbFile;
  return id;
}

/** 文件内容 → Response：asset 透传静态资产，dataUrl 直接 fetch（浏览器原生支持） */
export async function fileResponse(
  f: DbFile,
  origFetch: (input: string) => Promise<Response>,
  opts: { download?: boolean; filename?: string } = {},
): Promise<Response> {
  const src = f.asset ?? f.dataUrl;
  if (!src) throw notFound('文件不存在');
  let blob: Blob;
  if (src.startsWith('indexeddb:')) {
    blob = await demoFileStore('readonly', (store) => store.get(src.slice('indexeddb:'.length)));
    if (!(blob instanceof Blob)) throw notFound('文件不存在，请重新上传');
  } else {
    const r = await origFetch(src);
    if (!r.ok) throw notFound('文件不存在');
    blob = await r.blob();
  }
  const headers: Record<string, string> = { 'Content-Type': f.mime || blob.type || 'application/octet-stream' };
  if (opts.download) {
    const name = opts.filename ?? f.filename;
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  return new Response(blob, { headers });
}

export function getFileOr404(db: Db, id: string): DbFile {
  const f = db.files[id];
  if (!f) throw notFound('文件不存在');
  return f;
}
