import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getPushStatus, subscribePush, unsubscribePush, type PushStatus } from '../lib/push';

/** 推送状态变化广播：PushBanner 监听后重新评估（订阅变化即时隐藏提示条） */
export function notifyPushChanged(): void {
  window.dispatchEvent(new Event('anon-push-changed'));
}

const HINTS: Partial<Record<PushStatus, string>> = {
  unsupported: '当前浏览器不支持网页推送通知。',
  unconfigured: '当前站点未启用网页推送，邮件与 QQ 提醒不受影响。',
  denied: '浏览器已拦截本站通知权限，请在浏览器地址栏设置中允许通知后重试。',
  subscribed: '已开启：被指派待办、任务临期与紧急公告会直接推送到此设备。',
  off: '开启后，即使未打开网页也能在此设备收到重要提醒。',
};

/** 「个人资料」页的推送通知管理卡片：按设备开关 Web Push 订阅 */
export default function PushSettingsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getPushStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    refresh();
    // PushBanner 开启推送后同步状态
    window.addEventListener('anon-push-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('anon-push-changed', refresh);
    };
  }, []);

  const toggleable = status === 'subscribed' || status === 'off';

  const toggle = async (next: boolean) => {
    setBusy(true);
    if (next) {
      const ok = await subscribePush();
      if (ok) {
        toast.success('已开启推送，重要动态会推送到这台设备');
        setStatus('subscribed');
      } else if (Notification.permission === 'denied') {
        setStatus('denied');
      } else {
        toast.error('开启失败，请稍后重试');
      }
    } else {
      await unsubscribePush();
      toast.success('已关闭本设备的推送');
      setStatus('off');
    }
    setBusy(false);
    notifyPushChanged();
  };

  return (
    <section className="editorial-section">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="editorial-subheading">设备推送通知</h2>
      </header>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id="push-toggle"
            checked={status === 'subscribed'}
            disabled={!toggleable || busy}
            onCheckedChange={toggle}
          />
          <Label htmlFor="push-toggle">在此设备接收系统推送</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {status === null ? '正在检查浏览器推送状态…' : HINTS[status]}
        </p>
      </div>
    </section>
  );
}
