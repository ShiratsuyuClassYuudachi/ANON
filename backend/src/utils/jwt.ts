import jwt from 'jsonwebtoken';
import { config } from '../config';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'user' }, config.jwtSecret, { expiresIn: '15m' });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; kind?: string };
    if (payload.kind !== 'user') return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** 自定义工具启动令牌：5 分钟短期，仅可兑换 API 密钥，不可当用户态 token 用 */
export function signToolLaunchToken(p: { userId: string; toolId: string; projectId: string }): string {
  return jwt.sign({ sub: p.userId, kind: 'tool-launch', tid: p.toolId, pid: p.projectId }, config.jwtSecret, {
    expiresIn: '5m',
  });
}

export function verifyToolLaunchToken(token: string): { userId: string; toolId: string; projectId: string } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      sub?: string;
      kind?: string;
      tid?: string;
      pid?: string;
    };
    if (payload.kind !== 'tool-launch' || !payload.sub || !payload.tid || !payload.pid) return null;
    return { userId: payload.sub, toolId: payload.tid, projectId: payload.pid };
  } catch {
    return null;
  }
}
