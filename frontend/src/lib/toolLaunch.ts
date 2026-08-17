import { toast } from 'sonner';
import { api } from '../api/client';

/**
 * 自定义工具启动令牌的 postMessage 握手投递。
 * 令牌全程不进 URL：工具页以干净地址打开后，主动向 ANON 父页面
 * （embed：window.parent；link：window.opener）发送 {type:'anon:launch-request', nonce}，
 * 本模块校验 event.source（已登记窗口）与 event.origin（工具登记 URL 的 origin）后，
 * 回发 {type:'anon:launch', launchToken, nonce}（targetOrigin=工具 origin）。
 */

/** 请求 launchToken（POST /api/projects/:pid/custom-tools/:tid/launch），失败 toast 并返回 null */
export async function fetchLaunchToken(projectId: string, toolId: string): Promise<string | null> {
  try {
    const { launchToken } = await api<{ launchToken: string }>(
      `/api/projects/${projectId}/custom-tools/${toolId}/launch`,
      { method: 'POST' },
    );
    return launchToken;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

interface LaunchTargetEntry {
  origin: string;
  launchToken: string;
  /** 浏览器环境 setTimeout 返回 number */
  timer: number;
}

const targets = new Map<Window, LaunchTargetEntry>();
/** 与后端 launchToken 有效期一致：5 分钟 */
const ENTRY_TTL_MS = 5 * 60 * 1000;

function onMessage(event: MessageEvent) {
  const data = event.data as { type?: unknown; nonce?: unknown } | null;
  if (!data || typeof data !== 'object' || data.type !== 'anon:launch-request') return;
  if (typeof data.nonce !== 'string' || data.nonce.length < 8 || data.nonce.length > 128) return;
  const source = event.source as Window | null;
  if (!source) return;
  const entry = targets.get(source);
  if (!entry) return;
  if (event.origin !== entry.origin) return;
  // 投递后不删除：插件 SPA 可能重挂载重复请求，令牌 5 分钟内有效，重发幂等
  source.postMessage({ type: 'anon:launch', launchToken: entry.launchToken, nonce: data.nonce }, entry.origin);
}

let listenerInstalled = false;

/**
 * 登记一个令牌投递目标（iframe.contentWindow 或 window.open 返回值）。
 * 收到 {type:'anon:launch-request', nonce} 时校验 source+origin 后回发
 * {type:'anon:launch', launchToken, nonce}（targetOrigin=工具 origin）。
 * 返回 dispose；entry 5 分钟后自动过期清除。
 */
export function registerLaunchTarget(source: Window, toolUrl: string, launchToken: string): () => void {
  if (!listenerInstalled) {
    window.addEventListener('message', onMessage);
    listenerInstalled = true;
  }
  const origin = new URL(toolUrl).origin;
  const existing = targets.get(source);
  if (existing) clearTimeout(existing.timer);
  const entry: LaunchTargetEntry = {
    origin,
    launchToken,
    timer: setTimeout(() => targets.delete(source), ENTRY_TTL_MS),
  };
  targets.set(source, entry);
  return () => {
    if (targets.get(source) === entry) {
      clearTimeout(entry.timer);
      targets.delete(source);
    }
  };
}
