import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership } from '../middleware/projectAccess';
import { Activity } from '../models/Activity';
import { Announcement } from '../models/Announcement';
import { AnnouncementConfirmation } from '../models/AnnouncementConfirmation';
import { DashboardPreference } from '../models/DashboardPreference';
import { RiskInstance } from '../models/RiskInstance';
import { User } from '../models/User';
import { buildMyActions, buildSchedule, buildSummary } from '../services/dashboard';
import { computeHealth } from '../services/risk';
import { canSee, type Viewer } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.use(authRequired, loadMembership);

function riskJson(r: InstanceType<typeof RiskInstance>) {
  return {
    id: String(r._id),
    ruleCode: r.ruleCode,
    level: r.level,
    sourceType: r.sourceType,
    sourceId: r.sourceId ? String(r.sourceId) : null,
    title: r.title,
    description: r.description,
    status: r.status,
    firstDetectedAt: r.firstDetectedAt.toISOString(),
    lastDetectedAt: r.lastDetectedAt.toISOString(),
  };
}

const LEVEL_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const DEFAULT_PREFS = { defaultView: 'personal' as const, collapsedCards: [] as string[], hiddenCards: [] as string[], scheduleRange: 7 as const, cardOrder: [] as string[] };

async function buildAnnouncements(projectId: unknown, viewer: Viewer, userId: string, limit = 5) {
  const docs = await Announcement.find({
    projectId,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).sort({ isPinned: -1, publishedAt: -1 }).limit(20).lean();

  const visible = docs.filter((a) => canSee(viewer, a.visibility)).slice(0, limit);
  const pubIds = [...new Set(visible.map((a) => a.publishedBy.toString()))];
  const users = await User.find({ _id: { $in: pubIds } }).lean();
  const nameMap = new Map(users.map((u) => [u._id.toString(), u.name]));
  const myConfirms = await AnnouncementConfirmation.find({
    announcementId: { $in: visible.map((a) => a._id) },
    userId,
  }).lean();
  const confirmedSet = new Set(myConfirms.map((c) => c.announcementId.toString()));

  return visible.map((a) => ({
    id: a._id.toString(),
    title: a.title,
    content: a.content,
    type: a.type,
    isPinned: a.isPinned,
    requireConfirmation: a.requireConfirmation,
    publishedBy: { userId: a.publishedBy.toString(), name: nameMap.get(a.publishedBy.toString()) ?? '未知' },
    publishedAt: a.publishedAt.toISOString(),
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    confirmedByMe: confirmedSet.has(a._id.toString()),
  }));
}

async function buildActivities(projectId: unknown, permissions: Set<string>, limit = 10) {
  const docs = await Activity.find({ projectId }).sort({ createdAt: -1 }).limit(limit + 10).lean();
  const typed = docs as (typeof docs[number] & { createdAt: Date })[];
  const filtered = typed
    .filter((a) => !a.permissionGate || permissions.has(a.permissionGate) || permissions.has('project:manage'))
    .slice(0, limit);
  const actorIds = [...new Set(filtered.map((a) => a.actorId.toString()))];
  const users = await User.find({ _id: { $in: actorIds } }).lean();
  const nameMap = new Map(users.map((u) => [u._id.toString(), u.name]));
  return filtered.map((a) => ({
    id: a._id.toString(),
    actor: { userId: a.actorId.toString(), name: nameMap.get(a.actorId.toString()) ?? '未知' },
    type: a.type,
    message: a.message,
    sourceType: a.sourceType,
    sourceId: a.sourceId ? a.sourceId.toString() : null,
    createdAt: a.createdAt.toISOString(),
  }));
}

dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    const project = req.project!;
    const userId = req.userId!;
    const permissions = req.myPermissions!;
    const viewer: Viewer = { userId, roleName: req.membership?.roleName ?? null, isSuperAdmin: req.user?.isSuperAdmin ?? false };

    const prefDoc = await DashboardPreference.findOne({ userId, projectId: project._id }).lean();
    const prefs = prefDoc
      ? { defaultView: prefDoc.defaultView, collapsedCards: prefDoc.collapsedCards, hiddenCards: prefDoc.hiddenCards, scheduleRange: prefDoc.scheduleRange, cardOrder: prefDoc.cardOrder }
      : { ...DEFAULT_PREFS, defaultView: permissions.has('project:manage') ? 'project' as const : 'personal' as const };

    const scheduleDays = Math.min(Number(req.query.scheduleDays) || prefs.scheduleRange, 30);

    const [summary, myActions, schedule, risks, announcements, activities] = await Promise.all([
      buildSummary(project, userId, permissions),
      buildMyActions(project._id, userId),
      buildSchedule(project, scheduleDays),
      RiskInstance.find({ projectId: project._id, status: { $in: ['active', 'ignored'] } }),
      buildAnnouncements(project._id, viewer, userId),
      buildActivities(project._id, permissions),
    ]);

    const activeRisks = risks.filter((r) => r.status === 'active');
    activeRisks.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
    const health = computeHealth(activeRisks);

    res.json({
      summary,
      myActions: { items: myActions },
      risks: { risks: activeRisks.map(riskJson), health },
      schedule: { groups: schedule },
      announcements: { items: announcements },
      activities: { items: activities },
      preferences: prefs,
    });
  }),
);

dashboardRouter.get(
  '/preferences',
  ah(async (req, res) => {
    const prefDoc = await DashboardPreference.findOne({ userId: req.userId, projectId: req.project!._id }).lean();
    if (!prefDoc) {
      const defaultView = req.myPermissions!.has('project:manage') ? 'project' : 'personal';
      return res.json({ ...DEFAULT_PREFS, defaultView });
    }
    res.json({ defaultView: prefDoc.defaultView, collapsedCards: prefDoc.collapsedCards, hiddenCards: prefDoc.hiddenCards, scheduleRange: prefDoc.scheduleRange, cardOrder: prefDoc.cardOrder });
  }),
);

dashboardRouter.patch(
  '/preferences',
  ah(async (req, res) => {
    const { defaultView, collapsedCards, hiddenCards, scheduleRange, cardOrder } = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (defaultView !== undefined) {
      if (defaultView !== 'personal' && defaultView !== 'project') throw new AppError(400, 'bad_request', 'defaultView 无效');
      update.defaultView = defaultView;
    }
    if (collapsedCards !== undefined) {
      if (!Array.isArray(collapsedCards)) throw new AppError(400, 'bad_request', 'collapsedCards 必须是数组');
      update.collapsedCards = collapsedCards.slice(0, 20);
    }
    if (hiddenCards !== undefined) {
      if (!Array.isArray(hiddenCards)) throw new AppError(400, 'bad_request', 'hiddenCards 必须是数组');
      update.hiddenCards = hiddenCards.slice(0, 20);
    }
    if (scheduleRange !== undefined) {
      if (scheduleRange !== 7 && scheduleRange !== 30) throw new AppError(400, 'bad_request', 'scheduleRange 必须是 7 或 30');
      update.scheduleRange = scheduleRange;
    }
    if (cardOrder !== undefined) {
      if (!Array.isArray(cardOrder)) throw new AppError(400, 'bad_request', 'cardOrder 必须是数组');
      update.cardOrder = cardOrder.slice(0, 20);
    }
    const doc = await DashboardPreference.findOneAndUpdate(
      { userId: req.userId, projectId: req.project!._id },
      { $set: update },
      { upsert: true, new: true },
    );
    res.json({ defaultView: doc.defaultView, collapsedCards: doc.collapsedCards, hiddenCards: doc.hiddenCards, scheduleRange: doc.scheduleRange, cardOrder: doc.cardOrder });
  }),
);

dashboardRouter.get(
  '/summary',
  ah(async (req, res) => {
    const summary = await buildSummary(req.project!, req.userId!, req.myPermissions!);
    res.json(summary);
  }),
);

dashboardRouter.get(
  '/my-actions',
  ah(async (req, res) => {
    const items = await buildMyActions(req.project!._id, req.userId!);
    res.json({ items });
  }),
);

dashboardRouter.get(
  '/schedule',
  ah(async (req, res) => {
    const days = Math.min(Number(req.query.days) || 7, 30);
    const groups = await buildSchedule(req.project!, days);
    res.json({ groups });
  }),
);
