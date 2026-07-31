import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getPushStatus, subscribePush, unsubscribePush, type PushStatus } from '../lib/push';

/** 推送状态变化广播：PushBanner 监听后重新评估（订阅变化即时隐藏提示条） */
export function notifyPushChanged(): void {
  window.dispatchEvent(new Event('anon-push-changed'));
}

const HINTS: Partial<Record<PushStatus, string>> = {
  unsupported: '当前浏览器不支持推送通知',
  unconfigured: '部署未启用推送（未配置 VAPID），邮件提醒不受影响',
  denied: '浏览器已禁止本站通知，需在浏览器站点设置中重新允许后再开启',
  subscribed: '已开启：被指派、待办到期、紧急公告等动态会推送到这台设备',
  off: '未开启：开启后本设备可收到系统通知，即使没开着网页',
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">推送通知</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id="push-toggle"
            aria-label="本设备推送开关"
            checked={status === 'subscribed'}
            disabled={!toggleable || busy}
            onCheckedChange={toggle}
          />
          <Label htmlFor="push-toggle">本设备接收推送</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {status === null ? '检测中…' : HINTS[status]}
        </p>
      </CardContent>
    </Card>
  );
}
