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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import ProgramFormDialog from './ProgramFormDialog';
import { computeSchedule, copyRundownText, exportRundownImage, exportRundownText, hhmm, scheduleEndLabel } from './rundownExport';

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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string;
  rundown?: StageRundownSummary | null;
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
      const body = { name: name.trim(), startAt: new Date(startAt).toISOString(), note: note.trim() };
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
          <Input id="rundown-start" type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
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
  onEdit,
  onDelete,
}: {
  index: number;
  scheduled: StageRundownItem & { start: Date; end: Date };
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scheduled.id });
  const contacts = scheduled.participants.filter((p) => p.contact);
  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : ''}
    >
      <CardContent className="flex items-start gap-2 p-3">
        {canManage && (
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
            <Badge variant="secondary" className="font-mono">
              {hhmm(scheduled.start)}–{hhmm(scheduled.end)}
            </Badge>
            <span className="font-medium">{scheduled.name}</span>
            <span className="text-sm text-muted-foreground">{scheduled.durationMin} 分钟</span>
          </div>
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
        {canManage && (
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

  const [formOpen, setFormOpen] = useState(false);
  const [editingRundown, setEditingRundown] = useState<StageRundownSummary | null>(null);
  const [deleteRundown, setDeleteRundown] = useState<StageRundownSummary | null>(null);

  const [programFormOpen, setProgramFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StageRundownItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<StageRundownItem | null>(null);

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
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const order = arrayMove(ids, from, to);
    // 乐观更新，失败回滚
    setDetail({ ...detail, items: arrayMove(detail.items, from, to) });
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
    const total = detail.items.reduce((sum, it) => sum + it.durationMin, 0);
    const rows = (
      <div className="space-y-2">
        {scheduled.map((it, i) => (
          <SortableProgramRow
            key={it.id}
            index={i}
            scheduled={it}
            canManage={canManage}
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
                  开始 {fmtLocal(detail.startAt, true)} ｜ 预计结束 {scheduleEndLabel(detail.startAt, detail.items)}
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
                          createdAt: detail.createdAt,
                          updatedAt: detail.updatedAt,
                        });
                        setFormOpen(true);
                      }}
                    >
                      编辑信息
                    </DropdownMenuItem>
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
                          createdAt: detail.createdAt,
                          updatedAt: detail.updatedAt,
                        })
                      }
                    >
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => exportRundownImage(detail)}>
                <Image className="size-4" /> 导出图片
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportRundownText(detail)}>
                <Download className="size-4" /> 导出文本
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyRundownText(detail)}>
                <ClipboardCopy className="size-4" /> 复制文本
              </Button>
              {canManage && (
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

        {detail.items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无节目{canManage ? '，点击「添加节目」开始编排' : ''}
            </CardContent>
          </Card>
        ) : canManage ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={detail.items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
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
          onSaved={(rid) => {
            setEditingRundown(null);
            loadDetail(rid);
            loadList();
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
                  <p className="font-medium">{r.name}</p>
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
