import { Router } from 'express';
import { config } from '../config';
import { Membership } from '../models/Membership';
import { Milestone } from '../models/Milestone';
import { Project } from '../models/Project';
import { ReminderLog } from '../models/ReminderLog';
import { RiskInstance } from '../models/RiskInstance';
import { Todo } from '../models/Todo';
import { User } from '../models/User';
import { WeeklyReportLog } from '../models/WeeklyReportLog';
import { sendMail } from '../services/mailer';
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
      { kind: 'remind' as const, field: 'remindAt' as const, label: '节点提醒' },
      { kind: 'due' as const, field: 'dueAt' as const, label: '到期提醒' },
    ];
    let sent = 0;

    for (const { kind, field, label } of kinds) {
      const todos = await Todo.find({ status: 'open', [field]: { $lte: now } });
      for (const todo of todos) {
        const exists = await ReminderLog.exists({ todoId: todo._id, kind });
        if (exists) continue;
        const users = await User.find({ _id: { $in: todo.assigneeIds } }).lean();
        const emails = users.map((u) => u.email);
        if (emails.length) {
          await sendMail(
            emails,
            `[ANON] ${label}：${todo.title}`,
            `待办「${todo.title}」${label}。时间：${(todo[field] ?? now).toISOString()}`,
          );
        }
        await ReminderLog.create({ todoId: todo._id, kind });
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
      const managerRoleNames = project.roles.filter((r) => r.permissions.includes('project:manage')).map((r) => r.name);
      const memberships = await Membership.find({ projectId: ms.projectId, roleName: { $in: managerRoleNames } }).lean();
      const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
      const emails = users.map((u) => u.email);
      if (emails.length) {
        await sendMail(
          emails,
          `[ANON] 里程碑临近：${ms.title}`,
          `项目「${project.name}」的里程碑「${ms.title}」将于 ${ms.date.toISOString().slice(0, 10)} 到期。`,
        );
      }
      await ReminderLog.create({ todoId: ms._id, kind: 'milestone_approaching', targetType: 'milestone', targetId: ms._id });
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

      const managerRoleNames = project.roles.filter((r) => r.permissions.includes('project:manage')).map((r) => r.name);
      const managerIds = memberships.filter((m) => managerRoleNames.includes(m.roleName)).map((m) => m.userId);
      const managers = await User.find({ _id: { $in: managerIds } }).lean();
      const emails = managers.map((u) => u.email);

      if (emails.length) {
        const body = [
          `项目「${project.name}」周报 (${weekStart.toISOString().slice(0, 10)} ~ ${now.toISOString().slice(0, 10)})`,
          '',
          `本周完成待办：${completedTodos} 项`,
          `新增风险：${newRisks} 项`,
          `当前阶段：${currentStageName}（进度 ${completedStages}/${stages.length}）`,
          upcomingMilestones.length
            ? `下周里程碑：${upcomingMilestones.map((m) => `${m.title}(${m.date.toISOString().slice(5, 10)})`).join('、')}`
            : '下周暂无里程碑',
        ].join('\n');
        await sendMail(emails, `[ANON] 周报：${project.name}`, body);
      }

      await WeeklyReportLog.create({ projectId: project._id, weekStart, sentAt: now });
      sent += 1;
    }

    res.json({ sent });
  }),
);
