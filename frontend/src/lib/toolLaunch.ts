import { toast } from 'sonner';
import { api } from '../api/client';

/**
 * 自定义工具启动令牌的 postMessage 握手投递。
 * 令牌默认不进 URL：工具页以干净地址打开后，主动向 ANON 父页面
 * （embed：window.parent；link：window.opener）发送 {type:'anon:launch-request', nonce}，
 * 本模块校验 event.source（已登记窗口）与 event.origin（工具登记 URL 的 origin）后，
 * 回发 {type:'anon:launch', launchToken, nonce}（targetOrigin=工具 origin）。
 * 例外（见 canDeliverViaOpener / appendLaunchTokenToUrl）：standalone PWA 等无 opener
 * 通道的环境经链接 fragment 一次性携带令牌（不进服务器日志/Referer，插件收到即抹除）。
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

/**
 * 当前环境能否经 window.opener 向新标签页投递令牌。
 * standalone PWA（含桌面 PWA 窗口与 iOS navigator.standalone）中 window.open
 * 跨域 URL 会被甩给系统浏览器，opener 必断、握手无解——此时走 fragment 兜底。
 */
export function canDeliverViaOpener(): boolean {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return false;
  // iOS Safari 专有属性，lib.dom 未声明该字段
  const nav = navigator as { standalone?: boolean };
  if (nav.standalone === true) return false;
  return true;
}

/**
 * 把 launchToken 拼进工具 URL 的 fragment（#anon_launch=…），供无 opener 通道
 * 的环境（standalone PWA）一次性携带。fragment 不出浏览器：不进插件服务器访问
 * 日志、不进 Referer；插件侧契约要求收到后立即 history.replaceState 抹除
 * （见 docs/plugin-development.md §8）。既有 hash（如 SPA hash 路由）保留，以 & 续接。
 */
export function appendLaunchTokenToUrl(toolUrl: string, launchToken: string): string {
  const u = new URL(toolUrl);
  const base = u.hash ? u.hash.slice(1) : '';
  u.hash = (base ? `${base.replace(/&$/, '')}&` : '') + `anon_launch=${launchToken}`;
  return u.toString();
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

/**
 * 早到握手请求队列：link 形态在点击手势内同步直开工具页、令牌随后才登记，
 * 插件可能先于登记加载完并发出首发 anon:launch-request；embed iframe 同理
 * （iframe 挂载即加载，登记在 useEffect）。暂存 30s，登记时校验 origin 后补发回包。
 * 安全性与原路径一致：只向「已登记窗口 + origin 匹配登记 URL」回发。
 */
const earlyRequests = new Map<Window, { nonce: string; origin: string; timer: number }>();
const EARLY_REQUEST_TTL_MS = 30 * 1000;
const EARLY_REQUEST_MAX = 20;

function reply(source: Window, entry: LaunchTargetEntry, nonce: string) {
  source.postMessage({ type: 'anon:launch', launchToken: entry.launchToken, nonce }, entry.origin);
}

function onMessage(event: MessageEvent) {
  const data = event.data as { type?: unknown; nonce?: unknown } | null;
  if (!data || typeof data !== 'object' || data.type !== 'anon:launch-request') return;
  if (typeof data.nonce !== 'string' || data.nonce.length < 8 || data.nonce.length > 128) return;
  const source = event.source as Window | null;
  if (!source) return;
  const entry = targets.get(source);
  if (!entry) {
    // 未登记：暂存早到请求，等 registerLaunchTarget 重放（超限挤掉最旧的一条）
    if (!earlyRequests.has(source)) {
      if (earlyRequests.size >= EARLY_REQUEST_MAX) {
        const oldest = earlyRequests.keys().next().value;
        if (oldest) {
          const o = earlyRequests.get(oldest);
          if (o) clearTimeout(o.timer);
          earlyRequests.delete(oldest);
        }
      }
      earlyRequests.set(source, {
        nonce: data.nonce,
        origin: event.origin,
        timer: setTimeout(() => earlyRequests.delete(source), EARLY_REQUEST_TTL_MS),
      });
    }
    return;
  }
  if (event.origin !== entry.origin) return;
  // 投递后不删除：插件 SPA 可能重挂载重复请求，令牌 5 分钟内有效，重发幂等
  reply(source, entry, data.nonce);
}

let listenerInstalled = false;

/**
 * 登记一个令牌投递目标（iframe.contentWindow 或 window.open 返回值）。
 * 收到 {type:'anon:launch-request', nonce} 时校验 source+origin 后回发
 * {type:'anon:launch', launchToken, nonce}（targetOrigin=工具 origin）。
 * 登记前已到达的早到请求（见 earlyRequests）在 origin 匹配时立即补发。
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
  // 重放登记前到达的握手请求（插件先于令牌就绪加载完的场景）
  const early = earlyRequests.get(source);
  if (early) {
    clearTimeout(early.timer);
    earlyRequests.delete(source);
    if (early.origin === origin) reply(source, entry, early.nonce);
  }
  return () => {
    if (targets.get(source) === entry) {
      clearTimeout(entry.timer);
      targets.delete(source);
    }
  };
}
