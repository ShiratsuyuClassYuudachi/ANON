import type { StageExecution } from '../../../types';

export type ExecItemState = 'done' | 'current' | 'upcoming';
export interface ExecComputed<T> {
  item: T;
  state: ExecItemState;
  plannedStart: Date;
  plannedEnd: Date;
  expectedStart: Date;
  expectedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
}

/**
 * 执行态推算：计划时间逐项累加（与 computeSchedule 同算法，同序配对），
 * 未开始节目「预计时间」= 计划 + shiftMin；当前节目超时 = now > expectedEnd。
 */
export function computeExecution<T extends { id: string; durationMin: number }>(
  startAt: string,
  items: T[],
  execution: StageExecution,
): ExecComputed<T>[] {
  let cursor = new Date(startAt).getTime();
  return items.map((item) => {
    const plannedStart = new Date(cursor);
    const plannedEnd = new Date(cursor + item.durationMin * 60_000);
    cursor = plannedEnd.getTime();
    const actual = execution.actuals.find((a) => a.itemId === item.id) ?? null;
    const state: ExecItemState =
      execution.currentItemId === item.id ? 'current' : actual?.endedAt ? 'done' : 'upcoming';
    const actualStart = actual ? new Date(actual.startedAt) : null;
    const actualEnd = actual?.endedAt ? new Date(actual.endedAt) : null;
    let expectedStart: Date;
    let expectedEnd: Date;
    if (state === 'current') {
      expectedStart = actualStart ?? new Date(plannedStart.getTime() + execution.shiftMin * 60_000);
      expectedEnd = new Date(expectedStart.getTime() + item.durationMin * 60_000 + execution.shiftMin * 60_000);
    } else if (state === 'done') {
      expectedStart = actualStart ?? plannedStart;
      expectedEnd = actualEnd ?? plannedEnd;
    } else {
      expectedStart = new Date(plannedStart.getTime() + execution.shiftMin * 60_000);
      expectedEnd = new Date(expectedStart.getTime() + item.durationMin * 60_000);
    }
    return { item, state, plannedStart, plannedEnd, expectedStart, expectedEnd, actualStart, actualEnd };
  });
}

/** 当前节目实际开始相对计划的延误分钟（提前为负）；非当前项无意义返回 null */
export function delayMin(c: ExecComputed<unknown>): number | null {
  return c.state === 'current' && c.actualStart
    ? Math.round((c.actualStart.getTime() - c.plannedStart.getTime()) / 60_000)
    : null;
}

/** 当前节目超出预计结束的分钟数（未超时 0） */
export function overrunMin(c: ExecComputed<unknown>, now: Date): number {
  return c.state === 'current' && now.getTime() > c.expectedEnd.getTime()
    ? Math.floor((now.getTime() - c.expectedEnd.getTime()) / 60_000)
    : 0;
}

/** 5 → '+5 分钟'；-5 → '-5 分钟' */
export function signedMinLabel(n: number): string {
  return n > 0 ? `+${n} 分钟` : `${n} 分钟`;
}
