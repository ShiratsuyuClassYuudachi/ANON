import { ClipboardList, MoreHorizontal, Pencil, Plus, Printer, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import type { Member, ProjectDetail, WorkModuleItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

const fmt = (iso: string | null) => (iso ? iso.slice(5, 16).replace('T', ' ') : '');
const fmtRange = (m: WorkModuleItem) =>
  m.startAt || m.endAt ? `${fmt(m.startAt) || '…'} ~ ${fmt(m.endAt) || '…'}` : '';

export default function WorkTab({ project, members, myPermissions }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('work:manage');

  const [modules, setModules] = useState<WorkModuleItem[] | null>(null);
  const [err, setErr] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkModuleItem | null>(null);
  const [deleting, setDeleting] = useState<WorkModuleItem | null>(null);
  const [form, setForm] = useState({ name: '', description: '', location: '', startAt: '', endAt: '', requiredCount: '1' });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const d = await api<{ modules: WorkModuleItem[] }>(`/api/projects/${project.id}/work-modules`);
    setModules(d.modules);
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', location: '', startAt: '', endAt: '', requiredCount: '1' });
    setAssigneeIds([]);
    setEditOpen(true);
  };

  const openEdit = (m: WorkModuleItem) => {
    setEditing(m);
    setForm({
      name: m.name,
      description: m.description,
      location: m.location,
      startAt: m.startAt ? m.startAt.slice(0, 16) : '',
      endAt: m.endAt ? m.endAt.slice(0, 16) : '',
      requiredCount: String(m.requiredCount),
    });
    setAssigneeIds(m.assignees.map((a) => a.userId));
    setEditOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description || undefined,
      location: form.location || undefined,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : undefined,
      endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
      requiredCount: Number(form.requiredCount) || 1,
      assigneeIds,
    };
    try {
      if (editing) {
        await api(`/api/projects/${project.id}/work-modules/${editing.id}`, { method: 'PATCH', body });
        toast.success('已保存');
      } else {
        await api(`/api/projects/${project.id}/work-modules`, { body });
        toast.success('已创建');
      }
      setEditOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/projects/${project.id}/work-modules/${deleting.id}`, { method: 'DELETE' });
      toast.success('已删除');
      setDeleting(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const setConfirmed = async (moduleId: string, confirmed: boolean) => {
    try {
      await api(`/api/projects/${project.id}/work-modules/${moduleId}/${confirmed ? 'confirm' : 'unconfirm'}`, { body: {} });
      toast.success(confirmed ? '已确认' : '已取消确认');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const printSheet = (u: string) => nav(`/p/${project.id}/work-sheet/print?user=${u}`);

  const myItems = (modules ?? []).filter((m) => user && m.assignees.some((a) => a.userId === user.id));
  const myAssignment = (m: WorkModuleItem) => m.assignees.find((a) => a.userId === user?.id);

  if (err) return <Card><CardContent className="p-4 text-sm text-destructive">{err}</CardContent></Card>;
  if (!modules) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">现场</h3>
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> 新建模块</Button>
        )}
      </div>

      {/* 我的任务单（全体成员可见） */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">我的任务单</CardTitle>
          <Button variant="outline" size="sm" onClick={() => printSheet('me')}>
            <Printer className="size-4" /> 打印任务单
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {myItems.length === 0 && <p className="text-sm text-muted-foreground">暂无分配给你的任务</p>}
          {myItems.map((m) => {
            const a = myAssignment(m)!;
            return (
              <div key={m.id} className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[fmtRange(m), m.location].filter(Boolean).join(' ｜ ')}
                  </p>
                  {m.description && <p className="text-sm">{m.description}</p>}
                </div>
                {a.confirmedAt ? (
                  <Badge variant="outline" className="shrink-0 border-green-500 text-green-600 dark:text-green-400">
                    已确认 {a.confirmedAt.slice(5, 16).replace('T', ' ')}
                  </Badge>
                ) : (
                  <Button size="sm" className="shrink-0" onClick={() => setConfirmed(m.id, true)}>确认</Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 模块管理（work:manage） */}
      {canManage && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">任务模块（{modules.length}）</h4>
          {modules.length === 0 && (
            <Card className="flex flex-col items-center gap-3 py-10 text-center">
              <ClipboardList className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">还没有任务模块，点击「新建模块」开始分工</p>
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {modules.map((m) => {
              const shortage = m.requiredCount - m.assignees.length;
              return (
                <Card key={m.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{m.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="secondary">需 {m.requiredCount} 人</Badge>
                          <Badge variant="outline">已分配 {m.assignees.length}</Badge>
                          {shortage > 0 && <Badge variant="destructive">缺 {shortage}</Badge>}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="模块操作"><MoreHorizontal className="size-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(m)}><Pencil className="size-4" /> 编辑</DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(m)}><Trash2 className="size-4" /> 删除</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {(fmtRange(m) || m.location) && (
                      <p className="text-sm text-muted-foreground">{[fmtRange(m), m.location].filter(Boolean).join(' ｜ ')}</p>
                    )}
                    {m.description && <p className="text-sm">{m.description}</p>}
                    {m.assignees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.assignees.map((a) => (
                          <Badge
                            key={a.userId}
                            variant={a.confirmedAt ? 'default' : 'outline'}
                            className={a.confirmedAt ? 'bg-green-600 hover:bg-green-600' : ''}
                          >
                            {a.name}{a.confirmedAt ? ' ✓' : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 成员任务单（work:manage） */}
      {canManage && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-1.5"><Users className="size-4" /> 成员任务单</CardTitle>
            <Button variant="outline" size="sm" onClick={() => printSheet('all')}>
              <Printer className="size-4" /> 打印全员任务单
            </Button>
          </CardHeader>
          <CardContent className="divide-y">
            {members.map((mb) => {
              const cnt = modules.filter((m) => m.assignees.some((a) => a.userId === mb.userId)).length;
              return (
                <div key={mb.userId} className="flex items-center justify-between py-2 text-sm">
                  <span>{mb.name} <span className="text-muted-foreground">（{cnt} 项任务）</span></span>
                  <Button variant="ghost" size="sm" onClick={() => printSheet(mb.userId)}>任务单</Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 新建/编辑弹层 */}
      <FormOverlay open={editOpen} onOpenChange={setEditOpen} title={editing ? '编辑模块' : '新建模块'}>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wm-name">模块名称</Label>
            <Input id="wm-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：检票 / 舞台协助" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wm-start">开始时间</Label>
              <Input id="wm-start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wm-end">结束时间</Label>
              <Input id="wm-end" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wm-loc">地点</Label>
              <Input id="wm-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wm-req">所需人力</Label>
              <Input id="wm-req" type="number" min={1} step={1} required value={form.requiredCount} onChange={(e) => setForm({ ...form, requiredCount: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>分配成员（{assigneeIds.length}）</Label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((mb) => (
                <label
                  key={mb.userId}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                    assigneeIds.includes(mb.userId) ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'
                  }`}
                >
                  <Checkbox
                    checked={assigneeIds.includes(mb.userId)}
                    onCheckedChange={(c) =>
                      setAssigneeIds(c ? [...assigneeIds, mb.userId] : assigneeIds.filter((x) => x !== mb.userId))
                    }
                  />
                  {mb.name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wm-desc">工作内容</Label>
            <Textarea id="wm-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">{editing ? '保存' : '创建'}</Button>
        </form>
      </FormOverlay>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模块「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>分配与确认记录将一并删除，该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
