import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, History, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type {
  Member,
  PhysicalCategoryItem,
  PhysicalItemItem,
  PhysicalItemStatus,
  PhysicalLogItem,
  PhysicalSummary,
  ProjectDetail,
} from '../../types';
import { PHYSICAL_STATUS_LABELS } from '../../types';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

const STATUS_OPTIONS: PhysicalItemStatus[] = ['planned', 'in_stock', 'in_use', 'returned', 'disposed'];
const STATUS_VARIANT: Record<PhysicalItemStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  planned: 'outline',
  in_stock: 'secondary',
  in_use: 'default',
  returned: 'secondary',
  disposed: 'destructive',
};

const emptyForm = {
  name: '',
  spec: '',
  unit: '个',
  categoryId: '',
  plannedQty: 0,
  onHandQty: 0,
  usedQty: 0,
  lostQty: 0,
  status: 'planned' as PhysicalItemStatus,
  responsibleId: '',
  location: '',
  tags: '',
  note: '',
};

function QtyProgress({ onHand, planned }: { onHand: number; planned: number }) {
  if (planned <= 0) return null;
  const pct = Math.min(100, Math.round((onHand / planned) * 100));
  const done = onHand >= planned;
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', done ? 'bg-emerald-500' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('w-10 text-right text-xs', done ? 'text-emerald-600' : 'text-muted-foreground')}>{pct}%</span>
    </div>
  );
}

export default function PhysicalTab({ project, members, myPermissions }: Props) {
  const canManage =
    myPermissions.includes('project:manage') || myPermissions.includes('materials:manage');
  const base = `/api/projects/${project.id}/physical`;

  const [categories, setCategories] = useState<PhysicalCategoryItem[]>([]);
  const [items, setItems] = useState<PhysicalItemItem[]>([]);
  const [summary, setSummary] = useState<PhysicalSummary | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const [filterCat, setFilterCat] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  const [catOpen, setCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState('');
  const [deleteCat, setDeleteCat] = useState<PhysicalCategoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PhysicalItemItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteItem, setDeleteItem] = useState<PhysicalItemItem | null>(null);

  const [logFor, setLogFor] = useState<PhysicalItemItem | null>(null);
  const [logs, setLogs] = useState<PhysicalLogItem[]>([]);
  const [adj, setAdj] = useState<{ type: string; delta: number; status: PhysicalItemStatus; note: string }>({
    type: 'adjust_on_hand', delta: 0, status: 'planned', note: '',
  });

  const load = useCallback(async () => {
    const [c, it, s] = await Promise.all([
      api<{ categories: PhysicalCategoryItem[] }>(`${base}/categories`),
      api<{ items: PhysicalItemItem[] }>(`${base}/items`),
      api<PhysicalSummary>(`${base}/summary`),
    ]);
    setCategories(c.categories);
    setItems(it.items);
    setSummary(s);
    setErr('');
  }, [base]);

  useEffect(() => {
    load()
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  const createCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api(`${base}/categories`, { body: { name: newCatName.trim() } });
      setNewCatName('');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const renameCategory = async () => {
    if (!editingCat || !catDraft.trim()) return;
    try {
      await api(`${base}/categories/${editingCat}`, { method: 'PATCH', body: { name: catDraft.trim() } });
      setEditingCat(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const removeCategory = async () => {
    if (!deleteCat) return;
    try {
      await api(`${base}/categories/${deleteCat.id}`, { method: 'DELETE' });
      if (filterCat === deleteCat.id) setFilterCat('');
      setDeleteCat(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const moveCategory = async (index: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await api(`${base}/categories/reorder`, { method: 'PATCH', body: { order: ids } });
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '' });
    setFormOpen(true);
  };

  const openEdit = (it: PhysicalItemItem) => {
    setEditing(it);
    setForm({
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      categoryId: it.categoryId,
      plannedQty: it.plannedQty,
      onHandQty: it.onHandQty,
      usedQty: it.usedQty,
      lostQty: it.lostQty,
      status: it.status,
      responsibleId: it.responsible?.userId ?? '',
      location: it.location,
      tags: it.tags.join(', '),
      note: it.note,
    });
    setFormOpen(true);
  };

  const submitItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('请填写物资名称');
      return;
    }
    const payload = {
      name: form.name.trim(),
      spec: form.spec.trim(),
      unit: form.unit.trim() || '个',
      categoryId: form.categoryId,
      plannedQty: form.plannedQty,
      onHandQty: form.onHandQty,
      usedQty: form.usedQty,
      lostQty: form.lostQty,
      status: form.status,
      responsibleId: form.responsibleId || null,
      location: form.location.trim(),
      tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      note: form.note.trim(),
    };
    try {
      if (editing) {
        await api(`${base}/items/${editing.id}`, { method: 'PATCH', body: payload });
      } else {
        await api(`${base}/items`, { body: payload });
      }
      setFormOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const removeItem = async () => {
    if (!deleteItem) return;
    try {
      await api(`${base}/items/${deleteItem.id}`, { method: 'DELETE' });
      setDeleteItem(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const openLog = async (it: PhysicalItemItem) => {
    setLogFor(it);
    setAdj({ type: 'adjust_on_hand', delta: 0, status: it.status, note: '' });
    try {
      const d = await api<{ logs: PhysicalLogItem[] }>(`${base}/items/${it.id}/logs`);
      setLogs(d.logs);
    } catch {
      setLogs([]);
    }
  };

  const submitLog = async () => {
    if (!logFor) return;
    if (adj.type === 'status_change') {
      if (adj.status === logFor.status) {
        toast.error('状态未变化');
        return;
      }
    } else if (adj.delta === 0) {
      toast.error('变动量不能为 0');
      return;
    }
    const body = adj.type === 'status_change'
      ? { type: adj.type, status: adj.status, note: adj.note }
      : { type: adj.type, delta: adj.delta, note: adj.note };
    try {
      await api(`${base}/items/${logFor.id}/log`, { method: 'POST', body });
      setLogFor(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const q = search.trim().toLowerCase();
  const visible = items.filter(
    (it) =>
      (!filterCat || it.categoryId === filterCat) &&
      (!filterStatus || it.status === filterStatus) &&
      (!q ||
        it.name.toLowerCase().includes(q) ||
        it.spec.toLowerCase().includes(q) ||
        it.location.toLowerCase().includes(q) ||
        it.tags.some((t) => t.toLowerCase().includes(q))),
  );
  const totalPct = summary && summary.total.planned > 0
    ? Math.min(100, Math.round((summary.total.onHand / summary.total.planned) * 100))
    : 0;

  return (
    <div className="space-y-3">
      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">实物准备进度</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div><p className="text-xs text-muted-foreground">物资条目</p><p className="text-xl font-semibold">{summary.total.count}</p></div>
              <div><p className="text-xs text-muted-foreground">计划总数</p><p className="text-xl font-semibold">{summary.total.planned}</p></div>
              <div><p className="text-xs text-muted-foreground">在库</p><p className="text-xl font-semibold">{summary.total.onHand}</p></div>
              <div><p className="text-xs text-muted-foreground">使用中</p><p className="text-xl font-semibold">{summary.total.used}</p></div>
              <div><p className="text-xs text-muted-foreground">损耗</p><p className="text-xl font-semibold text-destructive">{summary.total.lost}</p></div>
            </div>
            {summary.total.planned > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full transition-all', totalPct >= 100 ? 'bg-emerald-500' : 'bg-primary')}
                    style={{ width: `${totalPct}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">备齐 {totalPct}%</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">分类管理</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setCatOpen((o) => !o)}>
                {categories.length} 个分类
                <ChevronDown className={cn('ml-1 size-4 transition-transform', catOpen && 'rotate-180')} />
              </Button>
            </div>
          </CardHeader>
          {catOpen && (
            <CardContent className="space-y-3">
              <form onSubmit={createCategory} className="flex gap-2">
                <Input
                  placeholder="新建分类（如 印刷品、设备）"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit">新建分类</Button>
              </form>
              <div className="flex flex-wrap gap-2">
                {categories.map((c, i) =>
                  editingCat === c.id ? (
                    <div key={c.id} className="flex items-center gap-1">
                      <Input
                        value={catDraft}
                        onChange={(e) => setCatDraft(e.target.value)}
                        className="h-7 w-28 px-2 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void renameCategory(); }
                          if (e.key === 'Escape') setEditingCat(null);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="size-7" title="保存" onClick={() => void renameCategory()}>
                        <Check className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" title="取消" onClick={() => setEditingCat(null)}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Badge key={c.id} variant="secondary" className="gap-0.5 pr-1">
                      {c.name}
                      <button
                        type="button" title="前移" disabled={i === 0}
                        className="ml-1 rounded p-0.5 hover:bg-background/60 disabled:opacity-30"
                        onClick={() => void moveCategory(i, -1)}
                      >
                        <ArrowLeft className="size-3" />
                      </button>
                      <button
                        type="button" title="后移" disabled={i === categories.length - 1}
                        className="rounded p-0.5 hover:bg-background/60 disabled:opacity-30"
                        onClick={() => void moveCategory(i, 1)}
                      >
                        <ArrowRight className="size-3" />
                      </button>
                      <button
                        type="button" title="重命名"
                        className="rounded p-0.5 hover:bg-background/60"
                        onClick={() => { setEditingCat(c.id); setCatDraft(c.name); }}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button" title="删除"
                        className="rounded p-0.5 hover:bg-background/60 hover:text-destructive"
                        onClick={() => setDeleteCat(c)}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ),
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">物资清单</CardTitle>
            {canManage && (
              <Button size="sm" onClick={openCreate}><Plus className="mr-1 size-4" />新建物资</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-40 flex-1 sm:max-w-64">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索名称 / 规格 / 位置 / 标签"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterCat || 'all'} onValueChange={(v) => setFilterCat(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="全部分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus || 'all'} onValueChange={(v) => setFilterStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{PHYSICAL_STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : visible.length === 0 ? (
            items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <Package className="size-8" />
                <p className="text-sm">{canManage ? '暂无物资，点击「新建物资」开始登记' : '尚未登记实物清单'}</p>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">没有符合筛选条件的物资</p>
            )
          ) : (
            <div className="space-y-2">
              {visible.map((it) => (
                <div key={it.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{it.name}</span>
                        <Badge variant={STATUS_VARIANT[it.status]}>{PHYSICAL_STATUS_LABELS[it.status]}</Badge>
                        <Badge variant="outline">{catName(it.categoryId)}</Badge>
                      </div>
                      {it.spec && <p className="mt-0.5 text-xs text-muted-foreground">{it.spec}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openLog(it)} title="数量变动 / 记录"><History className="size-4" /></Button>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(it)}>编辑</Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteItem(it)}><Trash2 className="size-4" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <span className="text-muted-foreground">计划 <b className="text-foreground">{it.plannedQty}</b> {it.unit}</span>
                    <span className="text-muted-foreground">在库 <b className="text-foreground">{it.onHandQty}</b></span>
                    <span className="text-muted-foreground">使用 <b className="text-foreground">{it.usedQty}</b></span>
                    <span className="text-muted-foreground">损耗 <b className={it.lostQty > 0 ? 'text-destructive' : 'text-foreground'}>{it.lostQty}</b></span>
                  </div>
                  <QtyProgress onHand={it.onHandQty} planned={it.plannedQty} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {it.responsible && <span>负责人：{it.responsible.name}</span>}
                    {it.location && <span>位置：{it.location}</span>}
                    {it.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                  </div>
                  {it.note && <p className="mt-1.5 text-xs text-muted-foreground">备注：{it.note}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新建 / 编辑表单 */}
      <FormOverlay open={formOpen} onOpenChange={setFormOpen} title={editing ? '编辑物资' : '新建物资'}>
        <form onSubmit={submitItem} className="space-y-3">
          <div className="space-y-1">
            <Label>名称 *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>规格</Label>
              <Input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} placeholder="如 A3 铜版纸" />
            </div>
            <div className="space-y-1">
              <Label>单位</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="个" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>分类 *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>状态</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PhysicalItemStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{PHYSICAL_STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField label="计划数量" value={form.plannedQty} onChange={(v) => setForm({ ...form, plannedQty: v })} />
            <NumField label="在库数量" value={form.onHandQty} onChange={(v) => setForm({ ...form, onHandQty: v })} />
            <NumField label="使用数量" value={form.usedQty} onChange={(v) => setForm({ ...form, usedQty: v })} />
            <NumField label="损耗数量" value={form.lostQty} onChange={(v) => setForm({ ...form, lostQty: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>负责人</Label>
              <Select value={form.responsibleId || 'none'} onValueChange={(v) => setForm({ ...form, responsibleId: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="未指定" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指定</SelectItem>
                  {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>存放位置</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 仓库 A 架" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>标签（逗号分隔）</Label>
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="易碎, 贵重" />
          </div>
          <div className="space-y-1">
            <Label>备注</Label>
            <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="submit">{editing ? '保存' : '创建'}</Button>
          </div>
        </form>
      </FormOverlay>

      {/* 数量变动 / 日志 */}
      <FormOverlay open={!!logFor} onOpenChange={(o) => { if (!o) setLogFor(null); }} title={logFor ? `变动记录 · ${logFor.name}` : ''}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <NumField label="在库" value={logFor?.onHandQty ?? 0} onChange={() => {}} readOnly />
            <NumField label="使用" value={logFor?.usedQty ?? 0} onChange={() => {}} readOnly />
            <NumField label="损耗" value={logFor?.lostQty ?? 0} onChange={() => {}} readOnly />
          </div>
          <div className="space-y-1">
            <Label>变动类型</Label>
            <Select value={adj.type} onValueChange={(v) => setAdj({ ...adj, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adjust_on_hand">在库 ±</SelectItem>
                <SelectItem value="adjust_used">使用 ±</SelectItem>
                <SelectItem value="adjust_lost">损耗 ±</SelectItem>
                <SelectItem value="status_change">状态变更</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adj.type === 'status_change' ? (
            <div className="space-y-1">
              <Label>新状态</Label>
              <Select value={adj.status} onValueChange={(v) => setAdj({ ...adj, status: v as PhysicalItemStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{PHYSICAL_STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>变动量（正=增加，负=减少）</Label>
              <Input type="number" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: Number(e.target.value) || 0 })} />
            </div>
          )}
          <div className="space-y-1">
            <Label>备注</Label>
            <Input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="如 到货 / 现场领用" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLogFor(null)}>关闭</Button>
            <Button type="button" onClick={submitLog}>{adj.type === 'status_change' ? '记录状态变更' : '记录变动'}</Button>
          </div>
          {logs.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">变动记录</p>
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs">
                  <span>
                    {l.operator.name} · {logTypeLabel(l.type)}
                    {l.type === 'status_change' && l.status && ` → ${PHYSICAL_STATUS_LABELS[l.status]}`}
                    {l.qty !== 0 && ` ${l.qty > 0 ? '+' : ''}${l.qty}`}
                    {l.note && ` · ${l.note}`}
                  </span>
                  <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </FormOverlay>

      <AlertDialog open={!!deleteCat} onOpenChange={(o) => { if (!o) setDeleteCat(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分类</AlertDialogTitle>
            <AlertDialogDescription>确定删除分类「{deleteCat?.name}」？分类下仍有物资时无法删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={removeCategory}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除物资</AlertDialogTitle>
            <AlertDialogDescription>确定删除「{deleteItem?.name}」？其变动记录将一并删除，无法恢复。</AlertDialogDescription>
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

function NumField({ label, value, onChange, readOnly }: { label: string; value: number; onChange: (v: number) => void; readOnly?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </div>
  );
}

function logTypeLabel(t: string) {
  switch (t) {
    case 'adjust_on_hand': return '在库';
    case 'adjust_used': return '使用';
    case 'adjust_lost': return '损耗';
    case 'status_change': return '状态变更';
    default: return t;
  }
}
