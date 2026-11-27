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
import { Card, CardContent } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
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
  if (!type) return '受限分类';
  if (!type.parentId) return type.name;
  const parent = categories.find((item) => item.id === type.parentId);
  return `${parent?.name ?? '受限分类'} / ${type.name}`;
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
      await onChanged().catch((error) => toast.error(`资料已保存，列表刷新失败：${(error as Error).message}`));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const selectedVersion = versions.find((v) => v.version === selected);
  const kind = previewKindOf(selectedVersion?.file?.mime, selectedVersion?.file?.filename);

  return (
    <Card className="editorial-card h-full gap-0 py-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex min-h-20 items-start gap-2 sm:gap-3">
          {selectedVersion?.hasPreview && kind ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              aria-label={`预览 ${resource.name}`}
              className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
              <File className="size-7" aria-hidden="true" />
              <span className="sr-only">{resource.latestVersion ? '文件暂无预览' : '暂无版本'}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 wrap-anywhere text-sm font-medium leading-5" title={resource.name}>{resource.name}</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="min-w-0 shrink"><span className="wrap-anywhere" title={categoryLabel(resource.typeId, categories)}>{categoryLabel(resource.typeId, categories)}</span></Badge>
              <Badge variant="outline" className="shrink-0">v{selected || resource.latestVersion || '—'}</Badge>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={`管理 ${resource.name}`}><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditDraft({ name: resource.name, description: resource.description, typeId: resource.typeId })}>编辑资料</DropdownMenuItem>
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
          {expanded ? '收起详情' : '展开详情与下载'}
        </Button>
        {expanded && (
          <div id={`resource-details-${resource.id}`} className="space-y-3 border-t pt-3">
            {resource.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{resource.description}</p>}
            {selectedVersion?.file && <p className="break-all text-sm text-muted-foreground">{selectedVersion.file.filename}</p>}
            {versions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
                  <SelectTrigger className="w-28" aria-label="选择资料版本"><SelectValue /></SelectTrigger>
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
                  <Download className="size-4" /> 下载当前版本
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{canManage ? '暂未上传文件，可通过右上角菜单上传初始版本。' : '暂未上传文件。'}</p>
            )}
          </div>
        )}
      </CardContent>

      {canManage && (
        <FormOverlay open={!!editDraft} onOpenChange={(open) => { if (!open && !savingEdit) setEditDraft(null); }} title="编辑资料">
          {editDraft && (
            <form className="space-y-3" onSubmit={saveEdit}>
              <fieldset disabled={savingEdit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`edit-resource-name-${resource.id}`}>资料名称</Label>
                  <Input id={`edit-resource-name-${resource.id}`} value={editDraft.name} required onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>所属分类</Label>
                  <Select value={editDraft.typeId} onValueChange={(typeId) => setEditDraft({ ...editDraft, typeId })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!categories.some((type) => type.id === editDraft.typeId) && <SelectItem value={editDraft.typeId}>受限分类（保留当前）</SelectItem>}
                      {categories.map((type) => <SelectItem key={type.id} value={type.id}>{categoryLabel(type.id, categories)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`edit-resource-description-${resource.id}`}>资料说明（可选）</Label>
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
        <FormOverlay open={showVis} onOpenChange={setShowVis} title="资料可见范围">
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
            <Label htmlFor={`upload-file-${resource.id}`}>选择文件</Label>
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
            <p className="text-xs text-muted-foreground">单个文件最大支持 1 GB</p>
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
          <Button className="w-full" disabled={uploading} onClick={uploadVersion}>{uploading ? '上传中…' : '开始上传'}</Button>
        </fieldset>
      </FormOverlay>

      <UploadErrorDialog message={uploadError} onClose={() => setUploadError('')} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该资料及其全部历史版本？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。</AlertDialogDescription>
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
  const [loading, setLoading] = useState(true);
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
  const loadSequence = useRef(0);
  const loadFilters = useRef({ projectId: project.id, filterRoot, filterChild });
  if (loadFilters.current.projectId !== project.id || loadFilters.current.filterRoot !== filterRoot || loadFilters.current.filterChild !== filterChild) {
    loadFilters.current = { projectId: project.id, filterRoot, filterChild };
  }

  const load = useCallback(async () => {
    const filters = loadFilters.current;
    const { projectId, filterRoot, filterChild } = filters;
    const sequence = ++loadSequence.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (filterRoot) {
      params.set('typeId', filterChild === 'all' || filterChild === 'direct' ? filterRoot : filterChild);
      if (filterChild === 'all') params.set('includeChildren', 'true');
    }
    const query = params.toString();
    try {
      const [typeResponse, resourceResponse] = await Promise.all([
        api<{ types: ResourceTypeItem[] }>('/api/projects/' + projectId + '/materials/types'),
        api<{ resources: ResourceItem[] }>('/api/projects/' + projectId + '/materials' + (query ? '?' + query : '')),
      ]);
      if (sequence !== loadSequence.current || filters !== loadFilters.current) return;
      setTypes(typeResponse.types);
      setResources(resourceResponse.resources);
      setErr('');
    } catch (error) {
      if (sequence === loadSequence.current && filters === loadFilters.current) throw error;
    } finally {
      if (sequence === loadSequence.current && filters === loadFilters.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch((error) => setErr((error as Error).message));
    return () => { loadSequence.current++; };
  }, [load, filterChild, filterRoot, project.id]);

  const rootOptions = (() => {
    const roots: { id: string; name: string; type: ResourceTypeItem | null; restricted: boolean }[] =
      types.filter((type) => !type.parentId).map((type) => ({ id: type.id, name: type.name, type, restricted: false }));
    const rootIds = new Set(roots.map((root) => root.id));
    const missingParents = [...new Set(types.map((type) => type.parentId).filter((id): id is string => !!id && !rootIds.has(id)))];
    for (const id of missingParents) roots.push({ id, name: '受限分类', type: null, restricted: true });
    return roots;
  })();
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
      await load().catch((error) => toast.error('资料已创建，列表刷新失败：' + (error as Error).message));
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
      <TabsList><TabsTrigger value="digital">文件资料</TabsTrigger><TabsTrigger value="physical">实物清单</TabsTrigger></TabsList>
    </Tabs>
  );

  if (view === 'physical') {
    return (
      <div className="space-y-3">
        <div data-tour="tab-materials" className="flex items-center justify-between gap-2"><h1 className="editorial-heading">物料</h1>{viewSwitcher}</div>
        <PhysicalTab project={project} members={members} myPermissions={myPermissions} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div data-tour="tab-materials" className="flex flex-wrap items-center justify-between gap-2"><h1 className="editorial-heading">物料</h1>{viewSwitcher}</div>
      {err && <p role="alert" className="py-4 text-sm text-destructive">{err}</p>}

      {categoryView ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCategoryView(false)}><ArrowLeft className="size-4" /> 返回资料列表</Button>
              <h2 className="editorial-subheading">资料分类管理</h2>
            </div>
            <Button size="sm" onClick={() => openNewCategory()}><Plus className="size-4" /> 新建一级分类</Button>
          </div>
          {rootOptions.length ? rootOptions.map((root) => {
            const children = types.filter((type) => type.parentId === root.id);
            return (
              <section key={root.id} className="border-t py-2">
                <header className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <h3 className="editorial-subheading min-w-0 wrap-anywhere">{root.name}</h3>
                  {!root.restricted && root.type && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openNewCategory(root.id)}><Plus className="size-4" /> 新建二级分类</Button>
                      <Button variant="ghost" size="icon" aria-label={'编辑' + root.name} onClick={() => openEditCategory(root.type!)}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={'删除' + root.name} disabled={children.length > 0} onClick={() => setDeleteTypeFor(root.type)}><Trash2 className="size-4" /></Button>
                    </div>
                  )}
                  {root.restricted && <span className="text-xs text-muted-foreground">父分类不可见</span>}
                </header>
                {children.length > 0 && (
                  <div className="editorial-list ml-3">
                    {children.map((child) => (
                      <div key={child.id} className="editorial-row flex flex-wrap items-center gap-2 pl-3">
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 wrap-anywhere text-sm">{child.name}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditCategory(child)}><Pencil className="size-4" /> 编辑</Button>
                          <Button variant="ghost" size="icon" aria-label={'删除' + child.name} onClick={() => setDeleteTypeFor(child)}><Trash2 className="size-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!children.length && root.restricted && <p className="text-sm text-muted-foreground">暂无可见子分类。</p>}
              </section>
            );
          }) : !loading && !err && <p className="py-4 text-sm text-muted-foreground">还没有分类，先新建一级分类。</p>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 w-full sm:flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="搜索文件资料" placeholder="搜索资料名称或说明" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={sort} onValueChange={(value) => setSort(value as 'newest' | 'oldest' | 'name')}>
                <SelectTrigger className="w-full sm:w-40" aria-label="资料排序"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">最新上传</SelectItem><SelectItem value="oldest">最早上传</SelectItem><SelectItem value="name">按名称排序</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setCategoryView(true)}>分类管理</Button>
                <Button size="sm" disabled={loading || !types.length} onClick={openNewResource}><Plus className="size-4" /> 新建资料</Button>
              </div>
            )}
          </div>

          <div className="space-y-3 border-b pb-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={filterRoot || 'all'} onValueChange={(value) => { const next = value === 'all' ? '' : value; if (next !== filterRoot || filterChild !== 'all') setLoading(true); setFilterRoot(next); setFilterChild('all'); }}>
                <SelectTrigger className="w-full min-w-0" aria-label="一级分类"><SelectValue placeholder="全部一级分类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部一级分类</SelectItem>
                  {rootOptions.map((root) => <SelectItem key={root.id} value={root.id}>{root.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterChild} disabled={!filterRoot} onValueChange={(value) => { if (value !== filterChild) setLoading(true); setFilterChild(value); }}>
                <SelectTrigger className="w-full min-w-0" aria-label="二级分类"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">本分类及子分类</SelectItem>
                  <SelectItem value="direct">仅本分类</SelectItem>
                  {selectedChildren.map((child) => <SelectItem key={child.id} value={child.id}>{child.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground" role="status" aria-busy={loading}>{loading ? '正在加载…' : `共 ${visible.length} 份资料`}</span>
              <Button variant="ghost" size="sm" disabled={!filterRoot && !search && sort === 'newest'} onClick={() => { if (filterRoot || filterChild !== 'all') setLoading(true); setFilterRoot(''); setFilterChild('all'); setSearch(''); setSort('newest'); }}>清空筛选</Button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2" aria-busy={loading}>
            {loading ? (
              <><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></>
            ) : !err && visible.map((resource) => (
              <ResourceCard key={resource.id} project={project} resource={resource} categories={types} members={members} roles={roles} canManage={canManage} onChanged={load} />
            ))}
          </div>
          {!loading && !err && !visible.length && <p className="py-6 text-center text-sm text-muted-foreground">{!types.length ? '请先在「分类管理」中创建一级分类，再新建资料。' : search.trim() || filterRoot ? '没有找到匹配的资料' : '还没有上传文件资料'}</p>}
        </>
      )}

      <FormOverlay open={resourceOpen} onOpenChange={(open) => { if (!creating) setResourceOpen(open); }} title="新建资料" description="可同时上传首个版本文件，也可先建条目稍后补传">
        <form className="space-y-3" onSubmit={createResource}>
          <fieldset disabled={creating} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-resource-name">资料名称</Label>
              <Input id="new-resource-name" placeholder="资料名称" value={resForm.name} required onChange={(event) => setResForm({ ...resForm, name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>所属分类</Label>
              <Select value={resForm.typeId} onValueChange={(typeId) => setResForm({ ...resForm, typeId })}>
                <SelectTrigger><SelectValue placeholder="请选择分类" /></SelectTrigger>
                <SelectContent>{types.map((type) => <SelectItem key={type.id} value={type.id}>{typeLabel(type.id)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea aria-label="资料说明（可选）" placeholder="资料说明（可选）" value={resForm.description} onChange={(event) => setResForm({ ...resForm, description: event.target.value })} />
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
              <p className="text-xs text-muted-foreground">单个文件最大支持 1 GB</p>
            </div>
            {resFile && <Input aria-label="版本备注（可选）" placeholder="版本备注（可选）" value={resNote} onChange={(event) => setResNote(event.target.value)} />}
            {creating && resFile && <MaterialUploadProgress percent={uploadPercent} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={creating} onClick={() => setResourceOpen(false)}>取消</Button>
              <Button type="submit" disabled={creating || !resForm.typeId}>{creating ? resFile ? '上传中…' : '创建中…' : '创建'}</Button>
            </div>
          </fieldset>
        </form>
      </FormOverlay>

      <FormOverlay open={!!categoryDraft} onOpenChange={(open) => { if (!open && !savingCategory) setCategoryDraft(null); }} title={categoryDraft?.id ? '编辑分类' : categoryDraft?.parentId ? '新建二级分类' : '新建一级分类'}>
        {categoryDraft && (
          <form className="space-y-3" onSubmit={saveCategory}>
            <fieldset disabled={savingCategory} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="category-name">分类名称</Label>
                <Input id="category-name" value={categoryDraft.name} required onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>上级分类</Label>
                <Select value={categoryDraft.parentId ?? 'root'} onValueChange={(value) => setCategoryDraft({ ...categoryDraft, parentId: value === 'root' ? null : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">设为一级分类</SelectItem>
                    {categoryDraft.parentId && !rootTypes.some((type) => type.id === categoryDraft.parentId) && <SelectItem value={categoryDraft.parentId}>受限分类（保留当前归属）</SelectItem>}
                    {categoryCanChangeParent && rootTypes.filter((type) => type.id !== categoryDraft.id).map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>可见范围</Label>
                <p className="text-xs text-muted-foreground">二级分类未单独勾选时自动继承上级分类范围；一级分类留空则全体成员可见。</p>
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
            <AlertDialogTitle>删除分类「{deleteTypeFor?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>分类下仍存在资料或子分类时无法删除。</AlertDialogDescription>
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
