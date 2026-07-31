import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Milestone } from '../models/Milestone';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { logActivity } from '../services/activity';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const milestonesRouter = Router({ mergeParams: true });
milestonesRouter.use(authRequired, loadMembership);

async function milestoneJson(
  m: InstanceType<typeof Milestone>,
  project: InstanceType<typeof Project>,
) {
  const user = await User.findById(m.createdBy).lean();
  const stage = m.stageId
    ? project.stages?.find((s) => s._id.toString() === m.stageId!.toString())
    : null;
  return {
    id: m._id.toString(),
    title: m.title,
    date: m.date.toISOString(),
    description: m.description,
    stageId: m.stageId ? m.stageId.toString() : null,
    stageName: stage?.name ?? null,
    completedAt: m.completedAt ? m.completedAt.toISOString() : null,
    createdBy: { userId: m.createdBy.toString(), name: user?.name ?? '未知' },
  };
}

// GET / — list milestones
milestonesRouter.get(
  '/',
  ah(async (req, res) => {
    const filter: Record<string, unknown> = { projectId: req.project!._id };
    const { from, to } = req.query;
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(String(from));
      if (to) dateFilter.$lte = new Date(String(to));
      filter.date = dateFilter;
    }
    const milestones = await Milestone.find(filter).sort({ date: 1 });
    res.json({
      milestones: await Promise.all(
        milestones.map((m) => milestoneJson(m, req.project!)),
      ),
    });
  }),
);

// POST / — create milestone
milestonesRouter.post(
  '/',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const { title, date, description, stageId } = req.body ?? {};
    if (!title || !String(title).trim()) throw new AppError(400, 'bad_request', '标题必填');
    if (!date) throw new AppError(400, 'bad_request', '日期必填');
    const d = new Date(String(date));
    if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '日期格式无效');
    const milestone = await Milestone.create({
      projectId: req.project!._id,
      title: String(title).trim(),
      date: d,
      description: String(description ?? ''),
      stageId: stageId || undefined,
      createdBy: req.userId,
    });
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'milestone:create',
      message: `${req.user!.name}创建了里程碑「${milestone.title}」`,
      sourceType: 'milestone',
      sourceId: milestone._id,
    });
    res.status(201).json({ milestone: await milestoneJson(milestone, req.project!) });
  }),
);

// PATCH /:milestoneId — update milestone
milestonesRouter.patch(
  '/:milestoneId',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const milestone = await Milestone.findOne({
      _id: req.params.milestoneId,
      projectId: req.project!._id,
    });
    if (!milestone) throw new AppError(404, 'not_found', '里程碑不存在');
    const { title, date, description, stageId, completedAt } = req.body ?? {};
    if (title !== undefined) milestone.title = String(title).trim();
    if (date !== undefined) {
      const d = new Date(String(date));
      if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '日期格式无效');
      milestone.date = d;
    }
    if (description !== undefined) milestone.description = String(description);
    if (stageId !== undefined) milestone.stageId = stageId || undefined;
    if (completedAt !== undefined) {
      milestone.completedAt = completedAt === null ? undefined : new Date(String(completedAt));
    }
    await milestone.save();
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'milestone:update',
      message: `${req.user!.name}更新了里程碑「${milestone.title}」`,
      sourceType: 'milestone',
      sourceId: milestone._id,
    });
    res.json({ milestone: await milestoneJson(milestone, req.project!) });
  }),
);

// DELETE /:milestoneId — delete milestone
milestonesRouter.delete(
  '/:milestoneId',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const milestone = await Milestone.findOne({
      _id: req.params.milestoneId,
      projectId: req.project!._id,
    });
    const title = milestone?.title ?? '';
    const r = await Milestone.deleteOne({
      _id: req.params.milestoneId,
      projectId: req.project!._id,
    });
    if (!r.deletedCount) throw new AppError(404, 'not_found', '里程碑不存在');
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'milestone:delete',
      message: `${req.user!.name}删除了里程碑「${title}」`,
      sourceType: 'milestone',
    });
    res.json({ ok: true });
  }),
);

// POST /:milestoneId/complete — mark milestone complete
milestonesRouter.post(
  '/:milestoneId/complete',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const milestone = await Milestone.findOne({
      _id: req.params.milestoneId,
      projectId: req.project!._id,
    });
    if (!milestone) throw new AppError(404, 'not_found', '里程碑不存在');
    milestone.completedAt = new Date();
    await milestone.save();
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'milestone:complete',
      message: `${req.user!.name}完成了里程碑「${milestone.title}」`,
      sourceType: 'milestone',
      sourceId: milestone._id,
    });
    res.json({ milestone: await milestoneJson(milestone, req.project!) });
  }),
);
