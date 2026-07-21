import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ProjectSummary } from '../types';

export default function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [err, setErr] = useState('');

  const load = () =>
    api<{ projects: ProjectSummary[] }>('/api/projects').then((d) => setProjects(d.projects));
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/projects', {
        body: {
          name,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
        },
      });
      setName('');
      setStartDate('');
      setEndDate('');
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  return (
    <div>
      <h2>我的项目</h2>
      <form className="card" onSubmit={create}>
        <label className="field">新建项目</label>
        <input placeholder="项目名称" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid-2">
          <div>
            <label className="field">开始日期</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="field">结束日期</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        {err && <p className="error">{err}</p>}
        <button>创建</button>
      </form>
      {projects.map((p) => (
        <div className="card" key={p.id}>
          <Link to={`/p/${p.id}`}>
            <strong>{p.name}</strong>
          </Link>
          <div className="muted">
            {p.myRole && <span className="chip">{p.myRole}</span>}
            {p.startDate && `${p.startDate.slice(0, 10)} ~ ${p.endDate?.slice(0, 10) ?? ''}`}
          </div>
        </div>
      ))}
      {!projects.length && <p className="muted">还没有项目，先创建一个吧。</p>}
    </div>
  );
}
