import type { StageExecution } from '../../../types';

export type ExecItemState = 'done' | 'current' | 'upcoming';
export interface ExecComputed<T> {
  item: T;
  state: ExecItemState;
  plannedStart: Date;
  plannedEnd: Date;
  expectedStart: Date;
  expectedEnd: Date;
  /** 实时推算开始：done=实际；current=实际；当前项之后 upcoming=前项推算结束（双向级联），之前=计划+顺延 */
  projectedStart: Date;
  /** 实时推算结束：current=max(实际开始+时长, now)，超时时随 now 逐分钟推移 */
  projectedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
}

/**
 * 执行态推算：计划时间逐项累加（与 computeSchedule 同算法，同序配对）。
 * 未开始节目「预计时间」= 计划 + shiftMin（已公布基准）。
 * 执行中「推算时间」随当前节目实际进度双向级联：当前节目推算结束 = max(实际开始+时长, now)，
 * 其后未执行节目推算开始 = 前项推算结束（拖晚则后推，提前也同步提前）；
 * 当前项之前的未执行项（跳节目越过）保持计划+顺延，不进级联链。
 */
export function computeExecution<T extends { id: string; durationMin: number }>(
  startAt: string,
  items: T[],
  execution: StageExecution,
  now: Date = new Date(),
): ExecComputed<T>[] {
  let cursor = new Date(startAt).getTime();
  let chainEnd = -Infinity;
  let cascading = false; // 经过当前节目后，后续未执行项进入纯级联
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
    let projectedStart: Date;
    let projectedEnd: Date;
    if (state === 'current') {
      expectedStart = actualStart ?? new Date(plannedStart.getTime() + execution.shiftMin * 60_000);
      // 超时基准 = 实际开始 + 时长（顺延只挪后续节目的公布时间，不延长当前节目档期）
      expectedEnd = new Date(expectedStart.getTime() + item.durationMin * 60_000);
      projectedStart = expectedStart;
      projectedEnd = actualStart
        ? new Date(Math.max(actualStart.getTime() + item.durationMin * 60_000, now.getTime()))
        : expectedEnd;
      cascading = true;
    } else if (state === 'done') {
      expectedStart = actualStart ?? plannedStart;
      expectedEnd = actualEnd ?? plannedEnd;
      projectedStart = expectedStart;
      projectedEnd = expectedEnd;
    } else {
      expectedStart = new Date(plannedStart.getTime() + execution.shiftMin * 60_000);
      expectedEnd = new Date(expectedStart.getTime() + item.durationMin * 60_000);
      projectedStart = cascading ? new Date(chainEnd) : expectedStart;
      projectedEnd = new Date(projectedStart.getTime() + item.durationMin * 60_000);
    }
    // 级联链只由「当前项及其后」推进；当前项之前的未执行项（跳节目越过）不进链，
    // 否则其公布时间会污染后续级联（提前+jump 时后续行错误锚回计划时间）
    if (cascading) chainEnd = Math.max(chainEnd, projectedEnd.getTime());
    return { item, state, plannedStart, plannedEnd, expectedStart, expectedEnd, projectedStart, projectedEnd, actualStart, actualEnd };
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
