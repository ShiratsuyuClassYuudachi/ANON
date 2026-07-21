import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { PlatformAccount, type IVisibility, type PlatformAccountDoc } from '../models/PlatformAccount';
import { User } from '../models/User';
import { serverDecrypt, serverEncrypt } from '../services/platformCrypto';
import { isVisible, type VisibilityContext } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: PlatformAccountDoc;
    }
  }
}

export const accountsRouter = Router({ mergeParams: true });
accountsRouter.use(authRequired, loadMembership);

const MODES = ['full', 'otp', 'contact'] as const;
const USER_CIPHER_PREFIX = 'ANONv1:';

function visibilityCtx(req: import('express').Request): VisibilityContext {
  return {
    userId: req.userId!,
    roleName: req.membership?.roleName ?? null,
    isSuperAdmin: req.user?.isSuperAdmin ?? false,
  };
}

async function accountJson(a: PlatformAccountDoc) {
  const adder = await User.findById(a.addedBy).lean();
  return {
    id: a._id.toString(),
    platform: a.platform,
    account: a.account,
    mode: a.mode,
    cipherKeySource: a.cipherKeySource ?? null,
    hasPassword: Boolean(a.passwordCipher),
    note: a.note,
    addedBy: adder
      ? { userId: adder._id.toString(), name: adder.name, contacts: adder.contacts }
      : null,
    visibility: {
      userIds: (a.visibility?.userIds ?? []).map((id) => id.toString()),
      roleNames: a.visibility?.roleNames ?? [],
    },
    createdAt: (a as unknown as { createdAt: Date }).createdAt,
  };
}

async function parseVisibility(projectId: unknown, roleNames: string[], raw: unknown): Promise<IVisibility> {
  if (raw === undefined) return { userIds: [], roleNames: [] } as IVisibility;
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError(400, 'bad_request', 'visibility 格式无效');
  }
  const v = raw as { userIds?: unknown; roleNames?: unknown };
  const userIds: string[] = Array.isArray(v.userIds) ? v.userIds.map(String) : [];
  const names: string[] = Array.isArray(v.roleNames) ? v.roleNames.map(String) : [];
  if (userIds.length) {
    const count = await Membership.countDocuments({ projectId, userId: { $in: userIds } });
    if (count !== new Set(userIds).size) {
      throw new AppError(400, 'bad_request', '可见范围内的用户必须是项目成员');
    }
  }
  for (const name of names) {
    if (!roleNames.includes(name)) throw new AppError(400, 'bad_request', `角色 ${name} 不存在`);
  }
  return { userIds, roleNames: names } as unknown as IVisibility;
}

// full 模式的密码入库：server = 明文由服务端加密；user（默认）= 前端已加密的 ANONv1 密文原样存储
function applyPassword(
  body: { cipherKeySource?: unknown; password?: unknown; passwordCipher?: unknown },
  target: { passwordCipher?: string; cipherKeySource?: 'user' | 'server' },
) {
  const source = body.cipherKeySource === 'server' ? 'server' : 'user';
  if (source === 'server') {
    const password = String(body.password ?? '');
    if (!password) throw new AppError(400, 'bad_request', '服务端加密模式需要提供明文密码');
    target.passwordCipher = serverEncrypt(password);
    target.cipherKeySource = 'server';
  } else {
    const cipher = String(body.passwordCipher ?? '');
    if (!cipher.startsWith(USER_CIPHER_PREFIX)) {
      throw new AppError(400, 'bad_request', '浏览器加密模式需要提供 ANONv1 格式的密文');
    }
    target.passwordCipher = cipher;
    target.cipherKeySource = 'user';
  }
}

accountsRouter.get(
  '/',
  ah(async (req, res) => {
    const filter: Record<string, unknown> = { projectId: req.project!._id };
    if (req.query.platform) filter.platform = String(req.query.platform);
    const accounts = await PlatformAccount.find(filter).sort({ createdAt: -1, _id: -1 });
    const ctx = visibilityCtx(req);
    const visible = accounts.filter((a) => isVisible(a.visibility, ctx));
    res.json({ accounts: await Promise.all(visible.map(accountJson)) });
  }),
);

accountsRouter.post(
  '/',
  ...requirePermission('accounts:manage'),
  ah(async (req, res) => {
    const { platform, account, mode, note, visibility } = req.body ?? {};
    if (!platform || !String(platform).trim()) throw new AppError(400, 'bad_request', '平台必填');
    if (!account || !String(account).trim()) throw new AppError(400, 'bad_request', '账号必填');
    if (!MODES.includes(mode)) throw new AppError(400, 'bad_request', 'mode 必须是 full/otp/contact');
    const doc = new PlatformAccount({
      projectId: req.project!._id,
      platform: String(platform).trim(),
      account: String(account).trim(),
      mode,
      note: String(note ?? ''),
      addedBy: req.userId,
      visibility: await parseVisibility(
        req.project!._id,
        req.project!.roles.map((r) => r.name),
        visibility,
      ),
    });
    if (mode === 'full') applyPassword(req.body ?? {}, doc);
    await doc.save();
    res.status(201).json({ account: await accountJson(doc) });
  }),
);

const loadAccount = ah(async (req, _res, next) => {
  const doc = await PlatformAccount.findOne({ _id: req.params.accountId, projectId: req.project!._id });
  if (!doc) throw new AppError(404, 'not_found', '账号不存在');
  if (!isVisible(doc.visibility, visibilityCtx(req))) {
    throw new AppError(403, 'forbidden', '不在该账号的可见范围内');
  }
  req.account = doc;
  next();
});

accountsRouter.patch(
  '/:accountId',
  ...requirePermission('accounts:manage'),
  loadAccount,
  ah(async (req, res) => {
    const doc = req.account!;
    const { platform, account, mode, note, visibility } = req.body ?? {};
    if (platform !== undefined) doc.platform = String(platform).trim();
    if (account !== undefined) doc.account = String(account).trim();
    if (note !== undefined) doc.note = String(note);
    if (visibility !== undefined) {
      doc.visibility = (await parseVisibility(
        req.project!._id,
        req.project!.roles.map((r) => r.name),
        visibility,
      )) as never;
    }
    if (mode !== undefined) {
      if (!MODES.includes(mode)) throw new AppError(400, 'bad_request', 'mode 必须是 full/otp/contact');
      doc.mode = mode;
      if (mode !== 'full') {
        doc.passwordCipher = undefined;
        doc.cipherKeySource = undefined;
      }
    }
    if (req.body?.password !== undefined || req.body?.passwordCipher !== undefined) {
      if (doc.mode !== 'full') throw new AppError(400, 'bad_request', '仅 full 模式可设置密码');
      applyPassword(req.body, doc);
    }
    await doc.save();
    res.json({ account: await accountJson(doc) });
  }),
);

accountsRouter.delete(
  '/:accountId',
  ...requirePermission('accounts:manage'),
  loadAccount,
  ah(async (req, res) => {
    await PlatformAccount.deleteOne({ _id: req.account!._id });
    res.json({ ok: true });
  }),
);

accountsRouter.post(
  '/:accountId/reveal',
  loadAccount,
  ah(async (req, res) => {
    const doc = req.account!;
    if (doc.mode !== 'full' || !doc.passwordCipher) {
      throw new AppError(400, 'bad_request', '该账号没有可查看的密码');
    }
    if (doc.cipherKeySource === 'server') {
      res.json({ password: serverDecrypt(doc.passwordCipher) });
    } else {
      // user 模式：只回密文，前端用保险库口令本地解密
      res.json({ cipher: doc.passwordCipher });
    }
  }),
);
