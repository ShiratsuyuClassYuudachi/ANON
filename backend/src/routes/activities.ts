import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership } from '../middleware/projectAccess';
import { Activity } from '../models/Activity';
import { User } from '../models/User';
import { ah } from '../utils/async';

export const activitiesRouter = Router({ mergeParams: true });
activitiesRouter.use(authRequired, loadMembership);

activitiesRouter.get(
  '/',
  ah(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const sourceType = req.query.sourceType ? String(req.query.sourceType) : undefined;

    const filter: Record<string, unknown> = { projectId: req.project!._id };
    if (before) filter.createdAt = { $lt: before };
    if (sourceType) filter.sourceType = sourceType;

    const docs = await Activity.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const items = (hasMore ? docs.slice(0, limit) : docs) as (typeof docs[number] & { createdAt: Date })[];

    const permissions = req.myPermissions!;
    const filtered = items.filter((a) =>
      !a.permissionGate || permissions.has(a.permissionGate) || permissions.has('project:manage'),
    );

    const actorIds = [...new Set(filtered.map((a) => a.actorId.toString()))];
    const users = await User.find({ _id: { $in: actorIds } }).lean();
    const nameMap = new Map(users.map((u) => [u._id.toString(), u.name]));

    const activities = filtered.map((a) => ({
      id: a._id.toString(),
      actor: { userId: a.actorId.toString(), name: nameMap.get(a.actorId.toString()) ?? '未知' },
      type: a.type,
      message: a.message,
      sourceType: a.sourceType,
      sourceId: a.sourceId ? a.sourceId.toString() : null,
      createdAt: a.createdAt.toISOString(),
    }));

    res.json({ activities, hasMore });
  }),
);
