import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
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

  // 已登录用户直接跳过登录页
  if (user) return <Navigate to={(location.state as any)?.from ?? '/projects'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api<{ token: string; user: User }>('/api/auth/login', { body: { email, password } });
      login(d.token, d.user);
      nav((location.state as any)?.from ?? '/projects', { replace: true });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
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
