import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ModeToggle } from '../theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

  useEffect(() => {
    api<{ invite: InviteInfo }>(`/api/invites/${token}`)
      .then((d) => setInfo(d.invite))
      .catch((e) => setErr(e.message));
  }, [token]);

  const accept = async () => {
    try {
      const d = await api<{ projectId: string }>(`/api/invites/${token}/accept`, { body: {} });
      nav(`/p/${d.projectId}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-primary">项目邀请</CardTitle>
          <CardDescription>接受邀请以加入项目</CardDescription>
        </CardHeader>
        <CardContent>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {info ? (
            <div className="space-y-3">
              <p className="text-lg font-semibold">{info.projectName}</p>
              <Badge variant="secondary">{info.roleName}</Badge>
              <p className="text-sm text-muted-foreground">有效期至 {info.expiresAt.slice(0, 10)}</p>
              <Button className="w-full" onClick={accept}>接受邀请</Button>
            </div>
          ) : (
            !err && <Skeleton className="h-40 w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
