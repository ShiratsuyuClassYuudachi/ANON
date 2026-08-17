import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApiKey } from '../models/ApiKey';
import { User, type UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { verifyToken } from '../utils/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      user?: UserDoc;
      apiKey?: { keyId: string; projectId: string; scopes: string[] };
    }
  }
}

/** API 密钥鉴权：anonk_ 前缀，sha256 哈希命中；过期即删，lastUsedAt 节流回写 */
async function authenticateApiKey(req: Request, token: string): Promise<void> {
  const keyHash = createHash('sha256').update(token).digest('hex');
  const key = await ApiKey.findOne({ keyHash });
  if (!key) throw new AppError(401, 'unauthorized', 'API 密钥无效或已过期');
  if (key.expiresAt && key.expiresAt <= new Date()) {
    key.deleteOne().catch(() => {});
    throw new AppError(401, 'unauthorized', 'API 密钥无效或已过期');
  }
  const user = await User.findById(key.userId);
  if (!user) throw new AppError(401, 'unauthorized', '用户不存在');
  req.userId = user._id.toString();
  req.user = user;
  req.apiKey = { keyId: key._id.toString(), projectId: key.projectId.toString(), scopes: key.scopes };
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60 * 60_000) {
    ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() })
      .exec()
      .catch(() => {});
  }
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token.startsWith('anonk_')) {
      await authenticateApiKey(req, token);
      return next();
    }
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

/** 用户态专属接口围栏：API 密钥一律 403（me/admin/push/invites/files 等 scope 收窄覆盖不到的面） */
export function rejectApiKey(req: Request, _res: Response, next: NextFunction) {
  if (req.apiKey) return next(new AppError(403, 'api_key_forbidden', '该接口不支持 API 密钥访问'));
  next();
}
