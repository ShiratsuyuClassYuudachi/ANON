import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  const [custom, setCustom] = useState('');

  const load = () =>
    api<{ inviteCodes: InviteCode[] }>('/api/admin/invite-codes').then((d) => setCodes(d.inviteCodes));
  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, []);

  if (!user?.isSuperAdmin) return <p className="text-sm text-destructive">需要超级管理员权限</p>;

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
      <h2 className="text-xl font-semibold">邀请码管理</h2>
      <Card>
        <CardContent className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="自定义邀请码（留空自动生成）"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button onClick={create}>创建</Button>
        </CardContent>
      </Card>
      {codes.map((c) => (
        <Card key={c.id}>
          <CardContent className="flex items-center gap-3">
            <code className="rounded bg-muted px-2 py-0.5">{c.code}</code>
            {c.used ? (
              <Badge variant="secondary">已使用</Badge>
            ) : (
              <Badge variant="outline" className="border-green-600 text-green-600">
                可用
              </Badge>
            )}
            <span className="ml-auto text-sm text-muted-foreground">
              创建于 {c.createdAt?.slice(0, 10) ?? '-'}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
