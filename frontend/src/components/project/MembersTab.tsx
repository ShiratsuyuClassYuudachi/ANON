import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import type { Member, ProjectDetail } from '../../types';

interface Props {
  project: ProjectDetail;
  members: Member[];
  onChanged: () => Promise<void>;
}

export default function MembersTab({ project, members, onChanged }: Props) {
  const { user } = useAuth();
  const [roleName, setRoleName] = useState(
    project.roles.find((r) => r.name === '一般staff')?.name ??
      project.roles[project.roles.length - 1]?.name ??
      '',
  );
  const [targetUserId, setTargetUserId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [err, setErr] = useState('');

  const run = (fn: () => Promise<void>) => fn().catch((e) => setErr(e.message));

  const createInvite = () =>
    run(async () => {
      const d = await api<{ url: string }>(`/api/projects/${project.id}/invites`, {
        body: { roleName, targetUserId: targetUserId || undefined },
      });
      setInviteUrl(`${location.origin}${d.url}`);
    });

  return (
    <div>
      <div className="card">
        <label className="field">生成邀请链接</label>
        <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
          {project.roles.map((r) => (
            <option key={r.name} value={r.name}>{r.name}</option>
          ))}
        </select>
        <input
          placeholder="指定用户 ID（留空则任何人可接受）"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
        />
        <button onClick={createInvite}>生成链接</button>
        {inviteUrl && (
          <p className="muted" style={{ wordBreak: 'break-all' }}>
            发给对方：<a href={inviteUrl}>{inviteUrl}</a>
          </p>
        )}
      </div>

      {err && <p className="error">{err}</p>}

      {members.map((m) => (
        <div className="card" key={m.userId}>
          <div className="row">
            <strong>{m.name}</strong>
            <span className="muted">{m.email}</span>
          </div>
          <div className="row">
            <select
              value={m.roleName}
              style={{ width: 'auto' }}
              onChange={(e) =>
                run(async () => {
                  await api(`/api/projects/${project.id}/members/${m.userId}`, {
                    method: 'PATCH',
                    body: { roleName: e.target.value },
                  });
                  await onChanged();
                })
              }
            >
              {project.roles.map((r) => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
            {m.userId !== user?.id && (
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    if (!confirm(`移除成员 ${m.name}？`)) return;
                    await api(`/api/projects/${project.id}/members/${m.userId}`, { method: 'DELETE' });
                    await onChanged();
                  })
                }
              >
                移除
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
