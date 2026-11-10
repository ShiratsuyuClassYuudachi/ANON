const TOKEN_KEY = 'anon-token';
const REFRESH_KEY = 'anon-refresh-token';
const SESSION_KEY = 'anon-session-id';

const newSessionId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function storeTokens(token: string | null, refreshToken: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_KEY);
}

/** 登录/退出才切换会话标识；刷新令牌保留标识，避免旧请求影响新账号。 */
export function setTokens(token: string | null, refreshToken?: string | null) {
  storeTokens(token, refreshToken ?? null);
  if (token) localStorage.setItem(SESSION_KEY, newSessionId());
  else localStorage.removeItem(SESSION_KEY);
}

export function getSessionId(): string | null {
  if (!getToken()) return null;
  let id = localStorage.getItem(SESSION_KEY);
  // 为升级前已有的登录态补齐标识，无需重新登录。
  if (!id) {
    id = newSessionId();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function assertSession(sessionId: string | null) {
  if (getSessionId() !== sessionId) throw new DOMException('登录状态已变化，请重新操作', 'AbortError');
}

const PUBLIC_PATHS = ['/login', '/register'];

function handleUnauthorized(sessionId: string | null) {
  assertSession(sessionId);
  setTokens(null, null);
  const p = location.pathname;
  if (!PUBLIC_PATHS.includes(p) && !p.startsWith('/invite/') && !p.startsWith('/lf/') && !p.startsWith('/screen/')) location.href = '/login';
}

let refreshFlight: { sessionId: string; token: string; promise: Promise<boolean> } | null = null;

function tryRefresh(sessionId: string | null): Promise<boolean> {
  assertSession(sessionId);
  const rt = localStorage.getItem(REFRESH_KEY);
  if (!sessionId || !rt) return Promise.resolve(false);
  if (!refreshFlight || refreshFlight.sessionId !== sessionId || refreshFlight.token !== rt) {
    const flight = { sessionId, token: rt, promise: Promise.resolve(false) };
    const rotate = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
          cache: 'no-store',
          redirect: 'error',
        });
        if (!res.ok) return false;
        const d = (await res.json()) as { token: string; refreshToken: string };
        if (typeof d.token !== 'string' || !d.token || typeof d.refreshToken !== 'string' || !d.refreshToken) return false;
        if (getSessionId() !== sessionId || localStorage.getItem(REFRESH_KEY) !== rt) {
          // 退出期间仍可能完成服务端轮换，顺手吊销未使用的新凭证。
          void fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: d.refreshToken }),
            cache: 'no-store',
            redirect: 'error',
          }).catch(() => {});
          return false;
        }
        storeTokens(d.token, d.refreshToken);
        return true;
      } catch {
        return false;
      }
    };
    const refresh = async () => {
      assertSession(sessionId);
      // 等待其他标签页的刷新锁期间，凭证可能已经轮换。
      if (localStorage.getItem(REFRESH_KEY) !== rt) return Boolean(getToken() && localStorage.getItem(REFRESH_KEY));
      return rotate();
    };
    // 支持 Web Locks 的浏览器跨标签页单飞，其余环境保留当前页面单飞。
    flight.promise = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request(`anon-refresh:${sessionId}`, refresh);
      }
      return refresh();
    })().catch(() => false).finally(() => {
      if (refreshFlight === flight) refreshFlight = null;
    });
    refreshFlight = flight;
  }
  return refreshFlight.promise;
}

function apiPath(input: string) {
  const url = new URL(input, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || url.username || url.password) {
    throw new Error('鉴权请求仅支持本站 API 地址');
  }
  return url.pathname + url.search;
}

/** 带鉴权与过期重试的 fetch：401 时先刷新令牌再重放一次（/api/auth/* 不重放防循环） */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const path = apiPath(input);
  const sessionId = getSessionId();
  const send = () => {
    assertSession(sessionId);
    const headers = new Headers(init.headers);
    const t = getToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
    return fetch(path, { ...init, headers, cache: 'no-store', redirect: 'error' });
  };
  return retryAuthorized(path, sessionId, send);
}

async function retryAuthorized(path: string, sessionId: string | null, send: () => Promise<Response>): Promise<Response> {
  const initialToken = getToken();
  let res = await send();
  assertSession(sessionId);
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // 较晚返回的 401 直接复用同会话已刷新的令牌，避免再次轮换。
    if (getToken() !== initialToken || (await tryRefresh(sessionId)) || getToken() !== initialToken) res = await send();
    assertSession(sessionId);
  }
  return res;
}

export type UploadProgress = (percent: number | null) => void;

/** fetch 尚无通用上传进度事件；上传仍复用相同的令牌刷新与错误处理。 */
function uploadWithProgress(input: string, method: string, formData: FormData, onProgress: UploadProgress) {
  const path = apiPath(input);
  const sessionId = getSessionId();
  return retryAuthorized(path, sessionId, () => new Promise<Response>((resolve, reject) => {
    assertSession(sessionId);
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.timeout = 10 * 60 * 1000;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    onProgress(0);
    const progress = (percent: number | null) => {
      try { assertSession(sessionId); } catch (error) { reject(error); xhr.abort(); return; }
      onProgress(percent);
    };
    xhr.upload.onprogress = (event) => progress(event.lengthComputable && event.total > 0 ? Math.floor(event.loaded * 100 / event.total) : null);
    xhr.upload.onload = () => progress(100);
    xhr.onload = () => {
      try { assertSession(sessionId); } catch (error) { reject(error); return; }
      if (!xhr.status) { reject(new Error('网络连接中断，请检查网络后重试')); return; }
      resolve(new Response(xhr.responseText || null, { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('网络连接失败，文件无法上传，请检查网络后重试'));
    xhr.ontimeout = () => reject(new Error('文件上传超时，请检查网络后重试'));
    xhr.onabort = () => reject(new Error('文件上传已中断，请重新上传'));
    xhr.send(formData);
  }));
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData; onUploadProgress?: UploadProgress } = {},
): Promise<T> {
  const sessionId = getSessionId();
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const method = opts.method ?? (body ? 'POST' : 'GET');
  const res = opts.formData && opts.onUploadProgress && import.meta.env.MODE !== 'demo'
    ? await uploadWithProgress(path, method, opts.formData, opts.onUploadProgress)
    : await authorizedFetch(path, { method, headers, body });
  if (res.status === 401) {
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    assertSession(sessionId);
    if (data.error?.code === 'bad_credentials') {
      throw new Error(data.error.message ?? '用户名或密码错误');
    }
    handleUnauthorized(sessionId);
    throw new Error('未登录或登录已过期');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  assertSession(sessionId);
  if (!res.ok) throw new Error(data.error?.message ?? (res.status === 413 ? '上传请求超过服务器或代理的大小限制' : `请求失败 (${res.status})`));
  return data as T;
}

export const MATERIAL_MAX_BYTES = 1024 * 1024 * 1024;
const MATERIAL_CHUNK_BYTES = 8 * 1024 * 1024;

export function validateMaterialFile(file: File) {
  if (file.size > MATERIAL_MAX_BYTES) throw new Error('单个物料文件不能超过 1 GB（1024 MB），请选择较小的文件');
}

export async function uploadMaterial<T = unknown>(path: string, file: File, fields: Record<string, string>, onProgress: UploadProgress): Promise<T> {
  try {
    return await sendMaterial<T>(path, file, fields, onProgress);
  } catch (error) {
    if (error instanceof TypeError) throw new Error('网络连接失败，文件无法上传，请检查网络后重试');
    throw error;
  }
}

async function sendMaterial<T>(path: string, file: File, fields: Record<string, string>, onProgress: UploadProgress): Promise<T> {
  validateMaterialFile(file);
  onProgress(0);
  if (file.size <= MATERIAL_CHUNK_BYTES) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    formData.set('file', file);
    // 演示站走内存 fetch mock，不向真实后端发送请求。
    if (import.meta.env.MODE === 'demo') onProgress(null);
    return api<T>(path, { formData, onUploadProgress: onProgress });
  }
  const base = path.replace(/\/materials(?:\/.*)?$/, '/materials/uploads');
  const { uploadId, chunkSize } = await api<{ uploadId: string; chunkSize: number }>(base, {
    body: { filename: file.name, mime: file.type, size: file.size },
  });
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = file.slice(offset, offset + chunkSize);
      const formData = new FormData();
      formData.set('offset', String(offset));
      formData.set('file', chunk, 'chunk');
      await api(`${base}/${uploadId}`, {
        method: 'PUT', formData,
        onUploadProgress: (percent) => onProgress(percent === null ? null : Math.floor((offset + chunk.size * percent / 100) * 100 / file.size)),
      });
      onProgress(Math.floor(Math.min(offset + chunk.size, file.size) * 100 / file.size));
    }
    onProgress(100);
    return await api<T>(path, { body: { ...fields, uploadId } });
  } catch (error) {
    await api(`${base}/${uploadId}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

export async function downloadFile(id: string, filename: string) {
  await downloadUrl(`/api/files/${id}`, filename);
}

export async function downloadUrl(url: string, filename: string) {
  const sessionId = getSessionId();
  const res = await authorizedFetch(url);
  if (res.status === 401) {
    handleUnauthorized(sessionId);
    throw new Error('未登录或登录已过期');
  }
  if (!res.ok) throw new Error('下载失败');
  const blob = await res.blob();
  assertSession(sessionId);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
