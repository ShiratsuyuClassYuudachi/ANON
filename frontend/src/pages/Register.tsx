import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ThemeToggle } from '../theme';
import type { User } from '../types';

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
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="theme-toggle-fixed"><ThemeToggle /></div>
      <h1>注册</h1>
      <form className="card" onSubmit={submit}>
        <input placeholder="邀请码（首个管理员可留空）" value={form.inviteCode} onChange={set('inviteCode')} />
        <input type="email" placeholder="邮箱" value={form.email} onChange={set('email')} required />
        <input placeholder="昵称" value={form.name} onChange={set('name')} required />
        <input type="password" placeholder="密码（至少 8 位）" value={form.password} onChange={set('password')} required minLength={8} />
        {err && <p className="error">{err}</p>}
        <button disabled={busy}>{busy ? '注册中…' : '注册'}</button>
      </form>
      <p className="muted">
        已有账号？<Link to="/login">去登录</Link>
      </p>
    </div>
  );
}
