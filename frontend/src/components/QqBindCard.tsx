import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">QQ 通知</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {state === null ? (
          <p className="text-sm text-muted-foreground">检测中…</p>
        ) : !state.enabled ? (
          <p className="text-sm text-muted-foreground">部署未启用 QQ 通知（未配置机器人凭证），其他提醒渠道不受影响</p>
        ) : (
          <>
            {state.bound && (
              <p className="text-sm text-muted-foreground">已绑定 QQ：指派、待办到期、里程碑等提醒会发到你的 QQ 私聊</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={generate}>
                {bindCode ? '重新生成' : state.bound ? '生成群绑定码' : '生成绑定码'}
              </Button>
              {state.bound && (
                <Button variant="outline" size="sm" disabled={busy} onClick={unbind}>
                  解绑
                </Button>
              )}
              {bindCode && (
                <span className="font-mono text-2xl font-semibold tracking-[0.3em]" aria-label="绑定码">
                  {bindCode.code}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {state.bound
                ? bindCode
                  ? `10 分钟内，在目标 QQ 群 @ANON 机器人发送：绑定 ${bindCode.code}`
                  : '生成群绑定码后，在目标 QQ 群 @ANON 机器人发送「绑定 XXXXXX」，关联你的群内身份'
                : bindCode
                  ? `10 分钟内，在 QQ 私聊 ANON 机器人发送：绑定 ${bindCode.code}；也可在目标群 @机器人发送此指令`
                  : '生成绑定码后，在 QQ 私聊 ANON 机器人发送「绑定 XXXXXX」；群内绑定请在目标群 @机器人发送同样的指令'}
            </p>
            <p className="text-sm text-muted-foreground">绑定码仅可使用一次，多个群需分别生成。群内录入按你的项目角色权限执行。</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
