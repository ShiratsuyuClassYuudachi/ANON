import { badRequest, bodyObj, canSee, json, notFound, nowIso, parseVis, requireProject, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbAccount } from '../types';

/** 与后端 accountJson 一致：otp 模式的 addedBy 带 contacts，其余不带 */
function accountJson(db: Db, a: DbAccount) {
  const adder = db.users.find((u) => u.id === a.addedBy);
  return {
    id: a.id,
    platform: a.platform,
    account: a.account,
    mode: a.mode,
    cipherKeySource: a.cipherKeySource,
    hasPassword: Boolean(a.passwordCipher ?? a.plainPassword),
    note: a.note,
    addedBy: adder
      ? a.mode === 'otp'
        ? { userId: adder.id, name: adder.name, contacts: adder.contacts }
        : { userId: adder.id, name: adder.name }
      : null,
    visibility: a.visibility,
    createdAt: a.createdAt,
  };
}

function findAccount(ctx: Ctx): DbAccount {
  const { db, params } = ctx;
  const a = db.accounts.find((x) => x.id === params.aid && x.projectId === params.pid);
  if (!a) throw notFound('账号不存在');
  return a;
}

const MODES = ['full', 'otp', 'contact'] as const;

/** full 模式密码入库：server 存「明文」（mock 服务端加解密）；user 存 ANONv 密文原样 */
function applyPassword(b: Record<string, unknown>, target: DbAccount): Response | null {
  const source = b.cipherKeySource === 'server' ? 'server' : 'user';
  if (source === 'server') {
    const password = String(b.password ?? '');
    if (!password) return badRequest('服务端加密模式需要提供明文密码');
    target.plainPassword = password;
    target.passwordCipher = null;
    target.cipherKeySource = 'server';
    return null;
  }
  const cipher = String(b.passwordCipher ?? '');
  if (!cipher.startsWith('ANONv')) return badRequest('浏览器加密模式需要提供 ANONv 格式的密文');
  target.passwordCipher = cipher;
  target.plainPassword = null;
  target.cipherKeySource = 'user';
  return null;
}

export const accountRoutes: Route[] = [
  def('GET', '/api/projects/:pid/accounts', async (ctx) => {
    const { db, params, query } = ctx;
    const { membership } = requireProject(ctx);
    const platform = query.get('platform');
    const accounts = db.accounts
      .filter((a) => a.projectId === params.pid)
      .filter((a) => !platform || a.platform === platform)
      .filter((a) => canSee(a.visibility, db.currentUserId, membership.roleName))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
    return json({ accounts: accounts.map((a) => accountJson(db, a)) });
  }),

  def('POST', '/api/projects/:pid/accounts', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.platform || !String(b.platform).trim()) return badRequest('平台必填');
    if (!b.account || !String(b.account).trim()) return badRequest('账号必填');
    if (!(MODES as readonly unknown[]).includes(b.mode)) return badRequest('mode 必须是 full/otp/contact');
    const a: DbAccount = {
      id: uid(),
      projectId: params.pid,
      platform: String(b.platform).trim(),
      account: String(b.account).trim(),
      mode: b.mode as DbAccount['mode'],
      cipherKeySource: null,
      passwordCipher: null,
      plainPassword: null,
      note: String(b.note ?? ''),
      addedBy: db.currentUserId,
      visibility: parseVis(b.visibility),
      createdAt: nowIso(),
    };
    if (a.mode === 'full') {
      const failed = applyPassword(b, a);
      if (failed) return failed;
    }
    db.accounts.push(a);
    return json({ account: accountJson(db, a) }, 201);
  }),

  def('PATCH', '/api/projects/:pid/accounts/:aid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const a = findAccount(ctx);
    const b = bodyObj(ctx);
    if (b.platform !== undefined) {
      if (!String(b.platform).trim()) return badRequest('平台不能为空');
      a.platform = String(b.platform).trim();
    }
    if (b.account !== undefined) {
      if (!String(b.account).trim()) return badRequest('账号不能为空');
      a.account = String(b.account).trim();
    }
    if (b.note !== undefined) a.note = String(b.note);
    if (b.visibility !== undefined) a.visibility = parseVis(b.visibility);
    if (b.mode !== undefined) {
      if (!(MODES as readonly unknown[]).includes(b.mode)) return badRequest('mode 必须是 full/otp/contact');
      a.mode = b.mode as DbAccount['mode'];
      if (a.mode !== 'full') {
        a.passwordCipher = null;
        a.plainPassword = null;
        a.cipherKeySource = null;
      }
    }
    if (b.password !== undefined || b.passwordCipher !== undefined) {
      if (a.mode !== 'full') return badRequest('仅 full 模式可设置密码');
      const failed = applyPassword(b, a);
      if (failed) return failed;
    }
    return json({ account: accountJson(db, a) });
  }),

  def('DELETE', '/api/projects/:pid/accounts/:aid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const a = findAccount(ctx);
    db.accounts.splice(db.accounts.indexOf(a), 1);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/accounts/:aid/reveal', async (ctx) => {
    requireProject(ctx);
    const a = findAccount(ctx);
    if (a.mode !== 'full' || (!a.passwordCipher && !a.plainPassword)) return badRequest('该账号没有可查看的密码');
    if (a.cipherKeySource === 'server') return json({ password: a.plainPassword });
    return json({ cipher: a.passwordCipher });
  }),
];
