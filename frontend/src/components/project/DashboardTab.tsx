import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  Info,
  ListTodo,
  MapPin,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../../api/client';
import { fmtLocal } from '../../lib/datetime';
import type {
  DashboardData,
  HealthStatus,
  Member,
  ProjectDetail,
  RiskItem,
} from '../../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

const LEVEL_MAP: Record<string, { icon: typeof Info; cls: string }> = {
  critical: { icon: AlertTriangle, cls: 'text-red-600 dark:text-red-400' },
  warning: { icon: AlertTriangle, cls: 'text-orange-600 dark:text-orange-400' },
  info: { icon: Info, cls: 'text-blue-600 dark:text-blue-400' },
};

function countdown(startDate: string | null, endDate: string | null): { text: string; cls: string } {
  if (!startDate) return { text: '尚未设置活动日期', cls: 'text-muted-foreground' };
  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  const msToStart = start.getTime() - now.getTime();

  if (msToStart > 86400000) {
    const days = Math.ceil(msToStart / 86400000);
    return { text: `距活动开始还有 ${days} 天`, cls: days <= 7 ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-foreground' };
  }
  if (msToStart > 0) {
    const hours = Math.ceil(msToStart / 3600000);
    return { text: hours <= 24 ? `距活动开始还有 ${hours} 小时` : '活动今天开始', cls: 'text-orange-600 dark:text-orange-400 font-medium' };
  }
  if (now <= end) {
    const dayNum = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
    return { text: `活动进行中，第 ${dayNum} 天`, cls: 'text-primary font-semibold' };
  }
  const daysSince = Math.floor((now.getTime() - end.getTime()) / 86400000);
  return { text: `活动已结束 ${daysSince} 天`, cls: 'text-muted-foreground' };
}

export default function DashboardTab({ project, members, myPermissions, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const d = await api<DashboardData>(`/api/projects/${project.id}/dashboard`);
    setData(d);
    setErr('');
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

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

  const { summary, myActions, risks, schedule } = data;
  const cd = countdown(project.startDate, project.endDate);
  const status = STATUS_MAP[project.status] ?? STATUS_MAP.preparing;
  const health = HEALTH_MAP[risks.health];

  return (
    <div className="space-y-4">
      {/* 项目头部 */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {project.currentStage && <Badge variant="outline">{project.currentStage}</Badge>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${health.cls}`}>{health.label}</span>
          </div>
          <p className={`text-lg font-semibold ${cd.cls}`}>{cd.text}</p>
          {project.startDate && (
            <p className="text-sm text-muted-foreground">
              {fmtLocal(project.startDate, true)}{project.endDate ? ` 至 ${fmtLocal(project.endDate, true)}` : ''}
            </p>
          )}
          {project.location && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" /> {project.location}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 待我处理 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            待我处理
            {myActions.items.length > 0 && <Badge variant="destructive">{myActions.items.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {myActions.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">当前没有需要你处理的事项</p>
          ) : (
            myActions.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.sourceType === 'todo' ? 'todos' : 'work')}
                className="flex w-full items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
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
            ))
          )}
        </CardContent>
      </Card>

      {/* 风险与异常 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">风险与异常</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {risks.risks.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
              当前未发现明显风险
            </div>
          ) : (
            risks.risks.map((risk) => <RiskCard key={risk.id} risk={risk} />)
          )}
        </CardContent>
      </Card>

      {/* 项目概况指标 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="待办完成率" value={`${summary.metrics.todoCompletionRate}%`} onClick={() => onNavigate('todos')} />
        <MetricCard label="逾期待办" value={String(summary.metrics.overdueCount)} alert={summary.metrics.overdueCount > 0} onClick={() => onNavigate('todos')} />
        {summary.metrics.budgetUsageRate !== null && (
          <MetricCard label="预算使用率" value={`${summary.metrics.budgetUsageRate}%`} alert={summary.metrics.budgetUsageRate > 90} onClick={() => onNavigate('finance')} />
        )}
        <MetricCard label="现场确认率" value={`${summary.metrics.workConfirmationRate}%`} onClick={() => onNavigate('work')} />
        <MetricCard label="成员" value={String(summary.metrics.memberCount)} onClick={() => onNavigate('members')} />
        <MetricCard label="活跃风险" value={String(summary.metrics.activeRiskCount)} alert={summary.metrics.activeRiskCount > 0} />
      </div>

      {/* 近期日程 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4" /> 近期日程
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedule.groups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">未来 7 天暂无日程安排</p>
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
                        <span className="truncate">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 模块摘要 */}
      <div className="grid gap-3 md:grid-cols-2">
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
    </div>
  );
}

function RiskCard({ risk }: { risk: RiskItem }) {
  const level = LEVEL_MAP[risk.level] ?? LEVEL_MAP.info;
  const Icon = level.icon;
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${level.cls}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{risk.title}</p>
        <p className="text-xs text-muted-foreground">{risk.description}</p>
      </div>
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
