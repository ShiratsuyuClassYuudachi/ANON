import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Project } from '../models/Project';
import { Milestone } from '../models/Milestone';
import { logActivity } from '../services/activity';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const stagesRouter = Router({ mergeParams: true });
stagesRouter.use(authRequired, loadMembership);

function stagesJson(project: InstanceType<typeof Project>) {
  const stages = [...(project.stages ?? [])].sort((a, b) => a.order - b.order);
  const currentStageIndex = stages.findIndex((s) => !s.completedAt);
  return {
    stages: stages.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      order: s.order,
      completedAt: s.completedAt?.toISOString() ?? null,
      note: s.note ?? '',
    })),
    currentStageIndex,
  };
}

// GET / — list stages
stagesRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(stagesJson(req.project!));
  }),
);

// PATCH /reorder — must be before /:stageId
stagesRouter.patch(
  '/reorder',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const { orderedIds } = req.body ?? {};
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new AppError(400, 'bad_request', 'orderedIds 必须是非空数组');
    }
    const project = req.project!;
    const stageMap = new Map((project.stages ?? []).map((s) => [s._id.toString(), s]));
    const reordered = orderedIds
      .map((id: string, i: number) => {
        const stage = stageMap.get(String(id));
        if (stage) stage.order = i;
        return stage;
      })
      .filter(Boolean);
    project.stages = reordered as typeof project.stages;
    await project.save();
    logActivity({
      projectId: project._id,
      actorId: req.userId!,
      type: 'stage:reorder',
      message: `${req.user!.name}调整了项目阶段顺序`,
      sourceType: 'project',
      sourceId: project._id,
    });
    res.json(stagesJson(project));
  }),
);

// PATCH /:stageId — update a stage
stagesRouter.patch(
  '/:stageId',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const project = req.project!;
    const stage = (project.stages ?? []).find(
      (s) => s._id.toString() === req.params.stageId,
    );
    if (!stage) throw new AppError(404, 'not_found', '阶段不存在');
    const { completedAt, note } = req.body ?? {};
    if (completedAt !== undefined) {
      stage.completedAt = completedAt === null ? undefined : new Date(String(completedAt));
    }
    if (note !== undefined) {
      stage.note = String(note);
    }
    await project.save();
    logActivity({
      projectId: project._id,
      actorId: req.userId!,
      type: 'stage:update',
      message: `${req.user!.name}更新了阶段「${stage.name}」`,
      sourceType: 'project',
      sourceId: project._id,
    });
    res.json(stagesJson(project));
  }),
);

// POST / — add a stage
stagesRouter.post(
  '/',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const { name, order } = req.body ?? {};
    if (!name || !String(name).trim()) throw new AppError(400, 'bad_request', '阶段名称必填');
    const project = req.project!;
    const stages = project.stages ?? [];
    const maxOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : -1;
    stages.push({
      name: String(name).trim(),
      order: typeof order === 'number' ? order : maxOrder + 1,
    } as (typeof stages)[number]);
    project.stages = stages;
    await project.save();
    logActivity({
      projectId: project._id,
      actorId: req.userId!,
      type: 'stage:add',
      message: `${req.user!.name}添加了阶段「${String(name).trim()}」`,
      sourceType: 'project',
      sourceId: project._id,
    });
    res.json(stagesJson(project));
  }),
);

// DELETE /:stageId — remove a stage
stagesRouter.delete(
  '/:stageId',
  ...requirePermission('project:manage'),
  ah(async (req, res) => {
    const project = req.project!;
    const stages = project.stages ?? [];
    if (stages.length <= 1) throw new AppError(409, 'conflict', '至少需要保留一个阶段');
    const idx = stages.findIndex((s) => s._id.toString() === req.params.stageId);
    if (idx === -1) throw new AppError(404, 'not_found', '阶段不存在');
    const [removed] = stages.splice(idx, 1);
    project.stages = stages;
    await project.save();
    // Fire-and-forget: unlink milestones from removed stage
    Milestone.updateMany(
      { projectId: project._id, stageId: req.params.stageId },
      { $set: { stageId: undefined } },
    ).catch(() => {});
    logActivity({
      projectId: project._id,
      actorId: req.userId!,
      type: 'stage:remove',
      message: `${req.user!.name}删除了阶段「${removed.name}」`,
      sourceType: 'project',
      sourceId: project._id,
    });
    res.json(stagesJson(project));
  }),
);
