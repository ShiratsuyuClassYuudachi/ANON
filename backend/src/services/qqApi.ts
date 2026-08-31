import { config } from '../config';

/**
 * QQ 开放平台 Bot API v2 传输层：凭证获取与消息发送。
 * 与 qqbot.ts（绑定码/通知渠道）分离，便于测试按模块边界 mock（同 mailer.ts 模式）。
 */

/** 凭证获取端点：官方文档注明不区分正式/沙箱环境 */
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

export function qqConfigured(): boolean {
  return Boolean(config.qq.appId && config.qq.appSecret);
}

export function apiBase(): string {
  return config.qq.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com';
}

// --- access_token 缓存（≤7200s 有效，提前 60s 视为过期；并发单飞） ---

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: config.qq.appId, clientSecret: config.qq.appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`getAppAccessToken HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number | string };
    if (!data.access_token) throw new Error(`getAppAccessToken 响应缺少 access_token: ${JSON.stringify(data)}`);
    const ttl = Math.max(Number(data.expires_in ?? 7200) - 60, 60);
    cached = { token: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    return data.access_token;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// --- 消息发送（msg_type=0 纯文本） ---

export interface QqSendOpts {
  /** 被动回复：携带触发消息的 msg_id（不占主动消息额度） */
  msgId?: string;
  /** 被动回复：携带事件 id（FRIEND_ADD / GROUP_ADD_ROBOT 场景） */
  eventId?: string;
}

async function postMessage(path: string, content: string, opts: QqSendOpts): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
      body: JSON.stringify({
        msg_type: 0,
        content,
        ...(opts.msgId ? { msg_id: opts.msgId } : {}),
        ...(opts.eventId ? { event_id: opts.eventId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[notifications:qq] 发送失败 HTTP ${res.status} ${path}:`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notifications:qq] 发送异常 ${path}:`, err);
    return false;
  }
}

/** C2C 单聊消息（用户 openid） */
export function sendC2CMessage(openid: string, content: string, opts: QqSendOpts = {}): Promise<boolean> {
  return postMessage(`/v2/users/${openid}/messages`, content, opts);
}

/** 群消息（群 openid） */
export function sendGroupMessage(groupOpenid: string, content: string, opts: QqSendOpts = {}): Promise<boolean> {
  return postMessage(`/v2/groups/${groupOpenid}/messages`, content, opts);
}
