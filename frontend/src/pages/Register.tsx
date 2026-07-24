import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ModeToggle } from '../theme';
import type { User } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Register() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ inviteCode: '', email: '', name: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api<{ token: string; user: User }>('/api/auth/register', {
        body: { ...form, inviteCode: form.inviteCode || undefined },
      });
      login(d.token, d.user);
      nav('/projects');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-primary">ANON</CardTitle>
          <CardDescription>凭邀请码注册新账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inviteCode">邀请码</Label>
              <Input id="inviteCode" placeholder="邀请码（可留空）" value={form.inviteCode} onChange={set('inviteCode')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" required value={form.email} onChange={set('email')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">昵称</Label>
              <Input id="name" required value={form.name} onChange={set('name')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" required minLength={8} value={form.password} onChange={set('password')} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? '注册中…' : '注册'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            已有账号？<Link to="/login" className="text-primary hover:underline">直接登录</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
