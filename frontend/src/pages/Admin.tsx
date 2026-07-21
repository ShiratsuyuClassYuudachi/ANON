import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';

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
  const [err, setErr] = useState('');

  const load = () =>
    api<{ inviteCodes: InviteCode[] }>('/api/admin/invite-codes').then((d) => setCodes(d.inviteCodes));
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  if (!user?.isSuperAdmin) return <p className="error">需要超级管理员权限</p>;

  const create = async () => {
    setErr('');
    try {
      await api('/api/admin/invite-codes', { body: custom ? { code: custom } : {} });
      setCustom('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <h2>邀请码管理</h2>
      <div className="card">
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="自定义邀请码（留空自动生成）"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button onClick={create}>创建</button>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {codes.map((c) => (
        <div className="card" key={c.id}>
          <div className="row">
            <code>{c.code}</code>
            <span className="chip">{c.used ? '已使用' : '可用'}</span>
          </div>
          <div className="muted">创建于 {c.createdAt?.slice(0, 10) ?? '-'}</div>
        </div>
      ))}
    </div>
  );
}
