// ANON 边缘入口:静态资产(Workers Static Assets)+ /api 反代到源站。
// 架构:Client -> CF Edge -> 本 Worker -> 静态走 ASSETS,/api/* -> ORIGIN(源站 nginx)。
// 源站经 https://anon.anontokyo.design:30362 公网可达,故无需 Cloudflare Tunnel。

// 与 frontend/nginx.conf 静态路由的安全响应头保持一致(Worker 托管后 nginx 那套不再生效)
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob: https: http:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/* 反代源站(helmet 安全头由后端自身下发,这里不叠加)
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      // 后端 trust proxy 1 取 X-Forwarded-For 首跳:显式写入真实客户端 IP,
      // 否则 /api/auth 登录限流会把所有用户算到 CF 出口 IP 上(共享配额)
      const ip = request.headers.get('cf-connecting-ip');
      if (ip) headers.set('x-forwarded-for', ip);
      headers.delete('host');
      return fetch(env.ORIGIN + url.pathname + url.search, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
    }

    // 静态资产(SPA 回退由 wrangler not_found_handling = "single-page-application" 处理)
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
