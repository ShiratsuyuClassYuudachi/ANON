import { bodyObj, currentUser, err, fileResponse, getFileOr404, json, nowIso, uid } from '../helpers';
import { def } from '../router';
import type { DbUser } from '../types';
import type { Route } from '../router';

function userJson(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isSuperAdmin: u.isSuperAdmin,
    contacts: u.contacts,
    onboardedAt: u.onboardedAt,
  };
}

export const authRoutes: Route[] = [
  // 演示登录：接受任意凭据
  def('POST', '/api/auth/login', async (ctx) => {
    return json({ token: 'demo-token', refreshToken: 'demo-refresh-token', user: userJson(currentUser(ctx.db)) });
  }),

  // 演示 token 不过期，正常流程不会触发；兜底防登出
  def('POST', '/api/auth/refresh', async (ctx) => {
    return json({ token: 'demo-token', refreshToken: 'demo-refresh-token', user: userJson(currentUser(ctx.db)) });
  }),
  def('POST', '/api/auth/logout', async () => json({ ok: true })),

  // 演示环境关闭注册
  def('POST', '/api/auth/register', async () => {
    return err(403, 'demo_readonly', '演示环境无需注册，请从登录页直接进入演示');
  }),

  def('GET', '/api/me', async (ctx) => {
    return json({ user: userJson(currentUser(ctx.db)), trialExpiresAt: null });
  }),

  def('PATCH', '/api/me', async (ctx) => {
    const u = currentUser(ctx.db);
    const b = bodyObj(ctx);
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return err(400, 'bad_request', '姓名不能为空');
      u.name = String(b.name).trim();
    }
    if (b.contacts !== undefined) {
      if (!Array.isArray(b.contacts)) return err(400, 'bad_request', 'contacts 必须是数组');
      u.contacts = b.contacts.map((c: { platform?: string; value?: string }) => ({
        platform: String(c?.platform ?? ''),
        value: String(c?.value ?? ''),
      }));
    }
    return json({ user: userJson(u) });
  }),

  def('POST', '/api/me/onboarded', async (ctx) => {
    const u = currentUser(ctx.db);
    if (!u.onboardedAt) u.onboardedAt = nowIso();
    return json({ user: userJson(u) });
  }),

  // Push：未配置 VAPID，前端据此隐藏订阅入口
  def('GET', '/api/push/config', async () => json({ publicKey: null })),
  def('POST', '/api/push/subscription', async () => json({ ok: true })),
  def('DELETE', '/api/push/subscription', async () => json({ ok: true, removed: 1 })),

  // 管理页邀请码（演示用户非超管，页面入口隐藏；数据仍可直接访问）
  def('GET', '/api/admin/invite-codes', async (ctx) => {
    const inviteCodes = [...ctx.db.inviteCodes]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((d) => ({ id: d.id, code: d.code, used: d.used, usedAt: d.usedAt, createdAt: d.createdAt }));
    return json({ inviteCodes });
  }),

  def('POST', '/api/admin/invite-codes', async (ctx) => {
    const b = bodyObj(ctx);
    const code = b.code ? String(b.code) : `ANON-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
    const doc = { id: uid(), code, used: false, usedAt: null, createdAt: nowIso() };
    ctx.db.inviteCodes.push(doc);
    return json({ code: doc.code, id: doc.id }, 201);
  }),

  // 项目邀请：store 里查得到的用真实数据，否则给固定示例（便于直接演示 /invite/:token）
  def('GET', '/api/invites/:token', async (ctx) => {
    const { db, params } = ctx;
    const inv = db.invites.find((x) => x.token === params.token);
    if (inv) {
      const project = db.projects.find((p) => p.id === inv.projectId);
      return json({
        invite: {
          projectName: project?.name ?? '未知项目',
          roleName: inv.roleName,
          expiresAt: inv.expiresAt,
          targeted: !!inv.targetUserId,
        },
      });
    }
    return json({
      invite: {
        projectName: '示例·夏日同人祭',
        roleName: '成员',
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        targeted: false,
      },
    });
  }),

  def('POST', '/api/invites/:token/accept', async (ctx) => {
    const { db, params } = ctx;
    const inv = db.invites.find((x) => x.token === params.token);
    const projectId = inv?.projectId ?? 'p-demo';
    const roleName = inv?.roleName ?? '成员';
    const existing = db.memberships.find((m) => m.projectId === projectId && m.userId === db.currentUserId);
    if (existing) existing.roleName = roleName;
    else db.memberships.push({ projectId, userId: db.currentUserId, roleName });
    return json({ ok: true, projectId });
  }),

  // 附件下载（凭证/完成附件等）
  def('GET', '/api/files/:id', async (ctx) => {
    const f = getFileOr404(ctx.db, ctx.params.id);
    return fileResponse(f, ctx.origFetch, { download: true });
  }),
];
