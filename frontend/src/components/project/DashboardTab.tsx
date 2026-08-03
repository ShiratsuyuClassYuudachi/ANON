import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  Info,
  ListTodo,
  Loader2,
  MapPin,
  Megaphone,
  Pin,
  RotateCcw,
  Settings2,
  ShieldOff,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { eventCountdown, fmtLocal } from '../../lib/datetime';
import type {
  ActivityItem,
  AnnouncementItem,
  DashboardData,
  DashboardPreferences,
  HealthStatus,
  Member,
  ProjectDetail,
  RiskItem,
} from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { AnnouncementManager } from './AnnouncementManager';
import { MilestoneSection } from './MilestoneSection';
import { StageStepper } from './StageStepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
  onNavigate: (tab: string) => void;
}

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  preparing: { label: '筹备中', variant: 'secondary' },
  active: { label: '进行中', variant: 'default' },
  settling: { label: '结算中', variant: 'outline' },
  completed: { label: '已完成', variant: 'outline' },
  archived: { label: '已归档', variant: 'outline' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

const HEALTH_MAP: Record<HealthStatus, { label: string; cls: string }> = {
  normal: { label: '正常', cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  attention: { label: '需关注', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  at_risk: { label: '存在风险', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  critical: { label: '严重异常', cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

const LEVEL_MAP: Record<string, { icon: typeof Info; cls: string; border: string }> = {
  critical: { icon: AlertTriangle, cls: 'text-red-600 dark:text-red-400', border: 'border-l-red-500' },
  warning: { icon: AlertTriangle, cls: 'text-orange-600 dark:text-orange-400', border: 'border-l-orange-500' },
  info: { icon: Info, cls: 'text-blue-600 dark:text-blue-400', border: 'border-l-blue-500' },
};

const CARD_DEFS: Record<string, { title: string }> = {
  myActions: { title: '待我处理' },
  risks: { title: '风险与异常' },
  announcements: { title: '公告' },
  schedule: { title: '近期日程' },
  milestones: { title: '里程碑' },
  modules: { title: '模块摘要' },
  activities: { title: '最近动态' },
};

const DEFAULT_CARD_ORDER = Object.keys(CARD_DEFS);

/** 合并服务端保存的顺序与新增卡片：未知 id 丢弃，新增 id 追加到默认位置 */
function mergeCardOrder(saved: string[]): string[] {
  const known = saved.filter((id) => id in CARD_DEFS);
  return [...known, ...DEFAULT_CARD_ORDER.filter((id) => !known.includes(id))];
}

export default function DashboardTab({ project, members, myPermissions, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState('');
  const [ignoredRisks, setIgnoredRisks] = useState<RiskItem[]>([]);

  const canCompleteTodo = myPermissions.some((p) => ['todo:complete', 'todo:manage', 'project:manage'].includes(p));
  const canManageRisk = myPermissions.includes('project:manage');
  const canManageAnnouncement = myPermissions.some((p) => ['announcement:manage', 'project:manage'].includes(p));

  // Quick action states
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionFiles, setCompletionFiles] = useState<FileList | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Risk management states
  const [ignoringRisk, setIgnoringRisk] = useState<RiskItem | null>(null);
  const [ignoreReason, setIgnoreReason] = useState('');
  const [ignoreDuration, setIgnoreDuration] = useState<'day' | 'untilStart' | 'forever'>('day');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [ignoredOpen, setIgnoredOpen] = useState(false);

  // Phase C states
  const [view, setView] = useState<'personal' | 'project'>('personal');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmingAnnouncement, setConfirmingAnnouncement] = useState<string | null>(null);
  const [announcementsManageOpen, setAnnouncementsManageOpen] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const rangeRef = useRef<7 | 30>(7);
  const prefsInitRef = useRef(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cardOrder, setCardOrder] = useState<string[]>(DEFAULT_CARD_ORDER);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([
      api<DashboardData>(`/api/projects/${project.id}/dashboard?scheduleDays=${rangeRef.current}`),
      canManageRisk
        ? api<{ risks: RiskItem[] }>(`/api/projects/${project.id}/risks`)
        : Promise.resolve(null),
    ]);
    setData(d);
    if (r) setIgnoredRisks(r.risks.filter((x) => x.status === 'ignored'));
    // 仅在首次加载时应用服务端偏好，避免覆盖本地刚修改（尚未持久化完成）的状态
    if (!prefsInitRef.current) {
      prefsInitRef.current = true;
      setView(d.preferences.defaultView);
      setCollapsed(new Set(d.preferences.collapsedCards));
      setHidden(new Set(d.preferences.hiddenCards));
      setCardOrder(mergeCardOrder(d.preferences.cardOrder));
      if (d.preferences.scheduleRange !== rangeRef.current) {
        rangeRef.current = d.preferences.scheduleRange;
        setRange(d.preferences.scheduleRange);
        setErr('');
        await load();
        return;
      }
    }
    setErr('');
  }, [project.id, canManageRisk]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  // --- Handlers ---

  const completeTodo = async (todoId: string) => {
    const fd = new FormData();
    if (completionNote.trim()) fd.append('completionNote', completionNote.trim());
    if (completionFiles) {
      for (let i = 0; i < completionFiles.length; i++) fd.append('files', completionFiles[i]);
    }
    try {
      await api(`/api/projects/${project.id}/todos/${todoId}/complete`, { formData: fd });
      toast.success('已完成');
      setCompletingId(null);
      setCompletionNote('');
      setCompletionFiles(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const confirmWork = async (moduleId: string) => {
    if (confirmingId) return;
    setConfirmingId(moduleId);
    try {
      await api(`/api/projects/${project.id}/work-modules/${moduleId}/confirm`, { body: {} });
      toast.success('已确认');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmingId(null);
    }
  };

  const ignoreRisk = async () => {
    if (!ignoringRisk || !ignoreReason.trim()) return;
    let ignoredUntil: string | undefined;
    if (ignoreDuration === 'day') {
      ignoredUntil = new Date(Date.now() + 86400000).toISOString();
    } else if (ignoreDuration === 'untilStart' && project.startDate) {
      ignoredUntil = project.startDate;
    }
    try {
      await api(`/api/projects/${project.id}/risks/${ignoringRisk.id}/ignore`, {
        body: { reason: ignoreReason.trim(), ignoredUntil },
      });
      toast.success('已忽略该风险');
      setIgnoringRisk(null);
      setIgnoreReason('');
      setIgnoreDuration('day');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const restoreRisk = async (riskId: string) => {
    if (restoringId) return;
    setRestoringId(riskId);
    try {
      await api(`/api/projects/${project.id}/risks/${riskId}/restore`, { body: {} });
      toast.success('已恢复风险');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  const confirmAnnouncement = async (id: string) => {
    if (confirmingAnnouncement) return;
    setConfirmingAnnouncement(id);
    try {
      await api(`/api/projects/${project.id}/announcements/${id}/confirm`, { body: {} });
      toast.success('已确认');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmingAnnouncement(null);
    }
  };

  const updatePrefs = async (patch: Partial<DashboardPreferences>) => {
    try {
      await api(`/api/projects/${project.id}/dashboard/preferences`, { method: 'PATCH', body: patch });
    } catch { /* silent */ }
  };

  const toggleCollapse = (cardId: string) => {
    const next = new Set(collapsed);
    if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
    setCollapsed(next);
    updatePrefs({ collapsedCards: [...next] });
  };

  const switchView = (v: 'personal' | 'project') => {
    setView(v);
    updatePrefs({ defaultView: v });
  };

  const switchRange = (r: 7 | 30) => {
    if (r === rangeRef.current) return;
    rangeRef.current = r;
    setRange(r);
    updatePrefs({ scheduleRange: r });
    void load();
  };

  const isCollapsed = (cardId: string) => collapsed.has(cardId);

  const toggleHide = (cardId: string) => {
    const next = new Set(hidden);
    if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
    setHidden(next);
    updatePrefs({ hiddenCards: [...next] });
  };

  const moveCard = (cardId: string, dir: -1 | 1) => {
    const idx = cardOrder.indexOf(cardId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= cardOrder.length) return;
    const next = [...cardOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    setCardOrder(next);
    updatePrefs({ cardOrder: next });
  };

  /** 卡片在 flex 列中的视觉顺序（头部/切换器/指标为负值固定在前） */
  const orderOf = (cardId: string) => 10 + cardOrder.indexOf(cardId);

  // --- Render ---

  if (err) return <Card className="p-4 text-sm text-destructive">{err}</Card>;
  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );

  const { summary, myActions, risks, schedule, announcements, activities } = data;
  const cd = eventCountdown(project.startDate, project.endDate);
  const status = STATUS_MAP[project.status] ?? STATUS_MAP.preparing;
  const health = HEALTH_MAP[risks.health];
  const showUntilStart = project.startDate && new Date(project.startDate).getTime() > Date.now();
  const isPersonal = view === 'personal';

  return (
    <div className="flex flex-col gap-4">
      {/* 项目头部 */}
      <Card style={{ order: -3 }}>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {project.currentStage && <Badge variant="outline">{project.currentStage}</Badge>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${health.cls}`}>{health.label}</span>
          </div>
          {/* 开展倒计时 */}
          {cd.phase === 'unset' ? (
            <p className="text-sm text-muted-foreground">{cd.text}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-3xl font-bold leading-none tabular-nums ${cd.cls}`}>{cd.count}</span>
                <span className={`text-sm font-medium ${cd.cls}`}>{cd.unit}</span>
              </div>
              <p className="pb-0.5 text-xs text-muted-foreground">
                {fmtLocal(project.startDate!, true)}{project.endDate ? ` 至 ${fmtLocal(project.endDate, true)}` : ''}
              </p>
            </div>
          )}
          {project.location && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" /> {project.location}
            </p>
          )}
          {project.stages && project.stages.length > 0 && (
            <div className="pt-2">
              <StageStepper stages={project.stages} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 视图切换 + 自定义入口 */}
      <div className="flex items-center gap-2" style={{ order: -2 }}>
        <div className="flex flex-1 gap-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => switchView('personal')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'personal' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            个人视图
          </button>
          <button
            onClick={() => switchView('project')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'project' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            项目视图
          </button>
        </div>
        <Button variant="outline" size="icon" onClick={() => setCustomizeOpen(true)} aria-label="自定义看板" title="自定义看板">
          <Settings2 className="size-4" />
        </Button>
      </div>

      {/* 项目概况指标（项目视图） */}
      {!isPersonal && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" style={{ order: -1 }}>
          <MetricCard label="待办完成率" value={`${summary.metrics.todoCompletionRate}%`} onClick={() => onNavigate('todos')} />
          <MetricCard label="逾期待办" value={String(summary.metrics.overdueCount)} alert={summary.metrics.overdueCount > 0} onClick={() => onNavigate('todos')} />
          {summary.metrics.budgetUsageRate !== null && (
            <MetricCard label="预算使用率" value={`${summary.metrics.budgetUsageRate}%`} alert={summary.metrics.budgetUsageRate > 90} onClick={() => onNavigate('finance')} />
          )}
          <MetricCard label="现场确认率" value={`${summary.metrics.workConfirmationRate}%`} onClick={() => onNavigate('work')} />
          <MetricCard label="成员" value={String(summary.metrics.memberCount)} onClick={() => onNavigate('members')} />
          <MetricCard label="活跃风险" value={String(summary.metrics.activeRiskCount)} alert={summary.metrics.activeRiskCount > 0} />
        </div>
      )}

      {/* 待我处理 */}
      {!hidden.has('myActions') && (
      <CollapsibleCard
        title="待我处理"
        icon={ListTodo}
        count={myActions.items.length}
        collapsed={isCollapsed('myActions')}
        onToggle={() => toggleCollapse('myActions')}
        style={{ order: orderOf('myActions') }}
      >
        <div className="space-y-2">
          {myActions.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">当前没有需要你处理的事项</p>
          ) : (
            myActions.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/50"
              >
                <button
                  onClick={() => onNavigate(item.sourceType === 'todo' ? 'todos' : 'work')}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  {item.sourceType === 'todo'
                    ? <ListTodo className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    : <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {item.isOverdue && <Badge variant="destructive" className="text-xs">逾期</Badge>}
                    {item.dueAt && <p className="mt-0.5 text-xs text-muted-foreground">{fmtLocal(item.dueAt)}</p>}
                  </div>
                </button>
                {item.action === 'complete' && canCompleteTodo && (
                  <Button
                    size="sm"
                    className="h-11 shrink-0 px-4"
                    onClick={() => { setCompletingId(item.id); setCompletionNote(''); setCompletionFiles(null); }}
                  >
                    完成
                  </Button>
                )}
                {item.action === 'confirm' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 shrink-0 px-4"
                    disabled={confirmingId === item.id}
                    onClick={() => void confirmWork(item.id)}
                  >
                    {confirmingId === item.id ? <Loader2 className="size-4 animate-spin" /> : null}
                    确认
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </CollapsibleCard>
      )}

      {/* 风险与异常 */}
      {!hidden.has('risks') && (
      <CollapsibleCard
        title="风险与异常"
        icon={AlertTriangle}
        count={risks.risks.length > 0 ? risks.risks.length : undefined}
        collapsed={isCollapsed('risks')}
        onToggle={() => toggleCollapse('risks')}
        style={{ order: orderOf('risks') }}
      >
        <div className="space-y-2">
          {risks.risks.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
              当前未发现明显风险
            </div>
          ) : (
            risks.risks.map((risk) => (
              <RiskCard
                key={risk.id}
                risk={risk}
                onIgnore={canManageRisk ? () => { setIgnoringRisk(risk); setIgnoreReason(''); setIgnoreDuration('day'); } : undefined}
              />
            ))
          )}

          {/* 已忽略风险折叠区 */}
          {canManageRisk && ignoredRisks.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <button
                onClick={() => setIgnoredOpen(!ignoredOpen)}
                className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <EyeOff className="size-4" />
                <span>已忽略 {ignoredRisks.length} 项</span>
                <ChevronDown className={`ml-auto size-4 transition-transform ${ignoredOpen ? 'rotate-180' : ''}`} />
              </button>
              {ignoredOpen && (
                <div className="mt-2 space-y-2">
                  {ignoredRisks.map((risk) => {
                    const level = LEVEL_MAP[risk.level] ?? LEVEL_MAP.info;
                    const Icon = level.icon;
                    const ignorerName = members.find((m) => m.userId === risk.ignoredBy)?.name ?? '成员';
                    return (
                      <div key={risk.id} className="flex items-start gap-2 rounded-lg border p-3 opacity-75">
                        <Icon className={`mt-0.5 size-4 shrink-0 ${level.cls}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{risk.title}</p>
                          {risk.ignoreReason && (
                            <p className="mt-0.5 text-xs italic text-muted-foreground">"{risk.ignoreReason}"</p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            由 {ignorerName} 忽略 · {risk.ignoredUntil ? `至 ${fmtLocal(risk.ignoredUntil, true)}` : '永久'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 shrink-0 px-3"
                          disabled={restoringId === risk.id}
                          onClick={() => void restoreRisk(risk.id)}
                        >
                          {restoringId === risk.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleCard>
      )}

      {/* 公告 */}
      {(announcements.items.length > 0 || canManageAnnouncement) && !hidden.has('announcements') && (
        <CollapsibleCard
          title="公告"
          icon={Megaphone}
          collapsed={isCollapsed('announcements')}
          onToggle={() => toggleCollapse('announcements')}
          style={{ order: orderOf('announcements') }}
          headerExtra={
            canManageAnnouncement ? (
              <Button variant="ghost" size="sm" onClick={() => setAnnouncementsManageOpen(true)}>
                <Settings2 className="size-4" /> 管理
              </Button>
            ) : undefined
          }
        >
          {announcements.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无公告</p>
          ) : (
          <div className="space-y-3">
            {announcements.items.map((a) => (
              <div key={a.id} className={`rounded-lg border p-3 ${a.type === 'emergency' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950' : a.type === 'important' ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950' : ''}`}>
                <div className="flex items-start gap-2">
                  {a.isPinned && <Pin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.content && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.content}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{a.publishedBy.name} · {fmtLocal(a.publishedAt)}</p>
                  </div>
                  {a.requireConfirmation && !a.confirmedByMe && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 px-3 text-xs"
                      disabled={confirmingAnnouncement === a.id}
                      onClick={() => void confirmAnnouncement(a.id)}
                    >
                      {confirmingAnnouncement === a.id ? <Loader2 className="size-3 animate-spin" /> : '我已知悉'}
                    </Button>
                  )}
                  {a.requireConfirmation && a.confirmedByMe && (
                    <Badge variant="secondary" className="shrink-0 text-xs">已确认</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </CollapsibleCard>
      )}

      {/* 近期日程 */}
      {!hidden.has('schedule') && (
      <CollapsibleCard
        title="近期日程"
        icon={CalendarDays}
        collapsed={isCollapsed('schedule')}
        onToggle={() => toggleCollapse('schedule')}
        style={{ order: orderOf('schedule') }}
        headerExtra={
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5 text-xs">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => switchRange(d)}
                className={`rounded px-2 py-0.5 transition-colors ${range === d ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {d} 天
              </button>
            ))}
          </div>
        }
      >
        {schedule.groups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">未来 {range} 天暂无日程安排</p>
        ) : (
          <div className="space-y-3">
            {schedule.groups.map((group) => (
              <div key={group.date}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <div key={`${item.sourceType}-${item.id}`} className="flex items-center gap-2 text-sm">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{fmtLocal(item.time).slice(6)}</span>
                      {item.sourceType === 'todo' && <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />}
                      {item.sourceType === 'work' && <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" />}
                      {item.sourceType === 'project' && <CalendarDays className="size-3.5 shrink-0 text-primary" />}
                      {item.sourceType === 'milestone' && <Flag className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />}
                      <span className="truncate">{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>
      )}

      {/* 里程碑 */}
      {!hidden.has('milestones') && (
      <MilestoneSection
        projectId={project.id}
        stages={project.stages ?? []}
        myPermissions={myPermissions}
        collapsed={isCollapsed('milestones')}
        onToggleCollapse={() => toggleCollapse('milestones')}
        style={{ order: orderOf('milestones') }}
      />
      )}

      {/* 模块摘要（项目视图） */}
      {!isPersonal && !hidden.has('modules') && (
      <div className="grid gap-3 md:grid-cols-2" style={{ order: orderOf('modules') }}>
        <ModuleCard title="待办" icon={ListTodo} onClick={() => onNavigate('todos')}>
          <Stat label="总数" value={summary.modules.todos.total} />
          <Stat label="已完成" value={summary.modules.todos.done} />
          <Stat label="逾期" value={summary.modules.todos.overdue} alert={summary.modules.todos.overdue > 0} />
          <Stat label="本周到期" value={summary.modules.todos.dueThisWeek} />
        </ModuleCard>

        {summary.modules.finance && (
          <ModuleCard title="财务" icon={Wallet} onClick={() => onNavigate('finance')}>
            <Stat label="收入" value={`¥${((summary.modules.finance.ticketIncomeCents + summary.modules.finance.incomeCents) / 100).toFixed(0)}`} />
            <Stat label="支出" value={`¥${(summary.modules.finance.expenseCents / 100).toFixed(0)}`} />
            <Stat label="结余" value={`¥${(summary.modules.finance.profitCents / 100).toFixed(0)}`} alert={summary.modules.finance.profitCents < 0} />
          </ModuleCard>
        )}

        {summary.modules.materials && (
          <ModuleCard title="物料" icon={FolderOpen} onClick={() => onNavigate('materials')}>
            <Stat label="资源总数" value={summary.modules.materials.totalResources} />
            <Stat label="无版本" value={summary.modules.materials.noVersionCount} alert={summary.modules.materials.noVersionCount > 0} />
            <Stat label="近 7 天更新" value={summary.modules.materials.recentCount} />
          </ModuleCard>
        )}

        {summary.modules.work && (
          <ModuleCard title="现场" icon={ClipboardList} onClick={() => onNavigate('work')}>
            <Stat label="任务模块" value={summary.modules.work.totalModules} />
            <Stat label="已分配/所需" value={`${summary.modules.work.totalAssigned}/${summary.modules.work.totalRequired}`} />
            <Stat label="已确认" value={summary.modules.work.confirmedCount} />
            <Stat label="人员缺口" value={summary.modules.work.shortageCount} alert={summary.modules.work.shortageCount > 0} />
          </ModuleCard>
        )}
      </div>
      )}

      {/* 最近动态 */}
      {activities.items.length > 0 && !hidden.has('activities') && (
        <CollapsibleCard
          title="最近动态"
          icon={Clock}
          collapsed={isCollapsed('activities')}
          onToggle={() => toggleCollapse('activities')}
          style={{ order: orderOf('activities') }}
        >
          <div className="space-y-2">
            {activities.items.map((act) => (
              <div key={act.id} className="flex items-start gap-2 text-sm">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">{fmtLocal(act.createdAt).slice(6)}</span>
                <span className="text-muted-foreground">{act.message}</span>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* 自定义看板 FormOverlay */}
      <FormOverlay
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        title="自定义看板"
        description="调整卡片显示顺序，或隐藏不需要的卡片（设置跨设备保存）"
      >
        <div className="space-y-2">
          {cardOrder.map((id, idx) => (
            <div
              key={id}
              className={`flex items-center gap-1 rounded-lg border p-2 pl-3 ${hidden.has(id) ? 'opacity-50' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm">{CARD_DEFS[id].title}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={idx === 0}
                onClick={() => moveCard(id, -1)}
                aria-label="上移"
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={idx === cardOrder.length - 1}
                onClick={() => moveCard(id, 1)}
                aria-label="下移"
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleHide(id)}
                aria-label={hidden.has(id) ? '显示' : '隐藏'}
              >
                {hidden.has(id) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
      </FormOverlay>

      {/* 完成待办 FormOverlay */}
      <FormOverlay
        open={!!completingId}
        onOpenChange={(o) => { if (!o) setCompletingId(null); }}
        title="完成待办"
      >
        <form
          onSubmit={(e) => { e.preventDefault(); if (completingId) void completeTodo(completingId); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>完成备注（可选）</Label>
            <Textarea
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              placeholder="补充说明或备注"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>附件（可选）</Label>
            <Input
              type="file"
              multiple
              onChange={(e) => setCompletionFiles(e.target.files)}
            />
          </div>
          <Button type="submit" className="w-full">确认完成</Button>
        </form>
      </FormOverlay>

      {/* 忽略风险 FormOverlay */}
      <FormOverlay
        open={!!ignoringRisk}
        onOpenChange={(o) => { if (!o) setIgnoringRisk(null); }}
        title="忽略风险"
        description={ignoringRisk?.title}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); void ignoreRisk(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>忽略原因（必填）</Label>
            <Textarea
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder="说明为什么忽略此风险"
              rows={3}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>忽略期限</Label>
            <RadioGroup value={ignoreDuration} onValueChange={(v) => setIgnoreDuration(v as typeof ignoreDuration)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="day" id="dur-day" />
                <Label htmlFor="dur-day" className="cursor-pointer font-normal">1 天</Label>
              </div>
              {showUntilStart && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="untilStart" id="dur-start" />
                  <Label htmlFor="dur-start" className="cursor-pointer font-normal">
                    至活动开始（{fmtLocal(project.startDate!, true)}）
                  </Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="forever" id="dur-forever" />
                <Label htmlFor="dur-forever" className="cursor-pointer font-normal">永久忽略</Label>
              </div>
            </RadioGroup>
          </div>
          <Button type="submit" className="w-full" disabled={!ignoreReason.trim()}>确认忽略</Button>
        </form>
      </FormOverlay>

      <AnnouncementManager
        projectId={project.id}
        members={members}
        roles={project.roles.map((r) => r.name)}
        open={announcementsManageOpen}
        onOpenChange={setAnnouncementsManageOpen}
        onChanged={load}
      />
    </div>
  );
}

function CollapsibleCard({ title, icon: Icon, count, collapsed, onToggle, headerExtra, style, children }: {
  title: string;
  icon: typeof ListTodo;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  headerExtra?: React.ReactNode;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Card style={style}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
            {count !== undefined && count > 0 && <Badge variant="destructive">{count}</Badge>}
            <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          {headerExtra}
        </CardTitle>
      </CardHeader>
      {!collapsed && <CardContent>{children}</CardContent>}
    </Card>
  );
}

function RiskCard({ risk, onIgnore }: { risk: RiskItem; onIgnore?: () => void }) {
  const level = LEVEL_MAP[risk.level] ?? LEVEL_MAP.info;
  const Icon = level.icon;
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-l-2 p-3 ${level.border}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${level.cls}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{risk.title}</p>
        <p className="text-xs text-muted-foreground">{risk.description}</p>
      </div>
      {onIgnore && (
        <Button
          size="sm"
          variant="outline"
          className="h-11 shrink-0 px-3"
          onClick={onIgnore}
        >
          <ShieldOff className="size-4" />
        </Button>
      )}
    </div>
  );
}

function MetricCard({ label, value, alert, onClick }: { label: string; value: string; alert?: boolean; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`rounded-lg border p-3 text-left ${onClick ? 'transition-colors hover:bg-accent/50' : ''}`}
    >
      <p className={`text-xl font-semibold ${alert ? 'text-destructive' : ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Comp>
  );
}

function ModuleCard({ title, icon: Icon, onClick, children }: { title: string; icon: typeof ListTodo; onClick: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><Icon className="size-4" /> {title}</span>
          <Button variant="ghost" size="sm" onClick={onClick}>查看</Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div>
      <p className={`text-sm font-medium ${alert ? 'text-destructive' : ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
