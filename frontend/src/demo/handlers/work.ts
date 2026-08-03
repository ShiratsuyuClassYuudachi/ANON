import { buildOnsite } from '../aggregate';
import { badRequest, bodyObj, json, membersJson, nameOf, notFound, nowIso, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbWorkAssignee, DbWorkModule } from '../types';
import type { IncidentCategory } from '../../types';

const INCIDENT_CATEGORIES = ['equipment', 'staff', 'material', 'venue', 'safety', 'other'];

function moduleJson(db: Db, m: DbWorkModule) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    location: m.location,
    startAt: m.startAt,
    endAt: m.endAt,
    requiredCount: m.requiredCount,
    assignees: m.assignees.map((a) => ({
      userId: a.userId,
      name: nameOf(db, a.userId),
      confirmedAt: a.confirmedAt,
      confirmedBy: a.confirmedBy,
      checkedInAt: a.checkedInAt,
      completedAt: a.completedAt,
    })),
    createdBy: m.createdBy,
    createdAt: m.createdAt,
  };
}

function findModule(ctx: Ctx): DbWorkModule {
  const { db, params } = ctx;
  const m = db.workModules.find((x) => x.id === params.mid && x.projectId === params.pid);
  if (!m) throw notFound('任务模块不存在');
  return m;
}

/** confirm/checkin/finish 共用：解析目标 assignee（默认当前用户；代他人需 body.userId） */
function resolveTarget(ctx: Ctx): { m: DbWorkModule; a: DbWorkAssignee } {
  const m = findModule(ctx);
  const target = String(bodyObj(ctx).userId ?? ctx.db.currentUserId);
  const a = m.assignees.find((x) => x.userId === target);
  if (!a) throw badRequest('该成员未被分配到此模块');
  return { m, a };
}

interface ModuleBody {
  name?: string;
  description?: string;
  location?: string;
  startAt?: string | null;
  endAt?: string | null;
  requiredCount?: number;
  assigneeIds?: string[];
}

/** 解析并校验模块字段（对齐后端 parseBody）；失败返回 Response */
function parseModuleBody(ctx: Ctx, b: Record<string, unknown>): ModuleBody | Response {
  const out: ModuleBody = {};
  if (b.name !== undefined) {
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 100) return badRequest('名称必填且不超过 100 字');
    out.name = name;
  }
  if (b.description !== undefined) out.description = String(b.description ?? '').trim();
  if (b.location !== undefined) out.location = String(b.location ?? '').trim();
  if (b.startAt !== undefined || b.endAt !== undefined) {
    const s = b.startAt ? new Date(String(b.startAt)) : null;
    const e = b.endAt ? new Date(String(b.endAt)) : null;
    if (s && Number.isNaN(s.getTime())) return badRequest('startAt 非法');
    if (e && Number.isNaN(e.getTime())) return badRequest('endAt 非法');
    if (s && e && s.getTime() > e.getTime()) return badRequest('开始时间不能晚于结束时间');
    out.startAt = s ? s.toISOString() : null;
    out.endAt = e ? e.toISOString() : null;
  }
  if (b.requiredCount !== undefined) {
    const n = Number(b.requiredCount);
    if (!Number.isInteger(n) || n < 1) return badRequest('所需人力须为 ≥1 的整数');
    out.requiredCount = n;
  }
  if (b.assigneeIds !== undefined) {
    if (!Array.isArray(b.assigneeIds)) return badRequest('assigneeIds 须为数组');
    const ids = [...new Set(b.assigneeIds.map(String))];
    const members = ctx.db.memberships.filter((m) => m.projectId === ctx.params.pid);
    if (ids.some((id) => !members.some((m) => m.userId === id))) return badRequest('assigneeIds 含非项目成员');
    out.assigneeIds = ids;
  }
  return out;
}

export const workRoutes: Route[] = [
  def('GET', '/api/projects/:pid/work-modules', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const modules = db.workModules
      .filter((m) => m.projectId === params.pid)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return json({ modules: modules.map((m) => moduleJson(db, m)) });
  }),

  def('POST', '/api/projects/:pid/work-modules', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const p = parseModuleBody(ctx, bodyObj(ctx));
    if (p instanceof Response) return p;
    if (!p.name) return badRequest('名称必填');
    const m: DbWorkModule = {
      id: uid(),
      projectId: params.pid,
      name: p.name,
      description: p.description ?? '',
      location: p.location ?? '',
      startAt: p.startAt ?? null,
      endAt: p.endAt ?? null,
      requiredCount: p.requiredCount ?? 1,
      assignees: (p.assigneeIds ?? []).map((userId) => ({ userId, confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null })),
      createdBy: db.currentUserId,
      createdAt: nowIso(),
    };
    db.workModules.push(m);
    return json({ module: moduleJson(db, m) }, 201);
  }),

  def('PATCH', '/api/projects/:pid/work-modules/:mid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const m = findModule(ctx);
    const p = parseModuleBody(ctx, bodyObj(ctx));
    if (p instanceof Response) return p;
    if (p.name !== undefined) m.name = p.name;
    if (p.description !== undefined) m.description = p.description;
    if (p.location !== undefined) m.location = p.location;
    if (p.startAt !== undefined) m.startAt = p.startAt;
    if (p.endAt !== undefined) m.endAt = p.endAt;
    if (p.requiredCount !== undefined) m.requiredCount = p.requiredCount;
    if (p.assigneeIds !== undefined) {
      // 留任成员保留确认/签到记录，被移除者清除
      m.assignees = p.assigneeIds.map((userId) => {
        const kept = m.assignees.find((a) => a.userId === userId);
        return kept ?? { userId, confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null };
      });
    }
    return json({ module: moduleJson(db, m) });
  }),

  def('DELETE', '/api/projects/:pid/work-modules/:mid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const m = findModule(ctx);
    db.workModules.splice(db.workModules.indexOf(m), 1);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/work-modules/:mid/confirm', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const { m, a } = resolveTarget(ctx);
    if (!a.confirmedAt) {
      a.confirmedAt = nowIso();
      a.confirmedBy = db.currentUserId;
    }
    return json({ module: moduleJson(db, m) });
  }),

  def('POST', '/api/projects/:pid/work-modules/:mid/unconfirm', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const { m, a } = resolveTarget(ctx);
    a.confirmedAt = null;
    a.confirmedBy = null;
    return json({ module: moduleJson(db, m) });
  }),

  def('POST', '/api/projects/:pid/work-modules/:mid/checkin', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const { m, a } = resolveTarget(ctx);
    if (!a.checkedInAt) a.checkedInAt = nowIso();
    return json({ module: moduleJson(db, m) });
  }),

  def('POST', '/api/projects/:pid/work-modules/:mid/finish', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const { m, a } = resolveTarget(ctx);
    if (!a.completedAt) {
      const now = nowIso();
      if (!a.checkedInAt) a.checkedInAt = now;
      a.completedAt = now;
    }
    return json({ module: moduleJson(db, m) });
  }),

  // 任务单打印：buildSheet（Mongo 升序：无 startAt 的排最前，其次 createdAt）
  def('GET', '/api/projects/:pid/work-sheet', async (ctx) => {
    return workSheet(ctx, ctx.db.currentUserId);
  }),

  def('GET', '/api/projects/:pid/work-sheet/:userId', async (ctx) => {
    return workSheet(ctx, ctx.params.userId);
  }),

  // 现场模式
  def('GET', '/api/projects/:pid/onsite', async (ctx) => {
    const { db } = ctx;
    const { project, membership } = requireProject(ctx);
    return json(buildOnsite(db, project, membership.roleName));
  }),

  def('POST', '/api/projects/:pid/onsite/incidents', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    const category = String(b.category ?? '');
    if (!INCIDENT_CATEGORIES.includes(category)) return badRequest(`category 须为 ${INCIDENT_CATEGORIES.join('/')}`);
    const note = String(b.note ?? '').trim();
    if (!note || note.length > 500) return badRequest('备注必填且不超过 500 字');
    let moduleId: string | null = null;
    if (b.moduleId !== undefined && b.moduleId !== null && b.moduleId !== '') {
      const mod = db.workModules.find((m) => m.id === String(b.moduleId) && m.projectId === params.pid);
      if (!mod) return badRequest('关联模块不存在');
      moduleId = mod.id;
    }
    const inc = {
      id: uid(),
      projectId: params.pid,
      moduleId,
      category: category as IncidentCategory,
      note,
      reporterId: db.currentUserId,
      status: 'open' as const,
      createdAt: nowIso(),
    };
    db.incidents.push(inc);
    const moduleName = moduleId ? (db.workModules.find((m) => m.id === moduleId)?.name ?? null) : null;
    return json(
      {
        incident: {
          id: inc.id,
          category: inc.category,
          note: inc.note,
          moduleId: inc.moduleId,
          moduleName,
          reporter: { userId: inc.reporterId, name: nameOf(db, inc.reporterId) },
          status: inc.status,
          createdAt: inc.createdAt,
        },
      },
      201,
    );
  }),
];

async function workSheet(ctx: Ctx, targetUserId: string): Promise<Response> {
  const { db, params } = ctx;
  const { project } = requireProject(ctx);
  const member = membersJson(db, params.pid).find((m) => m.userId === targetUserId);
  if (!member) return notFound('该用户不是项目成员');
  const items = db.workModules
    .filter((m) => m.projectId === params.pid && m.assignees.some((a) => a.userId === targetUserId))
    .sort((a, b) => {
      // Mongo 升序 null 排前
      const at = a.startAt ? new Date(a.startAt).getTime() : null;
      const bt = b.startAt ? new Date(b.startAt).getTime() : null;
      if (at === null && bt === null) return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (at === null) return -1;
      if (bt === null) return 1;
      return at - bt || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  return json({
    project: { id: project.id, name: project.name },
    user: { id: member.userId, name: member.name },
    generatedAt: nowIso(),
    items: items.map((m) => moduleJson(db, m)),
  });
}
