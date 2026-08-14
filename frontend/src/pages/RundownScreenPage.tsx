import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, MonitorX } from 'lucide-react';
import { api } from '../api/client';
import { fmtLocal } from '../lib/datetime';
import type { PublicRundownScreenResponse } from '../types';
import { computeExecution, delayMin, overrunMin } from '../components/project/tools/rundownExecution';
import { hhmm } from '../components/project/tools/rundownExport';

const pad = (n: number) => String(n).padStart(2, '0');

/** 免登录现场大屏（/screen/:token）：强制深色、每 10 秒轮询、本地 1 秒时钟 */
export default function RundownScreenPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicRundownScreenResponse | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      setData(await api<PublicRundownScreenResponse>(`/api/public/rundown-screen/${token}`));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-8 text-white">
        <div className="space-y-3 text-center">
          <MonitorX className="mx-auto size-12 text-neutral-600" />
          <p className="text-2xl font-medium">链接不存在或已关闭</p>
          <p className="text-sm text-neutral-500">{err}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-8 py-6">
          <div className="h-10 w-1/2 animate-pulse rounded bg-neutral-800" />
          <div className="h-40 w-full animate-pulse rounded bg-neutral-800" />
          <div className="h-24 w-full animate-pulse rounded bg-neutral-800" />
        </div>
      </div>
    );
  }

  const rundown = data.rundown;
  const e = data.rundown.execution;
  const execList = computeExecution(rundown.startAt, rundown.items, e, now);
  const currentIndex = execList.findIndex((c) => c.state === 'current');
  const current = currentIndex >= 0 ? execList[currentIndex] : null;
  const delay = current ? delayMin(current) : null;
  const overrun = current ? overrunMin(current, now) : 0;
  // 当前预期延误/提前 = 开场延误 + 已超时（与「接下来」时间同基准：计划+顺延）
  const projected = delay !== null ? delay + Math.max(0, overrun) : null;
  const elapsed = current?.actualStart
    ? Math.max(0, Math.floor((now.getTime() - current.actualStart.getTime()) / 60_000))
    : 0;
  const afterCurrent = currentIndex >= 0 ? execList.slice(currentIndex + 1) : execList;
  const nextUp = afterCurrent.filter((c) => c.state === 'upcoming').slice(0, 5);
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-8 py-6">
        {/* 顶栏：名称 + 时钟 + 状态 */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{rundown.name}</h1>
            <p className="text-neutral-400">{data.projectName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <p className="font-mono text-4xl tabular-nums">{clock}</p>
            {e.status === 'running' ? (
              <span className="rounded-md bg-green-600 px-3 py-1 text-lg font-medium">进行中</span>
            ) : e.status === 'finished' ? (
              <span className="rounded-md bg-neutral-700 px-3 py-1 text-lg font-medium text-neutral-200">已结束</span>
            ) : (
              <span className="rounded-md border border-neutral-600 px-3 py-1 text-lg font-medium text-neutral-300">
                未开始
              </span>
            )}
          </div>
        </div>

        {/* 紧急公告位 */}
        {data.announcements.map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-lg bg-red-600 px-5 py-4 text-white">
            <AlertTriangle className="mt-1 size-7 shrink-0" />
            <div className="min-w-0">
              <p className="text-2xl font-bold">{a.title}</p>
              {a.content && <p className="text-lg opacity-95">{a.content}</p>}
            </div>
          </div>
        ))}

        {/* 主体 */}
        {e.status === 'idle' && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-4xl font-bold">演出尚未开始</p>
            <p className="text-2xl text-neutral-400">计划开始 {fmtLocal(rundown.startAt, true)}</p>
            {rundown.items.length > 0 && (
              <p className="text-xl text-neutral-500">开场节目：{rundown.items[0].name}</p>
            )}
          </div>
        )}

        {e.status === 'running' && current && (
          <div className="space-y-4">
            <p className="text-xl text-neutral-400">正在演出</p>
            <p className="text-5xl font-bold leading-tight md:text-7xl">{current.item.name}</p>
            {current.item.participants.length > 0 && (
              <p className="text-2xl text-neutral-400">{current.item.participants.map((p) => p.cn).join('、')}</p>
            )}
            <p className="font-mono text-2xl text-neutral-300">
              计划 {hhmm(current.plannedStart)}–{hhmm(current.plannedEnd)}
              {current.actualStart && ` ｜ 实际开始 ${hhmm(current.actualStart)}`}
            </p>
            <p className="text-3xl font-medium">
              已进行 {elapsed} 分钟 <span className="text-neutral-400">/ 计划 {current.item.durationMin} 分钟</span>
              {overrun > 0 && <span className="ml-3 text-red-500">已超时 +{overrun} 分钟</span>}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {projected !== null && projected > 0 && (
                <span className="rounded-md bg-red-600 px-4 py-1.5 text-xl font-bold">预计延误 {projected} 分钟</span>
              )}
              {projected !== null && projected < 0 && (
                <span className="rounded-md bg-emerald-600 px-4 py-1.5 text-xl font-bold">预计提前 {-projected} 分钟</span>
              )}
              {projected === 0 && (
                <span className="rounded-md bg-neutral-700 px-4 py-1.5 text-xl font-bold">准点</span>
              )}
              {delay !== null && delay > 0 && (
                <span className="rounded-md bg-red-600 px-3 py-1 text-lg font-medium">延误 +{delay} 分钟</span>
              )}
              {delay !== null && delay < 0 && (
                <span className="rounded-md bg-green-600 px-3 py-1 text-lg font-medium">提前 {-delay} 分钟</span>
              )}
              {e.shiftMin !== 0 && (
                <span className="rounded-md bg-amber-600 px-3 py-1 text-lg font-medium">
                  {e.shiftMin > 0 ? `顺延 +${e.shiftMin} 分钟` : `提前 ${-e.shiftMin} 分钟`}
                </span>
              )}
            </div>
          </div>
        )}

        {e.status === 'finished' && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-4xl font-bold">演出已结束</p>
            {e.finishedAt && (
              <p className="text-2xl text-neutral-400">实际结束 {hhmm(new Date(e.finishedAt))}</p>
            )}
          </div>
        )}

        {/* 接下来 */}
        {e.status !== 'finished' && nextUp.length > 0 && (
          <div className="space-y-2 border-t border-neutral-800 pt-4">
            <p className="text-xl text-neutral-400">接下来</p>
            {nextUp.map((c) => (
              <div key={c.item.id} className="flex items-baseline gap-4">
                <span className="w-8 shrink-0 text-right text-xl text-neutral-500">
                  {execList.indexOf(c) + 1}
                </span>
                <span
                  className={`font-mono text-2xl tabular-nums ${
                    c.projectedStart.getTime() > c.expectedStart.getTime()
                      ? 'text-amber-400'
                      : c.projectedStart.getTime() < c.expectedStart.getTime()
                        ? 'text-emerald-400'
                        : ''
                  }`}
                >
                  {hhmm(c.projectedStart)}
                </span>
                <span className="min-w-0 flex-1 truncate text-2xl">{c.item.name}</span>
                <span className="shrink-0 text-lg text-neutral-500">{c.item.durationMin} 分钟</span>
              </div>
            ))}
          </div>
        )}

        {/* 底栏 */}
        <div className="border-t border-neutral-800 pt-4 text-lg text-neutral-400">
          {e.status === 'finished'
            ? e.finishedAt && `实际结束 ${hhmm(new Date(e.finishedAt))}`
            : execList.length > 0 && `预计结束 ${hhmm(execList[execList.length - 1].projectedEnd)}`}
        </div>
      </div>
    </div>
  );
}
