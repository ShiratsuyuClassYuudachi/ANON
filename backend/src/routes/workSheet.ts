import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { buildSheet } from '../services/workModules';
import { ah } from '../utils/async';

export const workSheetRouter = Router({ mergeParams: true });
workSheetRouter.use(authRequired, loadMembership);

workSheetRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await buildSheet(req.project!, req.userId!));
  }),
);

workSheetRouter.get(
  '/:userId',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    res.json(await buildSheet(req.project!, req.params.userId));
  }),
);
