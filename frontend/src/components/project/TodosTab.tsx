import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, downloadFile } from '../../api/client';
import type { Member, ProjectDetail, TodoItem } from '../../types';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function toIso(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}
function fmt(v: string | null): string {
  return v ? v.slice(0, 16).replace('T', ' ') : '';
}

export default function TodosTab({ project, members, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('todo:manage');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({ category: '', assignee: '', status: '', sort: 'createdAt', order: 'desc' });
  const [form, setForm] = useState({ title: '', category: '', note: '', nodeAt: '', dueAt: '', remindAt: '' });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionFiles, setCompletionFiles] = useState<FileList | null>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const [importAnchor, setImportAnchor] = useState<'start' | 'end'>('start');
  const [importDate, setImportDate] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const d = await api<{ todos: TodoItem[] }>(`/api/projects/${project.id}/todos?${q}`);
    setTodos(d.todos);
  }, [project.id, filters]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await api(`/api/projects/${project.id}/todos`, {
        body: {
          title: form.title,
          category: form.category || undefined,
          note: form.note || undefined,
          assigneeIds,
          nodeAt: toIso(form.nodeAt),
          dueAt: toIso(form.dueAt),
          remindAt: toIso(form.remindAt),
        },
      });
      setForm({ title: '', category: '', note: '', nodeAt: '', dueAt: '', remindAt: '' });
      setAssigneeIds([]);
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const complete = async (todoId: string) => {
    setErr('');
    try {
      const fd = new FormData();
      fd.set('completionNote', completionNote);
      if (completionFiles) for (const f of Array.from(completionFiles)) fd.append('files', f);
      await api(`/api/projects/${project.id}/todos/${todoId}/complete`, { formData: fd });
      setCompletingId(null);
      setCompletionNote('');
      setCompletionFiles(null);
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const exportTemplate = async () => {
    const tpl = await api(`/api/projects/${project.id}/todos/template/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'todo-template.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async () => {
    setErr('');
    const f = importFile.current?.files?.[0];
    if (!f || !importDate) {
      setErr('请选择模板文件并填写锚定日期');
      return;
    }
    try {
      const template = JSON.parse(await f.text());
      await api(`/api/projects/${project.id}/todos/template/import`, {
        body: { template, anchor: importAnchor, date: new Date(importDate).toISOString() },
      });
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  return (
    <div>
      <form className="card" onSubmit={create}>
        <label className="field">新建待办</label>
        <input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <input placeholder="类别（如 美工/宣发）" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <div className="grid-2">
          <div>
            <label className="field">节点时间</label>
            <input type="datetime-local" value={form.nodeAt} onChange={(e) => setForm({ ...form, nodeAt: e.target.value })} />
          </div>
          <div>
            <label className="field">到期时间</label>
            <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </div>
        </div>
        <label className="field">提醒时间</label>
        <input type="datetime-local" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} />
        <label className="field">指派人</label>
        <div className="row" style={{ marginBottom: 8 }}>
          {members.map((m) => (
            <label key={m.userId} className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', margin: '0 4px 0 0' }}
                checked={assigneeIds.includes(m.userId)}
                onChange={(e) =>
                  setAssigneeIds(
                    e.target.checked ? [...assigneeIds, m.userId] : assigneeIds.filter((x) => x !== m.userId),
                  )
                }
              />
              {m.name}
            </label>
          ))}
        </div>
        <textarea placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button>创建</button>
      </form>

      <div className="card">
        <div className="grid-2">
          <input placeholder="按类别筛选" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
          <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
            <option value="">全部指派人</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">全部状态</option>
            <option value="open">进行中</option>
            <option value="done">已完成</option>
          </select>
          <select
            value={`${filters.sort}:${filters.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(':');
              setFilters({ ...filters, sort, order });
            }}
          >
            <option value="createdAt:desc">最新创建</option>
            <option value="dueAt:asc">到期时间 ↑</option>
            <option value="nodeAt:asc">节点时间 ↑</option>
          </select>
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      {todos.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <strong style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</strong>
            {t.category && <span className="chip">{t.category}</span>}
            <span className="chip">{t.status === 'done' ? '已完成' : '进行中'}</span>
          </div>
          <div className="muted">
            {t.assignees.map((a) => a.name).join('、') || '未指派'}
            {t.nodeAt && ` ｜ 节点 ${fmt(t.nodeAt)}`}
            {t.dueAt && ` ｜ 到期 ${fmt(t.dueAt)}`}
          </div>
          {t.note && <p>{t.note}</p>}
          {t.status === 'done' && t.completionNote && <p className="muted">完成备注：{t.completionNote}</p>}
          {t.attachments.length > 0 && (
            <div className="row">
              {t.attachments.map((a) => (
                <button key={a.id} className="ghost" onClick={() => downloadFile(a.id, a.filename)}>
                  {a.filename}
                </button>
              ))}
            </div>
          )}
          {t.status === 'open' && completingId !== t.id && (
            <button className="ghost" onClick={() => setCompletingId(t.id)}>完成</button>
          )}
          {completingId === t.id && (
            <div>
              <textarea placeholder="完成备注（可选）" value={completionNote} onChange={(e) => setCompletionNote(e.target.value)} />
              <input type="file" multiple onChange={(e) => setCompletionFiles(e.target.files)} />
              <div className="row">
                <button onClick={() => complete(t.id)}>确认完成</button>
                <button className="ghost" onClick={() => setCompletingId(null)}>取消</button>
              </div>
            </div>
          )}
          {canManage && t.status === 'open' && (
            <button
              className="danger"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                if (!confirm('删除该待办？')) return;
                await api(`/api/projects/${project.id}/todos/${t.id}`, { method: 'DELETE' });
                await load();
              }}
            >
              删除
            </button>
          )}
        </div>
      ))}
      {!todos.length && <p className="muted">暂无待办。</p>}

      <div className="card">
        <label className="field">模板</label>
        <div className="row">
          <button className="ghost" onClick={exportTemplate}>导出为模板</button>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
        <div className="grid-2">
          <select value={importAnchor} onChange={(e) => setImportAnchor(e.target.value as 'start' | 'end')}>
            <option value="start">锚定开始时间</option>
            <option value="end">锚定结束时间</option>
          </select>
          <input type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} />
        </div>
        <input type="file" accept="application/json" ref={importFile} />
        <button className="ghost" onClick={importTemplate}>导入模板生成待办</button>
      </div>
    </div>
  );
}
