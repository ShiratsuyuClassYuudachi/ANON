import type { ExternalMember } from '../types';
import type { Ctx, Db, DbTodo, DbWorkAssignee, DbWorkModule } from './types';
import { badRequest, err, myPermissions, requireProject } from './helpers';

export function requirePeoplePermission(ctx: Ctx, permission: string) {
  const { project, membership } = requireProject(ctx);
  const permissions = myPermissions(ctx.db, project, membership);
  if (!permissions.has('project:manage') && !permissions.has(permission)) throw err(403, 'forbidden', '没有权限');
}

export function linkedUser(db: Db, projectId: string, id: string): string | null {
  const profile = db.externalMembers.find((m) => m.projectId === projectId && m.id === id);
  return profile?.linkedUserId && db.memberships.some((m) => m.projectId === projectId && m.userId === profile.linkedUserId) ? profile.linkedUserId : null;
}

export function todoUsers(db: Db, t: DbTodo) {
  return [...new Set([...t.assigneeIds, ...(t.externalAssigneeIds ?? []).flatMap((id) => linkedUser(db, t.projectId, id) ?? [])])];
}
export function todoExternals(db: Db, t: DbTodo) {
  return [...new Set(t.externalAssigneeIds ?? [])].filter((id) => !linkedUser(db, t.projectId, id));
}
export function normalizeTodo(db: Db, t: DbTodo) {
  t.assigneeIds = todoUsers(db, t);
  t.externalAssigneeIds = todoExternals(db, t);
}

export function externalIds(ctx: Ctx, value: unknown, kept: string[] = []): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw badRequest('externalAssigneeIds 须为 ID 数组');
  const ids = [...new Set(value as string[])];
  if (ids.some((id) => !ctx.db.externalMembers.some((m) => m.projectId === ctx.params.pid && m.id === id && ((!m.archivedAt && !m.linkedUserId) || kept.includes(id))))) throw badRequest('指派人必须是本项目未归档、未关联的成员；原有指派可保留');
  return ids;
}

export function workAssignments(db: Db, m: DbWorkModule) {
  const registered = new Map<string, DbWorkAssignee>();
  const external: NonNullable<DbWorkModule['externalAssignees']> = [];
  const add = (a: DbWorkAssignee) => {
    const old = registered.get(a.userId);
    if (!old) { registered.set(a.userId, { ...a }); return; }
    const confirmed = !old.confirmedAt || (a.confirmedAt && a.confirmedAt < old.confirmedAt) ? a : old;
    const first = (a: string | null, b: string | null) => !a ? b : !b ? a : a < b ? a : b;
    registered.set(a.userId, { ...old, confirmedAt: confirmed.confirmedAt, confirmedBy: confirmed.confirmedBy,
      checkedInAt: first(old.checkedInAt, a.checkedInAt), completedAt: first(old.completedAt, a.completedAt) });
  };
  m.assignees.forEach(add);
  for (const a of m.externalAssignees ?? []) {
    const userId = linkedUser(db, m.projectId, a.externalMemberId);
    if (userId) add({ userId, confirmedAt: a.confirmedAt, confirmedBy: a.confirmedBy, checkedInAt: a.checkedInAt, completedAt: a.completedAt });
    else external.push({ ...a });
  }
  return { registered: [...registered.values()], external };
}
export function normalizeWork(db: Db, m: DbWorkModule) {
  const all = workAssignments(db, m);
  m.assignees = all.registered;
  m.externalAssignees = all.external;
}
export const blankState = () => ({ confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null });
export function publicProfile(m: ExternalMember) {
  return { id: m.id, name: m.name, duty: m.duty, contacts: m.contacts, archivedAt: m.archivedAt, linkedUserId: m.linkedUserId, linkedAt: m.linkedAt };
}
