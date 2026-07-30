import { Types } from 'mongoose';
import type { ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import { ResourceVersion } from '../models/ResourceVersion';
import { RiskInstance } from '../models/RiskInstance';
import { Todo } from '../models/Todo';
import { Transaction } from '../models/Transaction';
import { WorkModule } from '../models/WorkModule';

interface DetectedRisk {
  ruleCode: string;
  level: 'info' | 'warning' | 'critical';
  sourceType: 'todo' | 'finance' | 'material' | 'work';
  sourceId?: Types.ObjectId;
  fingerprint: string;
  title: string;
  description: string;
}

export type HealthStatus = 'normal' | 'attention' | 'at_risk' | 'critical';

export function computeHealth(activeRisks: { level: string }[]): HealthStatus {
  const criticals = activeRisks.filter((r) => r.level === 'critical');
  const warnings = activeRisks.filter((r) => r.level === 'warning');
  if (criticals.length > 0) return 'critical';
  if (warnings.length >= 2) return 'at_risk';
  if (warnings.length === 1 || activeRisks.some((r) => r.level === 'info')) return 'attention';
  return 'normal';
}

export async function computeRisks(project: ProjectDoc): Promise<void> {
  const projectId = project._id;
  const now = new Date();
  const detected: DetectedRisk[] = [];

  const [todos, transactions, resources, workModules] = await Promise.all([
    Todo.find({ projectId }),
    Transaction.find({ projectId }),
    Resource.find({ projectId }),
    WorkModule.find({ projectId }),
  ]);

  // --- Todo risks ---
  const openTodos = todos.filter((t) => t.status === 'open');
  for (const todo of openTodos) {
    if (todo.dueAt && todo.dueAt < now) {
      detected.push({
        ruleCode: 'todo:overdue',
        level: 'warning',
        sourceType: 'todo',
        sourceId: todo._id,
        fingerprint: `todo:${todo._id}:overdue`,
        title: '待办已逾期',
        description: `「${todo.title}」已超过截止时间`,
      });
    }
    if (todo.assigneeIds.length === 0) {
      detected.push({
        ruleCode: 'todo:no_assignee',
        level: 'info',
        sourceType: 'todo',
        sourceId: todo._id,
        fingerprint: `todo:${todo._id}:no_assignee`,
        title: '待办无负责人',
        description: `「${todo.title}」尚未指派负责人`,
      });
    }
  }

  // Bulk incomplete near event
  if (project.startDate) {
    const daysUntilEvent = (project.startDate.getTime() - now.getTime()) / 86400000;
    if (daysUntilEvent >= 0 && daysUntilEvent <= 7 && todos.length > 0) {
      const incompleteRate = openTodos.length / todos.length;
      if (incompleteRate > 0.5) {
        detected.push({
          ruleCode: 'todo:bulk_incomplete',
          level: 'warning',
          sourceType: 'todo',
          fingerprint: 'todo:project:bulk_incomplete',
          title: '活动临近但大量待办未完成',
          description: `距活动开始不到 7 天，仍有 ${openTodos.length}/${todos.length} 项待办未完成`,
        });
      }
    }
  }

  // --- Finance risks ---
  const ticketTypes = project.ticketTypes ?? [];
  const ticketIncomeCents =
    ticketTypes.reduce((sum, t) => sum + t.priceCents * t.count, 0) +
    (project.ticketPriceCents ?? 0) * (project.ticketCount ?? 0);
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of transactions) {
    if (t.type === 'income') incomeCents += t.amountCents;
    else expenseCents += t.amountCents;
  }
  const totalIncome = ticketIncomeCents + incomeCents;
  if (totalIncome > 0 && expenseCents > totalIncome) {
    detected.push({
      ruleCode: 'finance:over_budget',
      level: 'critical',
      sourceType: 'finance',
      fingerprint: 'finance:project:over_budget',
      title: '支出超过收入',
      description: `已发生支出 ¥${(expenseCents / 100).toFixed(2)}，超过总收入 ¥${(totalIncome / 100).toFixed(2)}`,
    });
  }

  // --- Work risks ---
  for (const wm of workModules) {
    if (wm.assignees.length < wm.requiredCount) {
      detected.push({
        ruleCode: 'work:staff_shortage',
        level: 'critical',
        sourceType: 'work',
        sourceId: wm._id,
        fingerprint: `work:${wm._id}:staff_shortage`,
        title: '现场人员不足',
        description: `「${wm.name}」需要 ${wm.requiredCount} 人，目前仅分配 ${wm.assignees.length} 人`,
      });
    }
    if (wm.assignees.length === 0) {
      detected.push({
        ruleCode: 'work:no_assignees',
        level: 'warning',
        sourceType: 'work',
        sourceId: wm._id,
        fingerprint: `work:${wm._id}:no_assignees`,
        title: '现场任务无人分配',
        description: `「${wm.name}」尚未分配任何成员`,
      });
    }
    // Unconfirmed near event
    if (project.startDate) {
      const daysUntil = (project.startDate.getTime() - now.getTime()) / 86400000;
      if (daysUntil >= 0 && daysUntil <= 3) {
        const unconfirmed = wm.assignees.filter((a) => !a.confirmedAt);
        if (unconfirmed.length > 0) {
          detected.push({
            ruleCode: 'work:unconfirmed_near_event',
            level: 'warning',
            sourceType: 'work',
            sourceId: wm._id,
            fingerprint: `work:${wm._id}:unconfirmed_near_event`,
            title: '活动临近仍有未确认成员',
            description: `「${wm.name}」有 ${unconfirmed.length} 名成员尚未确认`,
          });
        }
      }
    }
  }

  // --- Material risks ---
  if (resources.length > 0) {
    const resourceIds = resources.map((r) => r._id);
    const versions = await ResourceVersion.find({ resourceId: { $in: resourceIds } });
    const hasVersion = new Set(versions.map((v) => v.resourceId.toString()));
    for (const r of resources) {
      if (!hasVersion.has(r._id.toString())) {
        detected.push({
          ruleCode: 'material:no_versions',
          level: 'info',
          sourceType: 'material',
          sourceId: r._id,
          fingerprint: `material:${r._id}:no_versions`,
          title: '物料无版本',
          description: `「${r.name}」尚未上传任何版本`,
        });
      }
    }
  }

  // --- Reconcile with DB ---
  await reconcileRisks(projectId, detected, now);
}

async function reconcileRisks(projectId: Types.ObjectId, detected: DetectedRisk[], now: Date): Promise<void> {
  const detectedFingerprints = new Set(detected.map((d) => d.fingerprint));

  // Expire ignored risks past their ignoredUntil
  await RiskInstance.updateMany(
    { projectId, status: 'ignored', ignoredUntil: { $ne: null, $lte: now } },
    { $set: { status: 'active', ignoredBy: undefined, ignoredAt: undefined, ignoredUntil: undefined, ignoreReason: undefined } },
  );

  // Auto-resolve: existing active risks no longer detected
  const existing = await RiskInstance.find({ projectId, status: { $in: ['active', 'ignored'] } });
  for (const risk of existing) {
    if (risk.status === 'active' && !detectedFingerprints.has(risk.fingerprint)) {
      risk.status = 'resolved';
      risk.resolvedAt = now;
      await risk.save();
    }
  }

  // Upsert new or still-present risks
  for (const d of detected) {
    const existingRisk = await RiskInstance.findOne({ projectId, fingerprint: d.fingerprint });
    if (existingRisk) {
      if (existingRisk.status === 'resolved' || existingRisk.status === 'expired') {
        // Re-detected: reactivate
        existingRisk.status = 'active';
        existingRisk.resolvedAt = undefined;
        existingRisk.lastDetectedAt = now;
        existingRisk.title = d.title;
        existingRisk.description = d.description;
        existingRisk.level = d.level;
        await existingRisk.save();
      } else {
        // Still active or ignored: just update lastDetectedAt and description
        existingRisk.lastDetectedAt = now;
        existingRisk.title = d.title;
        existingRisk.description = d.description;
        existingRisk.level = d.level;
        await existingRisk.save();
      }
    } else {
      await RiskInstance.create({
        projectId,
        ruleCode: d.ruleCode,
        level: d.level,
        sourceType: d.sourceType,
        sourceId: d.sourceId,
        fingerprint: d.fingerprint,
        title: d.title,
        description: d.description,
        status: 'active',
        firstDetectedAt: now,
        lastDetectedAt: now,
      });
    }
  }
}

/** Fire-and-forget helper to be called after mutations in existing routes */
export function triggerRiskRecompute(project: ProjectDoc): void {
  computeRisks(project).catch(() => {});
}
