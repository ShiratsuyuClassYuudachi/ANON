import { badRequest, bodyObj, err, json, notFound, nowIso, requireProject, uid } from '../helpers';
import { publicProfile, requirePeoplePermission } from '../people';
import { def, type Route } from '../router';
import type { Ctx } from '../types';

function profile(ctx: Ctx) {
  const b = bodyObj(ctx);
  const out: { name?: string; duty?: string; contacts?: { platform: string; value: string }[] } = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) throw badRequest('姓名必填');
    out.name = b.name.trim();
  }
  if (b.duty !== undefined) {
    if (typeof b.duty !== 'string') throw badRequest('岗位须为文字');
    out.duty = b.duty.trim();
  }
  if (b.contacts !== undefined) {
    if (!Array.isArray(b.contacts)) throw badRequest('联系方式须为数组');
    out.contacts = b.contacts.map((c) => {
      if (!c || typeof c.platform !== 'string' || typeof c.value !== 'string' || !c.platform.trim() || !c.value.trim()) throw badRequest('联系方式的平台和内容均需填写');
      return { platform: c.platform.trim(), value: c.value.trim() };
    });
  }
  return out;
}
function find(ctx: Ctx) {
  const m = ctx.db.externalMembers.find((m) => m.projectId === ctx.params.pid && m.id === ctx.params.memberId);
  if (!m) throw notFound('成员不存在');
  return m;
}
export const externalMemberRoutes: Route[] = [
  def('GET', '/api/projects/:pid/external-members', async (ctx) => {
    requireProject(ctx);
    for (const key of ['includeArchived', 'includeLinked']) if (ctx.query.has(key) && !['true', 'false'].includes(ctx.query.get(key)!)) return badRequest(`${key} 须为布尔值`);
    return json({ externalMembers: ctx.db.externalMembers.filter((m) => m.projectId === ctx.params.pid && (!m.archivedAt || ctx.query.get('includeArchived') === 'true') && (!m.linkedUserId || ctx.query.get('includeLinked') === 'true')).map(publicProfile) });
  }),
  def('POST', '/api/projects/:pid/external-members', async (ctx) => {
    requirePeoplePermission(ctx, 'member:manage');
    const data = profile(ctx);
    if (!data.name) return badRequest('姓名必填');
    const m = { id: uid(), projectId: ctx.params.pid, name: data.name, duty: data.duty ?? '', contacts: data.contacts ?? [], archivedAt: null, linkedUserId: null, linkedAt: null };
    ctx.db.externalMembers.push(m);
    return json({ externalMember: publicProfile(m) }, 201);
  }),
  def('PATCH', '/api/projects/:pid/external-members/:memberId', async (ctx) => {
    requirePeoplePermission(ctx, 'member:manage');
    const m = find(ctx);
    const data = profile(ctx);
    const archived = bodyObj(ctx).archived;
    if (archived !== undefined && typeof archived !== 'boolean') return badRequest('archived 须为布尔值');
    Object.assign(m, data, archived === undefined ? {} : { archivedAt: archived ? nowIso() : null });
    return json({ externalMember: publicProfile(m) });
  }),
  def('POST', '/api/projects/:pid/external-members/:memberId/link', async (ctx) => {
    requirePeoplePermission(ctx, 'member:manage');
    const m = find(ctx);
    const userId = bodyObj(ctx).userId;
    if (typeof userId !== 'string' || !ctx.db.memberships.some((x) => x.projectId === ctx.params.pid && x.userId === userId)) return badRequest('只能关联本项目已入项的账号');
    if (m.linkedUserId && m.linkedUserId !== userId) return err(409, 'member_already_linked', '成员已关联其他账号');
    if (!m.linkedUserId) { m.linkedUserId = userId; m.linkedAt = nowIso(); }
    return json({ externalMember: publicProfile(m) });
  }),
];
