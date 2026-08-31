import crypto from 'crypto';
import { config } from '../config';
import { Project } from '../models/Project';
import { QQBindCode, type IQQBindCode } from '../models/QQBindCode';
import type { NotificationChannel, NotificationPayload, NotificationRecipient, NotificationType } from './notifications';
import { qqConfigured, sendC2CMessage, sendGroupMessage } from './qqApi';

// --- 绑定码 ---

const BIND_CODE_TTL_MS = 10 * 60_000;

/** 生成 6 位数字绑定码；同目标旧码作废（单一有效码）；唯一索引冲突重试至多 5 次 */
export async function createBindCode(
  kind: 'user' | 'project',
  targetId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const scope = kind === 'user' ? { userId: targetId } : { projectId: targetId };
  await QQBindCode.deleteMany({ kind, ...scope });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + BIND_CODE_TTL_MS);
    try {
      await QQBindCode.create({ code, kind, ...scope, expiresAt });
      return { code, expiresAt };
    } catch (err) {
      // 唯一索引冲突（11000）换新码重试，其余错误直接抛出
      if ((err as { code?: number })?.code !== 11000 || attempt === 4) throw err;
    }
  }
  throw new Error('unreachable');
}

/** 消费绑定码：命中且未过期则删除后返回记录，否则 null（一次性） */
export async function consumeBindCode(code: string, kind: 'user' | 'project'): Promise<IQQBindCode | null> {
  const doc = await QQBindCode.findOne({ code, kind, expiresAt: { $gt: new Date() } }).lean();
  if (!doc) return null;
  await QQBindCode.deleteOne({ _id: doc._id });
  return doc;
}

// --- 通知渠道 ---

/** 项目群接收的精选事件类型；高频事件（todo:assigned/progress/completed、work:assigned）只发单聊 */
export const QQ_GROUP_TYPES: Readonly<Partial<Record<NotificationType, true>>> = {
  'milestone:approaching': true,
  'todo:remind': true,
  'todo:due': true,
  'announcement:published': true,
  'risk:new': true,
  'incident:reported': true,
  'weekly:report': true,
};

export function formatQQText(payload: NotificationPayload): string {
  let text = `【${payload.title}】\n${payload.body}`;
  if (config.publicBaseUrl && payload.link) text += `\n查看：${config.publicBaseUrl}${payload.link}`;
  return text;
}

/**
 * QQ 通知渠道：项目群（精选类型）+ 成员单聊。
 * 未配置凭证时静默跳过（与 webpush 未配置语义一致，不阻塞去重标记）；
 * 逐发送失败仅记日志，但有投递目标且全部失败时 throw——
 * notify 返回 false，cron 不写 ReminderLog，下轮重试（与「投递成功才去重」语义一致）。
 */
class QQChannel implements NotificationChannel {
  readonly id = 'qq';

  async deliver(payload: NotificationPayload, recipients: NotificationRecipient[]): Promise<void> {
    if (!qqConfigured()) return;
    const text = formatQQText(payload);
    const tasks: Promise<boolean>[] = [];

    if (QQ_GROUP_TYPES[payload.type]) {
      const project = await Project.findById(payload.projectId).lean();
      if (project?.qqGroupOpenId) tasks.push(sendGroupMessage(project.qqGroupOpenId, text));
    }
    for (const r of recipients) {
      if (r.qqOpenId) tasks.push(sendC2CMessage(r.qqOpenId, text));
    }
    if (tasks.length === 0) return;

    const results = await Promise.all(tasks);
    const failed = results.filter((ok) => !ok).length;
    if (failed === results.length) {
      throw new Error(`QQ 渠道全部投递失败（${failed}/${results.length}）`);
    }
  }
}

export const qqChannel = new QQChannel();
