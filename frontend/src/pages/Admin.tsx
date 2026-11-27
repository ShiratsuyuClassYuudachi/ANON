import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface InviteCode {
  id: string;
  code: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string | null;
}

export default function Admin() {
  const { user } = useAuth();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [custom, setCustom] = useState('');

  const load = () =>
    api<{ inviteCodes: InviteCode[] }>('/api/admin/invite-codes').then((d) => {
      setCodes(d.inviteCodes);
      setLoadFailed(false);
    });
  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    load().catch((e) => {
      setLoadFailed(true);
      toast.error((e as Error).message);
    });
  }, [user?.isSuperAdmin]);

  if (!user?.isSuperAdmin) return <p className="text-sm text-destructive">仅超级管理员可访问此页面</p>;

  const create = async () => {
    try {
      await api('/api/admin/invite-codes', { body: custom ? { code: custom } : {} });
      setCustom('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="editorial-title">邀请码管理</h1>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <Input
            className="flex-1"
            aria-label="自定义邀请码" placeholder="输入自定义邀请码，留空则随机生成"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button onClick={create}>生成邀请码</Button>
      </div>
      {loadFailed ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">加载邀请码失败</p>
          <Button
            onClick={() =>
              load().catch((e) => {
                setLoadFailed(true);
                toast.error((e as Error).message);
              })
            }
          >
            重试
          </Button>
        </div>
      ) : (
        <div className="editorial-list">
        {codes.map((c) => (
          <div key={c.id} className="editorial-row flex flex-wrap items-center gap-3">
              <code className="min-w-0 rounded bg-muted px-2 py-0.5 wrap-anywhere">{c.code}</code>
              {c.used ? (
                <Badge variant="secondary">已使用</Badge>
              ) : (
                <Badge variant="outline" className="border-success text-success">
                  可用
                </Badge>
              )}
              <span className="ml-auto text-sm text-muted-foreground">
                创建于 {c.createdAt?.slice(0, 10) ?? '-'}
              </span>
              {!c.used && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="复制邀请码"
                  onClick={() => {
                    navigator.clipboard?.writeText(c.code).then(
                      () => toast.success('已复制'),
                      () => toast.error('复制失败'),
                    );
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              )}
          </div>
        ))}
        </div>
      )}
    </div>
  );
}
