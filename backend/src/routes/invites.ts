import { Router } from 'express';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { Membership } from '../models/Membership';
import { Project } from '../models/Project';
import { ProjectInvite } from '../models/ProjectInvite';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const invitesRouter = Router();
invitesRouter.use(authRequired, rejectApiKey);

async function loadValidInvite(token: string) {
  const invite = await ProjectInvite.findOne({ token });
  if (!invite) throw new AppError(404, 'not_found', '邀请不存在');
  if (invite.acceptedBy || invite.expiresAt < new Date()) {
    throw new AppError(410, 'invite_gone', '邀请已使用或已过期');
  }
  return invite;
}

invitesRouter.get(
  '/:token',
  ah(async (req, res) => {
    const invite = await loadValidInvite(req.params.token);
    if (invite.targetUserId && invite.targetUserId.toString() !== req.userId) {
      throw new AppError(403, 'forbidden', '该邀请链接指定了其他用户');
    }
    const project = await Project.findById(invite.projectId);
    res.json({
      invite: {
        projectName: project?.name ?? '未知项目',
        roleName: invite.roleName,
        expiresAt: invite.expiresAt,
        targeted: !!invite.targetUserId,
      },
    });
  }),
);

invitesRouter.post(
  '/:token/accept',
  ah(async (req, res) => {
    const invite = await loadValidInvite(req.params.token);
    if (invite.targetUserId && invite.targetUserId.toString() !== req.userId) {
      throw new AppError(403, 'forbidden', '该邀请链接指定了其他用户');
    }
    await Membership.findOneAndUpdate(
      { projectId: invite.projectId, userId: req.userId },
      { roleName: invite.roleName },
      { upsert: true, new: true },
    );
    invite.acceptedBy = req.userId as never;
    invite.acceptedAt = new Date();
    await invite.save();
    res.json({ ok: true, projectId: invite.projectId.toString() });
  }),
);
