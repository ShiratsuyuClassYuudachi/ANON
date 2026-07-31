import { api } from '../api/client';

/** 用户主动关闭推送的 localStorage 标记：避免「已授权自动订阅」与用户退出打架 */
export const PUSH_OPTOUT_KEY = 'anon-push-optout';

/** 浏览器是否支持 Web Push */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** 服务端 VAPID 公钥；未配置返回 null（此时不提供订阅入口） */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const d = await api<{ publicKey: string | null }>('/api/push/config');
    return d.publicKey;
  } catch {
    return null;
  }
}

/**
 * 获取 SW 注册：已注册未激活时等其激活；未注册时等 registerSW 完成。
 * 开发模式无 SW，3s 超时返回 null，避免永久挂起。
 */
async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing.active ? existing : navigator.serviceWorker.ready;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  return reg?.pushManager.getSubscription() ?? null;
}

/** 本设备推送状态，供设置页展示 */
export type PushStatus = 'unsupported' | 'unconfigured' | 'denied' | 'subscribed' | 'off';

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const key = await getVapidPublicKey();
  if (!key) return 'unconfigured';
  return (await currentSubscription()) ? 'subscribed' : 'off';
}

/**
 * 订阅 Web Push：注册 Service Worker → 申请权限 → subscribe → 上报后端。
 * 已订阅且权限仍为 granted 时幂等复用现有订阅。
 */
export async function subscribePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  if (Notification.permission === 'denied') return false;
  const publicKey = await getVapidPublicKey();
  if (!publicKey) return false;

  let sub = await currentSubscription();
  if (!sub) {
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return false;
    }
    sub = await currentSubscription();
  }
  if (!sub) {
    const reg = await swRegistration();
    if (!reg) return false;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch {
      return false; // 推送服务不可用（如无网络/浏览器限制）
    }
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  try {
    await api('/api/push/subscription', {
      method: 'POST',
      body: {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent.slice(0, 300),
      },
    });
    localStorage.removeItem(PUSH_OPTOUT_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 取消推送订阅（本地 + 服务端），并记录用户主动退出 */
export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  localStorage.setItem(PUSH_OPTOUT_KEY, '1');
  const sub = await currentSubscription();
  if (sub) {
    const json = sub.toJSON();
    try {
      if (json.endpoint) {
        await api('/api/push/subscription', { method: 'DELETE', body: { endpoint: json.endpoint } });
      }
    } catch {
      /* 服务端删除失败不阻塞本地退订 */
    }
    await sub.unsubscribe().catch(() => {});
  }
}
