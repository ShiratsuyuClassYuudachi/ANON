import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getVapidPublicKey, pushSupported, subscribePush } from '../lib/push';

const DISMISS_KEY = 'anon-push-dismissed';

type State = 'checking' | 'prompt' | 'done' | 'off';

/** Web Push 订阅提示条：已授权则静默订阅；未询问过则展示一次开启入口 */
export default function PushBanner() {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        const ok = await subscribePush();
        if (!cancelled) setState(ok ? 'done' : 'off');
      } else if (Notification.permission === 'denied' || localStorage.getItem(DISMISS_KEY)) {
        setState('off');
      } else {
        setState('prompt');
      }
    })();
    return () => {
      cancelled = true;
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
    } else if (Notification.permission === 'denied') {
      setState('off');
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setState('off');
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <Bell className="size-4 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-foreground">
        开启推送通知，被指派、待办到期、紧急公告等动态会直接提醒你
      </p>
      <Button size="sm" disabled={busy} onClick={enable}>
        {busy ? '开启中…' : '开启'}
      </Button>
      <button
        aria-label="暂不开启"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        onClick={dismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
