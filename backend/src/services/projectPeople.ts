import { isValidObjectId, Types } from 'mongoose';
import { ExternalMember, type IExternalMember } from '../models/ExternalMember';
import { Membership } from '../models/Membership';
import { User } from '../models/User';
import type { TodoDoc } from '../models/Todo';
import type { IExternalWorkAssignee, IWorkAssignee, WorkModuleDoc } from '../models/WorkModule';
import { AppError } from '../utils/errors';

type External = IExternalMember & { _id: Types.ObjectId };
export function externalMemberJson(m: External) {
  return {
    id: String(m._id), name: m.name, duty: m.duty, contacts: m.contacts,
    archivedAt: m.archivedAt?.toISOString() ?? null,
    linkedUserId: m.linkedUserId ? String(m.linkedUserId) : null,
    linkedAt: m.linkedAt?.toISOString() ?? null,
  };
}

/** 注册成员与项目人员档案分开保存；关联只改变身份解析，不改写历史任务。 */
export class ProjectPeople extends Map<string, string> {
  externals = new Map<string, External>();
  links = new Map<string, string>();
  registeredContacts = new Map<string, { platform: string; value: string }[]>();
  roles = new Map<string, string>();

  externalIdsFor(userId: string) {
    return [...this.links].filter(([, id]) => id === userId).map(([id]) => id);
  }

  todoUserIds(t: { assigneeIds: Types.ObjectId[]; externalAssigneeIds?: Types.ObjectId[] }) {
    return [...new Set([
      ...t.assigneeIds.map(String),
      ...(t.externalAssigneeIds ?? []).flatMap((id) => this.links.get(String(id)) ?? []),
    ])];
  }

  todoExternalIds(t: { externalAssigneeIds?: Types.ObjectId[] }) {
    return [...new Set((t.externalAssigneeIds ?? []).map(String))].filter((id) => !this.links.has(id));
  }

  todoFilter(userId: string) {
    return { $or: [{ assigneeIds: userId }, { externalAssigneeIds: { $in: this.externalIdsFor(userId) } }] };
  }

  workFilter(userId: string) {
    return { $or: [{ 'assignees.userId': userId }, { 'externalAssignees.externalMemberId': { $in: this.externalIdsFor(userId) } }] };
  }

  workAssignments(m: { assignees: IWorkAssignee[]; externalAssignees?: IExternalWorkAssignee[] }) {
    const registered = new Map<string, IWorkAssignee>();
    const external = new Map<string, IExternalWorkAssignee>();
    for (const a of m.assignees) {
      const id = String(a.userId);
      registered.set(id, mergeState(registered.get(id), { ...stateOf(a), userId: a.userId }));
    }
    for (const a of m.externalAssignees ?? []) {
      const id = String(a.externalMemberId);
      const linked = this.links.get(id);
      if (linked) {
        registered.set(linked, mergeState(registered.get(linked), { ...stateOf(a), userId: new Types.ObjectId(linked) }));
      } else {
        external.set(id, mergeState(external.get(id), { ...stateOf(a), externalMemberId: a.externalMemberId }));
      }
    }
    return { registered: [...registered.values()], external: [...external.values()] };
  }

  normalizeTodo(t: TodoDoc) {
    t.assigneeIds = this.todoUserIds(t).map((id) => new Types.ObjectId(id));
    t.externalAssigneeIds = this.todoExternalIds(t).map((id) => new Types.ObjectId(id));
  }

  normalizeWork(m: WorkModuleDoc) {
    const all = this.workAssignments(m);
    m.assignees = all.registered;
    m.externalAssignees = all.external;
  }

  contacts() {
    const users = [...this].map(([userId, name]) => {
      const profiles = [...this.externals.values()].filter((m) => !m.archivedAt && this.links.get(String(m._id)) === userId);
      const contacts = [...(this.registeredContacts.get(userId) ?? []), ...profiles.flatMap((m) => m.contacts)];
      return {
        userId, name, roleName: this.roles.get(userId) ?? null,
        duty: [...new Set(profiles.map((m) => m.duty).filter(Boolean))].join('；'),
        contacts: contacts.filter((c, i) => contacts.findIndex((x) => x.platform === c.platform && x.value === c.value) === i),
      };
    });
    const externals = [...this.externals.values()]
      .filter((m) => !m.archivedAt && !m.linkedUserId)
      .map((m) => ({ userId: null, externalMemberId: String(m._id), name: m.name, duty: m.duty, roleName: null, contacts: m.contacts }));
    return [...users, ...externals].filter((m) => m.contacts.length);
  }
}

function stateOf(a: Omit<IWorkAssignee, 'userId'>) {
  return { confirmedAt: a.confirmedAt, confirmedBy: a.confirmedBy, checkedInAt: a.checkedInAt, completedAt: a.completedAt };
}

/** 合并重复身份，保留最早已发生的状态及对应确认人。 */
function mergeState<T extends Omit<IWorkAssignee, 'userId'>>(old: T | undefined, next: T): T {
  if (!old) return next;
  const confirmed = !old.confirmedAt || (next.confirmedAt && next.confirmedAt < old.confirmedAt) ? next : old;
  const earliest = (a?: Date, b?: Date) => !a ? b : !b ? a : a < b ? a : b;
  return { ...old, confirmedAt: confirmed.confirmedAt, confirmedBy: confirmed.confirmedBy,
    checkedInAt: earliest(old.checkedInAt, next.checkedInAt), completedAt: earliest(old.completedAt, next.completedAt) };
}

export async function loadProjectPeople(projectId: unknown): Promise<ProjectPeople> {
  const [members, external] = await Promise.all([
    Membership.find({ projectId }).lean(), ExternalMember.find({ projectId }).lean(),
  ]);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
  const people = new ProjectPeople();
  for (const u of users) {
    people.set(String(u._id), u.name);
    people.registeredContacts.set(String(u._id), u.contacts ?? []);
  }
  for (const m of members) people.roles.set(String(m.userId), m.roleName);
  for (const m of external) {
    people.externals.set(String(m._id), m);
    // 关联不会恢复成员资格；被移出项目的账号不再具有该身份。
    if (m.linkedUserId && people.has(String(m.linkedUserId))) people.links.set(String(m._id), String(m.linkedUserId));
  }
  return people;
}

export function parseAssigneeIds(value: unknown, field = 'externalAssigneeIds'): string[] {
  if (!Array.isArray(value)) throw new AppError(400, 'bad_request', `${field} 须为数组`);
  const ids = [...new Set(value.map(String))];
  if (ids.some((id) => !isValidObjectId(id))) throw new AppError(400, 'bad_request', `${field} 含非法 ID`);
  return ids;
}

export async function assertExternalAssignees(projectId: unknown, ids: string[], keptIds: string[] = []) {
  const members = await ExternalMember.find({ projectId, _id: { $in: ids } }).lean();
  if (members.length !== ids.length || members.some((m) => (m.archivedAt || m.linkedUserId) && !keptIds.includes(String(m._id)))) {
    throw new AppError(400, 'bad_request', '指派人必须是本项目未归档、未关联的成员；原有指派可保留');
  }
}
