import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { InviteCode } from '../models/InviteCode';
import { User, publicUser } from '../models/User';
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
    res.status(201).json({ token: signToken(user._id.toString()), user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const { email, password } = req.body ?? {};
    const user = await User.findOne({ email: String(email ?? '').toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(String(password ?? ''), user.passwordHash))) {
      throw new AppError(401, 'bad_credentials', '邮箱或密码错误');
    }
    res.json({ token: signToken(user._id.toString()), user: publicUser(user) });
  }),
);
