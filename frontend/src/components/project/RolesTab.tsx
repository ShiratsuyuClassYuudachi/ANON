import { useState } from 'react';
import { api } from '../../api/client';
import type { ProjectDetail } from '../../types';

const PERMISSIONS = [
  { key: 'project:manage', label: '项目管理' },
  { key: 'member:manage', label: '成员管理' },
  { key: 'role:manage', label: '角色管理' },
  { key: 'todo:manage', label: '待办管理' },
  { key: 'todo:complete', label: '完成待办' },
  { key: 'file:upload', label: '上传文件' },
];

interface Props {
  project: ProjectDetail;
  onChanged: () => Promise<void>;
}

function PermissionChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row" style={{ marginBottom: 8 }}>
      {PERMISSIONS.map((p) => (
        <label key={p.key} className="chip" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ width: 'auto', margin: '0 4px 0 0' }}
            checked={value.includes(p.key)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, p.key] : value.filter((x) => x !== p.key))
            }
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}

export default function RolesTab({ project, onChanged }: Props) {
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<string[]>([]);
  const [editPerms, setEditPerms] = useState<Record<string, string[]>>({});
  const [err, setErr] = useState('');

  const run = (fn: () => Promise<void>) => fn().catch((e) => setErr(e.message));
  const permsOf = (name: string, fallback: string[]) => editPerms[name] ?? fallback;

  return (
    <div>
      <div className="card">
        <label className="field">新建角色</label>
        <input placeholder="角色名" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <PermissionChecks value={newPerms} onChange={setNewPerms} />
        <button
          onClick={() =>
            run(async () => {
              await api(`/api/projects/${project.id}/roles`, {
                body: { name: newName, permissions: newPerms },
              });
              setNewName('');
              setNewPerms([]);
              await onChanged();
            })
          }
        >
          创建
        </button>
      </div>

      {err && <p className="error">{err}</p>}

      {project.roles.map((r) => (
        <div className="card" key={r.name}>
          <strong>{r.name}</strong>
          <PermissionChecks
            value={permsOf(r.name, r.permissions)}
            onChange={(v) => setEditPerms({ ...editPerms, [r.name]: v })}
          />
          <div className="row">
            <button
              className="ghost"
              onClick={() =>
                run(async () => {
                  await api(`/api/projects/${project.id}/roles/${encodeURIComponent(r.name)}`, {
                    method: 'PATCH',
                    body: { permissions: permsOf(r.name, r.permissions) },
                  });
                  await onChanged();
                })
              }
            >
              保存
            </button>
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  if (!confirm(`删除角色 ${r.name}？`)) return;
                  await api(`/api/projects/${project.id}/roles/${encodeURIComponent(r.name)}`, {
                    method: 'DELETE',
                  });
                  await onChanged();
                })
              }
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
