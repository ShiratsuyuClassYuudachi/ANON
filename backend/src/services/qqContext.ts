import { Membership } from '../models/Membership';
import { Project, type ProjectDoc } from '../models/Project';
import { User, type UserDoc } from '../models/User';
import { AppError } from '../utils/errors';

export interface QqMessage {
  id?: string;
  group_openid?: string;
  content?: string;
  author?: { user_openid?: string; member_openid?: string; union_openid?: string; username?: string };
  mentions?: { member_openid?: string; union_openid?: string; username?: string; bot?: boolean }[];
  attachments?: unknown[];
  message_type?: number;
}

export function qqSessionKey(d: QqMessage): string | null {
  if (!d.group_openid) return d.author?.user_openid ? JSON.stringify(['c2c', d.author.user_openid]) : null;
  const sender = d.author?.member_openid || d.author?.union_openid;
  return sender ? JSON.stringify(['group', d.group_openid, sender]) : null;
}

/** 写操作只接受稳定绑定身份，不以昵称或项目创建者兜底。 */
export async function resolveQqUser(d: QqMessage): Promise<UserDoc | null> {
  if (!d.group_openid) {
    if (!d.author?.user_openid) return null;
    const users = await User.find({ qqOpenId: d.author.user_openid }).limit(2);
    return users.length === 1 ? users[0] : null;
  }
  if (d.author?.member_openid) {
    const users = await User.find({ qqMemberIds: { $elemMatch: {
      groupOpenId: d.group_openid, memberOpenId: d.author.member_openid,
    } } }).limit(2);
    if (users.length) return users.length === 1 ? users[0] : null;
  }
  if (d.author?.union_openid) {
    const users = await User.find({ qqUnionOpenId: d.author.union_openid }).limit(2);
    return users.length === 1 ? users[0] : null;
  }
  return null;
}

export type QqWriteKind = 'signup' | 'finance' | 'material';
export async function qqCanWrite(user: UserDoc, project: ProjectDoc, kind: QqWriteKind): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const member = await Membership.findOne({ projectId: project._id, userId: user._id }).lean();
  const permissions = project.roles.find((r) => r.name === member?.roleName)?.permissions ?? [];
  const required = kind === 'signup' ? ['tools:manage'] : kind === 'material' ? ['materials:manage'] : ['finance:add', 'finance:manage'];
  return !!member && ['project:manage', ...required].some((p) => permissions.includes(p));
}

const ACTIVE_STATUSES = ['preparing', 'active', 'settling'];
export async function qqProjects(d: QqMessage, user: UserDoc, kind: QqWriteKind): Promise<ProjectDoc[]> {
  const memberships = d.group_openid ? [] : await Membership.find({ userId: user._id }).lean();
  const projects = await Project.find(d.group_openid
    ? { 'qqGroups.groupOpenId': d.group_openid }
    : { _id: { $in: memberships.map((m) => m.projectId) }, status: { $in: ACTIVE_STATUSES } });
  const eligible: ProjectDoc[] = [];
  for (const p of projects) if (await qqCanWrite(user, p, kind)) eligible.push(p);
  return eligible.sort((a, b) => (a.startDate?.getTime() ?? Infinity) - (b.startDate?.getTime() ?? Infinity)
    || a.name.localeCompare(b.name, 'zh') || String(a._id).localeCompare(String(b._id)));
}

export async function checkedQqProject(d: QqMessage, user: UserDoc, id: string, kind: QqWriteKind): Promise<ProjectDoc> {
  const project = await Project.findOne(d.group_openid
    ? { _id: id, 'qqGroups.groupOpenId': d.group_openid }
    : { _id: id, status: { $in: ACTIVE_STATUSES } });
  if (!project || !await qqCanWrite(user, project, kind)) {
    throw new AppError(403, 'forbidden', '活动已不可用或你没有操作权限，请重新开始录入。');
  }
  return project;
}

const queues = new Map<string, Promise<void>>();
/** 同一发送者的附件、结束、确认及绑定串行，避免异步下载与提交互相越过。 */
export async function serializeQqMessage(d: QqMessage, run: () => Promise<void>): Promise<void> {
  const key = qqSessionKey(d);
  if (!key) return run();
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(key, task);
  try { await task; } finally { if (queues.get(key) === task) queues.delete(key); }
}
