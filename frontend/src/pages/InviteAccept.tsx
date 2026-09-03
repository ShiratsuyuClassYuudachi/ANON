import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import AuthShell from '../components/AuthShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function fmtDate(v: string): string {
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface InviteInfo {
  projectName: string;
  roleName: string;
  expiresAt: string;
  targeted: boolean;
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: InviteInfo }>(`/api/invites/${token}`)
      .then((d) => setInfo(d.invite))
      .catch((e) => setErr(e.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const d = await api<{ projectId: string }>(`/api/invites/${token}/accept`, { body: {} });
      nav(`/p/${d.projectId}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="项目邀请" description="接受邀请以加入项目">
      {err ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-destructive">{err}</p>
          <Button variant="outline" className="w-full" onClick={() => nav('/projects')}>
            返回项目列表
          </Button>
        </div>
      ) : info ? (
        <div className="space-y-3">
          <p className="text-lg font-semibold">{info.projectName}</p>
          <div className="flex gap-2">
            <Badge variant="secondary">{info.roleName}</Badge>
            {info.targeted && <Badge variant="outline">定向邀请</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">有效期至 {fmtDate(info.expiresAt)}</p>
          <Button className="w-full" disabled={busy} onClick={accept}>
            {busy ? '加入中…' : '接受邀请'}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </AuthShell>
  );
}
