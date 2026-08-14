import { useEffect, useState } from 'react';
import { Flag, Play, RotateCcw, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import type { StageRundown } from '../../../types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { computeExecution, delayMin, overrunMin } from './rundownExecution';
import { hhmm } from './rundownExport';

interface Props {
  projectId: string;
  rundown: StageRundown;
  canManage: boolean;
  onChanged: (r: StageRundown) => void;
}

type ConfirmKind = 'finish' | 'reset' | 'restart';

const CONFIRM_TEXT: Record<ConfirmKind, { title: string; desc: string; action: string }> = {
  finish: { title: '结束执行', desc: '确定结束本次执行？当前节目将记为已下场。', action: '结束执行' },
  reset: { title: '重置执行', desc: '将清空全部实际记录与顺延，回到未开始状态。', action: '重置' },
  restart: { title: '重新执行', desc: '将清空本次执行的实际记录，从头开始执行。', action: '重新执行' },
};

/** Rundown 执行控制台：开始/推进/跳节目/顺延/结束与重置（canManage=false 时只读） */
export default function ExecutionPanel({ projectId, rundown, canManage, onChanged }: Props) {
  const e = rundown.execution;
  const base = `/api/projects/${projectId}/stage-rundowns/${rundown.id}/execution`;
  const [now, setNow] = useState(() => new Date());
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const execList = computeExecution(rundown.startAt, rundown.items, e, now);
  const current = execList.find((c) => c.state === 'current') ?? null;
  const currentIndex = current ? execList.indexOf(current) : -1;

  /** 执行操作统一入口：成功后回写详情；okText 为空则不 toast（调用方自定） */
  const post = async (op: string, body?: unknown, okText?: string) => {
    try {
      const res = await api<{ rundown: StageRundown }>(`${base}/${op}`, { body: body ?? {} });
      onChanged(res.rundown);
      if (okText) toast.success(okText);
      return res.rundown;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    }
  };

  const shift = (minutes: number) =>
    void post('shift', { minutes }, minutes > 0 ? `已顺延 ${minutes} 分钟` : `已提前 ${-minutes} 分钟`);

  const advance = async () => {
    const r = await post('advance');
    if (r) toast.success(r.execution.status === 'finished' ? '演出已结束' : '已推进到下一个节目');
  };

  const jump = async (itemId: string) => {
    const name = rundown.items.find((it) => it.id === itemId)?.name ?? '';
    const r = await post('jump', { itemId });
    if (r) toast.success(`已跳转到「${name}」`);
  };

  const doConfirm = async () => {
    if (confirm === 'finish') await post('finish', {}, '已结束执行');
    else if (confirm === 'reset') await post('reset', {}, '已重置执行');
    else if (confirm === 'restart') await post('start', {}, '已重新开始执行');
    setConfirm(null);
  };

  const elapsed = current?.actualStart
    ? Math.max(0, Math.floor((now.getTime() - current.actualStart.getTime()) / 60_000))
    : 0;
  const delay = current ? delayMin(current) : null;
  const overrun = current ? overrunMin(current, now) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">执行控制</CardTitle>
          {e.status === 'running' ? (
            <Badge className="bg-green-600 text-white hover:bg-green-600">进行中</Badge>
          ) : e.status === 'finished' ? (
            <Badge variant="secondary">已结束</Badge>
          ) : (
            <Badge variant="outline">未开始</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {e.status === 'idle' && (
          <>
            <p className="text-sm text-muted-foreground">未开始执行</p>
            {canManage && (
              <Button disabled={rundown.items.length === 0} onClick={() => void post('start', {}, '已开始执行')}>
                <Play className="size-4" /> 开始执行
              </Button>
            )}
          </>
        )}

        {e.status === 'running' && (
          <>
            {current ? (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xl font-bold">{current.item.name}</p>
                  <span className="text-sm text-muted-foreground">
                    第 {currentIndex + 1}/{execList.length} 个节目
                  </span>
                  {delay !== null && delay > 0 && <Badge variant="destructive">延误 +{delay} 分钟</Badge>}
                  {delay !== null && delay < 0 && (
                    <Badge className="bg-green-600 text-white hover:bg-green-600">提前 {-delay} 分钟</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  计划 {hhmm(current.plannedStart)}–{hhmm(current.plannedEnd)}
                  {current.actualStart && ` ｜ 实际开始 ${hhmm(current.actualStart)}`}
                </p>
                <p className="text-sm">
                  已进行 {elapsed} 分钟 / 计划 {current.item.durationMin} 分钟
                  {overrun > 0 && <span className="ml-2 font-medium text-destructive">已超时 +{overrun} 分钟</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  预计全场结束 {hhmm(execList[execList.length - 1].projectedEnd)}（随进度实时推算）
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">推进中…</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {e.shiftMin !== 0 && (
                <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {e.shiftMin > 0 ? `顺延 +${e.shiftMin} 分钟` : `提前 ${-e.shiftMin} 分钟`}
                </span>
              )}
              {canManage && (
                <>
                  <Button variant="outline" size="sm" onClick={() => shift(5)}>+5</Button>
                  <Button variant="outline" size="sm" onClick={() => shift(10)}>+10</Button>
                  <Button variant="outline" size="sm" onClick={() => shift(-5)}>-5</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={e.shiftMin === 0}
                    onClick={() => void post('shift', { minutes: -e.shiftMin }, '顺延已清除')}
                  >
                    清除顺延
                  </Button>
                </>
              )}
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void advance()}>
                  <SkipForward className="size-4" />
                  {currentIndex === execList.length - 1 ? '完成当前并结束' : '完成当前 → 下一个'}
                </Button>
                <Select key={e.currentItemId ?? 'none'} onValueChange={(v) => void jump(v)}>
                  <SelectTrigger className="w-40" aria-label="跳到节目">
                    <SelectValue placeholder="跳到节目…" />
                  </SelectTrigger>
                  <SelectContent>
                    {rundown.items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => setConfirm('finish')}>
                  <Flag className="size-4" /> 结束执行
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirm('reset')}>
                  <RotateCcw className="size-4" /> 重置执行
                </Button>
              </div>
            )}
          </>
        )}

        {e.status === 'finished' && (
          <>
            <p className="text-sm text-muted-foreground">
              实际开始 {e.startedAt ? hhmm(new Date(e.startedAt)) : '—'} ｜ 实际结束{' '}
              {e.finishedAt ? hhmm(new Date(e.finishedAt)) : '—'}
              {e.shiftMin !== 0 && ` ｜ ${e.shiftMin > 0 ? `顺延 +${e.shiftMin} 分钟` : `提前 ${-e.shiftMin} 分钟`}`}
            </p>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirm('restart')}>
                  <Play className="size-4" /> 重新执行
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirm('reset')}>
                  <RotateCcw className="size-4" /> 重置执行
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? CONFIRM_TEXT[confirm].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>{confirm ? CONFIRM_TEXT[confirm].desc : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doConfirm()}>
              {confirm ? CONFIRM_TEXT[confirm].action : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
