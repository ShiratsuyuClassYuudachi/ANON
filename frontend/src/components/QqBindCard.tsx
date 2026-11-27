import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';

interface QqState {
  enabled: boolean;
  bound: boolean;
}

interface BindCode {
  code: string;
  expiresAt: string;
}

/** 个人 QQ 绑定：已绑定私聊后仍可生成个人码，在群内补充身份关联。 */
export default function QqBindCard() {
  const [state, setState] = useState<QqState | null>(null);
  const [bindCode, setBindCode] = useState<BindCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ qq?: QqState }>('/api/me')
      .then((d) => {
        if (!cancelled) setState(d.qq ?? { enabled: false, bound: false });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const d = await api<BindCode>('/api/me/qq-bind-code', { method: 'POST' });
      setBindCode(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unbind = async () => {
    setBusy(true);
    try {
      await api('/api/me/qq-binding', { method: 'DELETE' });
      setState({ enabled: true, bound: false });
      setBindCode(null);
      toast.success('已解绑 QQ');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="editorial-section">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="editorial-subheading">QQ 机器人绑定</h2>
      </header>
      <div className="space-y-2">
        {state === null ? (
          <p className="text-sm text-muted-foreground">检测中…</p>
        ) : !state.enabled ? (
          <p className="text-sm text-muted-foreground">当前站点未启用 QQ 机器人通知，其他提醒渠道不受影响。</p>
        ) : (
          <>
            {state.bound && (
              <p className="text-sm text-muted-foreground">已绑定个人 QQ：待办指派、临期提醒与里程碑动态会私聊发给你。</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={generate}>
                {bindCode ? '重新生成' : state.bound ? '生成群身份码' : '生成绑定码'}
              </Button>
              {state.bound && (
                <Button variant="outline" size="sm" disabled={busy} onClick={unbind}>
                  解绑 QQ
                </Button>
              )}
              {bindCode && (
                <span className="font-mono text-2xl font-semibold tracking-[0.3em]" aria-label="绑定码">
                  {bindCode.code}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              请在 10 分钟内向 ANON 机器人私聊发送「绑定 {bindCode?.code ?? '{验证码}'}」，或在已关联的活动群内 @机器人 发送该指令补充群内身份。每个绑定码仅限单次使用，群内操作权限跟随你在对应活动中的角色。
            </p>
          </>
        )}
      </div>
    </section>
  );
}
