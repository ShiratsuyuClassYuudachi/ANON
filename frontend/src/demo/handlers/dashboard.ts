import { badRequest, bodyObj, canSee, json, membersJson, myPermissions, notFound, nowIso, parseVis, requireProject, uid } from '../helpers';
import { announcementJson, buildDashboard, computeHealth, prefsOf, riskJsonFull, sortRisks } from '../aggregate';
import { def, type Route } from '../router';
import type { DbAnnouncement } from '../types';

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

  // 管理列表：镜像后端 GET /announcements（对管理者同样按可见范围过滤，total 取分页前长度）
  def('GET', '/api/projects/:pid/announcements', async (ctx) => {
    const { db, query } = ctx;
    const { project, membership } = requireProject(ctx);
    const page = Math.max(1, Number(query.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.get('limit')) || 20));
    const includeExpired = query.get('includeExpired') === 'true';
    const now = Date.now();
    const visible = db.announcements
      .filter((a) => a.projectId === project.id)
      .filter((a) => includeExpired || !a.expiresAt || new Date(a.expiresAt).getTime() > now)
      .filter((a) => canSee(a.visibility, db.currentUserId, membership.roleName))
      .sort(
        (a, b) =>
          Number(b.isPinned) - Number(a.isPinned) ||
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
    const total = visible.length;
    const pageItems = visible.slice((page - 1) * limit, page * limit);
    return json({ announcements: pageItems.map((a) => announcementJson(db, a)), total, page });
  }),

  def('POST', '/api/projects/:pid/announcements', async (ctx) => {
    const { db } = ctx;
    const { project } = requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.title || !String(b.title).trim()) return badRequest('标题必填');
    const t = String(b.type);
    const a: DbAnnouncement = {
      id: uid(),
      projectId: project.id,
      title: String(b.title).trim(),
      content: String(b.content ?? ''),
      type: ['normal', 'important', 'emergency'].includes(t) ? (t as DbAnnouncement['type']) : 'normal',
      isPinned: !!b.isPinned,
      requireConfirmation: !!b.requireConfirmation,
      visibility: parseVis(b.visibility),
      publishedBy: db.currentUserId,
      publishedAt: nowIso(),
      expiresAt: b.expiresAt ? new Date(String(b.expiresAt)).toISOString() : null,
      confirmedBy: [],
    };
    db.announcements.push(a);
    return json({ announcement: { id: a.id, title: a.title } }, 201);
  }),

  def('PATCH', '/api/projects/:pid/announcements/:aid', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const a = db.announcements.find((x) => x.id === params.aid && x.projectId === project.id);
    if (!a) return notFound('公告不存在');
    const b = bodyObj(ctx);
    if (b.title !== undefined) a.title = String(b.title).trim();
    if (b.content !== undefined) a.content = String(b.content);
    if (b.type !== undefined && ['normal', 'important', 'emergency'].includes(String(b.type))) {
      a.type = String(b.type) as DbAnnouncement['type'];
    }
    if (b.isPinned !== undefined) a.isPinned = !!b.isPinned;
    if (b.requireConfirmation !== undefined) a.requireConfirmation = !!b.requireConfirmation;
    if (b.visibility !== undefined) a.visibility = parseVis(b.visibility);
    if (b.expiresAt !== undefined) a.expiresAt = b.expiresAt ? new Date(String(b.expiresAt)).toISOString() : null;
    return json({ ok: true });
  }),

  def('DELETE', '/api/projects/:pid/announcements/:aid', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const idx = db.announcements.findIndex((x) => x.id === params.aid && x.projectId === project.id);
    if (idx < 0) return notFound('公告不存在');
    db.announcements.splice(idx, 1);
    return json({ ok: true });
  }),

  def('GET', '/api/projects/:pid/announcements/:aid/confirmations', async (ctx) => {
    const { db, params } = ctx;
    const { project } = requireProject(ctx);
    const a = db.announcements.find((x) => x.id === params.aid && x.projectId === project.id);
    if (!a) return notFound('公告不存在');
    const members = membersJson(db, project.id);
    const confirmed = members.filter((m) => a.confirmedBy.includes(m.userId)).map((m) => ({ userId: m.userId, name: m.name }));
    const unconfirmed = members.filter((m) => !a.confirmedBy.includes(m.userId)).map((m) => ({ userId: m.userId, name: m.name }));
    return json({ confirmed, unconfirmed });
  }),
];
