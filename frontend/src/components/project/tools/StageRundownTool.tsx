import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ClipboardCopy,
  Download,
  GripVertical,
  Image,
  MonitorPlay,
  MoreHorizontal,
  Paperclip,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '../../../api/client';
import { fmtLocal, toLocalInput } from '../../../lib/datetime';
import type { ProjectDetail, StageRundown, StageRundownItem, StageRundownSummary } from '../../../types';
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import ProgramFormDialog from './ProgramFormDialog';
import ExecutionPanel from './ExecutionPanel';
import ScreenShareDialog from './ScreenShareDialog';
import { computeExecution, type ExecComputed } from './rundownExecution';
import { computeSchedule, copyRundownText, exportRundownImage, exportRundownText, hhmm, RUNDOWN_COLUMNS, scheduleEndLabel } from './rundownExport';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

/** Rundown 新建/编辑信息表单 */
function RundownFormDialog({
  open,
  onOpenChange,
  base,
  rundown,
  lockStartAt = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string;
  rundown?: StageRundownSummary | null;
  /** 执行中锁定开始时间（提交时省略 startAt，后端对 startAt 修改 409） */
  lockStartAt?: boolean;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [startAt, setStartAt] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(rundown?.name ?? '');
    setStartAt(rundown ? toLocalInput(rundown.startAt) : '');
    setNote(rundown?.note ?? '');
  }, [open, rundown]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: { name: string; startAt?: string; note: string } = { name: name.trim(), note: note.trim() };
      if (!lockStartAt) body.startAt = new Date(startAt).toISOString();
      const res = rundown
        ? await api<{ rundown: StageRundown }>(`${base}/${rundown.id}`, { method: 'PATCH', body })
        : await api<{ rundown: StageRundown }>(base, { body });
      toast.success(rundown ? 'Rundown 已更新' : 'Rundown 已创建');
      onOpenChange(false);
      onSaved(res.rundown.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={rundown ? '编辑 Rundown 信息' : '新建 Rundown'}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="rundown-name">名称</Label>
          <Input id="rundown-name" required placeholder="如 Day1 主舞台" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rundown-start">开始时间</Label>
          <Input id="rundown-start" type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} disabled={lockStartAt} />
          {lockStartAt && (
            <p className="text-xs text-muted-foreground">执行中不可修改开始时间，请先结束或重置执行</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rundown-note">备注</Label>
          <Input id="rundown-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? '提交中…' : rundown ? '保存' : '创建'}
        </Button>
      </form>
    </FormOverlay>
  );
}

/** 单个节目行（可排序） */
function SortableProgramRow({
  index,
  scheduled,
  canManage,
  locked,
  sortable,
  exec,
  onEdit,
  onDelete,
}: {
  index: number;
  scheduled: StageRundownItem & { start: Date; end: Date };
  canManage: boolean;
  /** 执行中锁定编排：不渲染编辑/删除菜单 */
  locked: boolean;
  /** 可拖拽排序：执行中仅未执行节目可拖（已演/在演位置锁定） */
  sortable: boolean;
  exec?: ExecComputed<StageRundownItem>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scheduled.id,
    disabled: !sortable,
  });
  const contacts = scheduled.participants.filter((p) => p.contact);
  // 未执行节目行时间实时级联：徽章显示推算区间（推晚琥珀描边/提前绿色描边），原计划降为下行小字基准
  const upcomingExec = exec && exec.state === 'upcoming' ? exec : null;
  const rangeStart = upcomingExec ? upcomingExec.projectedStart : scheduled.start;
  const rangeEnd = upcomingExec ? upcomingExec.projectedEnd : scheduled.end;
  const livePushed =
    upcomingExec !== null && upcomingExec.projectedStart.getTime() > upcomingExec.expectedStart.getTime();
  const liveEarlier =
    upcomingExec !== null && upcomingExec.projectedStart.getTime() < upcomingExec.expectedStart.getTime();
  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : ''}
    >
      <CardContent className="flex items-start gap-2 p-3">
        {canManage && sortable && (
          <button
            className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground"
            aria-label={`拖动排序 ${scheduled.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <span className="mt-1 w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={`font-mono ${
                livePushed
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : liveEarlier
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : ''
              }`}
            >
              {hhmm(rangeStart)}–{hhmm(rangeEnd)}
            </Badge>
            <span className="font-medium">{scheduled.name}</span>
            <span className="text-sm text-muted-foreground">{scheduled.durationMin} 分钟</span>
            {exec?.state === 'current' && <Badge>进行中</Badge>}
            {exec?.state === 'done' && (
              <Badge className="bg-green-600 text-white hover:bg-green-600">已完成</Badge>
            )}
          </div>
          {exec?.state === 'done' && exec.actualStart && (
            <p className="text-xs text-muted-foreground">
              实际 {hhmm(exec.actualStart)}–{exec.actualEnd ? hhmm(exec.actualEnd) : '—'}
            </p>
          )}
          {upcomingExec !== null && upcomingExec.projectedStart.getTime() !== upcomingExec.plannedStart.getTime() && (
            <p className="text-xs text-muted-foreground">
              计划 {hhmm(upcomingExec.plannedStart)}–{hhmm(upcomingExec.plannedEnd)}
            </p>
          )}
          {scheduled.participants.length > 0 && (
            <p className="text-sm text-muted-foreground">
              CN：{scheduled.participants.map((p) => p.cn).join('、')}
              {contacts.length > 0 && `（${contacts.map((p) => `${p.cn} ${p.contact}`).join('；')}）`}
            </p>
          )}
          {scheduled.note && <p className="text-sm text-muted-foreground">{scheduled.note}</p>}
          {scheduled.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scheduled.attachments.map((a) => (
                <Button key={a.id} variant="outline" size="sm" onClick={() => downloadFile(a.id, a.filename)}>
                  <Paperclip className="size-3.5" /> {a.filename}
                </Button>
              ))}
            </div>
          )}
        </div>
        {canManage && !locked && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`节目操作 ${scheduled.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>编辑</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardContent>
    </Card>
  );
}

export default function StageRundownTool({ project, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('tools:manage');
  const base = `/api/projects/${project.id}/stage-rundowns`;

  const [rundowns, setRundowns] = useState<StageRundownSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StageRundown | null>(null);

  // 执行中详情页 1s 时钟：驱动节目行预计时间与头卡预计结束实时级联
  const detailRunning = detail?.execution.status === 'running';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!detailRunning) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [detailRunning]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRundown, setEditingRundown] = useState<StageRundownSummary | null>(null);
  const [deleteRundown, setDeleteRundown] = useState<StageRundownSummary | null>(null);

  const [programFormOpen, setProgramFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StageRundownItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<StageRundownItem | null>(null);
  const [exportCols, setExportCols] = useState<string[]>(RUNDOWN_COLUMNS.map((c) => c.key));
  const [screenOpen, setScreenOpen] = useState(false);

  const toggleExportCol = (key: string) => {
    setExportCols((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) {
          toast.error('至少保留一列');
          return prev;
        }
        return prev.filter((k) => k !== key);
      }
      // 恢复时按注册表顺序插入，保持列序稳定
      const next = [...prev, key];
      return RUNDOWN_COLUMNS.map((c) => c.key).filter((k) => next.includes(k));
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadList = useCallback(async () => {
    const d = await api<{ rundowns: StageRundownSummary[] }>(base);
    setRundowns(d.rundowns);
  }, [base]);

  const loadDetail = useCallback(
    async (rid: string) => {
      const d = await api<{ rundown: StageRundown }>(`${base}/${rid}`);
      setDetail(d.rundown);
    },
    [base],
  );

  useEffect(() => {
    loadList().catch((e) => toast.error(e.message));
  }, [loadList]);

  useEffect(() => {
    if (selected) loadDetail(selected).catch((e) => toast.error(e.message));
    else setDetail(null);
  }, [selected, loadDetail]);

  const openDetail = (rid: string) => setSelected(rid);

  const removeRundown = async () => {
    if (!deleteRundown) return;
    try {
      await api(`${base}/${deleteRundown.id}`, { method: 'DELETE' });
      toast.success('Rundown 已删除');
      setDeleteRundown(null);
      if (selected === deleteRundown.id) setSelected(null);
      await loadList();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeItem = async () => {
    if (!deleteItem || !detail) return;
    try {
      await api(`${base}/${detail.id}/items/${deleteItem.id}`, { method: 'DELETE' });
      toast.success('节目已删除');
      setDeleteItem(null);
      await loadDetail(detail.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!detail || !over || active.id === over.id) return;
    const ids = detail.items.map((it) => it.id);
    let order: string[];
    if (detail.execution.status === 'running') {
      // 执行中：仅在未执行节目槽位内重排，已演/在演位置原样保留
      const states = new Map(
        computeExecution(detail.startAt, detail.items, detail.execution).map((c) => [c.item.id, c.state]),
      );
      const ups = ids.filter((id) => states.get(id) === 'upcoming');
      const from = ups.indexOf(String(active.id));
      const to = ups.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      const newUps = arrayMove(ups, from, to);
      let k = 0;
      order = ids.map((id) => (states.get(id) === 'upcoming' ? newUps[k++]! : id));
    } else {
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      order = arrayMove(ids, from, to);
    }
    // 乐观更新，失败回滚
    const byId = new Map(detail.items.map((it) => [it.id, it]));
    setDetail({ ...detail, items: order.map((id) => byId.get(id)!) });
    try {
      const res = await api<{ rundown: StageRundown }>(`${base}/${detail.id}/items/reorder`, {
        method: 'PATCH',
        body: { order },
      });
      setDetail(res.rundown);
    } catch (e) {
      toast.error((e as Error).message);
      await loadDetail(detail.id);
    }
  };

  // ---------- 详情视图 ----------
  if (selected && detail) {
    const scheduled = computeSchedule(detail.startAt, detail.items);
    // 与 scheduled 同算法同序，按下标配对执行态（now 驱动实时级联）
    const execList = computeExecution(detail.startAt, detail.items, detail.execution, now);
    const running = detail.execution.status === 'running';
    const total = detail.items.reduce((sum, it) => sum + it.durationMin, 0);
    const rows = (
      <div className="space-y-2">
        {scheduled.map((it, i) => (
          <SortableProgramRow
            key={it.id}
            index={i}
            scheduled={it}
            canManage={canManage}
            locked={running}
            sortable={!running || execList[i].state === 'upcoming'}
            exec={execList[i]}
            onEdit={() => {
              setEditingItem(detail.items.find((x) => x.id === it.id) ?? null);
              setProgramFormOpen(true);
            }}
            onDelete={() => setDeleteItem(it)}
          />
        ))}
      </div>
    );
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft className="size-4" /> Rundown 列表
        </Button>

        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-lg font-semibold">{detail.name}</p>
                <p className="text-sm text-muted-foreground">
                  开始 {fmtLocal(detail.startAt, true)} ｜ 预计结束{' '}
                  {running && execList.length > 0
                    ? `${hhmm(execList[execList.length - 1].projectedEnd)}（实时推算）`
                    : scheduleEndLabel(detail.startAt, detail.items)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {detail.items.length} 个节目 · 共 {total} 分钟
                </p>
                {detail.note && <p className="text-sm text-muted-foreground">{detail.note}</p>}
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Rundown 操作">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingRundown({
                          id: detail.id,
                          name: detail.name,
                          startAt: detail.startAt,
                          note: detail.note,
                          itemCount: detail.items.length,
                          totalDurationMin: total,
                          executionStatus: detail.execution.status,
                          createdAt: detail.createdAt,
                          updatedAt: detail.updatedAt,
                        });
                        setFormOpen(true);
                      }}
                    >
                      编辑信息
                    </DropdownMenuItem>
                    {!running && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() =>
                          setDeleteRundown({
                            id: detail.id,
                            name: detail.name,
                            startAt: detail.startAt,
                            note: detail.note,
                            itemCount: detail.items.length,
                            totalDurationMin: total,
                            executionStatus: detail.execution.status,
                            createdAt: detail.createdAt,
                            updatedAt: detail.updatedAt,
                          })
                        }
                      >
                        删除
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Image className="size-4" /> 导出图片
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>导出列（{exportCols.length}）</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {RUNDOWN_COLUMNS.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.key}
                          checked={exportCols.includes(c.key)}
                          onCheckedChange={() => toggleExportCol(c.key)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {c.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => exportRundownImage(detail, exportCols)}>
                    导出 PNG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => exportRundownText(detail)}>
                <Download className="size-4" /> 导出文本
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyRundownText(detail)}>
                <ClipboardCopy className="size-4" /> 复制文本
              </Button>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => setScreenOpen(true)}>
                  <MonitorPlay className="size-4" /> 现场大屏
                </Button>
              )}
              {canManage && !running && (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingItem(null);
                    setProgramFormOpen(true);
                  }}
                >
                  <Plus className="size-4" /> 添加节目
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <ExecutionPanel projectId={project.id} rundown={detail} canManage={canManage} onChanged={setDetail} />

        {detail.items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无节目{canManage ? '，点击「添加节目」开始编排' : ''}
            </CardContent>
          </Card>
        ) : canManage ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={
                running
                  ? execList.filter((c) => c.state === 'upcoming').map((c) => c.item.id)
                  : detail.items.map((it) => it.id)
              }
              strategy={verticalListSortingStrategy}
            >
              {rows}
            </SortableContext>
          </DndContext>
        ) : (
          rows
        )}

        <ProgramFormDialog
          open={programFormOpen}
          onOpenChange={setProgramFormOpen}
          base={`${base}/${detail.id}`}
          item={editingItem}
          onSaved={() => loadDetail(detail.id)}
        />

        <RundownFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          base={base}
          rundown={editingRundown}
          lockStartAt={running}
          onSaved={(rid) => {
            setEditingRundown(null);
            loadDetail(rid);
            loadList();
          }}
        />

        <ScreenShareDialog open={screenOpen} onOpenChange={setScreenOpen} base={base} rundownId={detail.id} />

        <AlertDialog open={!!deleteRundown} onOpenChange={(o) => { if (!o) setDeleteRundown(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除 Rundown</AlertDialogTitle>
              <AlertDialogDescription>
                确定删除「{deleteRundown?.name}」？全部节目与素材文件将一并删除，无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={removeRundown}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除节目</AlertDialogTitle>
              <AlertDialogDescription>确定删除「{deleteItem?.name}」？其素材文件将一并删除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={removeItem}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ---------- 列表视图 ----------
  if (selected) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft className="size-4" /> Rundown 列表
        </Button>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">舞台时间编排助手</h3>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setEditingRundown(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> 新建 Rundown
          </Button>
        )}
      </div>

      {rundowns === null ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : rundowns.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            暂无 Rundown{canManage ? '，点击「新建 Rundown」开始编排' : ''}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rundowns.map((r) => (
            <Card
              key={r.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => openDetail(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openDetail(r.id);
              }}
            >
              <CardContent className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{r.name}</p>
                    {r.executionStatus === 'running' && (
                      <Badge className="bg-green-600 text-white hover:bg-green-600">执行中</Badge>
                    )}
                    {r.executionStatus === 'finished' && <Badge variant="secondary">已结束</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {fmtLocal(r.startAt, true)} ｜ {r.itemCount} 个节目 · 共 {r.totalDurationMin} 分钟
                  </p>
                </div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rundown 操作 ${r.name}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRundown(r);
                          setFormOpen(true);
                        }}
                      >
                        编辑信息
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteRundown(r);
                        }}
                      >
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RundownFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        base={base}
        rundown={editingRundown}
        onSaved={(rid) => {
          setEditingRundown(null);
          loadList();
          if (!rundowns?.some((r) => r.id === rid)) openDetail(rid);
        }}
      />

      <AlertDialog open={!!deleteRundown} onOpenChange={(o) => { if (!o) setDeleteRundown(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Rundown</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{deleteRundown?.name}」？全部节目与素材文件将一并删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={removeRundown}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
