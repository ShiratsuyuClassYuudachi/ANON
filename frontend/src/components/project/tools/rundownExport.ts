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

/** 单元格单行省略：按列宽截断并补 … */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** 手写 canvas 表格导出 PNG（不引入 html2canvas：Tailwind v4 oklch 色值无法解析） */
export function exportRundownImage(r: StageRundown) {
  const scheduled = computeSchedule(r.startAt, r.items);
  const total = r.items.reduce((sum, it) => sum + it.durationMin, 0);

  const W = 1200;
  const SCALE = 2;
  const PAD = 32;
  const TITLE_H = 76;
  const HEADER_H = 40;
  const ROW_H = 44;
  const COLS = [56, 150, 330, 70, 200, 200, 194]; // 序号 时间 节目 时长 参与者 联系方式 素材
  const HEADERS = ['序号', '时间', '节目', '时长', '参与者', '联系方式', '素材'];

  const rows = scheduled.map((it, i) => [
    String(i + 1),
    `${hhmm(it.start)}-${hhmm(it.end)}`,
    it.name,
    `${it.durationMin}分钟`,
    it.participants.map((p) => p.cn).join('、'),
    it.participants.filter((p) => p.contact).map((p) => `${p.cn} ${p.contact}`).join('；'),
    it.attachments.map((a) => a.filename).join('、'),
  ]);

  const H = PAD + TITLE_H + HEADER_H + Math.max(rows.length, 1) * ROW_H + PAD;
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
  ctx.fillRect(PAD, y, W - PAD * 2, HEADER_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = FONT('normal', 14);
  ctx.textBaseline = 'middle';
  let x = PAD;
  for (let c = 0; c < COLS.length; c++) {
    ctx.fillText(HEADERS[c], x + 8, y + HEADER_H / 2);
    x += COLS[c];
  }
  y += HEADER_H;

  // 数据行
  ctx.font = FONT('normal', 13);
  const bodyRows = rows.length ? rows : [['', '', '（暂无节目）', '', '', '', '']];
  for (let ri = 0; ri < bodyRows.length; ri++) {
    if (ri % 2 === 1) {
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(PAD, y, W - PAD * 2, ROW_H);
    }
    ctx.fillStyle = '#111827';
    let cx = PAD;
    for (let c = 0; c < COLS.length; c++) {
      ctx.fillText(ellipsize(ctx, bodyRows[ri][c], COLS[c] - 16), cx + 8, y + ROW_H / 2);
      cx += COLS[c];
    }
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(PAD, y + ROW_H + 0.5);
    ctx.lineTo(W - PAD, y + ROW_H + 0.5);
    ctx.stroke();
    y += ROW_H;
  }

  canvas.toBlob((b) => {
    if (b) downloadBlob(b, `rundown-${safeName(r.name)}.png`);
  }, 'image/png');
}
