import { Router } from 'express';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { TrialSession } from '../models/TrialSession';
import { publicUser, User } from '../models/User';
import { createBindCode } from '../services/qqbot';
import { qqConfigured } from '../services/qqApi';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const meRouter = Router();
meRouter.use(authRequired, rejectApiKey);

meRouter.get(
  '/',
  ah(async (req, res) => {
    const session = await TrialSession.findOne({ userId: req.userId }).lean();
    res.json({
      user: publicUser(req.user!),
      trialExpiresAt: session ? session.expiresAt.toISOString() : null,
      qq: { enabled: qqConfigured(), bound: Boolean(req.user!.qqOpenId) },
    });
  }),
);

meRouter.patch(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const { name, contacts } = req.body ?? {};
    if (name !== undefined) {
      if (!String(name).trim()) throw new AppError(400, 'bad_request', '姓名不能为空');
      user.name = String(name).trim();
    }
    if (contacts !== undefined) {
      if (!Array.isArray(contacts)) throw new AppError(400, 'bad_request', 'contacts 必须是数组');
      user.contacts = contacts.map((c: { platform?: string; value?: string }) => ({
        platform: String(c?.platform ?? ''),
        value: String(c?.value ?? ''),
      }));
    }
    await user.save();
    res.json({ user: publicUser(user) });
  }),
);

meRouter.post(
  '/onboarded',
  ah(async (req, res) => {
    const u = req.user!;
    if (!u.onboardedAt) {
      u.onboardedAt = new Date();
      await u.save();
    }
    res.json({ user: publicUser(u) });
  }),
);

// ---- QQ 通知绑定 ----

meRouter.post(
  '/qq-bind-code',
  ah(async (req, res) => {
    if (!qqConfigured()) throw new AppError(503, 'qq_disabled', '部署未启用 QQ 通知');
    const { code, expiresAt } = await createBindCode('user', req.userId!);
    res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  }),
);

meRouter.delete(
  '/qq-binding',
  ah(async (req, res) => {
    await User.updateOne({ _id: req.userId }, { $unset: { qqOpenId: 1 } });
    res.json({ qqBound: false });
  }),
);
