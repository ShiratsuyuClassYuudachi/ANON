import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// demo 模式（npm run build:demo）：纯前端演示站
// - 摘除 VitePWA：不生成 SW/manifest，避免缓存拦截 mock 的 /api 响应
// - alias virtual:pwa-register → 空实现 stub（main.tsx 的 import 得以解析）
// - 其余模式保持生产构建原样
export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(isDemo
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              manifest: {
                name: 'ANON',
                short_name: 'ANON',
                display: 'standalone',
                theme_color: '#f6f7f9',
                background_color: '#f6f7f9',
                start_url: '/',
                icons: [
                  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
              },
              workbox: {
                navigateFallback: '/index.html',
                runtimeCaching: [
                  {
                    urlPattern: /\/api\/.*/,
                    handler: 'NetworkFirst',
                    method: 'GET',
                    options: {
                      cacheName: 'api-cache',
                      networkTimeoutSeconds: 5,
                      expiration: { maxAgeSeconds: 24 * 60 * 60 },
                    },
                  },
                ],
              },
            }),
          ]),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        ...(isDemo
          ? { 'virtual:pwa-register': fileURLToPath(new URL('./src/demo/pwa-register-stub.ts', import.meta.url)) }
          : {}),
      },
    },
    // demo 入口用顶层 await 安装 mock（生产构建不受影响），需要 es2022 目标
    ...(isDemo ? { build: { target: 'es2022' } } : {}),
    server: { proxy: { '/api': 'http://localhost:4000' } },
  };
});
