import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Download, File, FileText, FileType2, MoreHorizontal, Music, Pencil, Plus, Search, Play, Trash2 } from 'lucide-react';
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

function categoryLabel(typeId: string, categories: ResourceTypeItem[]): string {
  const type = categories.find((item) => item.id === typeId);
  if (!type) return '受限类别';
  if (!type.parentId) return type.name;
  const parent = categories.find((item) => item.id === type.parentId);
  return `${parent?.name ?? '受限类别'} / ${type.name}`;
}

function ResourceCard({
  project,
  resource,
  categories,
  members,
  roles,
  canManage,
  onChanged,
}: {
  project: ProjectDetail;
  resource: ResourceItem;
  categories: ResourceTypeItem[];
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
  const [editDraft, setEditDraft] = useState<{ name: string; description: string; typeId: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editDraft || savingEdit) return;
    setSavingEdit(true);
    try {
      await api(base, { method: 'PATCH', body: editDraft });
      setEditDraft(null);
      await onChanged().catch((error) => toast.error(`资源已保存，列表刷新失败：${(error as Error).message}`));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingEdit(false);
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
              <Badge variant="secondary" className="min-w-0 shrink"><span className="truncate" title={categoryLabel(resource.typeId, categories)}>{categoryLabel(resource.typeId, categories)}</span></Badge>
              <Badge variant="outline" className="shrink-0">v{selected || resource.latestVersion || '—'}</Badge>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={`管理 ${resource.name}`}><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditDraft({ name: resource.name, description: resource.description, typeId: resource.typeId })}>编辑资源</DropdownMenuItem>
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
        <FormOverlay open={!!editDraft} onOpenChange={(open) => { if (!open && !savingEdit) setEditDraft(null); }} title="编辑资源">
          {editDraft && (
            <form className="space-y-3" onSubmit={saveEdit}>
              <fieldset disabled={savingEdit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`edit-resource-name-${resource.id}`}>资源名称</Label>
                  <Input id={`edit-resource-name-${resource.id}`} value={editDraft.name} required onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>所属类别</Label>
                  <Select value={editDraft.typeId} onValueChange={(typeId) => setEditDraft({ ...editDraft, typeId })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!categories.some((type) => type.id === editDraft.typeId) && <SelectItem value={editDraft.typeId}>受限类别（保留当前）</SelectItem>}
                      {categories.map((type) => <SelectItem key={type.id} value={type.id}>{categoryLabel(type.id, categories)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`edit-resource-description-${resource.id}`}>描述</Label>
                  <Textarea id={`edit-resource-description-${resource.id}`} value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setEditDraft(null)}>取消</Button>
                  <Button type="submit">{savingEdit ? '保存中…' : '保存'}</Button>
                </div>
              </fieldset>
            </form>
          )}
        </FormOverlay>
      )}

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
  const [categoryView, setCategoryView] = useState(false);
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('materials:manage');
  const roles = project.roles.map((r) => r.name);
  const [types, setTypes] = useState<ResourceTypeItem[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [filterRoot, setFilterRoot] = useState('');
  const [filterChild, setFilterChild] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [err, setErr] = useState('');
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resForm, setResForm] = useState({ name: '', typeId: '', description: '' });
  const [resFile, setResFile] = useState<File | null>(null);
  const [resNote, setResNote] = useState('');
  const resFileInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(0);
  const [uploadError, setUploadError] = useState('');
  const [categoryDraft, setCategoryDraft] = useState<{
    id: string | null; name: string; parentId: string | null; visibility: Visibility;
  } | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [deleteTypeFor, setDeleteTypeFor] = useState<ResourceTypeItem | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterRoot) {
      params.set('typeId', filterChild === 'all' || filterChild === 'direct' ? filterRoot : filterChild);
      if (filterChild === 'all') params.set('includeChildren', 'true');
    }
    const query = params.toString();
    const [typeResponse, resourceResponse] = await Promise.all([
      api<{ types: ResourceTypeItem[] }>('/api/projects/' + project.id + '/materials/types'),
      api<{ resources: ResourceItem[] }>('/api/projects/' + project.id + '/materials' + (query ? '?' + query : '')),
    ]);
    setTypes(typeResponse.types);
    setResources(resourceResponse.resources);
    setErr('');
  }, [filterChild, filterRoot, project.id]);

  useEffect(() => {
    load().catch((error) => setErr((error as Error).message));
  }, [load]);

  const rootOptions = (() => {
    const roots: { id: string; name: string; type: ResourceTypeItem | null; restricted: boolean }[] =
      types.filter((type) => !type.parentId).map((type) => ({ id: type.id, name: type.name, type, restricted: false }));
    const rootIds = new Set(roots.map((root) => root.id));
    const missingParents = [...new Set(types.map((type) => type.parentId).filter((id): id is string => !!id && !rootIds.has(id)))];
    for (const id of missingParents) roots.push({ id, name: '受限类别', type: null, restricted: true });
    return roots;
  })();
  const selectedRoot = rootOptions.find((root) => root.id === filterRoot);
  const selectedChildren = filterRoot ? types.filter((type) => type.parentId === filterRoot) : [];
  const rootTypes = types.filter((type) => !type.parentId);
  const categoryCanChangeParent = !categoryDraft?.id || !!categoryDraft.parentId || !types.some((type) => type.parentId === categoryDraft.id);

  useEffect(() => {
    if (!filterRoot) return;
    const rootExists = types.some((type) => type.id === filterRoot && !type.parentId) || types.some((type) => type.parentId === filterRoot);
    if (!rootExists) {
      setFilterRoot('');
      setFilterChild('all');
      return;
    }
    if (filterChild !== 'all' && filterChild !== 'direct') {
      const selected = types.find((type) => type.id === filterChild);
      if (!selected) setFilterChild('all');
      else if (selected.parentId !== filterRoot) {
        if (selected.parentId) setFilterRoot(selected.parentId);
        else { setFilterRoot(''); setFilterChild('all'); }
      }
    }
  }, [filterChild, filterRoot, types]);

  const openNewCategory = (parentId: string | null = null) => {
    setCategoryDraft({ id: null, name: '', parentId, visibility: { userIds: [], roleNames: [] } });
  };
  const openEditCategory = (type: ResourceTypeItem) => {
    setCategoryDraft({ id: type.id, name: type.name, parentId: type.parentId, visibility: type.visibility });
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!categoryDraft || savingCategory) return;
    setSavingCategory(true);
    try {
      const path = '/api/projects/' + project.id + '/materials/types';
      const response = await api<{ type: ResourceTypeItem }>(categoryDraft.id ? path + '/' + categoryDraft.id : path, {
        method: categoryDraft.id ? 'PATCH' : 'POST',
        body: { name: categoryDraft.name, parentId: categoryDraft.parentId, visibility: categoryDraft.visibility },
      });
      if (categoryDraft.id && categoryDraft.parentId !== response.type.parentId && (filterRoot === categoryDraft.id || filterChild === categoryDraft.id)) {
        setFilterRoot('');
        setFilterChild('all');
      }
      setCategoryDraft(null);
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingCategory(false);
    }
  };

  const removeType = async (type: ResourceTypeItem) => {
    try {
      await api('/api/projects/' + project.id + '/materials/types/' + type.id, { method: 'DELETE' });
      if (filterRoot === type.id) { setFilterRoot(''); setFilterChild('all'); }
      else if (filterChild === type.id) setFilterChild('all');
      setDeleteTypeFor(null);
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const openNewResource = () => {
    const selectedChild = filterChild !== 'all' && filterChild !== 'direct'
      ? filterChild
      : filterRoot && filterChild === 'direct' && types.some((type) => type.id === filterRoot)
        ? filterRoot
        : filterRoot && filterChild === 'all'
          ? (types.some((type) => type.id === filterRoot) ? filterRoot : types.find((type) => type.parentId === filterRoot)?.id ?? '')
          : '';
    setResForm({ name: '', typeId: selectedChild || types[0]?.id || '', description: '' });
    setResFile(null);
    setResNote('');
    if (resFileInput.current) resFileInput.current.value = '';
    setResourceOpen(true);
  };

  const createResource = async (event: FormEvent) => {
    event.preventDefault();
    if (creating || !resForm.typeId) return;
    setErr('');
    setCreating(true);
    try {
      const url = '/api/projects/' + project.id + '/materials';
      if (resFile) {
        await uploadMaterial(url, resFile, {
          name: resForm.name, typeId: resForm.typeId, description: resForm.description, note: resNote,
        }, setUploadPercent);
      } else {
        await api(url, { body: {
          name: resForm.name, typeId: resForm.typeId,
          description: resForm.description || undefined,
        } });
      }
      setResForm({ name: '', typeId: '', description: '' });
      setResFile(null);
      if (resFileInput.current) resFileInput.current.value = '';
      setResNote('');
      setResourceOpen(false);
      await load().catch((error) => toast.error('资源已创建，列表刷新失败：' + (error as Error).message));
    } catch (error) {
      if (resFile) setUploadError((error as Error).message);
      else toast.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const typeLabel = (typeId: string) => categoryLabel(typeId, types);
  const query = search.trim().toLocaleLowerCase();
  const searched = resources.filter((resource) =>
    !query || (resource.name + '\n' + resource.description).toLocaleLowerCase().includes(query),
  );
  const visible = [...searched].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    const difference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return sort === 'newest' ? difference : -difference;
  });

  const viewSwitcher = (
    <Tabs value={view} onValueChange={(value) => setView(value as 'digital' | 'physical')}>
      <TabsList><TabsTrigger value="digital">数字资源</TabsTrigger><TabsTrigger value="physical">实物清单</TabsTrigger></TabsList>
    </Tabs>
  );

  if (view === 'physical') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">物料</h3>{viewSwitcher}</div>
        <PhysicalTab project={project} members={members} myPermissions={myPermissions} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">物料</h3>{viewSwitcher}</div>
      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {categoryView ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCategoryView(false)}><ArrowLeft className="size-4" /> 返回资源</Button>
              <h4 className="text-base font-semibold">类别管理</h4>
            </div>
            <Button size="sm" onClick={() => openNewCategory()}><Plus className="size-4" /> 新建一级类别</Button>
          </div>
          {rootOptions.length ? rootOptions.map((root) => {
            const children = types.filter((type) => type.parentId === root.id);
            return (
              <Card key={root.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="min-w-0 truncate text-base">{root.name}</CardTitle>
                  {!root.restricted && root.type && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openNewCategory(root.id)}><Plus className="size-4" /> 添加子类</Button>
                      <Button variant="ghost" size="icon" aria-label={'编辑' + root.name} onClick={() => openEditCategory(root.type!)}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={'删除' + root.name} disabled={children.length > 0} onClick={() => setDeleteTypeFor(root.type)}><Trash2 className="size-4" /></Button>
                    </div>
                  )}
                  {root.restricted && <span className="text-xs text-muted-foreground">父类别不可见</span>}
                </CardHeader>
                {children.length > 0 && (
                  <CardContent className="space-y-1 pt-0">
                    {children.map((child) => (
                      <div key={child.id} className="flex min-w-0 items-center gap-2 border-l pl-3">
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{child.name}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditCategory(child)}><Pencil className="size-4" /> 编辑</Button>
                          <Button variant="ghost" size="icon" aria-label={'删除' + child.name} onClick={() => setDeleteTypeFor(child)}><Trash2 className="size-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
                {!children.length && root.restricted && <CardContent className="pt-0 text-sm text-muted-foreground">暂无可见子类别。</CardContent>}
              </Card>
            );
          }) : <Card className="p-4 text-sm text-muted-foreground">还没有类别，先新建一级类别。</Card>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="搜索物料资源" placeholder="搜索名称或描述" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={sort} onValueChange={(value) => setSort(value as 'newest' | 'oldest' | 'name')}>
                <SelectTrigger className="w-full sm:w-40" aria-label="资源排序"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">最新创建</SelectItem><SelectItem value="oldest">最早创建</SelectItem><SelectItem value="name">名称排序</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCategoryView(true)}>类别管理</Button>
                <Button size="sm" disabled={!types.length} onClick={openNewResource}><Plus className="size-4" /> 新建资源</Button>
              </div>
            )}
          </div>

          <Card className="space-y-3 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={filterRoot || 'all'} onValueChange={(value) => { setFilterRoot(value === 'all' ? '' : value); setFilterChild('all'); }}>
                <SelectTrigger aria-label="一级类别"><SelectValue placeholder="全部一级类别" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部一级类别</SelectItem>
                  {rootOptions.map((root) => <SelectItem key={root.id} value={root.id}>{root.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterChild} disabled={!filterRoot} onValueChange={setFilterChild}>
                <SelectTrigger aria-label="二级类别"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部（含一级直属）</SelectItem>
                  <SelectItem value="direct">{selectedRoot?.name ?? '一级类别'}直属资源</SelectItem>
                  {selectedChildren.map((child) => <SelectItem key={child.id} value={child.id}>{child.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground" role="status">找到 {visible.length} 项</span>
              <Button variant="ghost" size="sm" disabled={!filterRoot && !search && sort === 'newest'} onClick={() => { setFilterRoot(''); setFilterChild('all'); setSearch(''); setSort('newest'); }}>清空筛选</Button>
            </div>
          </Card>

          <div className="grid items-start gap-3 md:grid-cols-2">
            {visible.map((resource) => (
              <ResourceCard key={resource.id} project={project} resource={resource} categories={types} members={members} roles={roles} canManage={canManage} onChanged={load} />
            ))}
          </div>
          {!visible.length && <p className="py-6 text-center text-sm text-muted-foreground">{search.trim() ? '没有符合搜索条件的资源。' : '暂无资源。'}</p>}
        </>
      )}

      <FormOverlay open={resourceOpen} onOpenChange={(open) => { if (!creating) setResourceOpen(open); }} title="新建资源" description="可以先创建资源，再上传初始版本文件。">
        <form className="space-y-3" onSubmit={createResource}>
          <fieldset disabled={creating} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-resource-name">资源名称</Label>
              <Input id="new-resource-name" placeholder="资源名称" value={resForm.name} required onChange={(event) => setResForm({ ...resForm, name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>所属类别</Label>
              <Select value={resForm.typeId} onValueChange={(typeId) => setResForm({ ...resForm, typeId })}>
                <SelectTrigger><SelectValue placeholder="请选择类别" /></SelectTrigger>
                <SelectContent>{types.map((type) => <SelectItem key={type.id} value={type.id}>{typeLabel(type.id)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea placeholder="描述（可选）" value={resForm.description} onChange={(event) => setResForm({ ...resForm, description: event.target.value })} />
            <div className="space-y-1.5">
              <Label htmlFor="new-resource-file">初始版本文件（可选）</Label>
              <Input id="new-resource-file" ref={resFileInput} type="file" onChange={(event) => {
                const selectedFile = event.target.files?.[0] ?? null;
                try {
                  if (selectedFile) validateMaterialFile(selectedFile);
                  setResFile(selectedFile);
                } catch (error) {
                  event.target.value = ''; setResFile(null); setUploadError((error as Error).message);
                }
              }} />
              <p className="text-xs text-muted-foreground">单个文件最大 1 GB（1024 MB）</p>
            </div>
            {resFile && <Input placeholder="版本备注（可选）" value={resNote} onChange={(event) => setResNote(event.target.value)} />}
            {creating && resFile && <MaterialUploadProgress percent={uploadPercent} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={creating} onClick={() => setResourceOpen(false)}>取消</Button>
              <Button type="submit" disabled={creating || !resForm.typeId}>{creating ? resFile ? '上传中…' : '创建中…' : '创建'}</Button>
            </div>
          </fieldset>
        </form>
      </FormOverlay>

      <FormOverlay open={!!categoryDraft} onOpenChange={(open) => { if (!open && !savingCategory) setCategoryDraft(null); }} title={categoryDraft?.id ? '编辑类别' : categoryDraft?.parentId ? '新建二级类别' : '新建一级类别'}>
        {categoryDraft && (
          <form className="space-y-3" onSubmit={saveCategory}>
            <fieldset disabled={savingCategory} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="category-name">类别名称</Label>
                <Input id="category-name" value={categoryDraft.name} required onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>所属一级类别</Label>
                <Select value={categoryDraft.parentId ?? 'root'} onValueChange={(value) => setCategoryDraft({ ...categoryDraft, parentId: value === 'root' ? null : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">一级类别</SelectItem>
                    {categoryDraft.parentId && !rootTypes.some((type) => type.id === categoryDraft.parentId) && <SelectItem value={categoryDraft.parentId}>受限类别（保留当前归属）</SelectItem>}
                    {categoryCanChangeParent && rootTypes.filter((type) => type.id !== categoryDraft.id).map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>可见范围</Label>
                <p className="text-xs text-muted-foreground">留空时二级类别继承上级范围，一级类别对全体成员可见。</p>
                <VisibilityPicker members={members} roles={roles} value={categoryDraft.visibility} onChange={(visibility) => setCategoryDraft({ ...categoryDraft, visibility })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={savingCategory} onClick={() => setCategoryDraft(null)}>取消</Button>
                <Button type="submit">{savingCategory ? '保存中…' : '保存'}</Button>
              </div>
            </fieldset>
          </form>
        )}
      </FormOverlay>

      <UploadErrorDialog message={uploadError} onClose={() => setUploadError('')} />
      <AlertDialog open={!!deleteTypeFor} onOpenChange={(open) => { if (!open) setDeleteTypeFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除类别「{deleteTypeFor?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>类别下仍有资源或子类别时无法删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTypeFor) void removeType(deleteTypeFor); }}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
