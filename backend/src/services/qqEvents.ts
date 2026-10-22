import type { Types } from 'mongoose';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { config } from '../config';
import { aiConfigured } from './ai';
import { consumeBindCode, QQ_GROUP_TYPE_KEYS } from './qqbot';
import { collectDirectMessage, exportMessagesToFile, parseForwardPayload } from './qqChatExport';
import { appendCollect, cancelCollect, endCollect, getCollect, startCollect } from './qqCollectSession';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { clearQqIntake, handleQqIntake, hasQqIntake } from './qqIntake';
import { qqControlText, serializeQqMessage, type QqMessage } from './qqContext';
import { beginQqFinance, handleQqFinance, hasQqFinance } from './qqFinance';
import { clearQqMaterials, handleQqMaterials, hasQqMaterials } from './qqMaterials';
import { qqHelpMenu, qqHelpReply } from './qqHelp';

/**
 * QQ 事件分发：webhook 回调（routes/qqWebhook.ts）验签去重后调用 handleQQEvent。
 * 处理帮助菜单、绑定流程、解绑清理、群@与单聊 AI 录入及物料上传（不做自由对话）。
 * 事件帧（op/t/id）由 webhook 入口解析，本模块只关心 t + d。
 */

const INVALID_BIND_HINT = '绑定码无效或已过期，请在 ANON「我的」页重新生成。';
const INVALID_GROUP_BIND_HINT = '绑定码无效或已过期，请项目管理者在项目「设置」页重新生成。';

/** QQ 事件负载：字段全部可选，消费前逐个运行时校验 */
interface C2CMessagePayload {
  id?: string;
  author?: { user_openid?: string; union_openid?: string };
  content?: string;
  /** 0=文本 3=卡片 101=并行 102=聊天记录（合并转发） 103=引用消息 */
  message_type?: number;
  message_scene?: { ext?: string[] };
  msg_elements?: unknown[];
  attachments?: unknown[];
}
interface GroupAtMessagePayload {
  id?: string;
  group_openid?: string;
  content?: string;
  author?: { member_openid?: string; union_openid?: string; username?: string };
  mentions?: { member_openid?: string; union_openid?: string; username?: string; bot?: boolean }[];
  message_type?: number;
  message_scene?: { ext?: string[] };
  msg_elements?: unknown[];
  attachments?: unknown[];
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

// --- 聊天记录导出（合并转发/其引用 → markdown 文件，回复主站下载链接） ---

/** 解析 → 建档 → 回复下载链接；visibilityHint 说明可见范围 */
async function runChatExport(
  d: unknown,
  attribution: { projectId?: Types.ObjectId; uploadedBy: Types.ObjectId },
  reply: (text: string) => Promise<boolean>,
  visibilityHint: string,
): Promise<void> {
  if (!config.publicBaseUrl) {
    console.error('[qq] 导出失败：未配置 PUBLIC_BASE_URL');
    await reply('服务器未配置 PUBLIC_BASE_URL，无法生成下载链接。');
    return;
  }
  const { messages, truncated } = parseForwardPayload(d);
  if (messages.length === 0) {
    await reply('未能从该消息解析出聊天内容。');
    return;
  }
  try {
    const file = await exportMessagesToFile(messages, truncated, attribution);
    const link = `${config.publicBaseUrl}/dl/${file._id}?name=${encodeURIComponent(file.filename)}`;
    await reply(`已导出 ${messages.length} 条消息：${link}\n需登录 ANON 下载，${visibilityHint}。`);
  } catch (err) {
    console.error('[qq] 聊天记录导出失败:', err);
    await reply('导出失败，请稍后重试。');
  }
}

/** C2C 合并转发导出：仅核验 QQ 已绑定 ANON 账号，文件归个人（仅本人/超管可见） */
async function handleC2cExport(d: C2CMessagePayload, openid: string): Promise<void> {
  const reply = (text: string) => (d.id ? sendC2CMessage(openid, text, { msgId: d.id }) : Promise.resolve(false));
  const user = await User.findOne({ qqOpenId: openid }).lean();
  if (!user) {
    await reply('请先在 ANON「我的」页生成绑定码并发送「绑定 XXXXXX」，完成绑定后再导出聊天记录。');
    return;
  }
  await runChatExport(d, { uploadedBy: user._id }, reply, '仅本人可见');
}

/** 群「引用回复转发 + @机器人 说导出」：文件归属本群绑定项目，项目成员可见 */
async function handleGroupExport(d: GroupAtMessagePayload, groupOpenid: string): Promise<void> {
  const reply = (text: string) => (d.id ? sendGroupMessage(groupOpenid, text, { msgId: d.id }) : Promise.resolve(false));
  const project = await Project.findOne({ 'qqGroups.groupOpenId': groupOpenid }).lean();
  if (!project) {
    await reply('本群未绑定项目，请项目管理者先在项目「设置」页生成绑定码并完成绑定。');
    return;
  }
  const memberOpenid = d.author?.member_openid;
  const user = memberOpenid
    ? await User.findOne({
        qqMemberIds: { $elemMatch: { groupOpenId: groupOpenid, memberOpenId: memberOpenid } },
      }).lean()
    : null;
  await runChatExport(d, { projectId: project._id, uploadedBy: user?._id ?? project.createdBy }, reply, '项目成员可见');
}

/** C2C 收集模式标记：开始导出（需已绑定）/ 结束导出（建档回链）/ 取消导出（丢弃） */
async function handleC2cCollectMarker(marker: string, openid: string, msgId?: string): Promise<void> {
  const reply = (text: string) => (msgId ? sendC2CMessage(openid, text, { msgId }) : Promise.resolve(false));
  if (marker === '开始导出') {
    const user = await User.findOne({ qqOpenId: openid }).lean();
    if (!user) {
      await reply('请先在 ANON「我的」页生成绑定码并发送「绑定 XXXXXX」，完成绑定后再导出聊天记录。');
      return;
    }
    startCollect(openid, { id: user._id, name: user.name });
    await reply('已开始收集聊天记录：接下来你发的文字、图片、转发的聊天记录都会并入本次导出。发完后回复「结束导出」；中途可回复「取消导出」。');
    return;
  }
  if (marker === '取消导出') {
    await reply(cancelCollect(openid) ? '已取消本次导出，收集的内容已丢弃。' : '当前没有正在进行的导出。发送「开始导出」开始收集。');
    return;
  }
  // 结束导出
  const session = endCollect(openid);
  if (!session) {
    await reply('当前没有正在进行的导出。发送「开始导出」开始收集。');
    return;
  }
  if (session.messages.length === 0) {
    await reply('本次没有收集到任何内容，未生成文件。');
    return;
  }
  if (!config.publicBaseUrl) {
    console.error('[qq] 导出失败：未配置 PUBLIC_BASE_URL');
    await reply('服务器未配置 PUBLIC_BASE_URL，无法生成下载链接。');
    return;
  }
  try {
    const file = await exportMessagesToFile(session.messages, session.truncated, { uploadedBy: session.userId });
    const link = `${config.publicBaseUrl}/dl/${file._id}?name=${encodeURIComponent(file.filename)}`;
    await reply(`已导出 ${session.messages.length} 条消息：${link}\n需登录 ANON 下载，仅本人可见。`);
  } catch (err) {
    console.error('[qq] 聊天记录导出失败:', err);
    await reply('导出失败，请稍后重试。');
  }
}

async function handleC2CMessage(d: C2CMessagePayload): Promise<void> {
  const openid = d.author?.user_openid;
  if (!openid) return;
  const reply = (text: string) => (d.id ? sendC2CMessage(openid, text, { msgId: d.id }) : Promise.resolve(false));
  const content = (d.content ?? '').trim();
  // 帮助在绑定、收集与草稿处理之前回复，不改动任何进行中的会话。
  const help = qqHelpReply(d);
  if (help) { await reply(help); return; }
  // 导出控制指令优先于绑定、收录与录单。
  if (content === '开始导出' || content === '结束导出' || content === '取消导出') {
    clearQqIntake(d);
    await clearQqMaterials(d);
    await handleC2cCollectMarker(content, openid, d.id);
    return;
  }
  const code = extractBindCode(content);
  // 绑定意图永远优先于收录与录单（102 转发 content 为整段拍平文本，不做绑定判断——保持原语义）
  if (d.message_type !== 102) {
    if (code) {
      clearQqIntake(d);
      await clearQqMaterials(d);
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
      return;
    }
    if (content.includes('绑定')) {
      if (d.id) await sendC2CMessage(openid, INVALID_BIND_HINT, { msgId: d.id });
      return;
    }
  }
  if (await handleQqMaterials(d)) {
    clearQqIntake(d);
    cancelCollect(openid);
    return;
  }
  // 收集模式：一切消息入档（含 102/103），不进即时导出与 AI 录单
  const session = getCollect(openid);
  if (session) {
    const msgs =
      d.message_type === 102 || d.message_type === 103
        ? parseForwardPayload(d).messages
        : await collectDirectMessage(content, d.attachments, session.userName);
    if (msgs.length === 0) {
      await reply('该消息没有可收集的内容，未并入。');
      return;
    }
    const r = appendCollect(openid, msgs);
    if (!r) {
      await reply('收集会话已过期，请重新发送「开始导出」。');
      return;
    }
    await reply(r.capped ? '本次收集已达 500 条上限，请发送「结束导出」生成文件。' : `已收录（本次共 ${r.total} 条）。`);
    return;
  }
  // 合并转发即时导出（转发 content 为占位文本，不应进入录单）
  if (d.message_type === 102) {
    clearQqIntake(d);
    await handleC2cExport(d, openid);
    return;
  }
  if (await handleQqFinance(d)) return;
  if (d.attachments?.length) {
    await reply('上传文件或图片前，请先发送「开始上传物料」，发完发送「结束上传物料」。记账请发送文字描述。');
    return;
  }
  if (/^记账(?:[：:\s]|$)/.test(content) && !aiConfigured()) { await beginQqFinance(d); return; }
  // 录入消息：AI 已配置时分流待办、舞台报名与记账；否则静默忽略。
  if (aiConfigured() && d.id) {
    await handleQqIntake(d);
  }
}

async function handleGroupAtMessage(d: GroupAtMessagePayload): Promise<void> {
  const groupOpenid = d.group_openid;
  if (!groupOpenid) return;
  const content = (d.content ?? '').trim();
  const help = qqHelpReply(d);
  if (help) {
    if (d.id) await sendGroupMessage(groupOpenid, help, { msgId: d.id });
    return;
  }
  console.log(`[qq] 群@消息: group=${groupOpenid} len=${content.length} author=${d.author?.username ?? '?'} mentions=${d.mentions?.length ?? 0}`);
  const code = extractBindCode(content);
  if (code) {
    clearQqIntake(d);
    await clearQqMaterials(d);
    // 先项目绑定码，未命中再试群内个人绑定码（@用户 指派解析依赖 qqMemberIds 对照表）
    const bind = await consumeBindCode(code, 'project');
    if (bind?.projectId) {
      // 一个群同一时刻只属于一个项目：先从其他项目移除，再（重置式）加入目标项目
      await Project.updateMany(
        { _id: { $ne: bind.projectId }, 'qqGroups.groupOpenId': groupOpenid },
        { $pull: { qqGroups: { groupOpenId: groupOpenid } } },
      );
      await Project.updateOne(
        { _id: bind.projectId },
        { $pull: { qqGroups: { groupOpenId: groupOpenid } } },
      );
      const project = await Project.findByIdAndUpdate(
        bind.projectId,
        { $push: { qqGroups: { groupOpenId: groupOpenid, types: QQ_GROUP_TYPE_KEYS, allowStageSignup: false } } },
        { new: true },
      ).lean();
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
  if (await handleQqMaterials(d)) { clearQqIntake(d); return; }
  if (await handleQqFinance(d)) return;
  if (d.attachments?.length) {
    if (d.id) await sendGroupMessage(groupOpenid, '上传文件或图片前，请先 @我 发送「开始上传物料」，发完发送「结束上传物料」。记账请发送文字描述。', { msgId: d.id });
    return;
  }
  if (/^记账(?:[：:\s]|$)/.test(content) && !aiConfigured()) { await beginQqFinance(d); return; }
  // 引用回复一条合并转发并说「导出」→ 导出被引用的聊天记录（置于 AI 录单之前）
  if (d.message_type === 103 && content.includes('导出')) {
    clearQqIntake(d);
    await handleGroupExport(d, groupOpenid);
    return;
  }
  // 录入消息：仅已绑定项目且 AI 已配置时分流待办、舞台报名与记账。
  if (aiConfigured() && (await Project.exists({ 'qqGroups.groupOpenId': groupOpenid }))) {
    await handleQqIntake(d);
  }
}

/**
 * QQ 事件分发（导出供单测与 webhook 路由；import 本模块无副作用）。
 * eventId 为事件最外层 id（FRIEND_ADD / GROUP_ADD_ROBOT 被动回信用）。
 */
// 事件负载为外部输入：以下 cast 目标字段全部可选，处理器内逐个运行时校验后才消费
async function dispatchQQEvent(t: string, d: unknown, eventId?: string): Promise<void> {
  try {
    // spike：观察富类型事件（102/103 等）与携带附件消息的真实形状（QQ_DEBUG_EVENTS=1 开启）
    const dd = d as Record<string, unknown> | null;
    const mt = dd?.message_type;
    const hasAtt = Array.isArray(dd?.attachments) && (dd.attachments as unknown[]).length > 0;
    if (process.env.QQ_DEBUG_EVENTS === '1' && ((typeof mt === 'number' && mt >= 100) || hasAtt)) {
      console.log(`[qq] debug event ${t}:`, JSON.stringify(d)?.slice(0, 8192));
      // content 体积大且已解析，结构字段（message_scene/attachments 等）单独完整输出
      if (dd && typeof dd === 'object') {
        const { content, ...rest } = dd;
        console.log(`[qq] debug event meta (content len=${typeof content === 'string' ? content.length : 0}):`, JSON.stringify(rest));
      }
    }
    switch (t) {
      case 'C2C_MESSAGE_CREATE':
        await handleC2CMessage((d ?? {}) as C2CMessagePayload);
        break;
      case 'GROUP_AT_MESSAGE_CREATE':
        await handleGroupAtMessage((d ?? {}) as GroupAtMessagePayload);
        break;
      case 'GROUP_MESSAGE_CREATE': {
        // 普通群消息仅接收本人已有会话的控制回复，其他聊天不进入 AI 或清除草稿。
        const payload = (d ?? {}) as GroupAtMessagePayload;
        const pendingReply = qqControlText(payload) !== null && (hasQqIntake(payload) || hasQqFinance(payload));
        if (payload.mentions?.some((m) => m.bot) || hasQqMaterials(payload) || pendingReply) await handleGroupAtMessage(payload);
        break;
      }
      case 'FRIEND_ADD': {
        const { openid } = (d ?? {}) as OpenidPayload;
        if (openid) await sendC2CMessage(openid, qqHelpMenu(false), { eventId });
        break;
      }
      case 'GROUP_ADD_ROBOT': {
        const { group_openid: groupOpenid } = (d ?? {}) as GroupPayload;
        if (groupOpenid) await sendGroupMessage(groupOpenid, qqHelpMenu(true), { eventId });
        break;
      }
      case 'FRIEND_DEL': {
        const { openid } = (d ?? {}) as OpenidPayload;
        if (openid) await User.updateMany({ qqOpenId: openid }, { $unset: { qqOpenId: 1 } });
        break;
      }
      case 'GROUP_DEL_ROBOT': {
        const { group_openid: groupOpenid } = (d ?? {}) as GroupPayload;
        if (groupOpenid) await Project.updateMany({ 'qqGroups.groupOpenId': groupOpenid }, { $pull: { qqGroups: { groupOpenId: groupOpenid } } });
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

/** 同一会话的下载、绑定和确认按到达顺序处理。 */
export async function handleQQEvent(t: string, d: unknown, eventId?: string): Promise<void> {
  if (['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'].includes(t)) {
    const payload = (d ?? {}) as QqMessage;
    const control = t === 'C2C_MESSAGE_CREATE' ? null : qqControlText(payload);
    const message = control === null ? d : { ...payload, content: control };
    await serializeQqMessage(payload, () => dispatchQQEvent(t, message, eventId));
  } else await dispatchQQEvent(t, d, eventId);
}
