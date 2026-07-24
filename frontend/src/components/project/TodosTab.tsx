import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FileJson, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '../../api/client';
import type { Member, ProjectDetail, TodoItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';

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

function isOverdue(t: TodoItem) {
  return t.status !== 'done' && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
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
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const d = await api<{ todos: TodoItem[] }>(`/api/projects/${project.id}/todos?${q}`);
    setTodos(d.todos);
  }, [project.id, filters]);

  useEffect(() => {
    load()
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
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
      setCreateOpen(false);
      toast.success('已创建');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
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
      toast.success('已完成');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const remove = async (todoId: string) => {
    try {
      await api(`/api/projects/${project.id}/todos/${todoId}`, { method: 'DELETE' });
      toast.success('已删除');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
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
      toast.error('请选择模板文件并填写锚定日期');
      return;
    }
    try {
      const template = JSON.parse(await f.text());
      await api(`/api/projects/${project.id}/todos/template/import`, {
        body: { template, anchor: importAnchor, date: new Date(importDate).toISOString() },
      });
      setImportOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">待办</h3>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><FileJson className="size-4" /> 模板</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportTemplate().catch((e) => toast.error((e as Error).message))}>
                导出为模板
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)}>导入模板…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 新建待办</Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
          <Input
            placeholder="按类别筛选"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          />
          <Select
            value={filters.assignee || 'all'}
            onValueChange={(v) => setFilters({ ...filters, assignee: v === 'all' ? '' : v })}
          >
            <SelectTrigger><SelectValue placeholder="指派人" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部指派人</SelectItem>
              {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? '' : v })}
          >
            <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="open">进行中</SelectItem>
              <SelectItem value="done">已完成</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={`${filters.sort}:${filters.order}`}
            onValueChange={(v) => { const [sort, order] = v.split(':'); setFilters({ ...filters, sort, order }); }}
          >
            <SelectTrigger><SelectValue placeholder="排序" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt:desc">最新创建</SelectItem>
              <SelectItem value="dueAt:asc">到期时间↑</SelectItem>
              <SelectItem value="nodeAt:asc">节点时间↑</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {loading ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      ) : todos.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">没有符合条件的待办</Card>
      ) : (
        todos.map((t) => (
          <Card key={t.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className={`font-medium ${t.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.category && <Badge variant="secondary">{t.category}</Badge>}
                    {t.status === 'done' ? (
                      <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">已完成</Badge>
                    ) : isOverdue(t) ? (
                      <Badge variant="destructive">已逾期</Badge>
                    ) : (
                      <Badge variant="outline">进行中</Badge>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {t.status === 'open' /* 与现行行为一致：客户端不预检完成权限，由服务端校验 */ && (
                      <DropdownMenuItem onClick={() => { setCompletingId(t.id); setCompletionNote(''); }}>完成</DropdownMenuItem>
                    )}
                    {canManage && (
                      <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(t.id)}>删除</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="text-sm text-muted-foreground">
                {t.assignees.length > 0 && <p>指派：{t.assignees.map((a) => a.name).join('、')}</p>}
                {t.nodeAt && <p>节点：{fmt(t.nodeAt)}</p>}
                {t.dueAt && <p>到期：{fmt(t.dueAt)}</p>}
              </div>
              {t.note && <p className="text-sm">{t.note}</p>}
              {t.completionNote && <p className="text-sm text-muted-foreground">完成备注:{t.completionNote}</p>}
              {t.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {t.attachments.map((a) => (
                    <Button key={a.id} variant="outline" size="sm" onClick={() => downloadFile(a.id, a.filename)}>
                      <Paperclip className="size-3.5" /> {a.filename}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <FormOverlay open={createOpen} onOpenChange={setCreateOpen} title="新建待办">
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">标题</Label>
            <Input
              id="todo-title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-category">类别</Label>
            <Input
              id="todo-category"
              placeholder="如 美工/宣发"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-node">节点时间</Label>
              <Input
                id="todo-node"
                type="datetime-local"
                value={form.nodeAt}
                onChange={(e) => setForm({ ...form, nodeAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-due">到期时间</Label>
              <Input
                id="todo-due"
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-remind">提醒时间</Label>
            <Input
              id="todo-remind"
              type="datetime-local"
              value={form.remindAt}
              onChange={(e) => setForm({ ...form, remindAt: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>指派人</Label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <label
                  key={m.userId}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                    assigneeIds.includes(m.userId)
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  <Checkbox
                    checked={assigneeIds.includes(m.userId)}
                    onCheckedChange={(c) =>
                      setAssigneeIds(c ? [...assigneeIds, m.userId] : assigneeIds.filter((x) => x !== m.userId))
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-note">备注</Label>
            <Textarea
              id="todo-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <Button type="submit" className="w-full">创建</Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={!!completingId}
        onOpenChange={(o) => !o && setCompletingId(null)}
        title="完成待办"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (completingId) void complete(completingId);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="completion-note">完成备注（可选）</Label>
            <Textarea
              id="completion-note"
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="completion-files">附件</Label>
            <Input
              id="completion-files"
              type="file"
              multiple
              onChange={(e) => setCompletionFiles(e.target.files)}
            />
          </div>
          <Button type="submit" className="w-full">确认完成</Button>
        </form>
      </FormOverlay>

      <FormOverlay open={importOpen} onOpenChange={setImportOpen} title="导入模板" description="按模板批量生成待办">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>锚定方式</Label>
            <Select value={importAnchor} onValueChange={(v) => setImportAnchor(v as 'start' | 'end')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="start">锚定开始时间</SelectItem>
                <SelectItem value="end">锚定结束时间</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-date">锚定日期</Label>
            <Input id="import-date" type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-file">模板文件（JSON）</Label>
            {/* shadcn Input 不转发 ref（React 18），此处需 ref 读取文件，故用原生 input */}
            <input
              id="import-file"
              type="file"
              accept="application/json"
              ref={importFile}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground dark:bg-input/30"
            />
          </div>
          <Button className="w-full" onClick={importTemplate}>导入模板生成待办</Button>
        </div>
      </FormOverlay>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除待办？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingId) void remove(deletingId);
                setDeletingId(null);
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
