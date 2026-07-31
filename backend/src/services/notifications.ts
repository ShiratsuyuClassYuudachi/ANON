import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { sendMail } from './mailer';
import { webPushChannel } from './webpush';

// --- 事件与载荷 ---

export type NotificationType =
  | 'todo:assigned'
  | 'todo:completed'
  | 'todo:remind'
  | 'todo:due'
  | 'milestone:approaching'
  | 'risk:new'
  | 'announcement:published'
  | 'work:assigned'
  | 'incident:reported'
  | 'weekly:report';

export interface NotificationPayload {
  projectId: Types.ObjectId | string;
  type: NotificationType;
  /** 邮件主题前缀后的主标题（站内通知的标题） */
  title: string;
  /** 纯文本正文 */
  body: string;
  /** 前端路由（如 /p/:id?tab=todos），供站内/推送渠道使用 */
  link?: string;
  /** 事件上下文（sourceId 等），渠道可定制 */
  metadata?: Record<string, unknown>;
  /** 目标收件人 userIds */
  recipients: string[];
  /** 触发者，自动从 recipients 中排除（防自通知） */
  actorId?: string;
}

export interface NotificationRecipient {
  userId: string;
  name: string;
  email?: string;
}

// --- 渠道接口：新增站内 / Web Push 等渠道时实现并注册即可 ---

export interface NotificationChannel {
  readonly id: string;
  deliver(payload: NotificationPayload, recipients: NotificationRecipient[]): Promise<void>;
}

class EmailChannel implements NotificationChannel {
  readonly id = 'email';

  async deliver(payload: NotificationPayload, recipients: NotificationRecipient[]): Promise<void> {
    const emails = recipients.map((r) => r.email).filter((e): e is string => !!e);
    if (emails.length === 0) return;
    await sendMail(emails, `[ANON] ${payload.title}`, payload.body);
  }
}

/** 已注册渠道；新增渠道时 push 实现 */
export const notificationChannels: NotificationChannel[] = [new EmailChannel(), webPushChannel];

/**
 * 统一通知入口：解析收件人（排除 actorId）→ 逐渠道投递。
 * 内部吞错：单渠道失败仅记日志，不影响其他渠道，不产生 unhandled rejection。
 * 返回是否全部渠道投递成功（无收件人视为成功）——cron 去重标记依赖该结果。
 */
export function notify(payload: NotificationPayload): Promise<boolean> {
  return (async () => {
    try {
      const users = await User.find({ _id: { $in: payload.recipients } }).lean();
      const recipients: NotificationRecipient[] = users
        .filter((u) => !payload.actorId || u._id.toString() !== payload.actorId)
        .map((u) => ({ userId: u._id.toString(), name: u.name, email: u.email }));
      if (recipients.length === 0) return true;
      const results = await Promise.all(
        notificationChannels.map((ch) =>
          ch
            .deliver(payload, recipients)
            .then(() => true)
            .catch((err) => {
              console.error(`[notifications:${ch.id}] 投递失败:`, err);
              return false;
            }),
        ),
      );
      return results.every(Boolean);
    } catch (err) {
      console.error('[notifications] 收件人解析失败:', err);
      return false;
    }
  })();
}

// --- 收件人辅助 ---

/** project.roles 中含 project:manage 权限的角色名（与 cron.ts 既有判定一致） */
export function managerRoleNames(project: { roles: { name: string; permissions: string[] }[] }): string[] {
  return project.roles.filter((r) => r.permissions.includes('project:manage')).map((r) => r.name);
}

/** 按角色名查项目成员 userIds */
export async function memberIdsByRole(projectId: Types.ObjectId | string, roleNames: string[]): Promise<string[]> {
  if (roleNames.length === 0) return [];
  const memberships = await Membership.find({ projectId, roleName: { $in: roleNames } }).lean();
  return memberships.map((m) => m.userId.toString());
}

/** 项目管理者 userIds（roles + memberships 两次查询） */
export async function projectManagerIds(projectId: Types.ObjectId | string): Promise<string[]> {
  const project = await Project.findById(projectId).lean();
  if (!project) return [];
  return memberIdsByRole(projectId, managerRoleNames(project));
}
