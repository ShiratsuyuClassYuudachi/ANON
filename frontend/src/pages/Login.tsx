import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, type To } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import Logo from '../components/Logo';
import { ModeToggle } from '../theme';
import type { User } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isDemo = import.meta.env.VITE_DEMO === 'true';
  const from = (location.state as { from?: To } | null)?.from ?? '/projects';

  // 已登录用户直接跳过登录页
  if (user) return <Navigate to={from} replace />;

  const doLogin = async (em: string, pw: string) => {
    setErr('');
    setBusy(true);
    try {
      const d = await api<{ token: string; user: User; trialExpiresAt?: string; refreshToken?: string }>('/api/auth/login', { body: { email: em, password: pw } });
      login(d.token, d.user, d.trialExpiresAt ?? null, d.refreshToken);
      nav(from, { replace: true });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader>
          <Logo className="mb-1" />
          <CardDescription>登录你的账号</CardDescription>
        </CardHeader>
        <CardContent>
          {isDemo && (
            <div className="mb-4 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm text-foreground">这是功能预览演示，无需账号，点击下方按钮直接进入</p>
              <Button
                type="button"
                variant="outline"
                className="w-full border-amber-500/60"
                disabled={busy}
                onClick={() => void doLogin('demo@anon.local', 'demo-pass-123')}
              >
                {busy ? '登录中…' : '进入演示'}
              </Button>
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            没有账号？<Link to="/register" className="text-primary hover:underline">使用邀请码注册</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
