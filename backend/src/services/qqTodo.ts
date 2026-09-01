import { Membership } from '../models/Membership';
import { type Types } from 'mongoose';
import { Project } from '../models/Project';
import { User, type IUser } from '../models/User';
import { config } from '../config';
import { parseTask } from './ai';
import { sendGroupMessage } from './qqApi';
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
  mentions?: { member_openid?: string; union_openid?: string; username?: string }[];
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

export async function handleGroupTaskTodo(d: GroupTaskPayload): Promise<void> {
  const groupOpenid = d.group_openid;
  const msgId = d.id;
  const content = (d.content ?? '').trim();
  if (!groupOpenid || !msgId || !content) return;
  const reply = (text: string) => sendGroupMessage(groupOpenid, text, { msgId });
  try {
    const project = await Project.findOne({ qqGroupOpenId: groupOpenid }).lean();
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
    const toDate = (s: string | null): Date | undefined => {
      if (!s) return undefined;
      const t = new Date(s);
      return Number.isNaN(t.getTime()) ? undefined : t;
    };
    const nodeAt = toDate(parsed.nodeAt);
    const dueAt = toDate(parsed.dueAt);
    const remindAt = toDate(parsed.remindAt);

    // mentions → assigneeIds（按 userId 去重）；未命中收集昵称。整体缺省合法，照常建单
    const assigneeIds: string[] = [];
    const assigneeNames: string[] = [];
    const unmatched: string[] = [];
    for (const m of d.mentions ?? []) {
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
