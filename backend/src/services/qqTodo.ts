import { Membership } from '../models/Membership';
import { type Types } from 'mongoose';
import { Project, type IProject } from '../models/Project';
import { User, type IUser } from '../models/User';
import { config } from '../config';
import { parseTask } from './ai';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { createTodo } from './todos';

/**
 * QQ 群任务消息 → AI 解析 → 自动建待办：
 * 已绑定项目的群里成员 @机器人 发任务描述（如「周五前把海报送到印刷店 @小明」），
 * parseTask 解析出结构化字段后建单；消息中 @ 的群成员经三层对照
 * （member_openid → union_openid → 昵称唯一匹配）映射为项目成员写入 assigneeIds。
 * 整体自行兜底：任何异常只记日志 + 回「创建失败」，不向网关分发器上抛。
 */

interface GroupTaskPayload {
  id?: string;
  group_openid?: string;
  content?: string;
  author?: { member_openid?: string; union_openid?: string; username?: string };
  mentions?: { member_openid?: string; union_openid?: string; username?: string; bot?: boolean }[];
}

type MemberUser = Pick<IUser, 'name' | 'qqUnionOpenId' | 'qqMemberIds'> & { _id: Types.ObjectId };

/** 项目时区格式化 YYYY-MM-DD HH:mm；非法 tz 回落服务器时区 */
function formatInTz(d: Date, tz: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en', opts);
  } catch {
    fmt = new Intl.DateTimeFormat('en', { ...opts, timeZone: undefined });
  }
  const parts = fmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** AI 输出不可信：逐字段校验时间串，非法视为缺省（群/单聊录单共用） */
function toDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? undefined : t;
}

/** 「进行中」项目口径：与 routes/cron.ts 周报一致（draft/completed/archived/cancelled 排除） */
const ACTIVE_PROJECT_STATUSES = ['preparing', 'active', 'settling'];

export async function handleGroupTaskTodo(d: GroupTaskPayload): Promise<void> {
  const groupOpenid = d.group_openid;
  const msgId = d.id;
  const content = (d.content ?? '').trim();
  if (!groupOpenid || !msgId || !content) return;
  const reply = (text: string) => sendGroupMessage(groupOpenid, text, { msgId });
  try {
    const project = await Project.findOne({ 'qqGroups.groupOpenId': groupOpenid }).lean();
    if (!project) return; // 未绑定群：绑定提示由网关侧处理，本流程不管

    // 项目成员名单一次加载，身份匹配与成员校验复用
    const memberships = await Membership.find({ projectId: project._id }).lean();
    const members: MemberUser[] = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();

    // 三层对照：member_openid（群维度）→ union_openid（跨场景，可能为空）→ 昵称唯一匹配
    const resolveIdentity = (q: { member_openid?: string; union_openid?: string; username?: string }): MemberUser | null => {
      if (q.member_openid) {
        const hit = members.find((u) =>
          u.qqMemberIds?.some((m) => m.groupOpenId === groupOpenid && m.memberOpenId === q.member_openid),
        );
        if (hit) return hit;
      }
      if (q.union_openid) {
        const hit = members.find((u) => u.qqUnionOpenId === q.union_openid);
        if (hit) return hit;
      }
      if (q.username) {
        const name = q.username.trim();
        const hits = name ? members.filter((u) => u.name === name) : [];
        if (hits.length === 1) return hits[0];
      }
      return null;
    };

    const parsed = await parseTask(content, { now: new Date(), timezone: project.timezone });
    if (!parsed) {
      await reply('任务解析暂时不可用，请稍后重试，或在 ANON 待办页手动添加。');
      return;
    }
    if (!parsed.isTask) {
      await reply('未识别到任务内容。@我 并说明要办的事项即可创建待办（可带时间，如「周五前把海报送到印刷店」）。');
      return;
    }

    // AI 输出不可信：逐字段校验时间串，非法视为缺省
    const nodeAt = toDate(parsed.nodeAt);
    const dueAt = toDate(parsed.dueAt);
    const remindAt = toDate(parsed.remindAt);

    // mentions → assigneeIds（按 userId 去重）；未命中收集昵称。整体缺省合法，照常建单
    // 全量模式（GROUP_MESSAGE_CREATE）的 mentions 可能含机器人自己（bot=true）：剔除，不参与指派
    const assigneeIds: string[] = [];
    const assigneeNames: string[] = [];
    const unmatched: string[] = [];
    for (const m of (d.mentions ?? []).filter((x) => !x.bot)) {
      const hit = resolveIdentity(m);
      if (hit) {
        const uid = hit._id.toString();
        if (!assigneeIds.includes(uid)) {
          assigneeIds.push(uid);
          assigneeNames.push(hit.name);
        }
      } else if (m.username) {
        unmatched.push(m.username);
      }
    }

    const sender = d.author ? resolveIdentity(d.author) : null;
    const createdBy = sender?._id ?? project.createdBy;
    const actorName = d.author?.username ? `${d.author.username}（QQ 群）` : 'QQ 群';

    const todo = await createTodo({
      projectId: project._id,
      title: parsed.title.trim().slice(0, 200),
      assigneeIds,
      nodeAt,
      dueAt,
      remindAt,
      note: parsed.note,
      createdBy,
      actorName,
      qqSourceGroupOpenId: groupOpenid,
    });

    let text = `已创建待办「${todo.title}」`;
    if (assigneeNames.length) text += `\n指派：${assigneeNames.join('、')}`;
    if (dueAt) text += `\n截止：${formatInTz(dueAt, project.timezone)}`;
    if (nodeAt) text += `\n节点：${formatInTz(nodeAt, project.timezone)}`;
    if (remindAt) text += `\n提醒：${formatInTz(remindAt, project.timezone)}`;
    if (unmatched.length) text += `\n未识别成员：${unmatched.map((n) => `@${n}`).join('、')}（可在 ANON 待办页手动指派）`;
    if (config.publicBaseUrl) text += `\n查看：${config.publicBaseUrl}/p/${String(project._id)}?tab=todos`;
    await reply(text);
  } catch (err) {
    console.error('[qq-todo] 创建失败:', err);
    await reply('创建失败，请稍后在 ANON 待办页手动添加。').catch(() => {});
  }
}

/**
 * QQ 单聊（C2C）任务消息 → AI 解析 → 自动建待办：
 * 已绑定账号的用户私聊机器人直接发任务描述即可建单；发送者在多个「进行中」
 * 活动里有成员身份时，先回序号列表让用户选择归属（内存 pending 10 分钟 TTL，
 * 重启丢失可接受——用户重发任务即可）。C2C 负载无 mentions，单聊录单不做指派。
 * 被动回复一律挂当条消息 msg_id（5 分钟窗口）；序号回复自带新 msg_id，最终建单
 * 回复挂在序号消息上。整体自行兜底：异常只记日志 + 回「创建失败」，不上抛。
 */

interface C2cTaskPayload {
  id?: string;
  content?: string;
  author?: { user_openid?: string; union_openid?: string };
}

interface PendingC2cTodo {
  content: string; // 原始任务文本（项目时区未定，选中后再解析）
  projectIds: string[]; // 序号（1 起）→ projectId
  expiresAt: number;
}

const pendingC2cTodos = new Map<string, PendingC2cTodo>(); // key = user_openid
const PENDING_TTL_MS = 10 * 60_000;

function getPending(openid: string): PendingC2cTodo | null {
  const p = pendingC2cTodos.get(openid);
  if (p && p.expiresAt > Date.now()) return p;
  pendingC2cTodos.delete(openid);
  return null;
}

type C2cProject = Pick<IProject, 'name' | 'timezone'> & { _id: Types.ObjectId };
type C2cUser = Pick<IUser, 'name'> & { _id: Types.ObjectId };

/** project 已确定后的解析建单与结果回复（单项目直达与序号选定两路共用） */
async function parseAndCreateC2cTodo(
  project: C2cProject,
  user: C2cUser,
  content: string,
  reply: (text: string) => Promise<unknown>,
): Promise<void> {
  const parsed = await parseTask(content, { now: new Date(), timezone: project.timezone });
  if (!parsed) {
    await reply('任务解析暂时不可用，请稍后重试，或在 ANON 待办页手动添加。');
    return;
  }
  if (!parsed.isTask) {
    await reply('未识别到任务内容。发送要办的事项即可创建待办（可带时间，如「周五前把海报送到印刷店」）。');
    return;
  }
  const nodeAt = toDate(parsed.nodeAt);
  const dueAt = toDate(parsed.dueAt);
  const remindAt = toDate(parsed.remindAt);
  const todo = await createTodo({
    projectId: project._id,
    title: parsed.title.trim().slice(0, 200),
    assigneeIds: [],
    nodeAt,
    dueAt,
    remindAt,
    note: parsed.note,
    createdBy: user._id,
    actorName: `${user.name}（QQ 单聊）`,
  });
  let text = `已创建待办「${todo.title}」到活动「${project.name}」`;
  if (dueAt) text += `\n截止：${formatInTz(dueAt, project.timezone)}`;
  if (nodeAt) text += `\n节点：${formatInTz(nodeAt, project.timezone)}`;
  if (remindAt) text += `\n提醒：${formatInTz(remindAt, project.timezone)}`;
  if (config.publicBaseUrl) text += `\n查看：${config.publicBaseUrl}/p/${String(project._id)}?tab=todos`;
  await reply(text);
}

export async function handleC2cTaskTodo(d: C2cTaskPayload): Promise<void> {
  const openid = d.author?.user_openid;
  const msgId = d.id;
  const content = (d.content ?? '').trim();
  if (!openid || !msgId || !content) return;
  const reply = (text: string) => sendC2CMessage(openid, text, { msgId });
  try {
    // 纯数字 = 序号选择（确定性优先，不喂 AI）
    if (/^\d{1,2}$/.test(content)) {
      const pending = getPending(openid);
      if (!pending) {
        await reply('没有待选择的活动，请先发送任务描述。');
        return;
      }
      const n = Number(content);
      if (n === 0) {
        pendingC2cTodos.delete(openid);
        await reply('已取消。');
        return;
      }
      if (n > pending.projectIds.length) {
        await reply(`序号无效，请回复 1-${pending.projectIds.length} 之间的数字，或回复 0 取消。`);
        return; // 保留 pending 允许重试
      }
      pendingC2cTodos.delete(openid);
      // 选中后复核活动状态与成员身份仍有效（列表发出后可能已变更）
      const user = await User.findOne({ qqOpenId: openid }).lean();
      const [project, member] = await Promise.all([
        Project.findOne({ _id: pending.projectIds[n - 1], status: { $in: ACTIVE_PROJECT_STATUSES } }).lean(),
        user ? Membership.exists({ projectId: pending.projectIds[n - 1], userId: user._id }) : null,
      ]);
      if (!user || !project || !member) {
        await reply('该活动已不可用，请重新发送任务描述。');
        return;
      }
      await parseAndCreateC2cTodo(project, user, pending.content, reply);
      return;
    }

    // 新任务分支
    const user = await User.findOne({ qqOpenId: openid }).lean();
    if (!user) {
      await reply('先在 ANON「我的」页生成绑定码并发送「绑定 XXXXXX」关联账号，之后直接给我发任务描述即可创建待办。');
      return;
    }
    const memberships = await Membership.find({ userId: user._id }).lean();
    const projects = await Project.find({
      _id: { $in: memberships.map((m) => m.projectId) },
      status: { $in: ACTIVE_PROJECT_STATUSES },
    }).lean();
    // JS 排序：startDate 早的在前（无 startDate 排最后），再按 name——不依赖 FerretDB 多空值排序行为
    projects.sort((a, b) => {
      const ta = a.startDate ? a.startDate.getTime() : Number.POSITIVE_INFINITY;
      const tb = b.startDate ? b.startDate.getTime() : Number.POSITIVE_INFINITY;
      return ta - tb || a.name.localeCompare(b.name, 'zh');
    });
    if (projects.length === 0) {
      await reply('你当前没有进行中的活动，暂无可创建待办的项目。');
      return;
    }
    if (projects.length > 1) {
      pendingC2cTodos.set(openid, {
        content,
        projectIds: projects.map((p) => String(p._id)),
        expiresAt: Date.now() + PENDING_TTL_MS,
      });
      const list = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      await reply(`这条待办属于哪个活动？回复序号选择（回复 0 取消）：\n${list}`);
      return;
    }
    await parseAndCreateC2cTodo(projects[0], user, content, reply);
  } catch (err) {
    console.error('[qq-todo] 单聊创建失败:', err);
    await reply('创建失败，请稍后在 ANON 待办页手动添加。').catch(() => {});
  }
}
