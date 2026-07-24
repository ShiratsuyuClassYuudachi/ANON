import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { FormOverlay } from '@/components/FormOverlay';
import { VisibilityPicker } from './VisibilityPicker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function ResourceCard({
  project,
  resource,
  typeName,
  members,
  roles,
  canManage,
  onChanged,
}: {
  project: ProjectDetail;
  resource: ResourceItem;
  typeName: string;
  members: Member[];
  roles: string[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const base = `/api/projects/${project.id}/materials/${resource.id}`;
  const [versions, setVersions] = useState<ResourceVersionItem[]>([]);
  const [selected, setSelected] = useState<number>(resource.latestVersion);
  const [zoom, setZoom] = useState(false);
  const [showVis, setShowVis] = useState(false);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [visDraft, setVisDraft] = useState<Visibility>(resource.visibility);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadVersions = useCallback(async () => {
    const d = await api<{ versions: ResourceVersionItem[] }>(`${base}/versions`);
    setVersions(d.versions);
    setSelected((s) => (d.versions.some((v) => v.version === s) ? s : (d.versions[0]?.version ?? 0)));
  }, [base]);

  useEffect(() => {
    if (resource.latestVersion > 0) loadVersions().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.latestVersion]);

  const uploadVersion = async () => {
    if (!file) {
      toast.error('请选择文件');
      return;
    }
    try {
      const fd = new FormData();
      fd.set('note', note);
      fd.set('file', file);
      await api(`${base}/versions`, { formData: fd });
      setFile(null);
      setNote('');
      setUploadOpen(false);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveVisibility = async () => {
    try {
      await api(base, { method: 'PATCH', body: { visibility: visDraft } });
      setShowVis(false);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    try {
      await api(base, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const selectedVersion = versions.find((v) => v.version === selected);

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{resource.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{typeName}</Badge>
              <Badge variant="outline">v{resource.latestVersion || '—'}</Badge>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setUploadOpen(true)}>上传新版本</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (!showVis) setVisDraft(resource.visibility);
                    setShowVis(!showVis);
                  }}
                >
                  可见范围
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {resource.description && <p className="text-sm text-muted-foreground">{resource.description}</p>}
        {resource.hasPreview && (
          <button onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-lg border">
            <AuthImg src={`${base}/preview`} alt={resource.name} style={{ width: '100%', display: 'block' }} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedVersion?.file}
            onClick={() =>
              selectedVersion?.file &&
              downloadUrl(`${base}/versions/${selected}/download`, selectedVersion.file.filename).catch((e) =>
                toast.error((e as Error).message),
              )
            }
          >
            <Download className="size-4" /> 下载该版本
          </Button>
        </div>
        {canManage && showVis && (
          <div className="space-y-2 rounded-lg border p-3">
            <VisibilityPicker members={members} roles={roles} value={visDraft} onChange={setVisDraft} />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveVisibility}>保存</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowVis(false)}>取消</Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">{resource.name}</DialogTitle>
          <AuthImg
            src={`${base}/versions/${selected}/download`}
            alt={resource.name}
            style={{ width: '100%' }}
            onClick={() => setZoom(false)}
          />
        </DialogContent>
      </Dialog>

      <FormOverlay open={uploadOpen} onOpenChange={setUploadOpen} title="上传新版本">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`upload-file-${resource.id}`}>文件</Label>
            {/* shadcn Input 不转发 ref（React 18），文件选择用原生 input 加 Input 同款类名 */}
            <input
              id={`upload-file-${resource.id}`}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground dark:bg-input/30"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`upload-note-${resource.id}`}>版本备注（可选）</Label>
            <Input
              id={`upload-note-${resource.id}`}
              placeholder="版本备注（可选）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={uploadVersion}>上传</Button>
        </div>
      </FormOverlay>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该资源及其全部版本？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
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
  const [typeVisDraft, setTypeVisDraft] = useState<Visibility>({ userIds: [], roleNames: [] });
  const [deleteTypeFor, setDeleteTypeFor] = useState<ResourceTypeItem | null>(null);

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
      toast.error((e2 as Error).message);
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
      toast.error((e2 as Error).message);
    }
  };

  const removeType = async (t: ResourceTypeItem) => {
    try {
      await api(`/api/projects/${project.id}/materials/types/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const saveTypeVisibility = async (t: ResourceTypeItem) => {
    try {
      await api(`/api/projects/${project.id}/materials/types/${t.id}`, {
        method: 'PATCH',
        body: { visibility: typeVisDraft },
      });
      setTypeVisFor(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? '';
  const visible = filterType ? resources.filter((r) => r.typeId === filterType) : resources;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">物料</h3>
      </div>

      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {canManage && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">类型管理</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={createType} className="flex gap-2">
              <Input
                placeholder="新建类型（如 海报、宣传图）"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                required
                className="flex-1"
              />
              <Button type="submit">新建类型</Button>
            </form>
            {types.map((t) => (
              <div key={t.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t.name}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (typeVisFor === t.id) {
                        setTypeVisFor(null);
                      } else {
                        setTypeVisDraft(t.visibility);
                        setTypeVisFor(t.id);
                      }
                    }}
                  >
                    可见范围
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTypeFor(t)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {typeVisFor === t.id && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <VisibilityPicker members={members} roles={roles} value={typeVisDraft} onChange={setTypeVisDraft} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveTypeVisibility(t)}>保存</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTypeVisFor(null)}>取消</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && types.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">新建资源</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={createResource} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="资源名称"
                  value={resForm.name}
                  onChange={(e) => setResForm({ ...resForm, name: e.target.value })}
                  required
                />
                <Select
                  value={resForm.typeId || types[0]?.id || ''}
                  onValueChange={(v) => setResForm({ ...resForm, typeId: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder="描述（可选）"
                value={resForm.description}
                onChange={(e) => setResForm({ ...resForm, description: e.target.value })}
              />
              <Button type="submit">创建</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant={filterType === '' ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setFilterType('')}
        >
          全部
        </Badge>
        {types.map((t) => (
          <Badge
            key={t.id}
            variant={filterType === t.id ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setFilterType(t.id)}
          >
            {t.name}
          </Badge>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
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
          />
        ))}
      </div>
      {!visible.length && <p className="text-sm text-muted-foreground">暂无资源。</p>}

      <AlertDialog open={!!deleteTypeFor} onOpenChange={(o) => !o && setDeleteTypeFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除类型「{deleteTypeFor?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTypeFor) void removeType(deleteTypeFor);
                setDeleteTypeFor(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
