import crypto from 'crypto';
import { Router } from 'express';
import { authRequired, requireSuperAdmin } from '../middleware/auth';
import { InviteCode } from '../models/InviteCode';
import { ah } from '../utils/async';

export const adminRouter = Router();
adminRouter.use(authRequired, requireSuperAdmin);

adminRouter.post(
  '/invite-codes',
  ah(async (req, res) => {
    const code = req.body?.code
      ? String(req.body.code)
      : `ANON-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const doc = await InviteCode.create({ code, createdBy: req.userId });
    res.status(201).json({ code: doc.code, id: doc._id.toString() });
  }),
);

adminRouter.get(
  '/invite-codes',
  ah(async (_req, res) => {
    const docs = await InviteCode.find().sort({ createdAt: -1 }).lean();
    res.json({
      inviteCodes: docs.map((d) => ({
        id: d._id.toString(),
        code: d.code,
        used: !!d.usedBy,
        usedAt: d.usedAt ?? null,
        createdAt: (d as { createdAt?: Date }).createdAt ?? null,
      })),
    });
  }),
);
