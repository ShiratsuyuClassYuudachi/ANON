const TOKEN_KEY = 'anon-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

const PUBLIC_PATHS = ['/login', '/register'];

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 401) {
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (data.error?.code === 'bad_credentials') {
      throw new Error(data.error.message ?? '用户名或密码错误');
    }
    setToken(null);
    const p = location.pathname;
    if (!PUBLIC_PATHS.includes(p) && !p.startsWith('/invite/')) location.href = '/login';
    throw new Error('未登录或登录已过期');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `请求失败 (${res.status})`);
  return data as T;
}

export async function downloadFile(id: string, filename: string) {
  const res = await fetch(`/api/files/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('下载失败');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
