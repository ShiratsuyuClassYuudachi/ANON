import type { ProjectDoc } from '../models/Project';
import type { TransactionDoc } from '../models/Transaction';

export interface MemberInfo {
  userId: string;
  name: string;
}

export interface PerUserNet extends MemberInfo {
  netCents: number;
}

export interface SettlementItem {
  from: MemberInfo;
  to: MemberInfo;
  amountCents: number;
}

export interface FinanceSummary {
  ticketPriceCents: number;
  ticketCount: number;
  ticketIncomeCents: number;
  /** 记账收入（不含门票） */
  incomeCents: number;
  /** 全部记账支出 */
  expenseCents: number;
  /** 门票收入 + 记账收入 − 记账支出 */
  profitCents: number;
  perUser: PerUserNet[];
  settlement: SettlementItem[];
}

/** 整数分下除不尽时，余数按顺序每人多摊 1 分，保证合计精确 */
function splitEvenly(amountCents: number, userIds: string[]): Map<string, number> {
  const n = userIds.length;
  const base = Math.floor(amountCents / n);
  const rem = amountCents - base * n;
  const out = new Map<string, number>();
  userIds.forEach((id, i) => out.set(id, base + (i < rem ? 1 : 0)));
  return out;
}

/**
 * 汇总口径：
 * - 门票收入 = ticketPriceCents × ticketCount，视为项目公款（不挂在任何成员名下）
 * - income 账目视为付款人代收款（净额 −金额）；expense 由付款人垫付（净额 +金额）
 * - splitAmong 非空的支出仅在平摊人之间结算；为空（全员）的支出与门票、收入一起计入公款池
 * - 公款池盈余 = 门票 + 收入 − 全员支出，按全体成员均摊并入净额
 * - 建议转账：净额为负者向为正者转账的贪心结算；成员净额合计与公款（门票）的差额由项目公款补齐
 */
export function buildSummary(
  project: ProjectDoc,
  transactions: TransactionDoc[],
  members: MemberInfo[],
): FinanceSummary {
  const memberIds = members.map((m) => m.userId);
  const net = new Map<string, number>(memberIds.map((id) => [id, 0]));
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);

  const ticketIncomeCents = (project.ticketPriceCents ?? 0) * (project.ticketCount ?? 0);
  let incomeCents = 0;
  let expenseCents = 0;
  let commonExpenseCents = 0;

  for (const t of transactions) {
    const payer = t.payerUserId.toString();
    if (t.type === 'income') {
      incomeCents += t.amountCents;
      add(payer, -t.amountCents);
    } else {
      expenseCents += t.amountCents;
      add(payer, t.amountCents);
      const splitIds = t.splitAmong.map((id) => id.toString());
      if (splitIds.length === 0) {
        commonExpenseCents += t.amountCents;
      } else {
        for (const [id, share] of splitEvenly(t.amountCents, splitIds)) add(id, -share);
      }
    }
  }

  const poolProfitCents = ticketIncomeCents + incomeCents - commonExpenseCents;
  for (const [id, share] of splitEvenly(poolProfitCents, memberIds)) add(id, share);

  const nameOf = new Map(members.map((m) => [m.userId, m.name]));
  const perUser: PerUserNet[] = members.map((m) => ({ ...m, netCents: net.get(m.userId) ?? 0 }));

  const debtors = perUser
    .filter((p) => p.netCents < 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.netCents - b.netCents || a.userId.localeCompare(b.userId));
  const creditors = perUser
    .filter((p) => p.netCents > 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => b.netCents - a.netCents || a.userId.localeCompare(b.userId));

  const settlement: SettlementItem[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(-d.netCents, c.netCents);
    if (amount > 0) {
      settlement.push({
        from: { userId: d.userId, name: nameOf.get(d.userId) ?? '' },
        to: { userId: c.userId, name: nameOf.get(c.userId) ?? '' },
        amountCents: amount,
      });
    }
    d.netCents += amount;
    c.netCents -= amount;
    if (d.netCents === 0) i += 1;
    if (c.netCents === 0) j += 1;
  }

  return {
    ticketPriceCents: project.ticketPriceCents ?? 0,
    ticketCount: project.ticketCount ?? 0,
    ticketIncomeCents,
    incomeCents,
    expenseCents,
    profitCents: ticketIncomeCents + incomeCents - expenseCents,
    perUser,
    settlement,
  };
}
