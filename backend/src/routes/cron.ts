import { Router } from 'express';
import { config } from '../config';
import { ReminderLog } from '../models/ReminderLog';
import { Todo } from '../models/Todo';
import { User } from '../models/User';
import { sendMail } from '../services/mailer';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const cronRouter = Router();

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
    res.json({ sent });
  }),
);
