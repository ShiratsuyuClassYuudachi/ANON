import { badRequest, bodyObj, form, formFiles, formStr, json, memberInfos, nameOf, notFound, nowIso, requireProject, storeUpload, uid } from '../helpers';
import { buildFinanceSummary } from '../aggregate';
import { def, type Route } from '../router';
import type { Ctx, Db, DbTransaction } from '../types';

function txJson(db: Db, t: DbTransaction) {
  return {
    id: t.id,
    type: t.type,
    amountCents: t.amountCents,
    note: t.note,
    payer: { userId: t.payerUserId, name: nameOf(db, t.payerUserId) },
    splitAmong: t.splitAmong.map((id) => ({ userId: id, name: nameOf(db, id) })),
    createdBy: t.createdBy,
    createdByName: nameOf(db, t.createdBy),
    createdAt: t.createdAt,
    attachments: t.attachments
      .map((id) => (db.files[id] ? { id, filename: db.files[id].filename } : null))
      .filter((x): x is { id: string; filename: string } => !!x),
  };
}

function findTx(ctx: Ctx): DbTransaction {
  const { db, params } = ctx;
  const t = db.transactions.find((x) => x.id === params.txId && x.projectId === params.pid);
  if (!t) throw notFound('账目不存在');
  return t;
}

/** 元（最多两位小数）→ 整数分（与后端 parseAmount 一致） */
function parseAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('金额必须为正数');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw badRequest('金额最多两位小数');
  return Math.round(n * 100);
}

/** multipart 中的 splitAmong：JSON 字符串或逗号分隔，去重 */
function parseSplitAmong(v: string): string[] {
  if (!v) return [];
  let ids: string[];
  if (v.startsWith('[')) {
    try {
      const arr = JSON.parse(v);
      ids = Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      throw badRequest('splitAmong 格式无效');
    }
  } else {
    ids = v.split(',').filter(Boolean);
  }
  return [...new Set(ids)];
}

function assertMembers(ctx: Ctx, label: string, userIds: string[]) {
  const { db, params } = ctx;
  const members = db.memberships.filter((m) => m.projectId === params.pid);
  if (userIds.some((id) => !members.some((m) => m.userId === id))) throw badRequest(`${label}必须是项目成员`);
}

export const financeRoutes: Route[] = [
  def('GET', '/api/projects/:pid/finance', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const transactions = db.transactions
      .filter((t) => t.projectId === project.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
    return json({ transactions: transactions.map((t) => txJson(db, t)), summary: buildFinanceSummary(db, project) });
  }),

  def('POST', '/api/projects/:pid/finance', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const fd = form(ctx);
    const type = formStr(fd, 'type');
    if (type !== 'income' && type !== 'expense') return badRequest('type 必须是 income 或 expense');
    const payerUserId = formStr(fd, 'payerUserId');
    if (!payerUserId) return badRequest('付款人必填');
    const splitAmong = parseSplitAmong(formStr(fd, 'splitAmong'));
    assertMembers(ctx, '付款人', [payerUserId]);
    assertMembers(ctx, '平摊人', splitAmong);
    const attachments: string[] = [];
    for (const f of formFiles(fd)) attachments.push(await storeUpload(db, f));
    const tx: DbTransaction = {
      id: uid(),
      projectId: ctx.params.pid,
      type,
      amountCents: parseAmount(formStr(fd, 'amount')),
      note: formStr(fd, 'note'),
      payerUserId,
      splitAmong,
      createdBy: db.currentUserId,
      createdAt: nowIso(),
      attachments,
    };
    db.transactions.push(tx);
    return json({ transaction: txJson(db, tx) }, 201);
  }),

  // /ticket 与 /export 必须先于 /:txId 注册
  def('PATCH', '/api/projects/:pid/finance/ticket', async (ctx) => {
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (b.ticketTypes !== undefined) {
      if (!Array.isArray(b.ticketTypes) || b.ticketTypes.length > 20) return badRequest('票种数量无效（0-20 个）');
      const parsed = b.ticketTypes.map((t: { name?: unknown; price?: unknown; count?: unknown }) => {
        const name = String(t?.name ?? '').trim();
        if (!name || name.length > 20) throw badRequest('票种名称无效');
        const price = Number(t?.price);
        if (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
          throw badRequest('票种价格无效');
        }
        const count = Number(t?.count);
        if (!Number.isInteger(count) || count < 0) throw badRequest('票种数量无效');
        return { name, priceCents: Math.round(price * 100), count };
      });
      project.ticketTypes = parsed;
      project.ticketPriceCents = 0;
      project.ticketCount = 0;
      const ticketIncomeCents = parsed.reduce((s, t) => s + t.priceCents * t.count, 0);
      return json({ ticketTypes: parsed, ticketIncomeCents });
    }
    return badRequest('ticketTypes 必填');
  }),

  // R6 CSV 导出：BOM + CRLF + UTC 时间戳（与后端 routes/finance.ts export 一致）
  def('GET', '/api/projects/:pid/finance/export', async (ctx) => {
    const { db, query, params } = ctx;
    requireProject(ctx);
    const members = memberInfos(db, params.pid);
    const target = query.get('userId') ?? db.currentUserId;
    const me = members.find((m) => m.userId === target);
    if (!me) return badRequest('userId 必须是项目成员');
    const all = db.transactions
      .filter((t) => t.projectId === params.pid)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
    const related = all.filter(
      (t) => t.payerUserId === target || t.splitAmong.length === 0 || t.splitAmong.includes(target),
    );
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const nameMap = new Map(members.map((m) => [m.userId, m.name]));
    const rows = related.map((t) =>
      [
        t.createdAt.slice(0, 19).replace('T', ' '),
        t.type === 'income' ? '收入' : '支出',
        (t.amountCents / 100).toFixed(2),
        nameMap.get(t.payerUserId) ?? '未知',
        t.splitAmong.length === 0 ? '全员' : t.splitAmong.map((id) => nameMap.get(id) ?? '未知').join('、'),
        t.note,
        nameOf(db, t.createdBy),
      ]
        .map(esc)
        .join(','),
    );
    const csv = '\uFEFF' + ['日期,类型,金额(元),付款人,参与平摊,备注,添加人', ...rows].join('\r\n') + '\r\n';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="finance-${me.userId}.csv"`,
      },
    });
  }),

  def('DELETE', '/api/projects/:pid/finance/:txId', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const tx = findTx(ctx);
    db.transactions.splice(db.transactions.indexOf(tx), 1);
    return json({ ok: true });
  }),
];
