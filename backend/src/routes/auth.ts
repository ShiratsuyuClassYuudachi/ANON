import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { InviteCode } from '../models/InviteCode';
import { User, publicUser } from '../models/User';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken } from '../services/session';
import { trialLogin } from '../services/trial';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';
import { signToken } from '../utils/jwt';

export const authRouter = Router();

authRouter.post(
  '/register',
  ah(async (req, res) => {
    const { inviteCode, email, name, password } = req.body ?? {};
    if (!email || !name || !password || String(password).length < 8) {
      throw new AppError(400, 'bad_request', '邮箱、姓名必填，密码至少 8 位');
    }
    const normalizedEmail = String(email).toLowerCase().trim();

    const userCount = await User.countDocuments();
    const isBootstrap =
      userCount === 0 && config.superAdminEmail !== '' && normalizedEmail === config.superAdminEmail;

    // 试用账号邮箱保留：首用户引导（SUPER_ADMIN_EMAIL 同为该邮箱）除外
    if (!isBootstrap && config.trialEmail && normalizedEmail === config.trialEmail) {
      throw new AppError(409, 'email_reserved', '该邮箱为试用账号保留');
    }

    let codeDoc = null;
    if (!isBootstrap) {
      if (!inviteCode) throw new AppError(400, 'invalid_invite', '邀请码无效或已被使用');
      codeDoc = await InviteCode.findOne({ code: String(inviteCode), usedBy: { $exists: false } });
      if (!codeDoc) throw new AppError(400, 'invalid_invite', '邀请码无效或已被使用');
    }

    if (await User.findOne({ email: normalizedEmail })) {
      throw new AppError(409, 'email_taken', '该邮箱已注册');
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await User.create({
      email: normalizedEmail,
      name: String(name),
      passwordHash,
      isSuperAdmin: isBootstrap,
      contacts: [],
      inviteCodeId: codeDoc?._id,
    });
    if (codeDoc) {
      codeDoc.usedBy = user._id;
      codeDoc.usedAt = new Date();
      await codeDoc.save();
    }
    res.status(201).json({
      token: signToken(user._id.toString()),
      refreshToken: await issueRefreshToken(user._id),
      user: publicUser(user),
    });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    const password = String(req.body?.password ?? '');
    // 试用入口：邮箱未被真实用户占用时，按密码 key 进入独立演示环境
    if (config.trialEmail && email === config.trialEmail) {
      const existing = await User.findOne({ email });
      if (!existing) {
        res.json(await trialLogin(password));
        return;
      }
      // 已有真实用户占用该邮箱（历史数据）：落入正常登录流程
    }
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(401, 'bad_credentials', '邮箱或密码错误');
    }
    res.json({
      token: signToken(user._id.toString()),
      refreshToken: await issueRefreshToken(user._id),
      user: publicUser(user),
    });
  }),
);

// 刷新：refresh token 本身是凭证，不鉴权；轮换旧凭证并签发新对
authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const rt = String(req.body?.refreshToken ?? '');
    if (!rt) throw new AppError(400, 'bad_request', '缺少 refreshToken');
    const rotated = await rotateRefreshToken(rt);
    if (!rotated) throw new AppError(401, 'invalid_refresh', '登录已过期，请重新登录');
    const user = await User.findById(rotated.userId);
    if (!user) throw new AppError(401, 'invalid_refresh', '登录已过期，请重新登录');
    res.json({
      token: signToken(user._id.toString()),
      refreshToken: rotated.refreshToken,
      user: publicUser(user),
    });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const rt = String(req.body?.refreshToken ?? '');
    if (rt) await revokeRefreshToken(rt);
    res.json({ ok: true });
  }),
);
