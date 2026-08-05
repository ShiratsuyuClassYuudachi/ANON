/**
 * 会话凭证：refresh token 为 48 字节随机 base64url，库中只存 sha256；
 * 30 天滚动有效，每次刷新轮换（旧凭证一次性作废），单用户最多保留 10 个（超出淘汰最旧）。
 */
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from '../models/RefreshToken';
import type { Types } from 'mongoose';

const REFRESH_TTL_MS = 30 * 86400_000;
const MAX_REFRESH_TOKENS_PER_USER = 10;

export async function issueRefreshToken(userId: string | Types.ObjectId): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  // 顺手清扫该用户过期会话，封顶增长
  await RefreshToken.deleteMany({ userId, expiresAt: { $lte: now } });
  await RefreshToken.create({ userId, tokenHash, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) });
  // 会话上限 10：淘汰最旧
  const all = await RefreshToken.find({ userId }).sort({ createdAt: 1 }).select('_id').lean();
  if (all.length > MAX_REFRESH_TOKENS_PER_USER) {
    await RefreshToken.deleteMany({
      _id: { $in: all.slice(0, all.length - MAX_REFRESH_TOKENS_PER_USER).map((d) => d._id) },
    });
  }
  return token;
}

/** 轮换：校验通过后旧凭证立即作废，签发新对；无效/过期返回 null */
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  // 原子取出即删：并发重放同一 refresh token 时只有一个请求拿到旧凭证，其余落入 401
  const doc = await RefreshToken.findOneAndDelete({ tokenHash });
  if (!doc) return null;
  if (doc.expiresAt <= new Date()) return null;
  return { userId: doc.userId.toString(), refreshToken: await issueRefreshToken(doc.userId) };
}

/** 登出吊销 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await RefreshToken.deleteOne({ tokenHash });
}
