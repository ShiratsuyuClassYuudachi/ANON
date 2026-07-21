import type { NextFunction, Request, Response } from 'express';
import { User, type UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { verifyToken } from '../utils/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      user?: UserDoc;
    }
  }
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const userId = token ? verifyToken(token) : null;
    if (!userId) throw new AppError(401, 'unauthorized', '未登录或登录已过期');
    const user = await User.findById(userId);
    if (!user) throw new AppError(401, 'unauthorized', '用户不存在');
    req.userId = user._id.toString();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isSuperAdmin) return next(new AppError(403, 'forbidden', '需要超级管理员权限'));
  next();
}
