import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getVapidPublicKey, PUSH_OPTOUT_KEY, pushSupported, subscribePush } from '../lib/push';

const DISMISS_KEY = 'anon-push-dismissed';

type State = 'checking' | 'prompt' | 'done' | 'off';

/** Web Push 订阅提示条：已授权则静默订阅；未询问过则展示一次开启入口 */
export default function PushBanner() {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!pushSupported()) {
        setState('off');
        return;
      }
      const key = await getVapidPublicKey();
      if (cancelled) return;
      if (!key) {
        setState('off');
        return;
      }
      if (Notification.permission === 'granted') {
        // 用户在「个人资料」主动关闭过推送 → 不再自动订阅
        if (localStorage.getItem(PUSH_OPTOUT_KEY) === '1') {
          setState('off');
          return;
        }
        const ok = await subscribePush();
        if (!cancelled) setState(ok ? 'done' : 'off');
      } else if (Notification.permission === 'denied' || localStorage.getItem(DISMISS_KEY)) {
        setState('off');
      } else {
        setState('prompt');
      }
    };
    check();
    // 「个人资料」页开关推送后重新评估（开启即时隐藏提示条）
    const onChanged = () => check();
    window.addEventListener('anon-push-changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('anon-push-changed', onChanged);
    };
  }, []);

  if (state === 'checking' || state === 'done' || state === 'off') return null;

  const enable = async () => {
    setBusy(true);
    const ok = await subscribePush();
    setBusy(false);
    if (ok) {
      toast.success('已开启通知，重要动态会推送到这台设备');
      setState('done');
      window.dispatchEvent(new Event('anon-push-changed'));
    } else if (Notification.permission === 'denied') {
      setState('off');
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setState('off');
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">
        开启设备推送通知，被指派任务、待办临期或发布紧急公告时会即时提醒你
      </p>
      <Button size="sm" disabled={busy} onClick={enable}>
        {busy ? '开启中…' : '开启通知'}
      </Button>
      <button
        aria-label="暂不开启"
        className="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:size-8"
        onClick={dismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
