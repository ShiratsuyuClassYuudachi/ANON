// 在 workbox generateSW 生成的 dist/sw.js 末尾追加 Web Push 事件处理。
// vite-plugin-pwa 的 generateSW 模式不支持自定义监听器，追加事件监听不影响既有 precache/路由逻辑。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const swPath = path.join(root, 'dist', 'sw.js');

const PUSH_HANDLERS = `
// --- ANON Web Push handlers (appended by scripts/patch-sw.mjs) ---
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    /* 非 JSON 载荷忽略 */
  }
  const title = data.title || 'ANON';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'anon',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});

// 清历史 api-cache 运行时缓存（workbox 的 cleanupOutdatedCaches 只清 precache）
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api-cache').catch(() => false));
});
`;

const sw = await readFile(swPath, 'utf8');
if (sw.includes('notificationclick')) {
  console.log('dist/sw.js 已包含推送处理，跳过');
} else {
  await writeFile(swPath, sw + PUSH_HANDLERS);
  console.log('已追加 Web Push 处理到 dist/sw.js');
}
