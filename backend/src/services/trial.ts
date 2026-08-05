/**
 * 试用模式：测试账号（config.trialEmail，默认 admin@test.com）+ 任意 ≥8 位密码登录时，
 * 以 sha256(trial:<jwtSecret>:<password>) 为 key 创建一套独立的演示数据环境；
 * 同密码 24h 内复用同一环境，到期由进程内清扫器级联销毁。
 */
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { RefreshToken } from '../models/RefreshToken';
import { TrialSession, type TrialSessionDoc } from '../models/TrialSession';
import { User, publicUser, type PublicUser } from '../models/User';
import { AppError } from '../utils/errors';
import { signToken } from '../utils/jwt';
import { deleteDemoData, seedDemoData } from './demoSeed';
import { issueRefreshToken } from './session';

const TRIAL_TTL_MS = 24 * 3600 * 1000;
const MAX_TRIAL_SESSIONS = 50;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function destroyTrial(session: TrialSessionDoc): Promise<void> {
  await deleteDemoData({ userIds: session.userIds, projectId: session.projectId });
  // 试用用户被级联删除，其 refresh token 不得残留
  await RefreshToken.deleteMany({ userId: { $in: session.userIds } });
  // 会话最后删：保证“查到会话 ⇒ 数据大概率完整”
  await TrialSession.deleteOne({ _id: session._id });
}

export async function trialLogin(
  password: string,
): Promise<{ token: string; refreshToken: string; user: PublicUser; trialExpiresAt: string }> {
  if (password.length < 8) {
    throw new AppError(400, 'bad_request', '试用密码至少 8 位');
  }
  // jwtSecret 作 pepper：DB 泄露不暴露明文密码
  const keyHash = createHash('sha256').update(`trial:${config.jwtSecret}:${password}`).digest('hex');
  const now = new Date();

  let session = await TrialSession.findOne({ keyHash });
  if (session && session.expiresAt <= now) {
    // 过期后同密码重建全新环境
    await destroyTrial(session);
    session = null;
  }
  if (session && !(await User.findById(session.userId))) {
    // 清扫中途的脏会话
    await destroyTrial(session);
    session = null;
  }

  if (!session) {
    const active = await TrialSession.countDocuments({ expiresAt: { $gt: now } });
    if (active >= MAX_TRIAL_SESSIONS) {
      throw new AppError(429, 'trial_limit', '试用环境数量已达上限，请稍后再试');
    }
    const tag = keyHash.slice(0, 12);
    const passwordHash = await bcrypt.hash(password, 12);
    const seeded = await seedDemoData({
      adminEmail: `trial-${tag}@trial.anon.local`,
      passwordHash,
      adminIsSuperAdmin: false,
      emailTag: tag,
    });
    try {
      session = await TrialSession.create({
        keyHash,
        userId: seeded.adminUserId,
        userIds: seeded.userIds,
        projectId: seeded.projectId,
        expiresAt: new Date(Date.now() + TRIAL_TTL_MS),
      });
    } catch (e) {
      // 并发下同密码双创建撞唯一索引，或任意失败：先清理刚种的孤儿数据再重查
      await deleteDemoData({ userIds: seeded.userIds, projectId: seeded.projectId }).catch(() => {});
      session = await TrialSession.findOne({ keyHash });
      if (!session) throw e;
    }
  }

  const user = await User.findById(session.userId);
  if (!user) throw new AppError(500, 'trial_broken', '试用环境异常，请重试');
  return {
    token: signToken(user._id.toString()),
    refreshToken: await issueRefreshToken(user._id),
    user: publicUser(user),
    trialExpiresAt: session.expiresAt.toISOString(),
  };
}

/** 销毁全部过期试用环境，返回销毁数量；单个失败不阻塞其余 */
export async function sweepExpiredTrials(now = new Date()): Promise<number> {
  const expired = await TrialSession.find({ expiresAt: { $lte: now } });
  let destroyed = 0;
  for (const session of expired) {
    try {
      await destroyTrial(session);
      destroyed += 1;
    } catch (e) {
      console.error(`[trial] 销毁试用环境 ${session._id} 失败:`, e);
    }
  }
  return destroyed;
}

/** 服务器入口调用：立即清扫一次，之后每 10 分钟一轮（unref，不阻塞退出） */
export function startTrialSweeper(): void {
  sweepExpiredTrials().catch((e) => console.error('[trial] 清扫失败:', e));
  setInterval(() => {
    sweepExpiredTrials().catch((e) => console.error('[trial] 清扫失败:', e));
  }, SWEEP_INTERVAL_MS).unref();
}
