import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, type To } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import AuthShell from '../components/AuthShell';
import type { User } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);
  const isDemo = import.meta.env.VITE_DEMO === 'true';
  const from = (location.state as { from?: To } | null)?.from ?? '/projects';

  // 已登录用户直接跳过登录页
  if (user) return <Navigate to={from} replace />;

  const doLogin = async (em: string, pw: string, source: 'form' | 'demo') => {
    setErr('');
    setBusy(source);
    try {
      const d = await api<{ token: string; user: User; trialExpiresAt?: string; refreshToken?: string }>('/api/auth/login', { body: { email: em, password: pw } });
      login(d.token, d.user, d.trialExpiresAt ?? null, d.refreshToken);
      nav(from, { replace: true });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await doLogin(email, password, 'form');
  };

  return (
    <AuthShell
      title="登录"
      footer={<>还没有账号？<Link to="/register" className="text-primary hover:underline">凭邀请码注册</Link></>}
    >
      {isDemo && (
        <div className="mb-4 space-y-3 rounded-lg border border-warning/40 bg-warning-soft p-3">
          <p className="text-sm text-foreground">当前为公开演示环境，无需账号即可直接体验全部功能。</p>
          <Button
            type="button"
            variant="outline"
            className="w-full border-warning/60"
            disabled={busy !== null}
            onClick={() => void doLogin('demo@anon.local', 'demo-pass-123', 'demo')}
          >
            {busy === 'demo' ? '正在进入…' : '直接进入演示'}
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">密码</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === 'form' ? '登录中…' : '登录'}
        </Button>
      </form>
    </AuthShell>
  );
}
