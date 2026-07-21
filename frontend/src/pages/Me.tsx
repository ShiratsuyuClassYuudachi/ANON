import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { User } from '../types';

export default function Me() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [contacts, setContacts] = useState(user?.contacts ?? []);
  const [msg, setMsg] = useState('');

  if (!user) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/me', { method: 'PATCH', body: { name, contacts } });
      await refresh();
      setMsg('已保存');
    } catch (e2) {
      setMsg((e2 as Error).message);
    }
  };

  return (
    <div>
      <h2>个人资料</h2>
      <form className="card" onSubmit={submit}>
        <p className="muted">
          {user.email}
          {user.isSuperAdmin && <span className="chip">超级管理员</span>}
        </p>
        <label className="field">昵称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="field">联系方式（会展示给项目成员）</label>
        {contacts.map((c, i) => (
          <div className="row" key={i}>
            <input
              style={{ width: 110 }}
              placeholder="平台（如 QQ）"
              value={c.platform}
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))}
            />
            <input
              style={{ flex: 1 }}
              placeholder="账号"
              value={c.value}
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <button type="button" className="danger" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>
              删
            </button>
          </div>
        ))}
        <button type="button" className="ghost" onClick={() => setContacts([...contacts, { platform: '', value: '' }])}>
          + 添加联系方式
        </button>
        <div style={{ marginTop: 8 }}>
          {msg && <p className="muted">{msg}</p>}
          <button>保存</button>
        </div>
      </form>
    </div>
  );
}
