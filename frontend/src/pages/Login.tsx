import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ThemeToggle } from '../theme';
import type { User } from '../types';

export default function Login() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api<{ token: string; user: User }>('/api/auth/login', { body: { email, password } });
      login(d.token, d.user);
      nav('/projects');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <ThemeToggle />
      <h1>ANON 登录</h1>
      <form className="card" onSubmit={submit}>
        <input type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="error">{err}</p>}
        <button disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
      <p className="muted">
        没有账号？<Link to="/register">使用邀请码注册</Link>
      </p>
    </div>
  );
}
