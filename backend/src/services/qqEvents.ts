import { Project } from '../models/Project';
import { User } from '../models/User';
import { aiConfigured } from './ai';
import { consumeBindCode } from './qqbot';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { handleGroupTaskTodo } from './qqTodo';

/**
 * QQ 事件分发：webhook 回调（routes/qqWebhook.ts）验签去重后调用 handleQQEvent。
 * 处理绑定流程、解绑清理、群@任务消息 AI 录单（不做自由对话）。
 * 事件帧（op/t/id）由 webhook 入口解析，本模块只关心 t + d。
 */

const INVALID_BIND_HINT = '绑定码无效或已过期，请在 ANON「我的」页重新生成。';
const INVALID_GROUP_BIND_HINT = '绑定码无效或已过期，请项目管理者在项目「设置」页重新生成。';
const FRIEND_GUIDE = '这里是 ANON 通知机器人。在 ANON 个人中心生成绑定码后，发送「绑定 XXXXXX」即可接收待办与里程碑提醒。';
const GROUP_GUIDE = '这里是 ANON 通知机器人。项目管理者在项目「设置」页生成绑定码后，@我 发送「绑定 XXXXXX」即可让本群接收项目通知。@我 发送任务描述（如「周五前把海报送到印刷店」）可直接创建待办。';

/** QQ 事件负载：字段全部可选，消费前逐个运行时校验 */
interface C2CMessagePayload {
  id?: string;
  author?: { user_openid?: string; union_openid?: string };
  content?: string;
}
interface GroupAtMessagePayload {
  id?: string;
  group_openid?: string;
  content?: string;
  author?: { member_openid?: string; union_openid?: string; username?: string };
  mentions?: { member_openid?: string; union_openid?: string; username?: string }[];
}
interface OpenidPayload {
  openid?: string;
}
interface GroupPayload {
  group_openid?: string;
}

/** 从消息文本提取绑定码：「绑定[:：] XXXXXX」或全文恰好 6 位字母数字 */
function extractBindCode(content: string): string | null {
  const m = /绑定\s*[:：]?\s*([A-Za-z0-9]{6})/i.exec(content);
  if (m) return m[1];
  const trimmed = content.trim();
  return /^[A-Za-z0-9]{6}$/.test(trimmed) ? trimmed : null;
}

async function handleC2CMessage(d: C2CMessagePayload): Promise<void> {
  const openid = d.author?.user_openid;
  if (!openid) return;
  const content = (d.content ?? '').trim();
  const code = extractBindCode(content);
  if (!code) {
    // 有绑定意图但码形不对 → 提示；其余消息忽略（不做对话）
    if (content.includes('绑定') && d.id) await sendC2CMessage(openid, INVALID_BIND_HINT, { msgId: d.id });
    return;
  }
  const bind = await consumeBindCode(code, 'user');
  if (!bind?.userId) {
    if (d.id) await sendC2CMessage(openid, INVALID_BIND_HINT, { msgId: d.id });
    return;
  }
  // union_openid 官方标注「可能为空」：仅在事件携带时写入，为空不覆盖已有值
  const user = await User.findByIdAndUpdate(
    bind.userId,
    { qqOpenId: openid, ...(d.author?.union_openid ? { qqUnionOpenId: d.author.union_openid } : {}) },
    { new: true },
  ).lean();
  if (d.id) {
    await sendC2CMessage(openid, `绑定成功：已关联 ANON 账号「${user?.name ?? ''}」，待办/里程碑等提醒将发送到这里。`, { msgId: d.id });
  }
}

async function handleGroupAtMessage(d: GroupAtMessagePayload): Promise<void> {
  const groupOpenid = d.group_openid;
  if (!groupOpenid) return;
  const content = (d.content ?? '').trim();
  console.log(`[qq] 群@消息: group=${groupOpenid} len=${content.length} author=${d.author?.username ?? '?'} mentions=${d.mentions?.length ?? 0}`);
  const code = extractBindCode(content);
  if (code) {
    // 先项目绑定码，未命中再试群内个人绑定码（@用户 指派解析依赖 qqMemberIds 对照表）
    const bind = await consumeBindCode(code, 'project');
    if (bind?.projectId) {
      const project = await Project.findByIdAndUpdate(bind.projectId, { qqGroupOpenId: groupOpenid }, { new: true }).lean();
      if (d.id) {
        await sendGroupMessage(groupOpenid, `已绑定项目「${project?.name ?? ''}」，里程碑临近、待办到期等通知将发送到本群。@我 发送任务描述（如「周五前把海报送到印刷店」）可直接创建待办。`, { msgId: d.id });
      }
      return;
    }
    const memberOpenid = d.author?.member_openid;
    const userBind = await consumeBindCode(code, 'user');
    if (userBind?.userId && memberOpenid) {
      const user = await User.findByIdAndUpdate(
        userBind.userId,
        {
          $addToSet: { qqMemberIds: { groupOpenId: groupOpenid, memberOpenId: memberOpenid } },
          ...(d.author?.union_openid ? { qqUnionOpenId: d.author.union_openid } : {}),
        },
        { new: true },
      ).lean();
      if (d.id) {
        await sendGroupMessage(groupOpenid, `绑定成功：已关联 ANON 账号「${user?.name ?? ''}」，群里 @你 创建的待办会指派到你名下。`, { msgId: d.id });
      }
      return;
    }
    if (d.id) await sendGroupMessage(groupOpenid, INVALID_GROUP_BIND_HINT, { msgId: d.id });
    return;
  }
  if (content.includes('绑定')) {
    if (d.id) await sendGroupMessage(groupOpenid, INVALID_GROUP_BIND_HINT, { msgId: d.id });
    return;
  }
  // 任务消息：仅已绑定项目且 AI 已配置时处理；否则静默忽略（渠道禁用语义）
  if (aiConfigured() && (await Project.exists({ qqGroupOpenId: groupOpenid }))) {
    await handleGroupTaskTodo(d);
  }
}

/**
 * QQ 事件分发（导出供单测与 webhook 路由；import 本模块无副作用）。
 * eventId 为事件最外层 id（FRIEND_ADD / GROUP_ADD_ROBOT 被动回信用）。
 */
// 事件负载为外部输入：以下 cast 目标字段全部可选，处理器内逐个运行时校验后才消费
export async function handleQQEvent(t: string, d: unknown, eventId?: string): Promise<void> {
  try {
    switch (t) {
      case 'C2C_MESSAGE_CREATE':
        await handleC2CMessage((d ?? {}) as C2CMessagePayload);
        break;
      case 'GROUP_AT_MESSAGE_CREATE':
        await handleGroupAtMessage((d ?? {}) as GroupAtMessagePayload);
        break;
      case 'FRIEND_ADD': {
        const { openid } = (d ?? {}) as OpenidPayload;
        if (openid) await sendC2CMessage(openid, FRIEND_GUIDE, { eventId });
        break;
      }
      case 'GROUP_ADD_ROBOT': {
        const { group_openid: groupOpenid } = (d ?? {}) as GroupPayload;
        if (groupOpenid) await sendGroupMessage(groupOpenid, GROUP_GUIDE, { eventId });
        break;
      }
      case 'FRIEND_DEL': {
        const { openid } = (d ?? {}) as OpenidPayload;
        if (openid) await User.updateMany({ qqOpenId: openid }, { $unset: { qqOpenId: 1 } });
        break;
      }
      case 'GROUP_DEL_ROBOT': {
        const { group_openid: groupOpenid } = (d ?? {}) as GroupPayload;
        if (groupOpenid) await Project.updateMany({ qqGroupOpenId: groupOpenid }, { $unset: { qqGroupOpenId: 1 } });
        break;
      }
      case 'C2C_MSG_REJECT':
      case 'GROUP_MSG_REJECT':
        // 用户/群关闭了主动消息开关：仅记录，不动绑定
        console.warn(`[qq] ${t}: 主动消息被拒`, d);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[qq] 事件处理失败 ${t}:`, err);
  }
}
