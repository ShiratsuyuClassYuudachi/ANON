/** 本地时区时间格式化（数据库存 UTC ISO，展示一律转本地） */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → "MM-DD HH:mm"（withYear 时为 "YYYY-MM-DD HH:mm"），非法输入返回空串 */
export function fmtLocal(iso: string, withYear = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withYear ? `${d.getFullYear()}-${date} ${time}` : `${date} ${time}`;
}

/** ISO → datetime-local 输入框值（本地 "YYYY-MM-DDTHH:mm"），用于编辑回填 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface EventCountdown {
  /** 阶段：未设置 / 未开始 / 进行中 / 已结束 */
  phase: 'unset' | 'before' | 'during' | 'after';
  /** 大数字（before=距开始天数，during=第几天，after=结束天数；unset 为 null） */
  count: number | null;
  /** 单位文案，如 "天后开展" */
  unit: string;
  /** 完整短文案，如 "距开展还有 12 天" */
  text: string;
  /** 紧迫度样式 */
  cls: string;
}

/** 活动倒计时：距开始 / 进行中 / 已结束 */
export function eventCountdown(startDate: string | null, endDate: string | null): EventCountdown {
  if (!startDate) {
    return { phase: 'unset', count: null, unit: '', text: '尚未设置活动日期', cls: 'text-muted-foreground' };
  }
  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  const msToStart = start.getTime() - now.getTime();

  if (msToStart > 86400000) {
    const days = Math.ceil(msToStart / 86400000);
    const urgent = days <= 7;
    return {
      phase: 'before',
      count: days,
      unit: '天后开展',
      text: `距开展还有 ${days} 天`,
      cls: urgent ? 'text-orange-600 dark:text-orange-400' : 'text-foreground',
    };
  }
  if (msToStart > 0) {
    const hours = Math.ceil(msToStart / 3600000);
    return {
      phase: 'before',
      count: hours,
      unit: '小时后开展',
      text: hours <= 24 ? `距开展还有 ${hours} 小时` : '今天开展',
      cls: 'text-orange-600 dark:text-orange-400',
    };
  }
  if (now <= end) {
    const dayNum = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
    return {
      phase: 'during',
      count: dayNum,
      unit: '进行中（天）',
      text: `进行中，第 ${dayNum} 天`,
      cls: 'text-primary',
    };
  }
  const daysSince = Math.floor((now.getTime() - end.getTime()) / 86400000);
  return {
    phase: 'after',
    count: daysSince,
    unit: '天前结束',
    text: `已结束 ${daysSince} 天`,
    cls: 'text-muted-foreground',
  };
}
