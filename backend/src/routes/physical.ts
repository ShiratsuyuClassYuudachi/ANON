import { Router, type Request } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { PhysicalCategory, DEFAULT_PHYSICAL_CATEGORIES } from '../models/PhysicalCategory';
import { PhysicalItem, PHYSICAL_ITEM_STATUSES, type PhysicalItemStatus } from '../models/PhysicalItem';
import { PhysicalItemLog } from '../models/PhysicalItemLog';
import { User } from '../models/User';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const physicalRouter = Router({ mergeParams: true });
physicalRouter.use(authRequired, loadMembership);

// ---------- helpers ----------

function categoryJson(c: { _id: { toString(): string }; name: string; order: number }) {
  return { id: c._id.toString(), name: c.name, order: c.order };
}

async function itemJson(it: { _id: { toString(): string }; categoryId: { toString(): string }; name: string; spec: string; unit: string; plannedQty: number; onHandQty: number; usedQty: number; lostQty: number; status: string; responsibleId?: Types.ObjectId | null; location: string; tags: string[]; note: string; createdBy: { toString(): string }; createdAt?: Date; updatedAt?: Date }, nameMap: Map<string, string>) {
  return {
    id: it._id.toString(),
    categoryId: it.categoryId.toString(),
    name: it.name,
    spec: it.spec,
    unit: it.unit,
    plannedQty: it.plannedQty,
    onHandQty: it.onHandQty,
    usedQty: it.usedQty,
    lostQty: it.lostQty,
    status: it.status,
    responsible: it.responsibleId
      ? { userId: it.responsibleId.toString(), name: nameMap.get(it.responsibleId.toString()) ?? '未知' }
      : null,
    location: it.location,
    tags: it.tags,
    note: it.note,
    createdBy: it.createdBy.toString(),
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  };
}

async function memberNameMap(projectId: unknown, userIds: (Types.ObjectId | string)[]) {
  const ids = [...new Set(userIds.map((u) => u.toString()))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await User.find({ _id: { $in: ids } }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

function assertNonNegInt(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new AppError(400, 'bad_request', `${field} 必须为非负整数`);
  }
  return n;
}

// ---------- 分类 ----------

/** 首次访问时若项目无任何分类，自动填充默认分类（懒初始化） */
async function ensureDefaultCategories(projectId: Types.ObjectId) {
  const count = await PhysicalCategory.countDocuments({ projectId });
  if (count > 0) return;
  await PhysicalCategory.insertMany(
    DEFAULT_PHYSICAL_CATEGORIES.map((name, i) => ({ projectId, name, order: i })),
  );
}

physicalRouter.get(
  '/categories',
  ah(async (req, res) => {
    await ensureDefaultCategories(req.project!._id);
    const docs = await PhysicalCategory.find({ projectId: req.project!._id }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ categories: docs.map(categoryJson) });
  }),
);

physicalRouter.post(
  '/categories',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '分类名称不能为空');
    const maxOrder = await PhysicalCategory.findOne({ projectId: req.project!._id }).sort({ order: -1 }).lean();
    const doc = await PhysicalCategory.create({
      projectId: req.project!._id,
      name,
      order: (maxOrder?.order ?? -1) + 1,
    });
    res.status(201).json({ category: categoryJson(doc) });
  }),
);

// 注意：/categories/reorder 必须注册在 /categories/:catId 之前，否则会被 :catId 捕获
physicalRouter.patch(
  '/categories/reorder',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) {
      throw new AppError(400, 'bad_request', 'order 必须为分类 id 数组');
    }
    const ids = order as string[];
    await Promise.all(
      ids.map((id, i) =>
        PhysicalCategory.updateOne({ _id: id, projectId: req.project!._id }, { $set: { order: i } }),
      ),
    );
    const docs = await PhysicalCategory.find({ projectId: req.project!._id }).sort({ order: 1 }).lean();
    res.json({ categories: docs.map(categoryJson) });
  }),
);

physicalRouter.patch(
  '/categories/:catId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const doc = await PhysicalCategory.findOne({ _id: req.params.catId, projectId: req.project!._id });
    if (!doc) throw new AppError(404, 'not_found', '分类不存在');
    if (typeof req.body?.name === 'string' && req.body.name.trim()) doc.name = req.body.name.trim();
    await doc.save();
    res.json({ category: categoryJson(doc) });
  }),
);

physicalRouter.delete(
  '/categories/:catId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const doc = await PhysicalCategory.findOne({ _id: req.params.catId, projectId: req.project!._id });
    if (!doc) throw new AppError(404, 'not_found', '分类不存在');
    const used = await PhysicalItem.countDocuments({ projectId: req.project!._id, categoryId: doc._id });
    if (used > 0) throw new AppError(400, 'bad_request', '该分类下仍有物资，无法删除');
    await doc.deleteOne();
    res.json({ ok: true });
  }),
);

// ---------- 物资条目 ----------

physicalRouter.get(
  '/items',
  ah(async (req, res) => {
    const { categoryId, status, responsibleId, tag, sort, order } = req.query;
    const filter: Record<string, unknown> = { projectId: req.project!._id };
    if (categoryId) {
      const cid = String(categoryId);
      // 原值进 Mongo filter 可注入操作符（qs 可传 {$ne:...}）；先校验 ObjectId
      if (!isValidObjectId(cid)) throw new AppError(400, 'bad_request', '筛选参数无效');
      filter.categoryId = cid;
    }
    if (status && PHYSICAL_ITEM_STATUSES.includes(status as PhysicalItemStatus)) filter.status = status;
    if (responsibleId) {
      const rid = String(responsibleId);
      if (!isValidObjectId(rid)) throw new AppError(400, 'bad_request', '筛选参数无效');
      filter.responsibleId = rid;
    }
    if (tag) filter.tags = String(tag);

    const sortField = sort === 'status' ? 'status' : sort === 'plannedQty' ? 'plannedQty' : 'name';
    const sortDir = order === 'desc' ? -1 : 1;

    const docs = await PhysicalItem.find(filter).sort({ [sortField]: sortDir, createdAt: -1 }).lean();

    const respIds = docs.map((d) => d.responsibleId).filter((x): x is Types.ObjectId => !!x);
    const nameMap = await memberNameMap(req.project!._id, respIds);

    res.json({ items: await Promise.all(docs.map((d) => itemJson(d as InstanceType<typeof PhysicalItem>, nameMap))) });
  }),
);

physicalRouter.post(
  '/items',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError(400, 'bad_request', '物资名称不能为空');
    const categoryId = b.categoryId;
    if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
      throw new AppError(400, 'bad_request', '分类无效');
    }
    const cat = await PhysicalCategory.findOne({ _id: categoryId, projectId: req.project!._id });
    if (!cat) throw new AppError(400, 'bad_request', '分类不存在');

    const responsibleId = b.responsibleId ? String(b.responsibleId) : undefined;
    if (responsibleId) {
      const m = await Membership.countDocuments({ projectId: req.project!._id, userId: responsibleId });
      if (!m) throw new AppError(400, 'bad_request', '负责人必须是项目成员');
    }

    const doc = await PhysicalItem.create({
      projectId: req.project!._id,
      categoryId,
      name,
      spec: String(b.spec ?? '').trim(),
      unit: String(b.unit ?? '个').trim() || '个',
      plannedQty: assertNonNegInt(b.plannedQty ?? 0, '计划数量'),
      onHandQty: assertNonNegInt(b.onHandQty ?? 0, '在库数量'),
      usedQty: assertNonNegInt(b.usedQty ?? 0, '使用数量'),
      lostQty: assertNonNegInt(b.lostQty ?? 0, '损耗数量'),
      status: PHYSICAL_ITEM_STATUSES.includes(b.status) ? b.status : 'planned',
      responsibleId: responsibleId ? new Types.ObjectId(responsibleId) : undefined,
      location: String(b.location ?? '').trim(),
      tags: Array.isArray(b.tags) ? b.tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [],
      note: String(b.note ?? '').trim(),
      createdBy: req.userId,
    });

    const nameMap = responsibleId ? await memberNameMap(req.project!._id, [responsibleId]) : new Map<string, string>();
    res.status(201).json({ item: await itemJson(doc, nameMap) });
  }),
);

async function loadItem(req: Request) {
  const it = await PhysicalItem.findOne({ _id: req.params.itemId, projectId: req.project!._id });
  if (!it) throw new AppError(404, 'not_found', '物资不存在');
  return it;
}

physicalRouter.get(
  '/items/:itemId',
  ah(async (req, res) => {
    const it = await loadItem(req);
    const nameMap = it.responsibleId ? await memberNameMap(req.project!._id, [it.responsibleId]) : new Map<string, string>();
    res.json({ item: await itemJson(it, nameMap) });
  }),
);

physicalRouter.patch(
  '/items/:itemId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const it = await loadItem(req);
    const b = req.body ?? {};
    if (typeof b.name === 'string' && b.name.trim()) it.name = b.name.trim();
    if (typeof b.spec === 'string') it.spec = b.spec.trim();
    if (typeof b.unit === 'string' && b.unit.trim()) it.unit = b.unit.trim();
    if (b.plannedQty !== undefined) it.plannedQty = assertNonNegInt(b.plannedQty, '计划数量');
    if (b.onHandQty !== undefined) it.onHandQty = assertNonNegInt(b.onHandQty, '在库数量');
    if (b.usedQty !== undefined) it.usedQty = assertNonNegInt(b.usedQty, '使用数量');
    if (b.lostQty !== undefined) it.lostQty = assertNonNegInt(b.lostQty, '损耗数量');
    if (b.status !== undefined) {
      if (!PHYSICAL_ITEM_STATUSES.includes(b.status)) throw new AppError(400, 'bad_request', '状态无效');
      it.status = b.status;
    }
    if (b.location !== undefined) it.location = String(b.location).trim();
    if (b.note !== undefined) it.note = String(b.note).trim();
    if (Array.isArray(b.tags)) it.tags = b.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
    if (b.responsibleId !== undefined) {
      if (b.responsibleId === null || b.responsibleId === '') {
        it.responsibleId = undefined as unknown as Types.ObjectId;
      } else {
        const rid = String(b.responsibleId);
        const m = await Membership.countDocuments({ projectId: req.project!._id, userId: rid });
        if (!m) throw new AppError(400, 'bad_request', '负责人必须是项目成员');
        it.responsibleId = new Types.ObjectId(rid);
      }
    }
    if (b.categoryId !== undefined) {
      const cat = await PhysicalCategory.findOne({ _id: b.categoryId, projectId: req.project!._id });
      if (!cat) throw new AppError(400, 'bad_request', '分类不存在');
      it.categoryId = cat._id;
    }
    await it.save();
    const nameMap = it.responsibleId ? await memberNameMap(req.project!._id, [it.responsibleId]) : new Map<string, string>();
    res.json({ item: await itemJson(it, nameMap) });
  }),
);

physicalRouter.delete(
  '/items/:itemId',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const it = await loadItem(req);
    await PhysicalItemLog.deleteMany({ itemId: it._id });
    await it.deleteOne();
    res.json({ ok: true });
  }),
);

// ---------- 数量变动 / 日志 ----------

physicalRouter.post(
  '/items/:itemId/log',
  ...requirePermission('materials:manage'),
  ah(async (req, res) => {
    const it = await loadItem(req);
    const b = req.body ?? {};
    const type = String(b.type ?? '');
    const note = String(b.note ?? '').trim();
    if (!['adjust_on_hand', 'adjust_used', 'adjust_lost', 'status_change'].includes(type)) {
      throw new AppError(400, 'bad_request', '日志类型无效');
    }

    if (type === 'status_change') {
      const newStatus = b.status;
      if (!PHYSICAL_ITEM_STATUSES.includes(newStatus)) throw new AppError(400, 'bad_request', '状态无效');
      it.status = newStatus;
      await it.save();
      await PhysicalItemLog.create({ itemId: it._id, projectId: req.project!._id, type, qty: 0, status: newStatus, note, operatorId: req.userId });
    } else {
      const delta = Number(b.delta);
      if (!Number.isFinite(delta) || Math.floor(delta) !== delta) {
        throw new AppError(400, 'bad_request', '变动量必须为整数');
      }
      const field = type === 'adjust_on_hand' ? 'onHandQty' : type === 'adjust_used' ? 'usedQty' : 'lostQty';
      const next = it[field] + delta;
      if (next < 0) throw new AppError(400, 'bad_request', '数量不能为负');
      it[field] = next;
      await it.save();
      await PhysicalItemLog.create({ itemId: it._id, projectId: req.project!._id, type, qty: delta, note, operatorId: req.userId });
    }

    const nameMap = it.responsibleId ? await memberNameMap(req.project!._id, [it.responsibleId]) : new Map<string, string>();
    res.json({ item: await itemJson(it, nameMap) });
  }),
);

physicalRouter.get(
  '/items/:itemId/logs',
  ah(async (req, res) => {
    const it = await loadItem(req);
    const docs = await PhysicalItemLog.find({ itemId: it._id }).sort({ createdAt: -1 }).limit(100).lean();
    const nameMap = await memberNameMap(req.project!._id, docs.map((d) => d.operatorId));
    res.json({
      logs: docs.map((d) => {
        // lean() 的返回类型不含 timestamps 字段，运行时实际存在
        const createdAt = (d as unknown as { createdAt: Date }).createdAt;
        return {
          id: d._id.toString(),
          type: d.type,
          qty: d.qty,
          status: d.status ?? null,
          note: d.note,
          operator: { userId: d.operatorId.toString(), name: nameMap.get(d.operatorId.toString()) ?? '未知' },
          createdAt,
        };
      }),
    });
  }),
);

// ---------- 汇总 ----------

physicalRouter.get(
  '/summary',
  ah(async (req, res) => {
    const items = await PhysicalItem.find({ projectId: req.project!._id }).lean();
    const total = { planned: 0, onHand: 0, used: 0, lost: 0, count: items.length };
    const byCategory = new Map<string, { planned: number; onHand: number; used: number; lost: number; count: number }>();
    for (const it of items) {
      total.planned += it.plannedQty;
      total.onHand += it.onHandQty;
      total.used += it.usedQty;
      total.lost += it.lostQty;
      const key = it.categoryId.toString();
      const c = byCategory.get(key) ?? { planned: 0, onHand: 0, used: 0, lost: 0, count: 0 };
      c.planned += it.plannedQty;
      c.onHand += it.onHandQty;
      c.used += it.usedQty;
      c.lost += it.lostQty;
      c.count += 1;
      byCategory.set(key, c);
    }
    res.json({
      total,
      byCategory: [...byCategory.entries()].map(([categoryId, v]) => ({ categoryId, ...v })),
    });
  }),
);
