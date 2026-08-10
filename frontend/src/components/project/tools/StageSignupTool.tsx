import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Import, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { fmtLocal, toLocalInput } from '../../../lib/datetime';
import type {
  ProjectDetail,
  StageRundownSummary,
  StageSignup,
  StageSignupItem,
  StageSignupSummary,
} from '../../../types';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import SignupItemDialog from './SignupItemDialog';
import SignupReviewDialog from './SignupReviewDialog';
import { computeSchedule, hhmm } from './rundownExport';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

const STATUS_LABEL: Record<StageSignupItem['status'], string> = {
  pending: '待审',
  approved: '通过',
  rejected: '不通过',
};
const STATUS_VARIANT: Record<StageSignupItem['status'], 'secondary' | 'default' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

/** 结束时间标签：与开始同日只给钟点，跨天给完整本地时间 */
function endLabel(startAt: string, endAt: string): string {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const sameDay =
    s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  return sameDay ? hhmm(e) : fmtLocal(endAt, true);
}

/** 报名批次新建/编辑表单 */
function SignupFormDialog({
  open,
  onOpenChange,
  base,
  signup,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string;
  signup?: StageSignupSummary | null;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(signup?.name ?? '');
    setStartAt(signup ? toLocalInput(signup.startAt) : '');
    setEndAt(signup ? toLocalInput(signup.endAt) : '');
    setNote(signup?.note ?? '');
  }, [open, signup]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        note: note.trim(),
      };
      const res = signup
        ? await api<{ signup: StageSignup }>(`${base}/${signup.id}`, { method: 'PATCH', body })
        : await api<{ signup: StageSignup }>(base, { body });
      toast.success(signup ? '批次已更新' : '报名批次已创建');
      onOpenChange(false);
      onSaved(res.signup.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={signup ? '编辑批次信息' : '新建报名批次'}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="signup-name">名称</Label>
          <Input id="signup-name" required placeholder="如 Day1 舞台报名" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-start">舞台可用开始</Label>
          <Input id="signup-start" type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-end">舞台可用结束</Label>
          <Input id="signup-end" type="datetime-local" required value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-note">备注</Label>
          <Input id="signup-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? '提交中…' : signup ? '保存' : '创建'}
        </Button>
      </form>
    </FormOverlay>
  );
}

/** 单个报名节目行 */
function SignupItemRow({
  item,
  dup,
  checked,
  onCheckedChange,
  canManage,
  onReview,
  onStatus,
  onEdit,
  onDelete,
}: {
  item: StageSignupItem;
  dup: boolean;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  canManage: boolean;
  onReview: () => void;
  onStatus: (status: StageSignupItem['status']) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const contacts = item.participants.filter((p) => p.contact);
  return (
    <Card>
      <CardContent className="flex items-start gap-2 p-3">
        <Checkbox
          className="mt-1 shrink-0"
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          aria-label={`选择 ${item.name}`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.name}</span>
            {dup && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                撞名
              </Badge>
            )}
            <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            <span className="text-sm text-muted-foreground">{item.durationMin} 分钟</span>
          </div>
          {item.participants.length > 0 && (
            <p className="text-sm text-muted-foreground">
              报名：{item.participants.map((p) => p.cn).join('、')}
              {contacts.length > 0 && `（${contacts.map((p) => `${p.cn} ${p.contact}`).join('；')}）`}
            </p>
          )}
          {item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}
          {item.reviews.length > 0 && (
            <div className="space-y-1">
              {item.reviews.map((r) => (
                <p key={r.userId} className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={
                      r.decision === 'approve'
                        ? 'border-green-600/40 text-green-600 dark:text-green-400'
                        : 'border-destructive/40 text-destructive'
                    }
                  >
                    {r.decision === 'approve' ? '赞成' : '反对'}
                  </Badge>
                  <span>{r.userName}</span>
                  {r.comment && <span>· {r.comment}</span>}
                  <span>· {fmtLocal(r.updatedAt)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`节目操作 ${item.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onReview}>投票</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>拍板</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onStatus('pending')}>待审</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatus('approved')}>通过</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatus('rejected')}>不通过</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={onEdit}>编辑</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardContent>
    </Card>
  );
}

export default function StageSignupTool({ project, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('tools:manage');
  const base = `/api/projects/${project.id}/stage-signups`;

  const [signups, setSignups] = useState<StageSignupSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StageSignup | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSignup, setEditingSignup] = useState<StageSignupSummary | null>(null);
  const [deleteSignup, setDeleteSignup] = useState<StageSignupSummary | null>(null);

  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StageSignupItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<StageSignupItem | null>(null);
  const [reviewItem, setReviewItem] = useState<StageSignupItem | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [rundownOptions, setRundownOptions] = useState<StageRundownSummary[] | null>(null);
  const [importTarget, setImportTarget] = useState<StageRundownSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const loadList = useCallback(async () => {
    const d = await api<{ signups: StageSignupSummary[] }>(base);
    setSignups(d.signups);
  }, [base]);

  const loadDetail = useCallback(
    async (sid: string) => {
      const d = await api<{ signup: StageSignup }>(`${base}/${sid}`);
      setDetail(d.signup);
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

  // 勾选预览为本地状态，切换批次即清空
  useEffect(() => {
    setChecked(new Set());
  }, [selected]);

  const toggleChecked = (id: string, v: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const removeSignup = async () => {
    if (!deleteSignup) return;
    try {
      await api(`${base}/${deleteSignup.id}`, { method: 'DELETE' });
      toast.success('报名批次已删除');
      setDeleteSignup(null);
      if (selected === deleteSignup.id) setSelected(null);
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

  const setStatus = async (item: StageSignupItem, status: StageSignupItem['status']) => {
    if (!detail) return;
    try {
      await api(`${base}/${detail.id}/items/${item.id}/status`, { method: 'PATCH', body: { status } });
      toast.success(`已拍板「${item.name}」为${STATUS_LABEL[status]}`);
      await loadDetail(detail.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const loadRundownOptions = async () => {
    try {
      const d = await api<{ rundowns: StageRundownSummary[] }>(`/api/projects/${project.id}/stage-rundowns`);
      setRundownOptions(d.rundowns);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doImport = async () => {
    if (!importTarget || !detail || importing) return;
    setImporting(true);
    try {
      await api(`${base}/${detail.id}/import`, { body: { rundownId: importTarget.id } });
      toast.success(`已导入到「${importTarget.name}」`);
      setImportTarget(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  // ---------- 详情视图 ----------
  if (selected && detail) {
    const availableMin = Math.round((new Date(detail.endAt).getTime() - new Date(detail.startAt).getTime()) / 60000);
    const approvedCount = detail.items.filter((it) => it.status === 'approved').length;
    const total = detail.items.reduce((sum, it) => sum + it.durationMin, 0);
    const displayItems = [...detail.items].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const nameCount = new Map<string, number>();
    for (const it of displayItems) {
      const k = it.name.trim().toLocaleLowerCase();
      nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }
    const isDup = (it: StageSignupItem) => (nameCount.get(it.name.trim().toLocaleLowerCase()) ?? 0) > 1;
    const checkedItems = displayItems.filter((it) => checked.has(it.id));
    const selectedTotal = checkedItems.reduce((sum, it) => sum + it.durationMin, 0);
    const remaining = availableMin - selectedTotal;

    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft className="size-4" /> 批次列表
        </Button>

        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-lg font-semibold">{detail.name}</p>
                <p className="text-sm text-muted-foreground">
                  {fmtLocal(detail.startAt, true)} – {endLabel(detail.startAt, detail.endAt)} ｜ 可用 {availableMin} 分钟
                </p>
                <p className="text-sm text-muted-foreground">
                  {detail.items.length} 个节目 · 通过 {approvedCount} 个 · 合计 {total} 分钟
                </p>
                {detail.note && <p className="text-sm text-muted-foreground">{detail.note}</p>}
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="批次操作">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingSignup({
                          id: detail.id,
                          name: detail.name,
                          startAt: detail.startAt,
                          endAt: detail.endAt,
                          note: detail.note,
                          itemCount: detail.items.length,
                          approvedCount,
                          totalDurationMin: total,
                          availableMin,
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
                        setDeleteSignup({
                          id: detail.id,
                          name: detail.name,
                          startAt: detail.startAt,
                          endAt: detail.endAt,
                          note: detail.note,
                          itemCount: detail.items.length,
                          approvedCount,
                          totalDurationMin: total,
                          availableMin,
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
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingItem(null);
                    setItemFormOpen(true);
                  }}
                >
                  <Plus className="size-4" /> 添加节目
                </Button>
                <DropdownMenu
                  onOpenChange={(o) => {
                    if (o) void loadRundownOptions();
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Import className="size-4" /> 导入 Rundown
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {approvedCount === 0 ? (
                      <DropdownMenuItem disabled>没有已通过的节目可导入</DropdownMenuItem>
                    ) : rundownOptions === null ? (
                      <DropdownMenuItem disabled>加载中…</DropdownMenuItem>
                    ) : rundownOptions.length === 0 ? (
                      <DropdownMenuItem disabled>暂无 Rundown</DropdownMenuItem>
                    ) : (
                      rundownOptions.map((r) => (
                        <DropdownMenuItem key={r.id} onClick={() => setImportTarget(r)}>
                          {r.name}（{r.itemCount} 个节目）
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </CardContent>
        </Card>

        {checkedItems.length > 0 && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-sm">
                选中 {checkedItems.length} 个 · 合计 {selectedTotal} / 可用 {availableMin} 分钟
                {remaining >= 0 ? (
                  <span className="ml-2 text-green-600 dark:text-green-400">剩余 {remaining} 分钟</span>
                ) : (
                  <span className="ml-2 text-destructive">超支 {-remaining} 分钟</span>
                )}
              </p>
              <div className="space-y-1">
                {computeSchedule(detail.startAt, checkedItems).map((it) => (
                  <p key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary" className="font-mono">
                      {hhmm(it.start)}–{hhmm(it.end)}
                    </Badge>
                    <span>{it.name}</span>
                    <span className="text-muted-foreground">{it.durationMin} 分钟</span>
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {detail.items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无报名节目{canManage ? '，点击「添加节目」开始录入' : ''}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {displayItems.map((it) => (
              <SignupItemRow
                key={it.id}
                item={it}
                dup={isDup(it)}
                checked={checked.has(it.id)}
                onCheckedChange={(v) => toggleChecked(it.id, v)}
                canManage={canManage}
                onReview={() => {
                  setReviewItem(it);
                  setReviewOpen(true);
                }}
                onStatus={(status) => setStatus(it, status)}
                onEdit={() => {
                  setEditingItem(detail.items.find((x) => x.id === it.id) ?? null);
                  setItemFormOpen(true);
                }}
                onDelete={() => setDeleteItem(it)}
              />
            ))}
          </div>
        )}

        <SignupItemDialog
          open={itemFormOpen}
          onOpenChange={setItemFormOpen}
          base={`${base}/${detail.id}`}
          item={editingItem}
          onSaved={() => loadDetail(detail.id)}
        />

        <SignupReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          base={`${base}/${detail.id}`}
          item={reviewItem}
          onSaved={() => loadDetail(detail.id)}
        />

        <SignupFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          base={base}
          signup={editingSignup}
          onSaved={(sid) => {
            setEditingSignup(null);
            loadDetail(sid);
            loadList();
          }}
        />

        <AlertDialog open={!!deleteSignup} onOpenChange={(o) => { if (!o) setDeleteSignup(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除报名批次</AlertDialogTitle>
              <AlertDialogDescription>
                确定删除「{deleteSignup?.name}」？全部报名节目与投票将一并删除，无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={removeSignup}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除节目</AlertDialogTitle>
              <AlertDialogDescription>确定删除「{deleteItem?.name}」？其投票记录将一并删除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={removeItem}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!importTarget} onOpenChange={(o) => { if (!o) setImportTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>导入 Rundown</AlertDialogTitle>
              <AlertDialogDescription>
                将把 {approvedCount} 个已通过节目追加到「{importTarget?.name}」。重复导入会重复追加，请确认。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={doImport} disabled={importing}>
                {importing ? '导入中…' : '导入'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ---------- 加载中 ----------
  if (selected) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          <ArrowLeft className="size-4" /> 批次列表
        </Button>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // ---------- 列表视图 ----------
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">舞台报名审核</h3>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setEditingSignup(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> 新建批次
          </Button>
        )}
      </div>

      {signups === null ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : signups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            暂无报名批次{canManage ? '，点击「新建批次」开始收集报名' : ''}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {signups.map((s) => (
            <Card
              key={s.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => setSelected(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(s.id);
              }}
            >
              <CardContent className="flex items-center justify-between gap-2 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtLocal(s.startAt, true)} – {endLabel(s.startAt, s.endAt)} ｜ 可用 {s.availableMin} 分钟
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {s.itemCount} 个节目 · 通过 {s.approvedCount} 个
                  </p>
                </div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`批次操作 ${s.name}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSignup(s);
                          setFormOpen(true);
                        }}
                      >
                        编辑信息
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteSignup(s);
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

      <SignupFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        base={base}
        signup={editingSignup}
        onSaved={(sid) => {
          setEditingSignup(null);
          loadList();
          if (!signups?.some((s) => s.id === sid)) setSelected(sid);
        }}
      />

      <AlertDialog open={!!deleteSignup} onOpenChange={(o) => { if (!o) setDeleteSignup(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除报名批次</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{deleteSignup?.name}」？全部报名节目与投票将一并删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={removeSignup}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
