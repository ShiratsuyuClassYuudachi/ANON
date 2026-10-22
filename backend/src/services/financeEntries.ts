import type { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import { Transaction } from '../models/Transaction';
import { AppError } from '../utils/errors';
import { logActivity } from './activity';

/** 元转整数分；机器人与网页共用金额边界，拒绝超出安全整数范围。 */
export function parseFinanceAmount(value: unknown): number {
  // AI 返回十进制字符串，直接按位转分，避免大金额在乘以 100 前已丢失分位。
  if (typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    const [whole, fraction = ''] = value.trim().split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents < 1n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError(400, 'bad_request', '金额必须为有效正数');
    return Number(cents);
  }
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents)) {
    throw new AppError(400, 'bad_request', '金额必须为有效正数');
  }
  if (Math.abs(amount * 100 - cents) > 1e-6) throw new AppError(400, 'bad_request', '金额最多两位小数');
  return cents;
}

export async function createFinanceEntry(input: {
  projectId: Types.ObjectId; userId: string; userName: string;
  type: 'income' | 'expense'; amountCents: number; note: string;
  payerUserId: string; splitAmong: string[]; attachments?: Types.ObjectId[];
}) {
  if (!['income', 'expense'].includes(input.type) || !Number.isSafeInteger(input.amountCents) || input.amountCents < 1) {
    throw new AppError(400, 'bad_request', '收支类型或金额无效');
  }
  const ids = [...new Set([input.payerUserId, ...input.splitAmong])];
  if (await Membership.countDocuments({ projectId: input.projectId, userId: { $in: ids } }) !== ids.length) {
    throw new AppError(400, 'bad_request', '付款人及平摊人必须是项目成员，请重新发送完整记账内容');
  }
  const tx = await Transaction.create({
    projectId: input.projectId, type: input.type, amountCents: input.amountCents, note: input.note,
    createdBy: input.userId, payerUserId: input.payerUserId,
    splitAmong: [...new Set(input.splitAmong)], attachments: input.attachments ?? [],
  });
  logActivity({ projectId: input.projectId, actorId: input.userId, type: 'finance:create',
    message: `${input.userName}添加了一笔${tx.type === 'income' ? '收入' : '支出'}记录`,
    sourceType: 'finance', sourceId: tx._id, permissionGate: 'finance:manage' });
  return tx;
}
