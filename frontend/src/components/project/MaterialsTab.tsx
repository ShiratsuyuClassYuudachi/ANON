import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, downloadUrl } from '../../api/client';
import AuthImg from '../AuthImg';
import type {
  Member,
  ProjectDetail,
  ResourceItem,
  ResourceTypeItem,
  ResourceVersionItem,
  Visibility,
} from '../../types';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function VisibilityEditor({
  value,
  members,
  roles,
  onSave,
}: {
  value: Visibility;
  members: Member[];
  roles: string[];
  onSave: (v: Visibility) => Promise<void>;
}) {
  const [userIds, setUserIds] = useState<string[]>(value.userIds);
  const [roleNames, setRoleNames] = useState<string[]>(value.roleNames);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        可见范围（不勾选 = 不限制；勾选后仅列出的成员/角色可见）
      </div>
      <div className="row" style={{ margin: '4px 0' }}>
        {members.map((m) => (
          <label key={m.userId} className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', margin: '0 4px 0 0' }}
              checked={userIds.includes(m.userId)}
              onChange={() => toggle(userIds, setUserIds, m.userId)}
            />
            {m.name}
          </label>
        ))}
      </div>
      <div className="row" style={{ margin: '4px 0' }}>
        {roles.map((r) => (
          <label key={r} className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', margin: '0 4px 0 0' }}
              checked={roleNames.includes(r)}
              onChange={() => toggle(roleNames, setRoleNames, r)}
            />
            {r}
          </label>
        ))}
      </div>
      <button className="ghost" onClick={() => onSave({ userIds, roleNames })}>
        保存可见范围
      </button>
    </div>
  );
}

function ResourceCard({
  project,
  resource,
  typeName,
  members,
  roles,
  canManage,
  onChanged,
  onError,
}: {
  project: ProjectDetail;
  resource: ResourceItem;
  typeName: string;
  members: Member[];
  roles: string[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const base = `/api/projects/${project.id}/materials/${resource.id}`;
  const [versions, setVersions] = useState<ResourceVersionItem[]>([]);
  const [selected, setSelected] = useState<number>(resource.latestVersion);
  const [zoom, setZoom] = useState(false);
  const [showVis, setShowVis] = useState(false);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const loadVersions = useCallback(async () => {
    const d = await api<{ versions: ResourceVersionItem[] }>(`${base}/versions`);
    setVersions(d.versions);
    setSelected((s) => (d.versions.some((v) => v.version === s) ? s : (d.versions[0]?.version ?? 0)));
  }, [base]);

  useEffect(() => {
    if (resource.latestVersion > 0) loadVersions().catch((e) => onError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.latestVersion]);

  const uploadVersion = async () => {
    if (!file) {
      onError('请选择文件');
      return;
    }
    onError('');
    try {
      const fd = new FormData();
      fd.set('note', note);
      fd.set('file', file);
      await api(`${base}/versions`, { formData: fd });
      setFile(null);
      setNote('');
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const selectedVersion = versions.find((v) => v.version === selected);

  return (
    <div className="card">
      <div className="row">
        <strong>{resource.name}</strong>
        {typeName && <span className="chip">{typeName}</span>}
        <span className="chip">v{resource.latestVersion || '—'}</span>
      </div>
      {resource.description && <p className="muted">{resource.description}</p>}

      {resource.hasPreview && (
        <AuthImg
          src={`${base}/preview`}
          alt={resource.name}
          style={{ maxWidth: 240, borderRadius: 8, cursor: 'zoom-in', display: 'block' }}
          onClick={() => setZoom(true)}
        />
      )}
      {zoom && (
        <div
          onClick={() => setZoom(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            cursor: 'zoom-out',
          }}
        >
          <AuthImg
            src={`${base}/versions/${selected}/download`}
            alt={resource.name}
            style={{ maxWidth: '92vw', maxHeight: '92vh' }}
          />
        </div>
      )}

      {versions.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <select value={selected} onChange={(e) => setSelected(Number(e.target.value))} style={{ width: 'auto' }}>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} {v.file?.filename ?? ''}
                {v.note ? `（${v.note}）` : ''}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            onClick={() =>
              selectedVersion?.file &&
              downloadUrl(`${base}/versions/${selected}/download`, selectedVersion.file.filename).catch((e) =>
                onError((e as Error).message),
              )
            }
          >
            下载该版本
          </button>
        </div>
      )}

      {canManage && (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <input
              placeholder="版本备注（可选）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={uploadVersion}>上传新版本</button>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="ghost" onClick={() => setShowVis(!showVis)}>
              可见范围
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (!confirm('删除该资源及其全部版本？')) return;
                await api(base, { method: 'DELETE' });
                await onChanged();
              }}
            >
              删除
            </button>
          </div>
          {showVis && (
            <VisibilityEditor
              value={resource.visibility}
              members={members}
              roles={roles}
              onSave={async (v) => {
                await api(base, { method: 'PATCH', body: { visibility: v } });
                setShowVis(false);
                await onChanged();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function MaterialsTab({ project, members, myPermissions }: Props) {
  const canManage =
    myPermissions.includes('project:manage') || myPermissions.includes('materials:manage');
  const roles = project.roles.map((r) => r.name);
  const [types, setTypes] = useState<ResourceTypeItem[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [filterType, setFilterType] = useState('');
  const [err, setErr] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [resForm, setResForm] = useState({ name: '', typeId: '', description: '' });
  const [typeVisFor, setTypeVisFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      api<{ types: ResourceTypeItem[] }>(`/api/projects/${project.id}/materials/types`),
      api<{ resources: ResourceItem[] }>(`/api/projects/${project.id}/materials`),
    ]);
    setTypes(t.types);
    setResources(r.resources);
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  const createType = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await api(`/api/projects/${project.id}/materials/types`, { body: { name: newTypeName } });
      setNewTypeName('');
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const createResource = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await api(`/api/projects/${project.id}/materials`, {
        body: {
          name: resForm.name,
          typeId: resForm.typeId || types[0]?.id,
          description: resForm.description || undefined,
        },
      });
      setResForm({ name: '', typeId: '', description: '' });
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? '';
  const visible = filterType ? resources.filter((r) => r.typeId === filterType) : resources;

  return (
    <div>
      {canManage && (
        <form className="card" onSubmit={createType}>
          <label className="field">资源类型</label>
          <div className="row">
            <input
              placeholder="新建类型（如 海报、宣传图）"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <button>新建类型</button>
          </div>
          {types.map((t) => (
            <div key={t.id} style={{ marginTop: 8 }}>
              <div className="row">
                <span className="chip">{t.name}</span>
                <button className="ghost" onClick={(e) => { e.preventDefault(); setTypeVisFor(typeVisFor === t.id ? null : t.id); }}>
                  可见范围
                </button>
                <button
                  className="danger"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!confirm(`删除类型「${t.name}」？`)) return;
                    try {
                      await api(`/api/projects/${project.id}/materials/types/${t.id}`, { method: 'DELETE' });
                      await load();
                    } catch (e2) {
                      setErr((e2 as Error).message);
                    }
                  }}
                >
                  删除
                </button>
              </div>
              {typeVisFor === t.id && (
                <VisibilityEditor
                  value={t.visibility}
                  members={members}
                  roles={roles}
                  onSave={async (v) => {
                    await api(`/api/projects/${project.id}/materials/types/${t.id}`, {
                      method: 'PATCH',
                      body: { visibility: v },
                    });
                    setTypeVisFor(null);
                    await load();
                  }}
                />
              )}
            </div>
          ))}
        </form>
      )}

      {canManage && types.length > 0 && (
        <form className="card" onSubmit={createResource}>
          <label className="field">新建资源</label>
          <div className="grid-2">
            <input
              placeholder="资源名称"
              value={resForm.name}
              onChange={(e) => setResForm({ ...resForm, name: e.target.value })}
              required
            />
            <select
              value={resForm.typeId || types[0]?.id || ''}
              onChange={(e) => setResForm({ ...resForm, typeId: e.target.value })}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="描述（可选）"
            value={resForm.description}
            onChange={(e) => setResForm({ ...resForm, description: e.target.value })}
          />
          <button>创建</button>
        </form>
      )}

      <div className="card">
        <div className="row">
          <button className={filterType === '' ? '' : 'ghost'} onClick={() => setFilterType('')}>
            全部
          </button>
          {types.map((t) => (
            <button
              key={t.id}
              className={filterType === t.id ? '' : 'ghost'}
              onClick={() => setFilterType(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="error">{err}</p>}

      {visible.map((r) => (
        <ResourceCard
          key={r.id}
          project={project}
          resource={r}
          typeName={typeName(r.typeId)}
          members={members}
          roles={roles}
          canManage={canManage}
          onChanged={load}
          onError={setErr}
        />
      ))}
      {!visible.length && <p className="muted">暂无资源。</p>}
    </div>
  );
}
