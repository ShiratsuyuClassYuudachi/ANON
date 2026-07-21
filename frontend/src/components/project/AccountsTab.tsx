import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { decryptWithPassphrase, encryptWithPassphrase } from '../../crypto';
import type { Member, PlatformAccountItem, ProjectDetail } from '../../types';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

const PLATFORMS = ['QQ', '小红书', 'B站', '微博', '其他'];
const MODE_LABELS: Record<PlatformAccountItem['mode'], string> = {
  full: '完整账号',
  otp: '二步验证',
  contact: '联系人',
};

interface VisibilityDraft {
  userIds: string[];
  roleNames: string[];
}

function VisibilityEditor({
  project,
  members,
  value,
  onChange,
}: {
  project: ProjectDetail;
  members: Member[];
  value: VisibilityDraft;
  onChange: (v: VisibilityDraft) => void;
}) {
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return (
    <div>
      <label className="field">可见范围（不选 = 全体成员可见）</label>
      <div className="row" style={{ marginBottom: 8 }}>
        {members.map((m) => (
          <label key={m.userId} className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', margin: '0 4px 0 0' }}
              checked={value.userIds.includes(m.userId)}
              onChange={() => onChange({ ...value, userIds: toggle(value.userIds, m.userId) })}
            />
            {m.name}
          </label>
        ))}
        {project.roles.map((r) => (
          <label key={r.name} className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', margin: '0 4px 0 0' }}
              checked={value.roleNames.includes(r.name)}
              onChange={() => onChange({ ...value, roleNames: toggle(value.roleNames, r.name) })}
            />
            角色:{r.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function AccountsTab({ project, members, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('accounts:manage');
  const [accounts, setAccounts] = useState<PlatformAccountItem[]>([]);
  const [err, setErr] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [form, setForm] = useState({ platform: 'QQ', account: '', mode: 'full' as PlatformAccountItem['mode'], password: '', passphrase: '', keySource: 'user' as 'user' | 'server', note: '' });
  const [vis, setVis] = useState<VisibilityDraft>({ userIds: [], roleNames: [] });
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealPass, setRevealPass] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [editingVisId, setEditingVisId] = useState<string | null>(null);
  const [visDraft, setVisDraft] = useState<VisibilityDraft>({ userIds: [], roleNames: [] });

  const load = useCallback(async () => {
    const q = platformFilter ? `?platform=${encodeURIComponent(platformFilter)}` : '';
    const d = await api<{ accounts: PlatformAccountItem[] }>(`/api/projects/${project.id}/accounts${q}`);
    setAccounts(d.accounts);
  }, [project.id, platformFilter]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const body: Record<string, unknown> = {
        platform: form.platform,
        account: form.account,
        mode: form.mode,
        note: form.note || undefined,
        visibility: vis,
      };
      if (form.mode === 'full') {
        if (!form.password) throw new Error('请填写密码');
        if (form.keySource === 'server') {
          body.cipherKeySource = 'server';
          body.password = form.password;
        } else {
          if (!form.passphrase) throw new Error('请设置保险库口令');
          body.passwordCipher = await encryptWithPassphrase(form.password, form.passphrase);
        }
      }
      await api(`/api/projects/${project.id}/accounts`, { body });
      setForm({ ...form, account: '', password: '', passphrase: '', note: '' });
      setVis({ userIds: [], roleNames: [] });
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const reveal = async (a: PlatformAccountItem) => {
    setErr('');
    try {
      const d = await api<{ password?: string; cipher?: string }>(
        `/api/projects/${project.id}/accounts/${a.id}/reveal`,
        { method: 'POST', body: {} },
      );
      if (a.cipherKeySource === 'server') {
        setRevealed({ ...revealed, [a.id]: d.password! });
      } else {
        if (!revealPass) throw new Error('请输入保险库口令');
        setRevealed({ ...revealed, [a.id]: await decryptWithPassphrase(d.cipher!, revealPass) });
      }
      setRevealingId(null);
      setRevealPass('');
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const saveVisibility = async (id: string) => {
    setErr('');
    try {
      await api(`/api/projects/${project.id}/accounts/${id}`, { method: 'PATCH', body: { visibility: visDraft } });
      setEditingVisId(null);
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const visText = (a: PlatformAccountItem) => {
    const { userIds, roleNames } = a.visibility;
    if (!userIds.length && !roleNames.length) return '全体成员';
    const names = userIds.map((id) => members.find((m) => m.userId === id)?.name ?? id);
    return [...names, ...roleNames.map((r) => `角色:${r}`)].join('、');
  };

  return (
    <div>
      {canManage && (
        <form className="card" onSubmit={create}>
          <label className="field">新建账号</label>
          <div className="grid-2">
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input placeholder="账号 / 联系方式" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} required />
          </div>
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as PlatformAccountItem['mode'] })}>
            <option value="full">完整账号（账号 + 密码）</option>
            <option value="otp">二步验证（仅账号 + 添加人，便于索取验证码）</option>
            <option value="contact">联系人（仅记录联系方式）</option>
          </select>
          {form.mode === 'full' && (
            <>
              <input type="password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <div className="row" style={{ marginBottom: 8 }}>
                <label className="chip" style={{ cursor: 'pointer' }}>
                  <input type="radio" style={{ width: 'auto', margin: '0 4px 0 0' }} checked={form.keySource === 'user'} onChange={() => setForm({ ...form, keySource: 'user' })} />
                  浏览器加密（推荐）
                </label>
                <label className="chip" style={{ cursor: 'pointer' }}>
                  <input type="radio" style={{ width: 'auto', margin: '0 4px 0 0' }} checked={form.keySource === 'server'} onChange={() => setForm({ ...form, keySource: 'server' })} />
                  服务端密钥加密
                </label>
              </div>
              {form.keySource === 'user' && (
                <input type="password" placeholder="保险库口令（服务端不存储，遗忘无法找回）" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} required />
              )}
            </>
          )}
          <textarea placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <VisibilityEditor project={project} members={members} value={vis} onChange={setVis} />
          <button>创建</button>
        </form>
      )}

      <div className="card">
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
          <option value="">全部平台</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {err && <p className="error">{err}</p>}

      {accounts.map((a) => (
        <div className="card" key={a.id}>
          <div className="row">
            <strong>{a.account}</strong>
            <span className="chip">{a.platform}</span>
            <span className="chip">{MODE_LABELS[a.mode]}</span>
            {a.mode === 'full' && (
              <span className="chip">{a.cipherKeySource === 'server' ? '服务端加密' : '浏览器加密'}</span>
            )}
          </div>
          <div className="muted">
            添加人：{a.addedBy?.name ?? '未知'} ｜ 可见范围：{visText(a)}
          </div>
          {a.mode === 'otp' && a.addedBy && (
            <p className="muted">
              索取二步验证码请联系：
              {a.addedBy.contacts.length
                ? a.addedBy.contacts.map((c) => `${c.platform} ${c.value}`).join('、')
                : a.addedBy.name}
            </p>
          )}
          {a.note && <p>{a.note}</p>}
          {a.mode === 'full' && (
            <div>
              {revealed[a.id] !== undefined ? (
                <p>
                  密码：<code>{revealed[a.id]}</code>
                </p>
              ) : revealingId === a.id ? (
                <div className="row">
                  {a.cipherKeySource !== 'server' && (
                    <input
                      type="password"
                      placeholder="保险库口令"
                      value={revealPass}
                      onChange={(e) => setRevealPass(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  )}
                  <button onClick={() => reveal(a)}>确认</button>
                  <button className="ghost" onClick={() => { setRevealingId(null); setRevealPass(''); }}>取消</button>
                </div>
              ) : (
                <button className="ghost" onClick={() => setRevealingId(a.id)}>查看密码</button>
              )}
            </div>
          )}
          {canManage && (
            <div className="row">
              <button
                className="ghost"
                onClick={() => {
                  setEditingVisId(editingVisId === a.id ? null : a.id);
                  setVisDraft({ userIds: [...a.visibility.userIds], roleNames: [...a.visibility.roleNames] });
                }}
              >
                可见范围
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm('删除该账号？')) return;
                  await api(`/api/projects/${project.id}/accounts/${a.id}`, { method: 'DELETE' });
                  await load();
                }}
              >
                删除
              </button>
            </div>
          )}
          {canManage && editingVisId === a.id && (
            <div>
              <VisibilityEditor project={project} members={members} value={visDraft} onChange={setVisDraft} />
              <div className="row">
                <button onClick={() => saveVisibility(a.id)}>保存可见范围</button>
                <button className="ghost" onClick={() => setEditingVisId(null)}>取消</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {!accounts.length && <p className="muted">暂无账号。</p>}
    </div>
  );
}
