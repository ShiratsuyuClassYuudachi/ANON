import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership } from '../middleware/projectAccess';
import { RiskInstance } from '../models/RiskInstance';
import { buildMyActions, buildSchedule, buildSummary } from '../services/dashboard';
import { computeHealth } from '../services/risk';
import { ah } from '../utils/async';

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

dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    const project = req.project!;
    const userId = req.userId!;
    const permissions = req.myPermissions!;

    const [summary, myActions, schedule, risks] = await Promise.all([
      buildSummary(project, userId, permissions),
      buildMyActions(project._id, userId),
      buildSchedule(project, 7),
      RiskInstance.find({ projectId: project._id, status: { $in: ['active', 'ignored'] } }),
    ]);

    const activeRisks = risks.filter((r) => r.status === 'active');
    activeRisks.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
    const health = computeHealth(activeRisks);

    res.json({
      summary,
      myActions: { items: myActions },
      risks: { risks: risks.filter((r) => r.status === 'active').map(riskJson), health },
      schedule: { groups: schedule },
    });
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
