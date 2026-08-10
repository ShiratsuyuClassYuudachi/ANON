import { toast } from 'sonner';
import type { StageRundown, StageRundownItem } from '../../../types';
import { fmtLocal } from '../../../lib/datetime';

export interface ScheduledItem extends StageRundownItem {
  start: Date;
  end: Date;
}

/** 从开始时间起逐项累加时长，推算每个节目的起止时间 */
export function computeSchedule(startAt: string, items: StageRundownItem[]): ScheduledItem[] {
  let cursor = new Date(startAt);
  return items.map((it) => {
    const start = cursor;
    const end = new Date(start.getTime() + it.durationMin * 60_000);
    cursor = end;
    return { ...it, start, end };
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 本地补零时分 "HH:mm" */
export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 预计结束标签：空节目单 '—'；与开始同日只给钟点，跨天给 MM-DD HH:mm */
export function scheduleEndLabel(startAt: string, items: StageRundownItem[]): string {
  if (items.length === 0) return '—';
  const start = new Date(startAt);
  const scheduled = computeSchedule(startAt, items);
  const end = scheduled[scheduled.length - 1].end;
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return sameDay ? hhmm(end) : fmtLocal(end.toISOString());
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 生成 rundown 纯文本 */
export function rundownText(r: StageRundown): string {
  const scheduled = computeSchedule(r.startAt, r.items);
  const total = r.items.reduce((sum, it) => sum + it.durationMin, 0);
  const lines = [
    `舞台 Rundown：${r.name}`,
    `开始：${fmtLocal(r.startAt, true)} ｜ 预计结束：${scheduleEndLabel(r.startAt, r.items)} ｜ 共 ${r.items.length} 个节目（${total} 分钟）`,
    '',
  ];
  if (scheduled.length === 0) {
    lines.push('（暂无节目）');
  } else {
    for (const it of scheduled) {
      let line = `${hhmm(it.start)}-${hhmm(it.end)}  ${it.name}（${it.durationMin}分钟）`;
      if (it.participants.length) line += `  CN：${it.participants.map((p) => p.cn).join('/')}`;
      const contacts = it.participants.filter((p) => p.contact).map((p) => `${p.cn} ${p.contact}`);
      if (contacts.length) line += `  联系：${contacts.join('；')}`;
      if (it.attachments.length) line += `  素材：${it.attachments.map((a) => a.filename).join('、')}`;
      lines.push(line);
    }
  }
  return lines.join('\n');
}

export function exportRundownText(r: StageRundown) {
  downloadBlob(new Blob([rundownText(r)], { type: 'text/plain;charset=utf-8' }), `rundown-${safeName(r.name)}.txt`);
}

export async function copyRundownText(r: StageRundown) {
  await navigator.clipboard.writeText(rundownText(r));
  toast.success('已复制');
}

// ---------- 图片导出 ----------

const FONT = (weight: number | string, size: number) =>
  `${weight} ${size}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;

export interface RundownColumn {
  key: string;
  label: string;
  /** 基准宽度（px），导出时按选中列等比缩放到表格总宽 */
  width: number;
}

/** 可导出列（勾选菜单与 PNG 表头共用此注册表） */
export const RUNDOWN_COLUMNS: RundownColumn[] = [
  { key: 'index', label: '序号', width: 56 },
  { key: 'time', label: '时间', width: 150 },
  { key: 'name', label: '节目', width: 330 },
  { key: 'duration', label: '时长', width: 100 },
  { key: 'participants', label: '参与者', width: 200 },
  { key: 'contact', label: '联系方式', width: 200 },
  { key: 'attachment', label: '素材', width: 194 },
  { key: 'note', label: '备注', width: 220 },
];

/** 单元格自动换行：逐字符贪心断行（CJK 友好），显式 \n 另起一行，不截断任何内容 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      continue;
    }
    if (cur && ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  lines.push(cur);
  return lines;
}

function cellText(it: ScheduledItem | null, index: number, key: string): string {
  if (!it) return key === 'name' ? '（暂无节目）' : '';
  switch (key) {
    case 'index': return String(index + 1);
    case 'time': return `${hhmm(it.start)}–${hhmm(it.end)}`;
    case 'name': return it.name;
    case 'duration': return `${it.durationMin}分钟`;
    case 'participants': return it.participants.map((p) => p.cn).join('、');
    case 'contact': return it.participants.filter((p) => p.contact).map((p) => `${p.cn} ${p.contact}`).join('；');
    case 'attachment': return it.attachments.map((a) => a.filename).join('、');
    case 'note': return it.note;
    default: return '';
  }
}

/** 手写 canvas 表格导出 PNG（不引入 html2canvas：Tailwind v4 oklch 色值无法解析）。长文本自动换行完整显示。 */
export function exportRundownImage(r: StageRundown, columnKeys?: string[]) {
  const scheduled = computeSchedule(r.startAt, r.items);
  const total = r.items.reduce((sum, it) => sum + it.durationMin, 0);
  const cols = RUNDOWN_COLUMNS.filter((c) => !columnKeys || columnKeys.includes(c.key));
  if (cols.length === 0) return;

  const W = 1200;
  const SCALE = 2;
  const PAD = 32;
  const TITLE_H = 76;
  const HEADER_H = 40;
  const LINE_H = 17; // 13px 正文行高
  const CELL_PAD_Y = 8;
  const CELL_PAD_X = 8;
  const TABLE_W = W - PAD * 2;

  // 选中列按基准宽度等比缩放铺满表格
  const scaleW = TABLE_W / cols.reduce((s, c) => s + c.width, 0);
  const widths = cols.map((c) => Math.max(36, Math.round(c.width * scaleW)));
  widths[widths.length - 1] += TABLE_W - widths.reduce((s, w) => s + w, 0);

  // 先用量尺上下文计算各行高度
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) return;
  mctx.font = FONT('normal', 13);
  const bodyItems: (ScheduledItem | null)[] = scheduled.length ? scheduled : [null];
  const rows = bodyItems.map((it, i) => {
    const cells = cols.map((c, ci) => wrapText(mctx, cellText(it, i, c.key), widths[ci] - CELL_PAD_X * 2));
    const maxLines = Math.max(...cells.map((l) => l.length));
    return { cells, height: maxLines * LINE_H + CELL_PAD_Y * 2 };
  });

  const H = PAD + TITLE_H + HEADER_H + rows.reduce((s, row) => s + row.height, 0) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);

  // 白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  let y = PAD;
  // 标题块
  ctx.fillStyle = '#111827';
  ctx.font = FONT('bold', 26);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`舞台 Rundown：${r.name}`, PAD, y + 30);
  ctx.fillStyle = '#6b7280';
  ctx.font = FONT('normal', 13);
  ctx.fillText(
    `开始：${fmtLocal(r.startAt, true)} ｜ 预计结束：${scheduleEndLabel(r.startAt, r.items)} ｜ 共 ${r.items.length} 个节目（${total} 分钟）`,
    PAD,
    y + 56,
  );
  y += TITLE_H;

  // 表头
  ctx.fillStyle = '#111827';
  ctx.fillRect(PAD, y, TABLE_W, HEADER_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = FONT('normal', 14);
  ctx.textBaseline = 'middle';
  let x = PAD;
  for (let c = 0; c < cols.length; c++) {
    ctx.fillText(cols[c].label, x + CELL_PAD_X, y + HEADER_H / 2);
    x += widths[c];
  }
  y += HEADER_H;

  // 数据行（顶对齐多行文本）
  ctx.font = FONT('normal', 13);
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (ri % 2 === 1) {
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(PAD, y, TABLE_W, row.height);
    }
    ctx.fillStyle = '#111827';
    let cx = PAD;
    for (let c = 0; c < cols.length; c++) {
      const lines = row.cells[c];
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], cx + CELL_PAD_X, y + CELL_PAD_Y + LINE_H * li + LINE_H / 2);
      }
      cx += widths[c];
    }
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(PAD, y + row.height + 0.5);
    ctx.lineTo(W - PAD, y + row.height + 0.5);
    ctx.stroke();
    y += row.height;
  }

  canvas.toBlob((b) => {
    if (b) downloadBlob(b, `rundown-${safeName(r.name)}.png`);
  }, 'image/png');
}
