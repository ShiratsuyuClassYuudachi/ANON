import { err, notFound } from './helpers';
import { routes } from './handlers';
import type { Ctx, Db, Handler } from './types';

export interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

/** 路径模板 → 有序路由。模板语法：:name 匹配单段。同一模板内字面量路由须先注册。 */
export function def(method: string, template: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = template
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { method, re: new RegExp(`^${pattern}$`), keys, handler };
}

/** 解析请求体：JSON 字符串 → 对象；FormData 原样；空 → undefined */
function parseBody(init?: RequestInit): unknown {
  const b = init?.body;
  if (typeof b === 'string') {
    if (!b) return undefined;
    try {
      return JSON.parse(b);
    } catch {
      return undefined;
    }
  }
  if (b instanceof FormData) return b;
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * mock 路由入口：统一 ~80ms 延迟（骨架屏可见）；handler 抛出的 Response 直接作为响应；
 * 非 GET 成功（res.ok）后由调用方持久化。
 */
export async function route(
  db: Db,
  method: string,
  url: URL,
  init: RequestInit | undefined,
  origFetch: (input: string) => Promise<Response>,
  persist: () => void,
): Promise<Response> {
  await sleep(80);
  const body = parseBody(init);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1]);
    });
    const ctx: Ctx = { db, params, query: url.searchParams, body, origFetch };
    try {
      const res = await r.handler(ctx);
      if (method !== 'GET' && res.ok) persist();
      return res;
    } catch (e) {
      if (e instanceof Response) return e;
      return err(500, 'demo_error', e instanceof Error ? e.message : 'demo 内部错误');
    }
  }
  return notFound();
}
