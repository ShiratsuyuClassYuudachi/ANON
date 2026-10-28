const TOKEN_KEY = 'anon-token';
const REFRESH_KEY = 'anon-refresh-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setTokens(token: string | null, refreshToken?: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (refreshToken !== undefined) {
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  }
}

const PUBLIC_PATHS = ['/login', '/register'];

function handleUnauthorized() {
  setTokens(null, null);
  const p = location.pathname;
  if (!p.startsWith('/login') && !PUBLIC_PATHS.includes(p) && !p.startsWith('/invite/') && !p.startsWith('/lf/')) location.href = '/login';
}

let refreshPromise: Promise<boolean> | null = null; // 单飞：并发 401 共享一次刷新

function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const rt = localStorage.getItem(REFRESH_KEY);
      if (!rt) return false;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const d = (await res.json()) as { token: string; refreshToken: string };
        setTokens(d.token, d.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** 带鉴权与过期重试的 fetch：401 时先刷新令牌再重放一次（/api/auth/* 不重放防循环） */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers);
    const t = getToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
    return fetch(input, { ...init, headers });
  };
  return retryAuthorized(input, send);
}

async function retryAuthorized(input: string, send: () => Promise<Response>): Promise<Response> {
  const res = await send();
  if (res.status === 401 && !input.startsWith('/api/auth/') && (await tryRefresh())) return send();
  return res;
}

export type UploadProgress = (percent: number | null) => void;

/** fetch 尚无通用上传进度事件；上传仍复用相同的令牌刷新与错误处理。 */
function uploadWithProgress(path: string, method: string, formData: FormData, onProgress: UploadProgress) {
  return retryAuthorized(path, () => new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.timeout = 10 * 60 * 1000;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    onProgress(0);
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable && event.total > 0 ? Math.floor(event.loaded * 100 / event.total) : null);
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
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
    if (data.error?.code === 'bad_credentials') {
      throw new Error(data.error.message ?? '用户名或密码错误');
    }
    handleUnauthorized();
    throw new Error('未登录或登录已过期');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
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
  const res = await authorizedFetch(url);
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('未登录或登录已过期');
  }
  if (!res.ok) throw new Error('下载失败');
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
