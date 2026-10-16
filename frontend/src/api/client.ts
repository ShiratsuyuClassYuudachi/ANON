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

/** 带鉴权与过期重试的 fetch：401 时先刷新令牌再重放一次（/api/auth/* 不重放防循环） */
export async function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || url.username || url.password) {
    throw new Error('鉴权请求仅支持本站 API 地址');
  }
  const path = url.pathname + url.search;
  const sessionId = getSessionId();
  const initialToken = getToken();
  const send = () => {
    assertSession(sessionId);
    const headers = new Headers(init.headers);
    const t = getToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
    return fetch(path, { ...init, headers, cache: 'no-store', redirect: 'error' });
  };
  let res = await send();
  assertSession(sessionId);
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // 较晚返回的 401 直接复用同会话已刷新的令牌，避免再次轮换。
    if (getToken() !== initialToken || (await tryRefresh(sessionId)) || getToken() !== initialToken) res = await send();
    assertSession(sessionId);
  }
  return res;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const sessionId = getSessionId();
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
    assertSession(sessionId);
    if (data.error?.code === 'bad_credentials') {
      throw new Error(data.error.message ?? '用户名或密码错误');
    }
    handleUnauthorized(sessionId);
    throw new Error('未登录或登录已过期');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  assertSession(sessionId);
  if (!res.ok) throw new Error(data.error?.message ?? `请求失败 (${res.status})`);
  return data as T;
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
