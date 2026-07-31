import webpush from 'web-push';
import { config } from '../config';
import { PushSubscription } from '../models/PushSubscription';
import type { NotificationChannel, NotificationPayload, NotificationRecipient } from './notifications';

/** 设备离线超过 1 天则放弃投递，避免陈旧提醒在恢复联网后弹出 */
const TTL_SECONDS = 86400;

function vapidConfigured(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

/**
 * Web Push 渠道：向收件人的全部已注册设备推送。
 * 未配置 VAPID 时静默跳过（邮件仍是可靠渠道，不阻塞去重标记）；
 * 单设备失败仅记日志，404/410 视为订阅失效并清除。
 */
class WebPushChannel implements NotificationChannel {
  readonly id = 'webpush';

  async deliver(payload: NotificationPayload, recipients: NotificationRecipient[]): Promise<void> {
    if (!vapidConfigured()) return;
    const subs = await PushSubscription.find({
      userId: { $in: recipients.map((r) => r.userId) },
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    if (subs.length === 0) return;

    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    const message = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.link ?? '/',
      tag: `${payload.type}:${String(payload.projectId)}`,
      type: payload.type,
      projectId: String(payload.projectId),
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
          { TTL: TTL_SECONDS },
        ),
      ),
    );

    const dead: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(String(subs[i]._id));
        else console.error('[notifications:webpush] 投递失败:', r.reason);
      }
    });
    if (dead.length) await PushSubscription.deleteMany({ _id: { $in: dead } });
  }
}

export const webPushChannel = new WebPushChannel();
