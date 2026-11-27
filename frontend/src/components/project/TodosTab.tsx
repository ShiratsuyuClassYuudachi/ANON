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
  externalMembers: import('../../types').ExternalMember[];
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

export default function TodosTab({ project, members, externalMembers, myPermissions }: Props) {
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
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      if (k === 'assignee' && v.startsWith('external:')) q.set('externalAssignee', v.slice(9));
      else q.set(k, v);
    }
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
      toast.error('请选择模板文件并填写基准日期');
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
      <div className="flex items-center justify-between gap-2" data-tour="tab-todos">
        <h1 className="editorial-heading">待办</h1>
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
        <form onSubmit={quickCreate} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <Input
            className="col-span-3 min-w-0 sm:col-span-1"
            aria-label="快速添加待办" placeholder="输入待办事项，按回车快速添加"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <div className="col-span-3 flex justify-end gap-2 sm:col-span-2">
            <Button type="submit" size="sm" className="shrink-0" disabled={!quickTitle.trim()}>
              <Plus className="size-4" /> 添加
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setFormInitial({ title: quickTitle })}
            >
              详细设置
            </Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="待办筛选">
          <Input
            className="w-full min-w-0"
            aria-label="按分类筛选" placeholder="按分类筛选"
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
            <SelectTrigger className="w-full min-w-0" aria-label="负责人"><SelectValue placeholder="负责人" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部负责人</SelectItem>
              {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
              {externalMembers.filter((m) => !m.linkedUserId).map((m) => <SelectItem key={m.id} value={`external:${m.id}`}>{m.name}（{m.archivedAt ? '已归档' : '未注册'}）</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? '' : v })}
          >
            <SelectTrigger className="w-full min-w-0" aria-label="待办状态"><SelectValue placeholder="状态" /></SelectTrigger>
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
            <SelectTrigger className="w-full min-w-0" aria-label="待办排序"><SelectValue placeholder="排序" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt:desc">最新添加</SelectItem>
              <SelectItem value="dueAt:asc">截止时间从早到晚</SelectItem>
              <SelectItem value="nodeAt:asc">节点时间从早到晚</SelectItem>
            </SelectContent>
          </Select>
      </div>


      {err ? (
        <p role="alert" className="py-4 text-sm text-destructive">{err}</p>
      ) : loading ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      ) : todos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filters.category || filters.assignee || filters.status
            ? '没有符合筛选条件的待办事项'
            : '还没有待办事项，在上方输入标题即可快速添加。'}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([category, items]) => (
            <div key={category || '__none'} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <h2 className="editorial-subheading min-w-0 wrap-anywhere">{category || '未分类'}</h2>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="editorial-list">
                {items.map((t) => {
                  const assignees = [
                    ...t.assignees.map((assignee) => assignee.name),
                    ...(t.externalAssignees ?? []).map((assignee) => `${assignee.name}（${assignee.archivedAt ? '已归档' : '未注册'}）`),
                  ].join('、');
                  const overdue = isOverdue(t);

                  return (
                    <article key={t.id} className="editorial-row space-y-1.5">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 lg:grid-cols-[auto_minmax(0,1fr)_minmax(9rem,0.75fr)_auto] lg:items-center">
                        {t.status === 'open' ? (
                          <button
                            aria-label={`完成待办：${t.title}`}
                            className="col-start-1 row-start-1 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring md:size-8"
                            onClick={() => setSheet({ kind: 'complete', id: t.id })}
                          >
                            <Circle className="size-4" aria-hidden="true" />
                          </button>
                        ) : (
                          <CheckCircle2 aria-hidden="true" className="col-start-1 row-start-1 size-11 p-2.5 text-success md:size-8 md:p-1.5" />
                        )}
                        <p className={`col-start-2 row-start-1 min-w-0 self-center text-sm leading-relaxed font-medium ${t.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
                        {(assignees || t.nodeAt || t.dueAt || overdue || t.status === 'done') && (
                          <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-1 text-xs text-muted-foreground lg:col-span-1 lg:col-start-3 lg:row-start-1">
                            {assignees && <span>负责人：{assignees}</span>}
                            {t.nodeAt && <span>{assignees && ' · '}节点：{fmt(t.nodeAt)}</span>}
                            {t.dueAt && <span>{(assignees || t.nodeAt) && ' · '}截止：{fmt(t.dueAt)}</span>}
                            {t.status === 'done' && <Badge variant="success-soft">已完成</Badge>}
                            {overdue && <Badge variant="destructive">已逾期</Badge>}
                          </div>
                        )}
                        <div className="col-start-3 row-start-1 flex items-center justify-end lg:col-start-4">
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`待办操作：${t.title}`}><MoreHorizontal aria-hidden="true" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {t.status === 'open' && <DropdownMenuItem onClick={() => setFormInitial(t)}>编辑</DropdownMenuItem>}
                                {t.status === 'done' && <DropdownMenuItem onClick={() => void reopen(t.id)}>重新打开</DropdownMenuItem>}
                                <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(t.id)}>删除</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 pl-[3.25rem] md:pl-10 empty:hidden">
                        {t.note && <p className="break-words text-sm">{t.note}</p>}
                        {t.completionNote && <p className="break-words text-sm text-muted-foreground">完成说明：{t.completionNote}</p>}
                        {t.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {t.attachments.map((a) => (
                              <Button key={a.id} variant="outline" size="sm" className="max-w-full" onClick={() => downloadFile(a.id, a.filename)}>
                                <Paperclip className="size-3.5" /> <span className="min-w-0 truncate" title={a.filename}>{a.filename}</span>
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
                                  {u.note && <p className="break-words text-sm">{u.note}</p>}
                                  {u.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {u.attachments.map((a) => (
                                        <Button key={a.id} variant="outline" size="sm" className="max-w-full" onClick={() => downloadFile(a.id, a.filename)}>
                                          <Paperclip className="size-3.5" /> <span className="min-w-0 truncate" title={a.filename}>{a.filename}</span>
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
                                  {expanded ? '收起进度' : `展开全部 ${sorted.length} 条进度`}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                        {t.status === 'open' && (
                          <div className="pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setSheet({ kind: 'progress', id: t.id })}>
                              <MessageSquarePlus className="size-3.5" /> 报进度
                            </Button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <TodoFormDialog
        open={formInitial !== null}
        onOpenChange={(o) => !o && setFormInitial(null)}
        projectId={project.id}
        startDate={project.startDate}
        members={members}
        externalMembers={externalMembers}
        knownCategories={knownCategories}
        initial={formInitial ?? undefined}
        onSaved={async () => { await load(); }}
      />

      <TodoActionSheet
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
        title={sheet?.kind === 'progress' ? '提交进度' : '完成待办'}
        noteLabel={sheet?.kind === 'progress' ? '进度说明' : '完成说明（可选）'}
        requireContent={sheet?.kind === 'progress'}
        submitLabel={sheet?.kind === 'progress' ? '提交进度' : '确认完成'}
        onSubmit={submitSheet}
      />

      <FormOverlay open={importOpen} onOpenChange={setImportOpen} title="从模板导入待办" description="根据锚定日期自动换算整套排期的截止与提醒时间">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>时间基准</Label>
            <Select value={importAnchor} onValueChange={(v) => setImportAnchor(v as 'start' | 'end')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="start">按活动开始时间正排/倒排</SelectItem>
                <SelectItem value="end">按活动结束时间换算</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-date">基准日期</Label>
            <Input id="import-date" type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-file">模板文件（JSON）</Label>
            <Input
              id="import-file"
              type="file"
              accept="application/json"
              ref={importFile}
            />
          </div>
          <Button className="w-full" onClick={importTemplate}>导入并生成待办</Button>
        </div>
      </FormOverlay>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这项待办？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。</AlertDialogDescription>
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
