import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, CalendarDays, FolderOpen, FolderPlus, LayoutGrid, Loader2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { eventCountdown } from '../lib/datetime';
import type { HealthStatus, ProjectSummary } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { FormOverlay } from '@/components/FormOverlay';

const HEALTH: Record<HealthStatus, { label: string; variant: 'success-soft' | 'warning-soft' | 'destructive' }> = {
  normal: { label: '状态良好', variant: 'success-soft' },
  attention: { label: '需要留意', variant: 'warning-soft' },
  at_risk: { label: '存在风险', variant: 'warning-soft' },
  critical: { label: '紧急关注', variant: 'destructive' },
};

export default function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  const keyword = query.trim().toLocaleLowerCase();
  const filtered = projects?.filter((p) => `${p.name} ${p.description} ${p.currentStage}`.toLocaleLowerCase().includes(keyword));
  const stats = [
    { label: '参与项目', value: projects?.length },
    { label: '筹备与进行中', value: projects?.filter((p) => p.status === 'preparing' || p.status === 'active').length },
    { label: '需要关注', value: projects?.filter((p) => p.activeRiskCount > 0).length },
  ];

  const load = () =>
    api<{ projects: ProjectSummary[] }>('/api/projects').then((d) => {
      setProjects(d.projects);
      setLoadFailed(false);
    });
  useEffect(() => {
    load().catch((e) => {
      setLoadFailed(true);
      toast.error((e as Error).message);
    });
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await api('/api/projects', {
        body: {
          name: name.trim(),
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
        },
      });
      setName('');
      setStartDate('');
      setEndDate('');
      setCreateOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="projects-heading">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 size-64 rounded-full bg-primary/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-medium text-primary"><LayoutGrid className="size-4" aria-hidden="true" /> 项目工作台</p>
            <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">我的项目</h1>
            <p className="text-sm leading-6 text-muted-foreground">从筹备到现场，把每一步安排妥当。</p>
          </div>
          <Button data-tour="new-project" className="min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> 新建项目
          </Button>
        </div>
        <dl className="relative grid grid-cols-3 border-t bg-muted/20 px-2 py-4 sm:px-3">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 space-y-1 px-3 text-center not-first:border-l sm:px-4 sm:text-left">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="text-2xl font-semibold tracking-tight">{loadFailed ? '—' : s.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {projects !== null && projects.length > 0 && !loadFailed && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">项目列表 <span className="text-sm font-normal text-muted-foreground">{filtered?.length} 个</span></h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="搜索项目" placeholder="搜索项目、说明或阶段" className="h-11 pl-9 pr-10" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 size-9" aria-label="清空项目搜索" onClick={() => setQuery('')}><X className="size-4" /></Button>}
          </div>
        </div>
      )}

      {loadFailed ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">加载项目列表失败</p>
          <Button
            onClick={() =>
              load().catch((e) => {
                setLoadFailed(true);
                toast.error((e as Error).message);
              })
            }
          >
            重试
          </Button>
        </Card>
      ) : projects === null ? (
        <div className="grid gap-4 md:grid-cols-2" aria-label="正在加载项目" aria-busy="true">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="rounded-2xl bg-primary/10 p-4 text-primary"><FolderPlus className="size-8" aria-hidden="true" /></span>
          <p className="font-medium">为下一场活动建个项目</p>
          <p className="max-w-xs px-4 text-sm leading-6 text-muted-foreground">集中管理待办、物料与现场分工，邀请伙伴一起推进。</p>
          <Button onClick={() => setCreateOpen(true)}>新建项目</Button>
        </Card>
      ) : filtered?.length === 0 ? (
        <Card className="items-center gap-3 px-4 py-12 text-center" role="status">
          <Search className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">没有找到匹配的项目</p>
          <p className="text-sm text-muted-foreground">试试其他名称、说明或阶段关键词。</p>
          <Button variant="outline" onClick={() => setQuery('')}>清空搜索</Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered?.map((p) => {
            const health = HEALTH[p.health] ?? HEALTH.normal;
            const countdown = eventCountdown(p.startDate, p.endDate);
            const completion = Math.min(100, Math.max(0, p.todoCompletionRate || 0));
            return (
              <Link key={p.id} data-tour="project-card" to={'/p/' + p.id} className="group min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
                <Card className="h-full gap-4 transition-[border-color,box-shadow,transform] duration-200 hover:border-primary/40 hover:shadow-md motion-safe:hover:-translate-y-0.5">
                  <CardHeader className="min-w-0 gap-3 px-5 sm:px-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className="rounded-lg bg-primary/10 p-2.5 text-primary"><FolderOpen className="size-5" aria-hidden="true" /></span>
                      <Badge variant={health.variant} className="shrink-0">{health.label}</Badge>
                    </div>
                    <CardTitle className="line-clamp-2 break-words text-lg leading-7 [overflow-wrap:anywhere]">{p.name}</CardTitle>
                    {p.description && <CardDescription className="line-clamp-2 break-words leading-6 [overflow-wrap:anywhere]">{p.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="mt-auto space-y-4 px-5 sm:px-6">
                    <div className={`flex items-center gap-2 text-sm ${countdown.cls}`}>
                      <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                      <span>{countdown.text}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {p.myRole && <Badge variant="secondary">{p.myRole}</Badge>}
                      {p.currentStage && <span className="min-w-0 break-words [overflow-wrap:anywhere]">{p.currentStage}</span>}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">待办完成度</span><span className="font-medium">{completion}%</span></div>
                      <div role="progressbar" aria-label={`${p.name}待办完成率`} aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                      <span>阶段 {p.stageProgress.completed}/{p.stageProgress.total}</span>
                      {p.activeRiskCount > 0 && <span className="flex items-center gap-1 text-warning"><AlertCircle className="size-3.5" aria-hidden="true" /> {p.activeRiskCount} 项风险</span>}
                      <span className="ml-auto flex items-center gap-1 font-medium text-primary">进入项目 <ArrowUpRight className="size-4" aria-hidden="true" /></span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <FormOverlay open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)} title="新建项目">
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pname">项目名称</Label>
            <Input id="pname" required value={name} disabled={creating} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pstart">开始日期</Label>
              <Input id="pstart" type="date" value={startDate} disabled={creating} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pend">结束日期</Label>
              <Input id="pend" type="date" min={startDate || undefined} value={endDate} disabled={creating} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={creating || !name.trim()}>{creating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{creating ? '创建中…' : '创建'}</Button>
        </form>
      </FormOverlay>
    </div>
  );
}
