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
  const res = await send();
  if (res.status === 401 && !input.startsWith('/api/auth/') && (await tryRefresh())) return send();
  return res;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await authorizedFetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 401) {
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (data.error?.code === 'bad_credentials') {
      throw new Error(data.error.message ?? '用户名或密码错误');
    }
    handleUnauthorized();
    throw new Error('未登录或登录已过期');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `请求失败 (${res.status})`);
  return data as T;
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
