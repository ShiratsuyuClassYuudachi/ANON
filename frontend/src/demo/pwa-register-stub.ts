// demo 构建模式下替代 virtual:pwa-register 的空实现：
// 演示站不注册 Service Worker，避免 SW 缓存拦截 mock 的 /api 响应。
export function registerSW(_opts?: unknown): () => void {
  return () => {};
}
