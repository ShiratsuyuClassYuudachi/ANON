import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CirclePlay,
  ClipboardCheck,
  Clock,
  ListVideo,
  MapPin,
  Megaphone,
  PackageSearch,
  Phone,
  SkipForward,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { enqueueOffline, isOfflineError } from '../lib/offlineQueue';
import { fmtLocal } from '../lib/datetime';
import { hhmm } from '../components/project/tools/rundownExport';
import type { IncidentCategory, OnsiteData, OnsiteModule, OnsiteRundown } from '../types';
import LostFoundItemDialog from '../components/project/tools/LostFoundItemDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const CATEGORIES: { key: IncidentCategory; label: string }[] = [
  { key: 'equipment', label: '设备故障' },
  { key: 'staff', label: '人员缺席' },
  { key: 'material', label: '物料缺失' },
  { key: 'venue', label: '场地问题' },
  { key: 'safety', label: '安全事件' },
  { key: 'other', label: '其他' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<IncidentCategory, string>;

const OFFLINE_HINT = '已离线保存，联网后自动同步';

function fmtRange(startAt: string | null, endAt: string | null): string {
  if (!startAt) return '时间未定';
  const start = fmtLocal(startAt);
  if (!endAt) return start;
  const s = new Date(startAt);
  const e = new Date(endAt);
  // 同一天只显示一次日期
  if (s.toDateString() === e.toDateString()) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${start} - ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  }
  return `${start} - ${fmtLocal(endAt)}`;
}

export default function OnsitePage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<OnsiteData | null>(null);
  const [err, setErr] = useState('');
  const [acting, setActing] = useState(false);

  // 异常上报表单
  const [category, setCategory] = useState<IncidentCategory>('equipment');
  const [moduleId, setModuleId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 失物登记弹层
  const [lfOpen, setLfOpen] = useState(false);

  const load = useCallback(async () => {
    const d = await api<OnsiteData>(`/api/projects/${id}/onsite`);
    setData(d);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
    const timer = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const currentModule = useMemo(() => data?.myModules.find((m) => m.state === 'current') ?? null, [data]);
  const nextModule = useMemo(() => data?.myModules.find((m) => m.state === 'upcoming') ?? null, [data]);
  const sortedIncidents = useMemo(
    () => (data ? [...data.incidents].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)) : []),
    [data],
  );

  const postAction = async (url: string, body: unknown, okText: string) => {
    try {
      await api(url, { body });
      toast.success(okText);
      await load();
    } catch (e) {
      if (isOfflineError(e)) {
        enqueueOffline(url, body);
        toast.info(OFFLINE_HINT);
      } else {
        toast.error((e as Error).message);
        throw e;
      }
    }
  };

  const checkin = async (mid: string) => {
    setActing(true);
    try {
      await postAction(`/api/projects/${id}/work-modules/${mid}/checkin`, {}, '已签到');
    } catch {
      /* 非离线错误已 toast */
    } finally {
      setActing(false);
    }
  };

  const finish = async (mid: string) => {
    setActing(true);
    try {
      await postAction(`/api/projects/${id}/work-modules/${mid}/finish`, {}, '已完成');
    } catch {
      /* 非离线错误已 toast */
    } finally {
      setActing(false);
    }
  };

  const rundownAction = async (rid: string, op: string, body: unknown, okText: string) => {
    try {
      await postAction(`/api/projects/${id}/stage-rundowns/${rid}/execution/${op}`, body, okText);
    } catch {
      /* 非离线错误已 toast */
    }
  };

  const submitIncident = async () => {
    if (!note.trim()) {
      toast.error('请填写备注');
      return;
    }
    setSubmitting(true);
    try {
      const body: { category: IncidentCategory; note: string; moduleId?: string } = {
        category,
        note: note.trim(),
      };
      if (moduleId) body.moduleId = moduleId;
      await postAction(`/api/projects/${id}/onsite/incidents`, body, '已上报');
      setNote('');
      setModuleId('');
    } catch {
      /* 非离线错误已 toast */
    } finally {
      setSubmitting(false);
    }
  };

  if (err)
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-base text-destructive">{err}</p>
        <Button variant="outline" onClick={() => nav(`/p/${id}`)}>返回项目</Button>
      </Card>
    );
  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );

  const my = currentModule?.myAssignee ?? null;
  const canManageLF =
    data.myPermissions.includes('project:manage') || data.myPermissions.includes('lostfound:manage');
  const canManageTools =
    data.myPermissions.includes('project:manage') || data.myPermissions.includes('tools:manage');

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      {/* 顶部：返回 + 标题 + 时间 */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => nav(`/p/${id}`)} aria-label="返回项目">
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Smartphone className="size-5 shrink-0" /> 现场模式
          </h1>
          <p className="text-sm text-muted-foreground">
            {fmtLocal(data.now)} · 每 30 秒自动刷新
          </p>
        </div>
      </div>

      {/* 紧急/重要公告置顶条 */}
      {data.emergency.map((a) => (
        <div
          key={a.id}
          className={`flex items-start gap-2 rounded-lg px-4 py-3 text-white ${
            a.type === 'emergency' ? 'bg-red-600' : 'bg-orange-500'
          }`}
        >
          {a.type === 'emergency' ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Megaphone className="mt-0.5 size-5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-base font-bold">{a.title}</p>
            <p className="text-sm opacity-95">{a.content}</p>
          </div>
        </div>
      ))}

      {/* 当前任务大卡 */}
      <Card className="border-2 border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-muted-foreground">当前任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {currentModule ? (
            <>
              <p className="text-2xl font-bold leading-tight">{currentModule.name}</p>
              <div className="space-y-1 text-base">
                {currentModule.location && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" /> {currentModule.location}
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  {fmtRange(currentModule.startAt, currentModule.endAt)}
                </p>
              </div>
              {my?.completedAt ? (
                <Badge className="h-11 gap-1.5 bg-green-600 px-4 text-base text-white hover:bg-green-600">
                  <CheckCircle2 className="size-5" /> 已完成
                </Badge>
              ) : my?.checkedInAt ? (
                <Button
                  className="h-14 w-full text-lg font-bold"
                  disabled={acting}
                  onClick={() => finish(currentModule.id)}
                >
                  <ClipboardCheck className="size-5" /> 完成任务
                </Button>
              ) : (
                <Button
                  className="h-14 w-full text-lg font-bold"
                  disabled={acting}
                  onClick={() => checkin(currentModule.id)}
                >
                  <CheckCircle2 className="size-5" /> 签到
                </Button>
              )}
            </>
          ) : (
            <p className="py-4 text-center text-base text-muted-foreground">当前没有进行中的任务</p>
          )}
        </CardContent>
      </Card>

      {/* 下一项任务 */}
      {nextModule && <NextModuleCard module={nextModule} />}

      {/* 舞台执行 */}
      {data.rundowns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListVideo className="size-5 text-primary" /> 舞台执行
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.rundowns.map((r) => (
              <RundownExecRow key={r.id} rundown={r} canManage={canManageTools} onAction={rundownAction} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* 异常上报 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5 text-orange-500" /> 异常上报
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`h-11 rounded-full border px-4 text-base font-medium transition-colors ${
                  category === c.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Select value={moduleId || 'none'} onValueChange={(v) => setModuleId(v === 'none' ? '' : v)}>
            <SelectTrigger className="w-full text-base data-[size=default]:h-11">
              <SelectValue placeholder="关联模块（可选）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不关联模块</SelectItem>
              {data.myModules.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（必填，500 字以内）"
            maxLength={500}
            className="min-h-24 text-base"
          />
          <Button className="h-14 w-full text-lg font-bold" disabled={submitting} onClick={submitIncident}>
            提交上报
          </Button>
        </CardContent>
      </Card>

      {/* 失物登记 */}
      {canManageLF && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <PackageSearch className="size-5 text-primary" /> 失物招领
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-base text-muted-foreground">捡到物品？拍照登记，可在「工具 → 失物招领」跟踪认领</p>
            <Button className="h-14 w-full text-lg font-bold" onClick={() => setLfOpen(true)}>
              <PackageSearch className="size-5" /> 登记捡到的物品
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 联系人 */}
      {data.contacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Phone className="size-5" /> 联系人
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.contacts.map((c) => {
              const phones = c.contacts.filter((p) => p.platform === 'phone');
              return (
                <div key={c.userId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{c.name}</p>
                    {c.roleName && <p className="text-sm text-muted-foreground">{c.roleName}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {phones.map((p) => (
                      <Button key={p.value} variant="outline" className="h-11 gap-1.5 text-base" asChild>
                        <a href={`tel:${p.value}`}>
                          <Phone className="size-4" /> {p.value}
                        </a>
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 异常列表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">异常记录</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedIncidents.length === 0 && (
            <p className="py-2 text-center text-base text-muted-foreground">暂无异常记录</p>
          )}
          {sortedIncidents.map((inc) => (
            <div key={inc.id} className="space-y-1 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-medium">{CATEGORY_LABEL[inc.category] ?? inc.category}</p>
                <Badge
                  variant={inc.status === 'open' ? 'destructive' : 'secondary'}
                  className={inc.status === 'resolved' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : ''}
                >
                  {inc.status === 'open' ? '待处理' : '已解决'}
                </Badge>
              </div>
              <p className="text-base">{inc.note}</p>
              <p className="text-sm text-muted-foreground">
                {inc.reporter.name}
                {inc.moduleName ? ` · ${inc.moduleName}` : ''} · {fmtLocal(inc.createdAt)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <LostFoundItemDialog
        open={lfOpen}
        onOpenChange={setLfOpen}
        base={`/api/projects/${id}/lostfound`}
        onSaved={() => {}}
      />
    </div>
  );
}

function RundownExecRow({
  rundown: r,
  canManage,
  onAction,
}: {
  rundown: OnsiteRundown;
  canManage: boolean;
  onAction: (rid: string, op: string, body: unknown, okText: string) => Promise<void>;
}) {
  const running = r.status === 'running';
  // 延误 = 当前节目实际开始 - 计划开始（分钟，提前为负）
  const delay =
    running && r.currentActualStart && r.currentPlannedStart
      ? Math.round((new Date(r.currentActualStart).getTime() - new Date(r.currentPlannedStart).getTime()) / 60_000)
      : null;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <p className="font-medium">{r.name}</p>
        {running ? (
          <Badge className="bg-green-600 text-white hover:bg-green-600">执行中</Badge>
        ) : (
          <Badge variant="secondary">未开始</Badge>
        )}
        {delay !== null && delay > 0 && <Badge variant="destructive">延误 +{delay} 分钟</Badge>}
        {delay !== null && delay < 0 && (
          <Badge className="bg-green-600 text-white hover:bg-green-600">提前 {-delay} 分钟</Badge>
        )}
        {running && r.shiftMin !== 0 && (
          <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
            {r.shiftMin > 0 ? `顺延 +${r.shiftMin} 分钟` : `提前 ${-r.shiftMin} 分钟`}
          </Badge>
        )}
      </div>
      {running ? (
        <>
          <p className="text-xl font-bold leading-tight">{r.currentItemName ?? '推进中…'}</p>
          {r.currentIndex !== null && (
            <p className="text-sm text-muted-foreground">
              第 {r.currentIndex + 1}/{r.itemCount} 个节目
            </p>
          )}
          {canManage && (
            <div className="flex gap-2">
              <Button
                className="h-12 flex-1 text-base font-bold"
                onClick={() => void onAction(r.id, 'advance', {}, '已推进')}
              >
                <SkipForward className="size-5" />
                {r.currentIndex === r.itemCount - 1 ? '完成并结束' : '完成当前 → 下一个'}
              </Button>
              <Button
                variant="outline"
                className="h-12"
                aria-label="提前 5 分钟"
                onClick={() => void onAction(r.id, 'shift', { minutes: -5 }, '已提前 5 分钟')}
              >
                -5
              </Button>
              <Button
                variant="outline"
                className="h-12"
                aria-label="顺延 5 分钟"
                onClick={() => void onAction(r.id, 'shift', { minutes: 5 }, '已顺延 5 分钟')}
              >
                +5
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-base text-muted-foreground">
            {hhmm(new Date(r.startAt))} 开始 · {r.itemCount} 个节目
          </p>
          {canManage && (
            <Button
              className="h-12 w-full text-base font-bold"
              onClick={() => void onAction(r.id, 'start', {}, '已开始执行')}
            >
              <CirclePlay className="size-5" /> 开始执行
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function NextModuleCard({ module }: { module: OnsiteModule }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-muted-foreground">下一项任务</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-xl font-semibold leading-tight">{module.name}</p>
        <div className="space-y-1 text-base">
          {module.location && (
            <p className="flex items-center gap-1.5">
              <MapPin className="size-4 shrink-0 text-muted-foreground" /> {module.location}
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            {fmtRange(module.startAt, module.endAt)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
