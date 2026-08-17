import { Router } from 'express';
import { config } from '../config';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { PushSubscription } from '../models/PushSubscription';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const pushRouter = Router();
pushRouter.use(authRequired, rejectApiKey);

/** 每个用户最多保留的设备订阅数（超出时淘汰最旧的） */
const MAX_SUBSCRIPTIONS_PER_USER = 20;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** 校验 endpoint / p256dh / auth，返回净化后的值 */
function parseSubscription(body: Record<string, unknown>) {
  const { endpoint } = parseEndpoint(body);
  const p256dh = String(body.p256dh ?? '').trim();
  const auth = String(body.auth ?? '').trim();
  if (!BASE64URL_RE.test(p256dh) || !BASE64URL_RE.test(auth)) {
    throw new AppError(400, 'bad_request', 'p256dh/auth 须为 URL-safe base64');
  }
  return { endpoint, p256dh, auth };
}

/** 仅校验 endpoint（DELETE 用） */
function parseEndpoint(body: Record<string, unknown>) {
  const endpoint = String(body.endpoint ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new AppError(400, 'bad_request', 'endpoint 非法');
  }
  const allowed = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
  if (!allowed) throw new AppError(400, 'bad_request', 'endpoint 必须是 https（或 localhost http）');
  return { endpoint };
}

/** VAPID 公钥（未配置返回 null，前端据此不展示订阅入口） */
pushRouter.get(
  '/config',
  ah(async (_req, res) => {
    res.json({ publicKey: config.vapid.publicKey || null });
  }),
);

pushRouter.post(
  '/subscription',
  ah(async (req, res) => {
    const { endpoint, p256dh, auth } = parseSubscription(req.body ?? {});
    const userAgent = String(req.body?.userAgent ?? '').slice(0, 300);
    await PushSubscription.findOneAndUpdate(
      { userId: req.userId, endpoint },
      { $set: { p256dh, auth, userAgent } },
      { upsert: true, new: true },
    );
    // 超出上限时淘汰最旧订阅
    const total = await PushSubscription.countDocuments({ userId: req.userId });
    if (total > MAX_SUBSCRIPTIONS_PER_USER) {
      const oldest = await PushSubscription.find({ userId: req.userId })
        .sort({ createdAt: 1 })
        .limit(total - MAX_SUBSCRIPTIONS_PER_USER)
        .select('_id')
        .lean();
      await PushSubscription.deleteMany({ _id: { $in: oldest.map((o) => o._id) } });
    }
    res.json({ ok: true });
  }),
);

pushRouter.delete(
  '/subscription',
  ah(async (req, res) => {
    const { endpoint } = parseEndpoint(req.body ?? {});
    const r = await PushSubscription.deleteOne({ userId: req.userId, endpoint });
    res.json({ ok: true, removed: r.deletedCount });
  }),
);
