import { api } from '../api/client';

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

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
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
    const reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
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
    return true;
  } catch {
    return false;
  }
}

/** 取消推送订阅（本地 + 服务端） */
export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
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
