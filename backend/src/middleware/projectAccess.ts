import type { NextFunction, Request, Response } from 'express';
import { Membership, type MembershipDoc } from '../models/Membership';
import { Project, type ProjectDoc } from '../models/Project';
import { ALL_PERMISSIONS } from '../services/permissions';
import { AppError } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      project?: ProjectDoc;
      membership?: MembershipDoc | null;
      myPermissions?: Set<string>;
    }
  }
}

export async function loadMembership(req: Request, _res: Response, next: NextFunction) {
  try {
    const projectId = req.params.id ?? req.params.projectId;
    const project = await Project.findById(projectId);
    if (!project) throw new AppError(404, 'not_found', '项目不存在');
    req.project = project;

    if (req.user?.isSuperAdmin) {
      req.membership = null;
      req.myPermissions = new Set(ALL_PERMISSIONS);
      return next();
    }

    const membership = await Membership.findOne({ projectId: project._id, userId: req.userId });
    if (!membership) throw new AppError(403, 'forbidden', '不是项目成员');
    req.membership = membership;
    const role = project.roles.find((r) => r.name === membership.roleName);
    req.myPermissions = new Set(role?.permissions ?? []);
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(perm: string) {
  return [
    loadMembership,
    (req: Request, _res: Response, next: NextFunction) => {
      const perms = req.myPermissions ?? new Set<string>();
      if (perms.has('project:manage') || perms.has(perm)) return next();
      next(new AppError(403, 'forbidden', '没有权限'));
    },
  ];
}
