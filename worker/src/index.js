// ANON 边缘入口:静态资产(Workers Static Assets)+ /api 反代到源站。
// 架构:Client -> CF Edge -> 本 Worker -> 静态走 ASSETS,/api/* -> ORIGIN(源站 nginx)。
// 源站经 https://anon.anontokyo.design:30362 公网可达,故无需 Cloudflare Tunnel。
import nacl from 'tweetnacl';

// QQ webhook 回调地址验证(op13)边缘应答:QQ 控制台校验窗口仅 ~3s,
// 回源家宽链路实测 2~3s 且偶发失败,会超时导致「签名校验不通过」,故签名计算(纯 CPU)直接落在边缘。
// secret 经 `wrangler secret put QQ_BOT_APP_SECRET` 配置;未配置时透明回源(源站按 qq_disabled 处理)。
// 算法与后端 services/qqWebhook.ts 一致(官方:appSecret 倍增取 32 字节 seed 派生 Ed25519,签名 event_ts+plain_token)。
function qqSignValidation(secret, eventTs, plainToken) {
  let seed = secret;
  while (seed.length < 32) seed += seed;
  const pair = nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));
  const sig = nacl.sign.detached(new TextEncoder().encode(eventTs + plainToken), pair.secretKey);
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function proxyApi(request, env, url, body) {
  const headers = new Headers(request.headers);
  // 后端 trust proxy 1 取 X-Forwarded-For 首跳:显式写入真实客户端 IP,
  // 否则 /api/auth 登录限流会把所有用户算到 CF 出口 IP 上(共享配额)
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.delete('host');
  return fetch(env.ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers,
    body: body ?? request.body,
    redirect: 'manual',
  });
}

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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // /api/* 反代源站(helmet 安全头由后端自身下发,这里不叠加)
    if (url.pathname.startsWith('/api/')) {
      // QQ webhook:op13 验证在边缘直接应答;op0 事件边缘即时 ACK 后 waitUntil 回源处理
      if (url.pathname === '/api/qq/webhook' && request.method === 'POST' && env.QQ_BOT_APP_SECRET) {
        const body = await request.arrayBuffer();
        let frame;
        try {
          frame = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return Response.json({ error: { code: 'bad_request', message: 'body 必须是 JSON' } }, { status: 400 });
        }
        if (frame?.op === 13) {
          const d = frame.d ?? {};
          if (typeof d.plain_token !== 'string' || typeof d.event_ts !== 'string' || !d.plain_token || !d.event_ts) {
            return Response.json({ error: { code: 'bad_request', message: '缺少 plain_token/event_ts' } }, { status: 400 });
          }
          console.log(JSON.stringify({ tag: 'qq-webhook', op: 13, appid: request.headers.get('x-bot-appid') }));
          return Response.json({
            plain_token: d.plain_token,
            signature: qqSignValidation(env.QQ_BOT_APP_SECRET, d.event_ts, d.plain_token),
          });
        }
        if (frame?.op === 0) {
          // 边缘即时 ACK(op12):QQ 回包窗口短,家宽回源慢会被判超时反复重投;处理放 waitUntil
          console.log(JSON.stringify({ tag: 'qq-webhook', op: 0, t: frame.t, id: frame.id, appid: request.headers.get('x-bot-appid') }));
          ctx.waitUntil(
            proxyApi(request, env, url, body)
              .then((r) => console.log(JSON.stringify({ tag: 'qq-webhook', op: 0, id: frame.id, originStatus: r.status })))
              .catch((err) => console.log(JSON.stringify({ tag: 'qq-webhook', op: 0, id: frame.id, originError: String(err) }))),
          );
          return Response.json({ opcode: 12 });
        }
        return proxyApi(request, env, url, body); // body 已消费,重建转发
      }
      return proxyApi(request, env, url);
    }

    // 静态资产(SPA 回退由 wrangler not_found_handling = "single-page-application" 处理)
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
