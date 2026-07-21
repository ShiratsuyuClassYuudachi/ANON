import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { ProjectDetail } from '../../types';

interface Props {
  project: ProjectDetail;
  onChanged: () => Promise<void>;
}

function toDateInput(v: string | null): string {
  return v ? v.slice(0, 10) : '';
}

export default function SettingsTab({ project, onChanged }: Props) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    startDate: toDateInput(project.startDate),
    endDate: toDateInput(project.endDate),
  });
  const [msg, setMsg] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          description: form.description,
          startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
          endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        },
      });
      await onChanged();
      setMsg('已保存');
    } catch (e2) {
      setMsg((e2 as Error).message);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <label className="field">项目名称</label>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <label className="field">描述</label>
      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="grid-2">
        <div>
          <label className="field">开始日期</label>
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <label className="field">结束日期</label>
          <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <button>保存</button>
    </form>
  );
}
