import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { fixFilename, upload } from '../middleware/upload';
import { File } from '../models/File';
import { Membership } from '../models/Membership';
import { Transaction, type TransactionDoc } from '../models/Transaction';
import { User } from '../models/User';
import { buildSummary, type MemberInfo } from '../services/finance';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const financeRouter = Router({ mergeParams: true });
financeRouter.use(authRequired, loadMembership);

/** 项目成员（按 userId 排序，保证余数分摊确定性） */
async function projectMembers(projectId: unknown): Promise<MemberInfo[]> {
  const ms = await Membership.find({ projectId }).lean();
  const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  return ms
    .map((m) => ({ userId: m.userId.toString(), name: nameOf.get(m.userId.toString()) ?? '未知' }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

async function txJson(t: TransactionDoc) {
  const ids = [t.payerUserId, t.createdBy, ...t.splitAmong];
  const users = await User.find({ _id: { $in: ids } }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  const files = await File.find({ _id: { $in: t.attachments } }).lean();
  return {
    id: t._id.toString(),
    type: t.type,
    amountCents: t.amountCents,
    note: t.note,
    payer: { userId: t.payerUserId.toString(), name: nameOf.get(t.payerUserId.toString()) ?? '未知' },
    splitAmong: t.splitAmong.map((id) => ({
      userId: id.toString(),
      name: nameOf.get(id.toString()) ?? '未知',
    })),
    createdBy: t.createdBy.toString(),
    createdByName: nameOf.get(t.createdBy.toString()) ?? '未知',
    createdAt: (t as unknown as { createdAt: Date }).createdAt,
    attachments: files.map((f) => ({ id: f._id.toString(), filename: f.filename })),
  };
}

async function assertMembers(projectId: unknown, label: string, userIds: string[]) {
  const count = await Membership.countDocuments({ projectId, userId: { $in: userIds } });
  if (count !== new Set(userIds).size) {
    throw new AppError(400, 'bad_request', `${label}必须是项目成员`);
  }
}

/** 元（最多两位小数）→ 整数分 */
function parseAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(400, 'bad_request', '金额必须为正数');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new AppError(400, 'bad_request', '金额最多两位小数');
  }
  return Math.round(n * 100);
}

/** multipart 表单中 splitAmong 为 JSON 字符串或逗号分隔 */
function parseSplitAmong(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  const s = String(v);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      throw new AppError(400, 'bad_request', 'splitAmong 格式无效');
    }
  }
  return s.split(',').filter(Boolean);
}

function parseType(v: unknown): 'income' | 'expense' {
  if (v !== 'income' && v !== 'expense') {
    throw new AppError(400, 'bad_request', 'type 必须是 income 或 expense');
  }
  return v;
}

async function saveUploads(req: { files?: unknown; project?: { _id: unknown }; userId?: string }) {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  if (!uploaded.length) return [];
  return File.insertMany(
    uploaded.map((f) => ({
      projectId: req.project!._id,
      filename: fixFilename(f.originalname),
      path: f.path,
      mime: f.mimetype,
      size: f.size,
      uploadedBy: req.userId,
    })),
  );
}

financeRouter.get(
  '/',
  ah(async (req, res) => {
    const transactions = await Transaction.find({ projectId: req.project!._id }).sort({
      createdAt: -1,
      _id: -1,
    });
    const members = await projectMembers(req.project!._id);
    res.json({
      transactions: await Promise.all(transactions.map(txJson)),
      summary: buildSummary(req.project!, transactions, members),
    });
  }),
);

financeRouter.post(
  '/',
  ...requirePermission('finance:manage'),
  upload.array('files', 10),
  ah(async (req, res) => {
    const { type, amount, note, payerUserId } = req.body ?? {};
    if (!payerUserId) throw new AppError(400, 'bad_request', '付款人必填');
    const splitAmong = parseSplitAmong(req.body?.splitAmong);
    await assertMembers(req.project!._id, '付款人', [String(payerUserId)]);
    await assertMembers(req.project!._id, '平摊人', splitAmong);
    const fileDocs = await saveUploads(req);
    const tx = await Transaction.create({
      projectId: req.project!._id,
      type: parseType(type),
      amountCents: parseAmount(amount),
      note: String(note ?? ''),
      createdBy: req.userId,
      payerUserId: String(payerUserId),
      splitAmong,
      attachments: fileDocs.map((f) => f._id),
    });
    res.status(201).json({ transaction: await txJson(tx) });
  }),
);

// 注意：/ticket 与 /export 必须注册在 /:txId 之前
financeRouter.patch(
  '/ticket',
  ...requirePermission('finance:manage'),
  ah(async (req, res) => {
    const { ticketPrice, ticketCount } = req.body ?? {};
    const price = Number(ticketPrice);
    if (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
      throw new AppError(400, 'bad_request', '门票价格无效');
    }
    const count = Number(ticketCount);
    if (!Number.isInteger(count) || count < 0) throw new AppError(400, 'bad_request', '售票数量无效');
    req.project!.ticketPriceCents = Math.round(price * 100);
    req.project!.ticketCount = count;
    await req.project!.save();
    res.json({ ticketPriceCents: req.project!.ticketPriceCents, ticketCount: count });
  }),
);

financeRouter.get(
  '/export',
  ah(async (req, res) => {
    const target = String(req.query.userId ?? req.userId);
    const members = await projectMembers(req.project!._id);
    const me = members.find((m) => m.userId === target);
    if (!me) throw new AppError(400, 'bad_request', 'userId 必须是项目成员');
    const all = await Transaction.find({ projectId: req.project!._id }).sort({ createdAt: 1, _id: 1 });
    const related = all.filter(
      (t) =>
        t.payerUserId.toString() === target ||
        t.splitAmong.length === 0 ||
        t.splitAmong.some((id) => id.toString() === target),
    );
    const nameOf = new Map(members.map((m) => [m.userId, m.name]));
    const creators = await User.find({ _id: { $in: related.map((t) => t.createdBy) } }).lean();
    const creatorOf = new Map(creators.map((u) => [u._id.toString(), u.name]));
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = related.map((t) =>
      [
        (t as unknown as { createdAt: Date }).createdAt.toISOString().slice(0, 19).replace('T', ' '),
        t.type === 'income' ? '收入' : '支出',
        (t.amountCents / 100).toFixed(2),
        nameOf.get(t.payerUserId.toString()) ?? '未知',
        t.splitAmong.length === 0
          ? '全员'
          : t.splitAmong.map((id) => nameOf.get(id.toString()) ?? '未知').join('、'),
        t.note,
        creatorOf.get(t.createdBy.toString()) ?? '未知',
      ]
        .map(esc)
        .join(','),
    );
    const csv =
      '\uFEFF' + ['日期,类型,金额(元),付款人,参与平摊,备注,添加人', ...rows].join('\r\n') + '\r\n';


    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="finance-${me.userId}.csv"`,
    );
    res.send(csv);
  }),
);

financeRouter.patch(
  '/:txId',
  ...requirePermission('finance:manage'),
  ah(async (req, res) => {
    const tx = await Transaction.findOne({ _id: req.params.txId, projectId: req.project!._id });
    if (!tx) throw new AppError(404, 'not_found', '账目不存在');
    const { type, amount, note, payerUserId } = req.body ?? {};
    if (type !== undefined) tx.type = parseType(type);
    if (amount !== undefined) tx.amountCents = parseAmount(amount);
    if (note !== undefined) tx.note = String(note);
    if (payerUserId !== undefined) {
      await assertMembers(req.project!._id, '付款人', [String(payerUserId)]);
      tx.payerUserId = String(payerUserId) as never;
    }
    if (req.body?.splitAmong !== undefined) {
      const splitAmong = parseSplitAmong(req.body.splitAmong);
      await assertMembers(req.project!._id, '平摊人', splitAmong);
      tx.splitAmong = splitAmong as never;
    }
    await tx.save();
    res.json({ transaction: await txJson(tx) });
  }),
);

financeRouter.delete(
  '/:txId',
  ...requirePermission('finance:manage'),
  ah(async (req, res) => {
    const r = await Transaction.deleteOne({ _id: req.params.txId, projectId: req.project!._id });
    if (!r.deletedCount) throw new AppError(404, 'not_found', '账目不存在');
    res.json({ ok: true });
  }),
);
