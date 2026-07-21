import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import AccountsTab from '../components/project/AccountsTab';
import FinanceTab from '../components/project/FinanceTab';
import MaterialsTab from '../components/project/MaterialsTab';
import MembersTab from '../components/project/MembersTab';
import RolesTab from '../components/project/RolesTab';
import SettingsTab from '../components/project/SettingsTab';
import TodosTab from '../components/project/TodosTab';
import type { Member, ProjectDetail } from '../types';

interface Detail {
  project: ProjectDetail;
  members: Member[];
  myRole: string;
  myPermissions: string[];
}

const TABS = [
  { key: 'todos', label: '待办' },
  { key: 'finance', label: '财务' },
  { key: 'materials', label: '物料' },
  { key: 'accounts', label: '账号' },
  { key: 'members', label: '成员' },
  { key: 'roles', label: '角色' },
  { key: 'settings', label: '设置' },
] as const;

export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('todos');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const d = await api<Detail>(`/api/projects/${id}`);
    setDetail(d);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  if (err) return <p className="error">{err}</p>;
  if (!detail) return <p>加载中…</p>;

  return (
    <div>
      <h2>
        {detail.project.name} <span className="chip">{detail.myRole}</span>
      </h2>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'todos' && (
        <TodosTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
      )}
      {tab === 'finance' && (
        <FinanceTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
      )}
      {tab === 'materials' && (
        <MaterialsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
      )}
      {tab === 'accounts' && (
        <AccountsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
      )}
      {tab === 'members' && (
        <MembersTab project={detail.project} members={detail.members} onChanged={load} />
      )}
      {tab === 'roles' && <RolesTab project={detail.project} onChanged={load} />}
      {tab === 'settings' && <SettingsTab project={detail.project} onChanged={load} />}
    </div>
  );
}
