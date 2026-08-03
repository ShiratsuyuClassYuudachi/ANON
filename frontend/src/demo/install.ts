import { route } from './router';
import { buildSeed, DB_VERSION } from './seed';
import type { Db } from './types';

const STORAGE_KEY = 'anon-demo-db';
const TOKEN_KEY = 'anon-token';

/**
 * 演示模式安装入口（main.tsx 在渲染前 await）：
 * 1. 种 token，使 AuthProvider 直接视为已登录；
 * 2. 初始化内存库（sessionStorage 有同版本数据则恢复，否则重建种子）；
 * 3. 包装 window.fetch，拦截全部 /api 请求走内存路由，其余原样透传。
 */
export async function installDemo(): Promise<void> {
  if (!localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, 'demo-token');

  let db: Db;
  const saved = sessionStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Db;
      db = parsed && parsed.version === DB_VERSION ? parsed : await buildSeed();
    } catch {
      db = await buildSeed();
    }
  } else {
    db = await buildSeed();
  }

  const persist = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // QuotaExceeded：静默退化为当次内存态（同 offlineQueue.ts save 的容错模式）
    }
  };
  persist();

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.href, location.origin);
    if (!url.pathname.startsWith('/api/')) return origFetch(input as never, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    return route(db, method, url, init, (src: string) => origFetch(src), persist);
  };
}
