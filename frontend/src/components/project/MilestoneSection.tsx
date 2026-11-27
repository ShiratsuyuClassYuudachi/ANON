import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Flag, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { fmtLocal } from '../../lib/datetime';
import type { MilestoneItem, StageItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  projectId: string;
  stages: StageItem[];
  myPermissions: string[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  style?: React.CSSProperties;
}

export function MilestoneSection({ projectId, stages, myPermissions, collapsed = false, onToggleCollapse, style }: Props) {
  const [milestones, setMilestones] = useState<MilestoneItem[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [stageId, setStageId] = useState('');

  const canManage = myPermissions.includes('project:manage');

  const load = useCallback(async () => {
    const d = await api<{ milestones: MilestoneItem[] }>(`/api/projects/${projectId}/milestones`);
    setMilestones(d.milestones);
  }, [projectId]);

  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || submitting) return;
    setSubmitting(true);
    try {
      await api(`/api/projects/${projectId}/milestones`, {
        body: {
          title: title.trim(),
          date,
          description: description.trim(),
          stageId: stageId || undefined,
        },
      });
      toast.success('里程碑已创建');
      setCreateOpen(false);
      setTitle('');
      setDate('');
      setDescription('');
      setStageId('');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const sortedStages = [...stages].sort((a, b) => a.order - b.order);
  const items = milestones ? [...milestones].sort((a, b) => a.date.localeCompare(b.date)) : null;

  return (
    <section style={style} className="editorial-section">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="editorial-subheading">
          <button onClick={onToggleCollapse} aria-expanded={!collapsed} className="flex min-h-11 min-w-0 items-center gap-2 text-left md:min-h-8">
            <span>里程碑</span>
            {items && items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
            <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
        </h2>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> 新建
            </Button>
          )}
        </div>
      </header>
      {!collapsed && (
      <div>
        {items === null ? (
          <div className="editorial-list">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">暂无里程碑节点</p>
        ) : (
          <div className="editorial-list">
            {items.map((m) => (
              <div
                key={m.id}
                className="editorial-row flex items-start gap-2"
              >
                <span className="mt-0.5 w-12 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                  {fmtLocal(m.date).slice(0, 5)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`wrap-anywhere text-sm ${m.completedAt ? 'text-muted-foreground line-through' : 'font-medium'}`}>
                    {m.title}
                  </p>
                  {m.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                  )}
                </div>
                {m.stageName && <Badge variant="outline" className="shrink-0 text-xs">{m.stageName}</Badge>}
                {m.completedAt ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <Flag className="mt-1 size-3.5 shrink-0 text-primary" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <FormOverlay open={createOpen} onOpenChange={setCreateOpen} title="新建里程碑">
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ms-title">里程碑名称</Label>
            <Input
              id="ms-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="里程碑标题"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ms-date">目标日期</Label>
            <Input id="ms-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {sortedStages.length > 0 && (
            <div className="space-y-2">
              <Label>关联阶段（可选）</Label>
              <Select value={stageId || 'none'} onValueChange={(v) => setStageId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择关联阶段" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联阶段</SelectItem>
                  {sortedStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ms-desc">补充说明（可选）</Label>
            <Textarea
              id="ms-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充说明"
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting || !title.trim() || !date}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            创建里程碑
          </Button>
        </form>
      </FormOverlay>
    </section>
  );
}
