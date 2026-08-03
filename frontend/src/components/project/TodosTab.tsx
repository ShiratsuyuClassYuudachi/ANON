import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Circle, FileJson, MessageSquarePlus, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
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
import { TodoActionSheet } from './TodoActionSheet';
import { TodoFormDialog } from './TodoFormDialog';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function fmt(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isOverdue(t: TodoItem) {
  return t.status !== 'done' && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
}

export default function TodosTab({ project, members, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('todo:manage');
  const canCreate = canManage || myPermissions.includes('todo:create');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({ category: '', assignee: '', status: '', sort: 'createdAt', order: 'desc' });
  const [quickTitle, setQuickTitle] = useState('');
  const importFile = useRef<HTMLInputElement>(null);
  const [importAnchor, setImportAnchor] = useState<'start' | 'end'>('start');
  const [importDate, setImportDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // null = 关闭；{ title } = 创建（可预填）；完整 TodoItem = 编辑
  const [formInitial, setFormInitial] = useState<TodoItem | { title: string } | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'complete' | 'progress'; id: string } | null>(null);
  const [expandedUpdates, setExpandedUpdates] = useState<Record<string, boolean>>({});
  const knownCategoriesRef = useRef<Set<string>>(new Set());

  const loadSeq = useRef(0);

  const load = useCallback(async (seq?: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const d = await api<{ todos: TodoItem[] }>(`/api/projects/${project.id}/todos?${q}`);
    // 只应用最新一次筛选请求的结果，丢弃慢响应覆盖新结果的过期响应
    if (seq === undefined || seq === loadSeq.current) {
      setTodos(d.todos);
      setErr('');
      for (const t of d.todos) if (t.category) knownCategoriesRef.current.add(t.category);
    }
  }, [project.id, filters]);

  useEffect(() => {
    const seq = ++loadSeq.current;
    const timer = setTimeout(() => {
      load(seq)
        .catch((e) => {
          if (seq === loadSeq.current) setErr(e.message);
        })
        .finally(() => {
          if (seq === loadSeq.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const knownCategories = Array.from(knownCategoriesRef.current);

  const groups = useMemo(() => {
    const m = new Map<string, TodoItem[]>();
    for (const t of todos) {
      const arr = m.get(t.category);
      if (arr) arr.push(t);
      else m.set(t.category, [t]);
    }
    // 非空类别按中文排序，空类别（「未分类」）固定最后
    return [...m.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, 'zh');
    });
  }, [todos]);

  const quickCreate = async (e: FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    try {
      await api(`/api/projects/${project.id}/todos`, { body: { title } });
      toast.success('已创建');
      setQuickTitle('');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const reopen = async (todoId: string) => {
    try {
      await api(`/api/projects/${project.id}/todos/${todoId}`, { method: 'PATCH', body: { status: 'open' } });
      toast.success('已重新打开');
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

  const submitSheet = async (note: string, files: File[]) => {
    if (!sheet) return;
    const fd = new FormData();
    if (sheet.kind === 'complete') {
      fd.set('completionNote', note);
      for (const f of files) fd.append('files', f);
      try {
        await api(`/api/projects/${project.id}/todos/${sheet.id}/complete`, { formData: fd });
        toast.success('已完成');
        setSheet(null);
        await load();
      } catch (e2) {
        toast.error((e2 as Error).message);
      }
    } else {
      fd.set('note', note);
      for (const f of files) fd.append('files', f);
      try {
        await api(`/api/projects/${project.id}/todos/${sheet.id}/updates`, { formData: fd });
        toast.success('已提交进度');
        setSheet(null);
        await load();
      } catch (e2) {
        toast.error((e2 as Error).message);
      }
    }
  };

  const exportTemplate = async () => {
    const tpl = await api(`/api/projects/${project.id}/todos/template/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'todo-template.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        {canManage && (
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
        )}
      </div>

      {canCreate && (
        <form onSubmit={quickCreate} className="flex gap-2">
          <Input
            placeholder="快速新建：输入标题，回车创建"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <Button type="submit" size="sm" className="shrink-0" disabled={!quickTitle.trim()}>
            <Plus className="size-4" /> 创建
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setFormInitial({ title: quickTitle })}
          >
            详细
          </Button>
        </form>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
          <Input
            placeholder="按类别筛选"
            list="todo-filter-categories"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          />
          <datalist id="todo-filter-categories">
            {knownCategories.map((c) => <option key={c} value={c} />)}
          </datalist>
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
        <div className="space-y-4">
          {groups.map(([category, items]) => (
            <div key={category || '__none'} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <h4 className="text-sm font-medium text-muted-foreground">{category || '未分类'}</h4>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              {items.map((t) => (
                <Card key={t.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start gap-2">
                      {/* 客户端不预检完成权限，服务端 403 由 toast 呈现 */}
                      {t.status === 'open' ? (
                        <button
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:text-primary"
                          onClick={() => setSheet({ kind: 'complete', id: t.id })}
                        >
                          <Circle className="size-4" />
                        </button>
                      ) : (
                        <CheckCircle2 className="mt-0.5 size-8 shrink-0 p-1.5 text-green-600 dark:text-green-400" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
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
                          {t.status === 'open' && canManage && (
                            <DropdownMenuItem onClick={() => setFormInitial(t)}>编辑</DropdownMenuItem>
                          )}
                          {t.status === 'done' && canManage && (
                            <DropdownMenuItem onClick={() => void reopen(t.id)}>重新打开</DropdownMenuItem>
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
                    {t.updates.length > 0 && (() => {
                      const sorted = [...t.updates].sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                      );
                      const expanded = !!expandedUpdates[t.id];
                      const visible = expanded ? sorted : sorted.slice(0, 2);
                      return (
                        <div className="space-y-2 border-t pt-2">
                          {visible.map((u, i) => (
                            <div key={i} className="space-y-1">
                              <p className="text-xs text-muted-foreground">{u.createdByName} · {fmt(u.createdAt)}</p>
                              {u.note && <p className="text-sm">{u.note}</p>}
                              {u.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {u.attachments.map((a) => (
                                    <Button key={a.id} variant="outline" size="sm" onClick={() => downloadFile(a.id, a.filename)}>
                                      <Paperclip className="size-3.5" /> {a.filename}
                                    </Button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          {sorted.length > 2 && (
                            <button
                              className="text-xs text-primary hover:underline"
                              onClick={() => setExpandedUpdates({ ...expandedUpdates, [t.id]: !expanded })}
                            >
                              {expanded ? '收起' : `展开全部 ${sorted.length} 条进度`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {t.status === 'open' && (
                      <div className="pt-1">
                        <Button variant="outline" size="sm" onClick={() => setSheet({ kind: 'progress', id: t.id })}>
                          <MessageSquarePlus className="size-3.5" /> 进度
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      <TodoFormDialog
        open={formInitial !== null}
        onOpenChange={(o) => !o && setFormInitial(null)}
        projectId={project.id}
        members={members}
        knownCategories={knownCategories}
        initial={formInitial ?? undefined}
        onSaved={async () => { await load(); }}
      />

      <TodoActionSheet
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
        title={sheet?.kind === 'progress' ? '提交进度' : '完成待办'}
        noteLabel={sheet?.kind === 'progress' ? '进度内容' : '完成备注（可选）'}
        requireContent={sheet?.kind === 'progress'}
        submitLabel={sheet?.kind === 'progress' ? '提交进度' : '确认完成'}
        onSubmit={submitSheet}
      />

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
