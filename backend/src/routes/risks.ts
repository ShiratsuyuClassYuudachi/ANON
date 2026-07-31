import { Router } from 'express';
import { Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { RiskInstance } from '../models/RiskInstance';
import { computeHealth, computeRisks } from '../services/risk';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const risksRouter = Router({ mergeParams: true });
risksRouter.use(authRequired, loadMembership);

const LEVEL_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

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
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    ignoredBy: r.ignoredBy ? String(r.ignoredBy) : null,
    ignoredUntil: r.ignoredUntil ? r.ignoredUntil.toISOString() : null,
    ignoreReason: r.ignoreReason ?? null,
  };
}

function sortRisks(risks: InstanceType<typeof RiskInstance>[]) {
  risks.sort(
    (a, b) =>
      (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) ||
      b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime(),
  );
  return risks;
}

risksRouter.get(
  '/',
  ah(async (req, res) => {
    const risks = await RiskInstance.find({
      projectId: req.project!._id,
      status: { $in: ['active', 'ignored'] },
    });
    sortRisks(risks);
    const health = computeHealth(risks.filter((r) => r.status === 'active'));
    res.json({ risks: risks.map(riskJson), health });
  }),
);

risksRouter.post(
  '/evaluate',
  ah(async (req, res) => {
    await computeRisks(req.project!);
    const risks = await RiskInstance.find({
      projectId: req.project!._id,
      status: { $in: ['active', 'ignored'] },
    });
    sortRisks(risks);
    const health = computeHealth(risks.filter((r) => r.status === 'active'));
    res.json({ risks: risks.map(riskJson), health });
  }),
);

risksRouter.post(
  '/:riskId/ignore',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const risk = await RiskInstance.findOne({ _id: req.params.riskId, projectId: req.project!._id });
    if (!risk) throw new AppError(404, 'not_found', '风险不存在');
    if (risk.status !== 'active') throw new AppError(400, 'bad_request', '只能忽略生效中的风险');
    const { reason, ignoredUntil } = req.body ?? {};
    if (!reason || !String(reason).trim()) throw new AppError(400, 'bad_request', '忽略原因必填');
    risk.status = 'ignored';
    risk.ignoredBy = new Types.ObjectId(req.userId!);
    risk.ignoredAt = new Date();
    risk.ignoreReason = String(reason).trim();
    risk.ignoredUntil = ignoredUntil ? new Date(ignoredUntil) : undefined;
    await risk.save();
    res.json({ risk: riskJson(risk) });
  }),
);

risksRouter.post(
  '/:riskId/restore',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const risk = await RiskInstance.findOne({ _id: req.params.riskId, projectId: req.project!._id });
    if (!risk) throw new AppError(404, 'not_found', '风险不存在');
    if (risk.status !== 'ignored') throw new AppError(400, 'bad_request', '只能恢复已忽略的风险');
    risk.status = 'active';
    risk.ignoredBy = undefined;
    risk.ignoredAt = undefined;
    risk.ignoredUntil = undefined;
    risk.ignoreReason = undefined;
    await risk.save();
    res.json({ risk: riskJson(risk) });
  }),
);
