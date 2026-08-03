import { badRequest, bodyObj, json, nameOf, notFound, nowIso, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbPhysicalItem } from '../types';
import type { PhysicalItemStatus } from '../../types';

const STATUSES: PhysicalItemStatus[] = ['planned', 'in_stock', 'in_use', 'returned', 'disposed'];

function itemJson(db: Db, it: DbPhysicalItem) {
  return {
    id: it.id,
    categoryId: it.categoryId,
    name: it.name,
    spec: it.spec,
    unit: it.unit,
    plannedQty: it.plannedQty,
    onHandQty: it.onHandQty,
    usedQty: it.usedQty,
    lostQty: it.lostQty,
    status: it.status,
    responsible: it.responsibleId ? { userId: it.responsibleId, name: nameOf(db, it.responsibleId) } : null,
    location: it.location,
    tags: it.tags,
    note: it.note,
    createdBy: it.createdBy,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  };
}

function findItem(ctx: Ctx): DbPhysicalItem {
  const { db, params } = ctx;
  const it = db.physicalItems.find((x) => x.id === params.iid && x.projectId === params.pid);
  if (!it) throw notFound('物资不存在');
  return it;
}

function nonNegInt(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) throw badRequest(`${field} 必须为非负整数`);
  return n;
}

export const physicalRoutes: Route[] = [
  // /categories/reorder 须先于 /categories/:cid
  def('GET', '/api/projects/:pid/physical/categories', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const categories = db.physicalCategories
      .filter((c) => c.projectId === params.pid)
      .sort((a, b) => a.order - b.order || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((c) => ({ id: c.id, name: c.name, order: c.order }));
    return json({ categories });
  }),

  def('POST', '/api/projects/:pid/physical/categories', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const name = String(bodyObj(ctx).name ?? '').trim();
    if (!name) return badRequest('分类名称不能为空');
    const maxOrder = db.physicalCategories.filter((c) => c.projectId === params.pid).reduce((m, c) => Math.max(m, c.order), -1);
    const c = { id: uid(), projectId: params.pid, name, order: maxOrder + 1, createdAt: nowIso() };
    db.physicalCategories.push(c);
    return json({ category: { id: c.id, name: c.name, order: c.order } }, 201);
  }),

  def('PATCH', '/api/projects/:pid/physical/categories/reorder', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const order = bodyObj(ctx).order;
    if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) return badRequest('order 必须为分类 id 数组');
    for (const [i, id] of (order as string[]).entries()) {
      const c = db.physicalCategories.find((x) => x.id === id && x.projectId === params.pid);
      if (c) c.order = i;
    }
    const categories = db.physicalCategories
      .filter((c) => c.projectId === params.pid)
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ id: c.id, name: c.name, order: c.order }));
    return json({ categories });
  }),

  def('PATCH', '/api/projects/:pid/physical/categories/:cid', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const c = db.physicalCategories.find((x) => x.id === params.cid && x.projectId === params.pid);
    if (!c) return notFound('分类不存在');
    const name = bodyObj(ctx).name;
    if (typeof name === 'string' && name.trim()) c.name = name.trim();
    return json({ category: { id: c.id, name: c.name, order: c.order } });
  }),

  def('DELETE', '/api/projects/:pid/physical/categories/:cid', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const c = db.physicalCategories.find((x) => x.id === params.cid && x.projectId === params.pid);
    if (!c) return notFound('分类不存在');
    if (db.physicalItems.some((it) => it.categoryId === c.id)) return badRequest('该分类下仍有物资，无法删除');
    db.physicalCategories.splice(db.physicalCategories.indexOf(c), 1);
    return json({ ok: true });
  }),

  def('GET', '/api/projects/:pid/physical/items', async (ctx) => {
    const { db, params, query } = ctx;
    requireProject(ctx);
    const categoryId = query.get('categoryId');
    const status = query.get('status');
    const responsibleId = query.get('responsibleId');
    const tag = query.get('tag');
    const sortField = query.get('sort') === 'status' ? 'status' : query.get('sort') === 'plannedQty' ? 'plannedQty' : 'name';
    const dir = query.get('order') === 'desc' ? -1 : 1;
    const items = db.physicalItems
      .filter((it) => it.projectId === params.pid)
      .filter((it) => !categoryId || it.categoryId === categoryId)
      .filter((it) => !status || it.status === status)
      .filter((it) => !responsibleId || it.responsibleId === responsibleId)
      .filter((it) => !tag || it.tags.includes(tag))
      .sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return cmp * dir || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    return json({ items: items.map((it) => itemJson(db, it)) });
  }),

  def('POST', '/api/projects/:pid/physical/items', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    const name = String(b.name ?? '').trim();
    if (!name) return badRequest('物资名称不能为空');
    const categoryId = String(b.categoryId ?? '');
    if (!db.physicalCategories.some((c) => c.id === categoryId && c.projectId === params.pid)) return badRequest('分类不存在');
    const responsibleId = b.responsibleId ? String(b.responsibleId) : null;
    if (responsibleId && !db.memberships.some((m) => m.projectId === params.pid && m.userId === responsibleId)) {
      return badRequest('负责人必须是项目成员');
    }
    const it: DbPhysicalItem = {
      id: uid(),
      projectId: params.pid,
      categoryId,
      name,
      spec: String(b.spec ?? '').trim(),
      unit: String(b.unit ?? '个').trim() || '个',
      plannedQty: nonNegInt(b.plannedQty ?? 0, '计划数量'),
      onHandQty: nonNegInt(b.onHandQty ?? 0, '在库数量'),
      usedQty: nonNegInt(b.usedQty ?? 0, '使用数量'),
      lostQty: nonNegInt(b.lostQty ?? 0, '损耗数量'),
      status: STATUSES.includes(b.status as PhysicalItemStatus) ? (b.status as PhysicalItemStatus) : 'planned',
      responsibleId,
      location: String(b.location ?? '').trim(),
      tags: Array.isArray(b.tags) ? b.tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [],
      note: String(b.note ?? '').trim(),
      createdBy: db.currentUserId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.physicalItems.push(it);
    return json({ item: itemJson(db, it) }, 201);
  }),

  def('PATCH', '/api/projects/:pid/physical/items/:iid', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const it = findItem(ctx);
    const b = bodyObj(ctx);
    if (typeof b.name === 'string' && b.name.trim()) it.name = b.name.trim();
    if (typeof b.spec === 'string') it.spec = b.spec.trim();
    if (typeof b.unit === 'string' && b.unit.trim()) it.unit = b.unit.trim();
    if (b.plannedQty !== undefined) it.plannedQty = nonNegInt(b.plannedQty, '计划数量');
    if (b.onHandQty !== undefined) it.onHandQty = nonNegInt(b.onHandQty, '在库数量');
    if (b.usedQty !== undefined) it.usedQty = nonNegInt(b.usedQty, '使用数量');
    if (b.lostQty !== undefined) it.lostQty = nonNegInt(b.lostQty, '损耗数量');
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status as PhysicalItemStatus)) return badRequest('状态无效');
      it.status = b.status as PhysicalItemStatus;
    }
    if (b.location !== undefined) it.location = String(b.location).trim();
    if (b.note !== undefined) it.note = String(b.note).trim();
    if (Array.isArray(b.tags)) it.tags = b.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
    if (b.responsibleId !== undefined) {
      if (b.responsibleId === null || b.responsibleId === '') it.responsibleId = null;
      else {
        const rid = String(b.responsibleId);
        if (!db.memberships.some((m) => m.projectId === params.pid && m.userId === rid)) return badRequest('负责人必须是项目成员');
        it.responsibleId = rid;
      }
    }
    if (b.categoryId !== undefined) {
      if (!db.physicalCategories.some((c) => c.id === b.categoryId && c.projectId === params.pid)) return badRequest('分类不存在');
      it.categoryId = String(b.categoryId);
    }
    it.updatedAt = nowIso();
    return json({ item: itemJson(db, it) });
  }),

  def('DELETE', '/api/projects/:pid/physical/items/:iid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const it = findItem(ctx);
    db.physicalLogs = db.physicalLogs.filter((l) => l.itemId !== it.id);
    db.physicalItems.splice(db.physicalItems.indexOf(it), 1);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/physical/items/:iid/log', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const it = findItem(ctx);
    const b = bodyObj(ctx);
    const type = String(b.type ?? '');
    const note = String(b.note ?? '').trim();
    if (!['adjust_on_hand', 'adjust_used', 'adjust_lost', 'status_change'].includes(type)) return badRequest('日志类型无效');
    if (type === 'status_change') {
      const status = b.status as PhysicalItemStatus;
      if (!STATUSES.includes(status)) return badRequest('状态无效');
      it.status = status;
      it.updatedAt = nowIso();
      db.physicalLogs.push({ id: uid(), projectId: params.pid, itemId: it.id, type, qty: 0, status, note, operatorId: db.currentUserId, createdAt: nowIso() });
    } else {
      const delta = Number(b.delta);
      if (!Number.isFinite(delta) || Math.floor(delta) !== delta) return badRequest('变动量必须为整数');
      const field = type === 'adjust_on_hand' ? 'onHandQty' : type === 'adjust_used' ? 'usedQty' : 'lostQty';
      if (it[field] + delta < 0) return badRequest('数量不能为负');
      it[field] += delta;
      it.updatedAt = nowIso();
      db.physicalLogs.push({ id: uid(), projectId: params.pid, itemId: it.id, type, qty: delta, status: null, note, operatorId: db.currentUserId, createdAt: nowIso() });
    }
    return json({ item: itemJson(db, it) });
  }),

  def('GET', '/api/projects/:pid/physical/items/:iid/logs', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const it = findItem(ctx);
    const logs = db.physicalLogs
      .filter((l) => l.itemId === it.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)
      .map((l) => ({
        id: l.id,
        type: l.type,
        qty: l.qty,
        status: l.status,
        note: l.note,
        operator: { userId: l.operatorId, name: nameOf(db, l.operatorId) },
        createdAt: l.createdAt,
      }));
    return json({ logs });
  }),

  // 不带信封的 PhysicalSummary（与后端一致）
  def('GET', '/api/projects/:pid/physical/summary', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const items = db.physicalItems.filter((it) => it.projectId === params.pid);
    const total = { planned: 0, onHand: 0, used: 0, lost: 0, count: items.length };
    const byCategory = new Map<string, { planned: number; onHand: number; used: number; lost: number; count: number }>();
    for (const it of items) {
      total.planned += it.plannedQty;
      total.onHand += it.onHandQty;
      total.used += it.usedQty;
      total.lost += it.lostQty;
      const c = byCategory.get(it.categoryId) ?? { planned: 0, onHand: 0, used: 0, lost: 0, count: 0 };
      c.planned += it.plannedQty;
      c.onHand += it.onHandQty;
      c.used += it.usedQty;
      c.lost += it.lostQty;
      c.count += 1;
      byCategory.set(it.categoryId, c);
    }
    return json({ total, byCategory: [...byCategory.entries()].map(([categoryId, v]) => ({ categoryId, ...v })) });
  }),
];
