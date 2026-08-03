import { badRequest, bodyObj, currentStageOf, err, json, membersJson, myPermissions, nameOf, notFound, nowIso, requireProject, uid } from '../helpers';
import { projectSummary } from '../aggregate';
import { def, type Route } from '../router';
import type { DbProject, DbStage } from '../types';

function projectJson(p: DbProject) {
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    location: p.location,
    timezone: p.timezone,
    currentStage: currentStageOf(p),
    stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order, completedAt: s.completedAt, note: s.note })),
    roles: p.roles,
    createdBy: p.createdBy,
  };
}

const ALL_PERMISSIONS = [
  'project:manage',
  'member:manage',
  'role:manage',
  'todo:create',
  'todo:manage',
  'todo:complete',
  'file:upload',
  'finance:manage',
  'finance:add',
  'materials:manage',
  'accounts:manage',
  'work:manage',
  'announcement:manage',
];

/** routes/stages.ts stagesJson：变更类端点统一返回 {stages, currentStageIndex} */
function stagesJson(p: DbProject) {
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  return {
    stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order, completedAt: s.completedAt, note: s.note })),
    currentStageIndex: stages.findIndex((s) => !s.completedAt),
  };
}

export const projectRoutes: Route[] = [
  def('GET', '/api/projects', async (ctx) => {
    const { db } = ctx;
    const mine = db.projects.filter((p) =>
      db.memberships.some((m) => m.projectId === p.id && m.userId === db.currentUserId),
    );
    return json({ projects: mine.map((p) => projectSummary(db, p)) });
  }),

  def('POST', '/api/projects', async (ctx) => {
    const { db } = ctx;
    const b = bodyObj(ctx);
    if (!b.name || !String(b.name).trim()) return badRequest('项目名称必填');
    const parseOptDate = (v: unknown) => {
      if (v === undefined || v === null || v === '') return null;
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const id = uid();
    const project: DbProject = {
      id,
      name: String(b.name).trim(),
      description: String(b.description ?? ''),
      status: 'draft',
      startDate: parseOptDate(b.startDate),
      endDate: parseOptDate(b.endDate),
      location: '',
      timezone: 'Asia/Shanghai',
      stages: ['选题', '立项', '宣传', '售票', '筹备', '布展', '现场', '结算'].map(
        (name, i): DbStage => ({ id: `${id}-st${i}`, name, order: i, completedAt: null, note: '' }),
      ),
      roles: [
        { name: '管理者', permissions: [...ALL_PERMISSIONS] },
        { name: '财务', permissions: ['finance:add', 'finance:manage'] },
        { name: '成员', permissions: ['todo:complete', 'file:upload'] },
      ],
      createdBy: db.currentUserId,
      ticketTypes: [],
      ticketPriceCents: 0,
      ticketCount: 0,
    };
    db.projects.push(project);
    db.memberships.push({ projectId: id, userId: db.currentUserId, roleName: '管理者' });
    return json({ project: projectJson(project) }, 201);
  }),

  def('GET', '/api/projects/:pid', async (ctx) => {
    const { db } = ctx;
    const { project, membership } = requireProject(ctx);
    return json({
      project: projectJson(project),
      members: membersJson(db, project.id),
      myRole: membership.roleName,
      myPermissions: [...myPermissions(db, project, membership)],
    });
  }),

  def('PATCH', '/api/projects/:pid', async (ctx) => {
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (b.name !== undefined) project.name = String(b.name).trim();
    if (b.description !== undefined) project.description = String(b.description);
    if (b.startDate !== undefined) project.startDate = b.startDate ? new Date(String(b.startDate)).toISOString() : null;
    if (b.endDate !== undefined) project.endDate = b.endDate ? new Date(String(b.endDate)).toISOString() : null;
    if (b.status !== undefined) project.status = b.status as DbProject['status'];
    if (b.location !== undefined) project.location = String(b.location);
    if (b.timezone !== undefined) project.timezone = String(b.timezone);
    return json({ project: projectJson(project) });
  }),

  // ---- 角色 ----
  def('POST', '/api/projects/:pid/roles', async (ctx) => {
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.name || !Array.isArray(b.permissions)) return badRequest('角色名与权限数组必填');
    const invalid = (b.permissions as unknown[]).map(String).filter((x) => !ALL_PERMISSIONS.includes(x));
    if (invalid.length) return badRequest(`未知权限点: ${invalid.join(',')}`);
    const name = String(b.name);
    if (project.roles.some((r) => r.name === name)) return err(409, 'role_exists', '角色已存在');
    project.roles.push({ name, permissions: (b.permissions as unknown[]).map(String) });
    return json({ roles: project.roles }, 201);
  }),

  def('PATCH', '/api/projects/:pid/roles/:roleName', async (ctx) => {
    const { project } = requireProject(ctx);
    const role = project.roles.find((r) => r.name === ctx.params.roleName);
    if (!role) return notFound('角色不存在');
    const b = bodyObj(ctx);
    if (!Array.isArray(b.permissions)) return badRequest('权限数组必填');
    const invalid = (b.permissions as unknown[]).map(String).filter((x) => !ALL_PERMISSIONS.includes(x));
    if (invalid.length) return badRequest(`未知权限点: ${invalid.join(',')}`);
    role.permissions = (b.permissions as unknown[]).map(String);
    return json({ roles: project.roles });
  }),

  def('DELETE', '/api/projects/:pid/roles/:roleName', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    if (db.memberships.some((m) => m.projectId === project.id && m.roleName === params.roleName)) {
      return err(409, 'role_in_use', '仍有成员使用该角色');
    }
    const before = project.roles.length;
    project.roles = project.roles.filter((r) => r.name !== params.roleName);
    if (project.roles.length === before) return notFound('角色不存在');
    return json({ roles: project.roles });
  }),

  // ---- 成员 ----
  def('PATCH', '/api/projects/:pid/members/:userId', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const { roleName } = bodyObj(ctx);
    if (!project.roles.some((r) => r.name === roleName)) return badRequest('角色不存在');
    const m = db.memberships.find((x) => x.projectId === project.id && x.userId === params.userId);
    if (!m) return notFound('成员不存在');
    m.roleName = String(roleName);
    return json({ members: membersJson(db, project.id) });
  }),

  def('DELETE', '/api/projects/:pid/members/:userId', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    if (params.userId === db.currentUserId) return badRequest('不能移除自己');
    const idx = db.memberships.findIndex((x) => x.projectId === project.id && x.userId === params.userId);
    if (idx < 0) return notFound('成员不存在');
    db.memberships.splice(idx, 1);
    return json({ members: membersJson(db, project.id) });
  }),

  // ---- 项目邀请 ----
  def('POST', '/api/projects/:pid/invites', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    const roleName = String(b.roleName ?? '');
    if (!project.roles.some((r) => r.name === roleName)) return badRequest('角色不存在');
    const targetUserId = b.targetUserId ? String(b.targetUserId) : null;
    if (targetUserId && !db.users.some((u) => u.id === targetUserId)) return badRequest('目标用户不存在');
    const token = crypto.randomUUID().replaceAll('-', '');
    db.invites.push({
      token,
      projectId: project.id,
      roleName,
      targetUserId,
      expiresAt: new Date(Date.now() + Number(b.expiresInHours ?? 72) * 3600000).toISOString(),
    });
    return json({ token, url: `/invite/${token}` }, 201);
  }),

  // ---- 里程碑 ----
  def('GET', '/api/projects/:pid/milestones', async (ctx) => {
    const { db, query } = ctx;
    const { project } = requireProject(ctx);
    const from = query.get('from') ? new Date(query.get('from')!).getTime() : null;
    const to = query.get('to') ? new Date(query.get('to')!).getTime() : null;
    const milestones = db.milestones
      .filter((m) => m.projectId === project.id)
      .filter((m) => (from === null || new Date(m.date).getTime() >= from) && (to === null || new Date(m.date).getTime() <= to))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((m) => {
        const stage = m.stageId ? project.stages.find((s) => s.id === m.stageId) : null;
        return {
          id: m.id,
          title: m.title,
          date: m.date,
          description: m.description,
          stageId: m.stageId,
          stageName: stage?.name ?? null,
          completedAt: m.completedAt,
          createdBy: { userId: m.createdBy, name: nameOf(db, m.createdBy) },
        };
      });
    return json({ milestones });
  }),

  def('POST', '/api/projects/:pid/milestones', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.title || !String(b.title).trim()) return badRequest('标题必填');
    if (!b.date) return badRequest('日期必填');
    const d = new Date(String(b.date));
    if (Number.isNaN(d.getTime())) return badRequest('日期格式无效');
    const milestone = {
      id: uid(),
      projectId: project.id,
      title: String(b.title).trim(),
      date: d.toISOString(),
      description: String(b.description ?? ''),
      stageId: b.stageId ? String(b.stageId) : null,
      completedAt: null,
      createdBy: db.currentUserId,
    };
    db.milestones.push(milestone);
    const stage = milestone.stageId ? project.stages.find((s) => s.id === milestone.stageId) : null;
    return json(
      {
        milestone: {
          id: milestone.id,
          title: milestone.title,
          date: milestone.date,
          description: milestone.description,
          stageId: milestone.stageId,
          stageName: stage?.name ?? null,
          completedAt: null,
          createdBy: { userId: milestone.createdBy, name: nameOf(db, milestone.createdBy) },
        },
      },
      201,
    );
  }),

  // ---- 阶段 ----（reorder 必须排在 :sid 之前，路由器按数组顺序匹配）
  def('POST', '/api/projects/:pid/stages', async (ctx) => {
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.name || !String(b.name).trim()) return badRequest('阶段名称必填');
    const maxOrder = project.stages.length ? Math.max(...project.stages.map((s) => s.order)) : -1;
    project.stages.push({
      id: uid(),
      name: String(b.name).trim(),
      order: typeof b.order === 'number' ? b.order : maxOrder + 1,
      completedAt: null,
      note: '',
    });
    return json(stagesJson(project));
  }),

  def('PATCH', '/api/projects/:pid/stages/reorder', async (ctx) => {
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (!Array.isArray(b.orderedIds) || b.orderedIds.length === 0) return badRequest('orderedIds 必须是非空数组');
    const map = new Map(project.stages.map((s) => [s.id, s]));
    project.stages = (b.orderedIds as unknown[])
      .map((id, i) => {
        const s = map.get(String(id));
        if (s) s.order = i;
        return s;
      })
      .filter((s): s is DbStage => !!s);
    return json(stagesJson(project));
  }),

  def('PATCH', '/api/projects/:pid/stages/:sid', async (ctx) => {
    const { params } = ctx;
    const { project } = requireProject(ctx);
    const s = project.stages.find((x) => x.id === params.sid);
    if (!s) return notFound('阶段不存在');
    const b = bodyObj(ctx);
    if (b.completedAt !== undefined) {
      s.completedAt = b.completedAt === null ? null : new Date(String(b.completedAt)).toISOString();
    }
    if (b.note !== undefined) s.note = String(b.note);
    return json(stagesJson(project));
  }),

  def('DELETE', '/api/projects/:pid/stages/:sid', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    if (project.stages.length <= 1) return err(409, 'conflict', '至少需要保留一个阶段');
    const idx = project.stages.findIndex((x) => x.id === params.sid);
    if (idx < 0) return notFound('阶段不存在');
    project.stages.splice(idx, 1);
    db.milestones.forEach((m) => {
      if (m.projectId === project.id && m.stageId === params.sid) m.stageId = null;
    });
    return json(stagesJson(project));
  }),
];
