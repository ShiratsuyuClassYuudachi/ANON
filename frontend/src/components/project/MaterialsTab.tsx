import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Download, File, FileText, FileType2, MoreHorizontal, Music, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadUrl, uploadMaterial, validateMaterialFile } from '../../api/client';
import AuthImg from '../AuthImg';
import AuthMedia, { previewKindOf } from '../AuthMedia';
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
import PhysicalTab from './PhysicalTab';
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
import { ListRow } from '@/components/ui/list-row';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function MaterialUploadProgress({ percent }: { percent: number | null }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">
        {percent === 100 ? '文件已传输，正在保存…' : percent === null ? '正在上传…' : `正在上传 ${percent}%`}
      </p>
      <div role="progressbar" aria-label="文件上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full bg-primary transition-[width] ${percent === null ? 'animate-pulse' : ''}`} style={{ width: `${percent ?? 100}%` }} />
      </div>
    </div>
  );
}

function UploadErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <AlertDialog open={!!message} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>文件上传失败</AlertDialogTitle>
          <AlertDialogDescription className="break-words">{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogAction onClick={onClose}>知道了</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  const [expanded, setExpanded] = useState(false);
  const [showVis, setShowVis] = useState(false);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [visDraft, setVisDraft] = useState<Visibility>(resource.visibility);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(0);
  const [uploadError, setUploadError] = useState('');

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
    if (uploading) return;
    if (!file) {
      setUploadError('请选择需要上传的文件');
      return;
    }
    setUploading(true);
    try {
      await uploadMaterial(`${base}/versions`, file, { note }, setUploadPercent);
      setFile(null);
      setNote('');
      setUploadOpen(false);
      await onChanged().catch((e) => toast.error(`文件已保存，列表刷新失败：${(e as Error).message}`));
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
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
  const kind = previewKindOf(selectedVersion?.file?.mime, selectedVersion?.file?.filename);

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex h-20 items-start gap-3">
          {selectedVersion?.hasPreview && kind ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              aria-label={`预览 ${resource.name}`}
              className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {kind === 'image' && (
                <AuthImg
                  src={`${base}/versions/${selected}/preview`}
                  alt={resource.name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              )}
              {kind === 'pdf' && <FileText className="size-7 text-muted-foreground" />}
              {kind === 'video' && <Play className="size-7 text-muted-foreground" />}
              {kind === 'audio' && <Music className="size-7 text-muted-foreground" />}
              {kind === 'markdown' && <FileType2 className="size-7 text-muted-foreground" />}
            </button>
          ) : (
            <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
              <File className="size-7" aria-hidden="true" />
              <span className="sr-only">{resource.latestVersion ? '文件暂无预览' : '暂无版本'}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 h-10 break-all text-sm font-medium leading-5" title={resource.name}>{resource.name}</p>
            <div className="mt-2 flex min-w-0 items-center gap-1.5">
              <Badge variant="secondary" className="min-w-0 shrink"><span className="truncate" title={typeName}>{typeName}</span></Badge>
              <Badge variant="outline" className="shrink-0">v{selected || resource.latestVersion || '—'}</Badge>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={`管理 ${resource.name}`}><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setUploadOpen(true)}>上传新版本</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setVisDraft(resource.visibility);
                    setShowVis(true);
                  }}
                >
                  可见范围
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          aria-expanded={expanded}
          aria-controls={`resource-details-${resource.id}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {expanded ? '收起详情' : '展开详情'}
        </Button>
        {expanded && (
          <div id={`resource-details-${resource.id}`} className="space-y-3 border-t pt-3">
            {resource.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{resource.description}</p>}
            {selectedVersion?.file && <p className="break-all text-sm text-muted-foreground">{selectedVersion.file.filename}</p>}
            {versions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
                  <SelectTrigger className="w-28" aria-label="选择资源版本"><SelectValue /></SelectTrigger>
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
            ) : (
              <p className="text-sm text-muted-foreground">暂无版本{canManage ? '，可通过右上角菜单上传文件。' : '。'}</p>
            )}
          </div>
        )}
      </CardContent>

      {canManage && (
        <FormOverlay open={showVis} onOpenChange={setShowVis} title="资源可见范围">
          <div className="space-y-3">
            <VisibilityPicker members={members} roles={roles} value={visDraft} onChange={setVisDraft} />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveVisibility}>保存</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowVis(false)}>取消</Button>
            </div>
          </div>
        </FormOverlay>
      )}

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-auto p-2 pt-10 sm:max-w-3xl">
          <DialogTitle className="sr-only">{resource.name}</DialogTitle>
          {kind === 'pdf' && <AuthMedia kind="pdf" src={`${base}/versions/${selected}/preview`} alt={resource.name} className="h-[80vh] w-full" />}
          {kind === 'video' && <AuthMedia kind="video" src={`${base}/versions/${selected}/preview`} className="max-h-[80vh] w-full" />}
          {kind === 'audio' && <AuthMedia kind="audio" src={`${base}/versions/${selected}/preview`} className="w-full" />}
          {kind === 'markdown' && <AuthMedia kind="markdown" src={`${base}/versions/${selected}/preview`} className="max-h-[80vh] w-full overflow-auto p-4 text-sm" />}
          {(!kind || kind === 'image') && (
            <div className="flex min-h-0 min-w-0 items-center justify-center">
              <AuthImg
                src={`${base}/versions/${selected}/download`}
                alt={resource.name}
                style={{ maxWidth: '100%', maxHeight: 'calc(100dvh - 6rem)', objectFit: 'contain' }}
                onClick={() => setZoom(false)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FormOverlay open={uploadOpen} onOpenChange={(open) => { if (!uploading) setUploadOpen(open); }} title="上传新版本">
        <fieldset disabled={uploading} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`upload-file-${resource.id}`}>文件</Label>
            <Input
              id={`upload-file-${resource.id}`}
              type="file"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0] ?? null;
                try {
                  if (selectedFile) validateMaterialFile(selectedFile);
                  setFile(selectedFile);
                } catch (error) {
                  e.target.value = '';
                  setFile(null);
                  setUploadError((error as Error).message);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">单个文件最大 1 GB（1024 MB）</p>
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
          {uploading && <MaterialUploadProgress percent={uploadPercent} />}
          <Button className="w-full" disabled={uploading} onClick={uploadVersion}>{uploading ? '上传中…' : '上传'}</Button>
        </fieldset>
      </FormOverlay>

      <UploadErrorDialog message={uploadError} onClose={() => setUploadError('')} />

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
  const [view, setView] = useState<'digital' | 'physical'>('digital');
  const canManage =
    myPermissions.includes('project:manage') || myPermissions.includes('materials:manage');
  const roles = project.roles.map((r) => r.name);
  const [types, setTypes] = useState<ResourceTypeItem[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [filterType, setFilterType] = useState('');
  const [err, setErr] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [resForm, setResForm] = useState({ name: '', typeId: '', description: '' });
  const [resFile, setResFile] = useState<File | null>(null);
  const [resNote, setResNote] = useState('');
  const resFileInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(0);
  const [uploadError, setUploadError] = useState('');
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
    setErr('');
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
    if (creating) return;
    setErr('');
    setCreating(true);
    try {
      const url = `/api/projects/${project.id}/materials`;
      if (resFile) {
        await uploadMaterial(url, resFile, {
          name: resForm.name,
          typeId: resForm.typeId || types[0]?.id || '',
          description: resForm.description,
          note: resNote,
        }, setUploadPercent);
      } else {
        await api(url, {
          body: {
            name: resForm.name,
            typeId: resForm.typeId || types[0]?.id,
            description: resForm.description || undefined,
          },
        });
      }
      setResForm({ name: '', typeId: '', description: '' });
      setResFile(null);
      if (resFileInput.current) resFileInput.current.value = '';
      setResNote('');
      await load().catch((error) => toast.error(`资源已创建，列表刷新失败：${(error as Error).message}`));
    } catch (e2) {
      if (resFile) setUploadError((e2 as Error).message);
      else toast.error((e2 as Error).message);
    } finally {
      setCreating(false);
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

  const viewSwitcher = (
    <Tabs value={view} onValueChange={(v) => setView(v as 'digital' | 'physical')}>
      <TabsList>
        <TabsTrigger value="digital">数字资源</TabsTrigger>
        <TabsTrigger value="physical">实物清单</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (view === 'physical') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">物料</h3>
          {viewSwitcher}
        </div>
        <PhysicalTab project={project} members={members} myPermissions={myPermissions} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">物料</h3>
        {viewSwitcher}
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
                  <ListRow className="space-y-2">
                    <VisibilityPicker members={members} roles={roles} value={typeVisDraft} onChange={setTypeVisDraft} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveTypeVisibility(t)}>保存</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTypeVisFor(null)}>取消</Button>
                    </div>
                  </ListRow>
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
              <fieldset disabled={creating} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="资源名称"
                    value={resForm.name}
                    onChange={(e) => setResForm({ ...resForm, name: e.target.value })}
                    required
                  />
                  <Select
                    disabled={creating}
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
                <div className="space-y-1.5">
                  <Label>初始版本文件（可选）</Label>
                  <Input
                    ref={resFileInput}
                    type="file"
                    onChange={(e) => {
                      const selectedFile = e.target.files?.[0] ?? null;
                      try {
                        if (selectedFile) validateMaterialFile(selectedFile);
                        setResFile(selectedFile);
                      } catch (error) {
                        e.target.value = '';
                        setResFile(null);
                        setUploadError((error as Error).message);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">单个文件最大 1 GB（1024 MB）</p>
                </div>
                {resFile && (
                  <Input
                    placeholder="版本备注（可选）"
                    value={resNote}
                    onChange={(e) => setResNote(e.target.value)}
                  />
                )}
                {creating && resFile && <MaterialUploadProgress percent={uploadPercent} />}
                <Button type="submit" disabled={creating}>{creating ? resFile ? '上传中…' : '创建中…' : '创建'}</Button>
              </fieldset>
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

      <div className="grid items-start gap-3 md:grid-cols-2">
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

      <UploadErrorDialog message={uploadError} onClose={() => setUploadError('')} />

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
