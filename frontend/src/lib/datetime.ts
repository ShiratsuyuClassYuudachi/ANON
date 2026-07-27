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
