import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { publicUser } from '../models/User';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const meRouter = Router();
meRouter.use(authRequired);

meRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({ user: publicUser(req.user!) });
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
