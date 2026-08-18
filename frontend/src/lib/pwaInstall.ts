import { useEffect, useReducer } from 'react';

/**
 * PWA 安装入口的状态管理：捕获浏览器 beforeinstallprompt 事件（须在页面加载早期
 * 挂监听，事件可能在 React 挂载前触发，故放模块级），供项目页移动端「更多」Sheet
 * 的「安装应用」入口消费。
 *
 * - Chromium（桌面/Android）：事件触发后可 e.prompt() 弹原生安装框；事件一次性，
 *   prompt() 后作废，浏览器在条件再次满足时会重发。
 * - iOS（Safari 及全系第三方浏览器内核）：无此事件，只能引导「分享 → 添加到主屏幕」。
 * - 已以 standalone 运行时（含桌面 PWA 窗口与 iOS navigator.standalone）隐藏入口。
 */

/** Chromium beforeinstallprompt 事件；lib.dom 未声明 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** 当前是否以已安装形态运行（standalone 窗口 / iOS 主屏幕图标启动） */
export function isStandalonePwa(): boolean {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari 专有属性，lib.dom 未声明该字段
  const nav = navigator as { standalone?: boolean };
  return nav.standalone === true;
}

/** iOS（含 iPadOS 桌面 UA 模式）：无 beforeinstallprompt，只能手动添加 */
export function isIOS(): boolean {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ 桌面模式 UA 伪装成 MacIntel，用触点数识别
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
/** 原生框被关闭/调用失败过 → 入口保留，下次点击出手动指引 */
let dismissedOnce = false;
const listeners = new Set<() => void>();
let inited = false;

function emit() {
  for (const l of listeners) l();
}

function init() {
  if (inited) return;
  inited = true;
  installed = isStandalonePwa();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 拦浏览器默认 mini-infobar，改由应用内按钮触发
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
  // 运行期间 display-mode 变化（如从浏览器页签下装后直接切换）同步隐藏
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    installed = isStandalonePwa();
    emit();
  });
}

// 模块加载即挂监听：SW 已激活的回访中 beforeinstallprompt 可能在 React 挂载前触发
if (typeof window !== 'undefined') init();

export interface PwaInstall {
  /** 已安装（standalone 运行中或刚装完）→ 隐藏入口 */
  installed: boolean;
  /** 已捕获 beforeinstallprompt，可直接弹原生安装框 */
  canPrompt: boolean;
  /** 应显示「安装应用」入口：可弹原生框 / iOS 手动路径 / 原生框被关后保留（demo 站与已安装恒为 false） */
  available: boolean;
  /** 弹原生安装框；无事件时返回 null（调用方应走指引弹层）。accepted 后 installed 置真 */
  promptInstall(): Promise<'accepted' | 'dismissed' | null>;
}

/** demo 站构建期摘除 PWA（无 manifest/SW），入口永不渲染；字面比较便于打包器静态剔除 */
const DEMO = import.meta.env.VITE_DEMO === 'true';

export function usePwaInstall(): PwaInstall {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return {
    installed,
    canPrompt: deferredPrompt !== null,
    available: !DEMO && !installed && (deferredPrompt !== null || dismissedOnce || isIOS()),
    async promptInstall() {
      const e = deferredPrompt;
      if (!e) return null;
      // 事件一次性，但要等结果落地后再作废：过早清空会让中间渲染误判 canPrompt=false；
      // prompt() 调用失败按用户关闭处理
      try {
        await e.prompt();
        // userChoice 仅在用户操作原生框后落地；个别环境（无头/被抑制）永不落地，
        // 超时按关闭处理——若用户其实装了，appinstalled 监听会纠正为 installed
        const outcome = await Promise.race([
          e.userChoice.then((c) => c.outcome),
          new Promise<'dismissed'>((resolve) => setTimeout(() => resolve('dismissed'), 60_000)),
        ]);
        if (outcome === 'accepted') installed = true;
        else dismissedOnce = true; // 用户关闭：入口保留，再点出手动指引
        return outcome;
      } catch {
        dismissedOnce = true;
        return 'dismissed';
      } finally {
        deferredPrompt = null;
        emit();
      }
    },
  };
}
