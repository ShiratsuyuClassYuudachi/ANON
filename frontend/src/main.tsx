import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthProvider } from './auth';
import { Toaster } from './components/Toaster';
import './index.css';
import { flushQueue } from './lib/offlineQueue';
import { ThemeProvider } from './theme';

// 演示模式：构建期静态替换 VITE_DEMO，生产构建中条件恒 false，demo chunk 被 tree-shake
if (import.meta.env.VITE_DEMO === 'true') {
  const { installDemo } = await import('./demo/install');
  await installDemo();
}

registerSW({ immediate: true });

function syncOfflineQueue() {
  void flushQueue().then((n) => {
    if (n > 0) toast.success(`已同步 ${n} 条离线操作`);
  });
}
window.addEventListener('online', syncOfflineQueue);
if (navigator.onLine) syncOfflineQueue();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
