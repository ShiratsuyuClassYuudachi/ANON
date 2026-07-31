import { Router } from 'express';
import { config } from '../config';
import { Membership } from '../models/Membership';
import { Milestone } from '../models/Milestone';
import { Project } from '../models/Project';
import { ReminderLog } from '../models/ReminderLog';
import { RiskInstance } from '../models/RiskInstance';
import { Todo } from '../models/Todo';
import { WeeklyReportLog } from '../models/WeeklyReportLog';
import { managerRoleNames, memberIdsByRole, notify } from '../services/notifications';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const cronRouter = Router();

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

cronRouter.post(
  '/reminders',
  ah(async (req, res) => {
    if (!config.cronSecret) throw new AppError(503, 'cron_disabled', '未配置 CRON_SECRET');
    const header = req.headers.authorization ?? '';
    if (header !== `Bearer ${config.cronSecret}`) throw new AppError(401, 'unauthorized', '密钥错误');

    const now = new Date();
    const kinds = [
      { kind: 'remind' as const, field: 'remindAt' as const, label: '节点提醒', type: 'todo:remind' as const },
      { kind: 'due' as const, field: 'dueAt' as const, label: '到期提醒', type: 'todo:due' as const },
    ];
    let sent = 0;

    for (const { kind, field, label, type } of kinds) {
      const todos = await Todo.find({ status: 'open', [field]: { $lte: now } });
      for (const todo of todos) {
        const exists = await ReminderLog.exists({ todoId: todo._id, kind });
        if (exists) continue;
        // 仅投递成功才写去重标记，失败时下次 cron 重试（与旧直发 sendMail 语义一致）
        const ok = await notify({
          projectId: todo.projectId,
          type,
          title: `待办${label}：${todo.title}`,
          body: `待办「${todo.title}」${label}。时间：${(todo[field] ?? now).toISOString()}`,
          link: `/p/${String(todo.projectId)}?tab=todos`,
          metadata: { todoId: todo._id.toString() },
          recipients: todo.assigneeIds.map((id) => id.toString()),
        });
        if (ok) await ReminderLog.create({ todoId: todo._id, kind });
        sent += 1;
      }
    }

    // Milestone approaching (3 days before)
    const threeDaysLater = new Date(now.getTime() + 3 * 86400000);
    const upcomingMilestones = await Milestone.find({
      completedAt: { $exists: false },
      date: { $gte: now, $lte: threeDaysLater },
    }).lean();

    for (const ms of upcomingMilestones) {
      const exists = await ReminderLog.exists({ targetId: ms._id, kind: 'milestone_approaching' });
      if (exists) continue;
      const project = await Project.findById(ms.projectId).lean();
      if (!project) continue;
      const managerIds = await memberIdsByRole(ms.projectId, managerRoleNames(project));
      const ok = await notify({
        projectId: ms.projectId,
        type: 'milestone:approaching',
        title: `里程碑临近：${ms.title}`,
        body: `项目「${project.name}」的里程碑「${ms.title}」将于 ${ms.date.toISOString().slice(0, 10)} 到期。`,
        link: `/p/${String(ms.projectId)}?tab=dashboard`,
        metadata: { milestoneId: ms._id.toString() },
        recipients: managerIds,
      });
      if (ok) {
        await ReminderLog.create({ todoId: ms._id, kind: 'milestone_approaching', targetType: 'milestone', targetId: ms._id });
      }
      sent += 1;
    }

    res.json({ sent });
  }),
);

cronRouter.post(
  '/weekly-report',
  ah(async (req, res) => {
    if (!config.cronSecret) throw new AppError(503, 'cron_disabled', '未配置 CRON_SECRET');
    const header = req.headers.authorization ?? '';
    if (header !== `Bearer ${config.cronSecret}`) throw new AppError(401, 'unauthorized', '密钥错误');

    const now = new Date();
    const weekStart = getMonday(now);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    let sent = 0;

    const projects = await Project.find({ status: { $in: ['preparing', 'active', 'settling'] } }).lean();

    for (const project of projects) {
      const exists = await WeeklyReportLog.exists({ projectId: project._id, weekStart });
      if (exists) continue;

      const [completedTodos, newRisks, upcomingMilestones, memberships] = await Promise.all([
        Todo.countDocuments({ projectId: project._id, status: 'done', completedAt: { $gte: weekAgo } }),
        RiskInstance.countDocuments({ projectId: project._id, firstDetectedAt: { $gte: weekAgo }, status: 'active' }),
        Milestone.find({ projectId: project._id, date: { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) }, completedAt: { $exists: false } }).lean(),
        Membership.find({ projectId: project._id }).lean(),
      ]);

      const stages = project.stages ?? [];
      const completedStages = stages.filter((s) => s.completedAt).length;
      const currentStageName = stages.filter((s) => !s.completedAt).sort((a, b) => a.order - b.order)[0]?.name ?? '未设置';

      const managerRoleNamesList = managerRoleNames(project);
      const managerIds = memberships
        .filter((m) => managerRoleNamesList.includes(m.roleName))
        .map((m) => m.userId.toString());

      const ok = await notify({
        projectId: project._id,
        type: 'weekly:report',
        title: `周报：${project.name}`,
        body: [
          `项目「${project.name}」周报 (${weekStart.toISOString().slice(0, 10)} ~ ${now.toISOString().slice(0, 10)})`,
          '',
          `本周完成待办：${completedTodos} 项`,
          `新增风险：${newRisks} 项`,
          `当前阶段：${currentStageName}（进度 ${completedStages}/${stages.length}）`,
          upcomingMilestones.length
            ? `下周里程碑：${upcomingMilestones.map((m) => `${m.title}(${m.date.toISOString().slice(5, 10)})`).join('、')}`
            : '下周暂无里程碑',
        ].join('\n'),
        link: `/p/${String(project._id)}?tab=dashboard`,
        recipients: managerIds,
      });
      if (ok) await WeeklyReportLog.create({ projectId: project._id, weekStart, sentAt: now });
      sent += 1;
    }

    res.json({ sent });
  }),
);
