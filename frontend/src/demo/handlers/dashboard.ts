import { badRequest, bodyObj, err, json, myPermissions, notFound, nowIso, requireProject } from '../helpers';
import { buildDashboard, computeHealth, prefsOf, riskJsonFull, sortRisks } from '../aggregate';
import { def, type Route } from '../router';

export const dashboardRoutes: Route[] = [
  def('GET', '/api/projects/:pid/dashboard', async (ctx) => {
    const { db, query } = ctx;
    const { project, membership } = requireProject(ctx);
    const scheduleDays = Number(query.get('scheduleDays')) || 0;
    return json(buildDashboard(db, project, membership.roleName, myPermissions(db, project, membership), scheduleDays));
  }),

  def('GET', '/api/projects/:pid/dashboard/preferences', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    return json(prefsOf(db, project.id));
  }),

  def('PATCH', '/api/projects/:pid/dashboard/preferences', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (b.defaultView !== undefined && b.defaultView !== 'personal' && b.defaultView !== 'project') {
      return badRequest('defaultView 无效');
    }
    if (b.scheduleRange !== undefined && b.scheduleRange !== 7 && b.scheduleRange !== 30) {
      return badRequest('scheduleRange 必须是 7 或 30');
    }
    let doc = db.dashboardPreferences.find((x) => x.projectId === project.id && x.userId === db.currentUserId);
    if (!doc) {
      doc = { userId: db.currentUserId, projectId: project.id, ...prefsOf(db, project.id) };
      db.dashboardPreferences.push(doc);
    }
    if (b.defaultView !== undefined) doc.defaultView = b.defaultView as 'personal' | 'project';
    if (Array.isArray(b.collapsedCards)) doc.collapsedCards = b.collapsedCards.map(String).slice(0, 20);
    if (Array.isArray(b.hiddenCards)) doc.hiddenCards = b.hiddenCards.map(String).slice(0, 20);
    if (b.scheduleRange !== undefined) doc.scheduleRange = b.scheduleRange as 7 | 30;
    if (Array.isArray(b.cardOrder)) doc.cardOrder = b.cardOrder.map(String).slice(0, 20);
    return json(prefsOf(db, project.id));
  }),

  // R4：active + ignored 全字段，level 降序后 lastDetectedAt 降序
  def('GET', '/api/projects/:pid/risks', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const risks = sortRisks(
      db.risks.filter((r) => r.projectId === project.id && (r.status === 'active' || r.status === 'ignored')),
    );
    const health = computeHealth(risks.filter((r) => r.status === 'active').map((r) => r.level));
    return json({ risks: risks.map(riskJsonFull), health });
  }),

  def('POST', '/api/projects/:pid/risks/:rid/ignore', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const risk = db.risks.find((r) => r.id === params.rid && r.projectId === project.id);
    if (!risk) return notFound('风险不存在');
    if (risk.status !== 'active') return badRequest('只能忽略生效中的风险');
    const b = bodyObj(ctx);
    if (!b.reason || !String(b.reason).trim()) return badRequest('忽略原因必填');
    risk.status = 'ignored';
    risk.ignoredBy = db.currentUserId;
    risk.ignoreReason = String(b.reason).trim();
    risk.ignoredUntil = b.ignoredUntil ? new Date(String(b.ignoredUntil)).toISOString() : null;
    return json({ risk: riskJsonFull(risk) });
  }),

  def('POST', '/api/projects/:pid/risks/:rid/restore', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const risk = db.risks.find((r) => r.id === params.rid && r.projectId === project.id);
    if (!risk) return notFound('风险不存在');
    if (risk.status !== 'ignored') return badRequest('只能恢复已忽略的风险');
    risk.status = 'active';
    risk.ignoredBy = null;
    risk.ignoredUntil = null;
    risk.ignoreReason = null;
    return json({ risk: riskJsonFull(risk) });
  }),

  def('POST', '/api/projects/:pid/announcements/:aid/confirm', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const a = db.announcements.find((x) => x.id === params.aid && x.projectId === project.id);
    if (!a) return notFound('公告不存在');
    if (!a.confirmedBy.includes(db.currentUserId)) a.confirmedBy.push(db.currentUserId);
    return json({ ok: true, confirmedAt: nowIso() });
  }),

  // 未实现的管理端点统一提示（发布公告/删除公告等在演示环境只读）
  def('POST', '/api/projects/:pid/announcements', async () => err(403, 'demo_readonly', '演示环境公告为示例数据，不支持新建')),
];
