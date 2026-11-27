import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Loader2, Plus, Search, X } from 'lucide-react';
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
  normal: { label: '正常', variant: 'success-soft' },
  attention: { label: '留意', variant: 'warning-soft' },
  at_risk: { label: '预警', variant: 'warning-soft' },
  critical: { label: '紧急', variant: 'destructive' },
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
    { label: '参与活动', value: projects?.length },
    { label: '筹备与进行中', value: projects?.filter((p) => p.status === 'preparing' || p.status === 'active').length },
    { label: '需留意或处理', value: projects?.filter((p) => p.health !== 'normal').length },
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
      <section aria-labelledby="projects-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="projects-heading" className="editorial-title">我的活动</h1>
          <Button data-tour="new-project" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" /> 新建活动
          </Button>
        </div>
        <dl className="editorial-band mt-5 grid-cols-3 py-4">
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
          <h2 className="editorial-subheading flex items-center gap-2">全部活动 <span className="text-sm font-normal text-muted-foreground">{filtered?.length}</span></h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="搜索活动" placeholder="搜索活动名称、简介或当前阶段" className="h-11 pl-9 pr-12" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-0 size-11 -translate-y-1/2" aria-label="清空搜索" onClick={() => setQuery('')}><X className="size-4" /></Button>}
          </div>
        </div>
      )}

      {loadFailed ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">加载活动列表失败</p>
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
        </div>
      ) : projects === null ? (
        <div className="grid gap-4 md:grid-cols-2" aria-label="正在加载活动" aria-busy="true">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-medium">还没有参与中的活动</p>
          <p className="max-w-xs px-4 text-sm leading-6 text-muted-foreground">新建一场活动，把排期、经费、物料与现场排班集中管理起来。</p>
          <Button onClick={() => setCreateOpen(true)}>新建活动</Button>
        </div>
      ) : filtered?.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center" role="status">
          <p className="font-medium">没有找到匹配的活动</p>
          <p className="text-sm text-muted-foreground">换个名称、简介或阶段关键词试试。</p>
          <Button variant="outline" onClick={() => setQuery('')}>清空搜索</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered?.map((p) => {
            const health = HEALTH[p.health] ?? HEALTH.normal;
            const countdown = eventCountdown(p.startDate, p.endDate);
            const completion = Math.min(100, Math.max(0, p.todoCompletionRate || 0));
            return (
              <Link key={p.id} data-tour="project-card" to={'/p/' + p.id} className="group min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
                <Card className="editorial-card h-full gap-4 duration-200 motion-safe:transition-[border-color,transform] motion-safe:hover:-translate-y-0.5">
                  <CardHeader className="min-w-0 gap-3 px-5 sm:px-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {p.myRole && <Badge variant="secondary">{p.myRole}</Badge>}
                        {p.currentStage && <span className="min-w-0 break-words [overflow-wrap:anywhere]">{p.currentStage}</span>}
                      </div>
                      <Badge variant={health.variant} className="shrink-0">{health.label}</Badge>
                    </div>
                    <CardTitle className="line-clamp-2 break-words text-lg leading-7 group-hover:text-primary [overflow-wrap:anywhere]">{p.name}</CardTitle>
                    {p.description && <CardDescription className="line-clamp-2 break-words leading-6 [overflow-wrap:anywhere]">{p.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="mt-auto space-y-4 px-5 sm:px-6">
                    <div className={`flex items-center gap-2 text-sm ${countdown.cls}`}>
                      <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                      <span>{countdown.text}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">待办进度</span><span className="font-medium">{completion}%</span></div>
                      <div role="progressbar" aria-label={`${p.name}待办完成率`} aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                      <span>阶段 {p.stageProgress.completed}/{p.stageProgress.total}</span>
                      {p.activeRiskCount > 0 && <span className="text-warning">{p.activeRiskCount} 项待处理风险</span>}
                      <span className="ml-auto flex items-center gap-1 font-medium text-primary">进入 ↗</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <FormOverlay open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)} title="新建活动">
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pname">活动名称</Label>
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
          <Button type="submit" className="w-full" disabled={creating || !name.trim()}>{creating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{creating ? '创建中…' : '创建活动'}</Button>
        </form>
      </FormOverlay>
    </div>
  );
}
