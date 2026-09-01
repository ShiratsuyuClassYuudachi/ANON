import WebSocket from 'ws';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { consumeBindCode } from './qqbot';
import { apiBase, getAccessToken, qqConfigured, sendC2CMessage, sendGroupMessage } from './qqApi';
import { aiConfigured } from './ai';
import { handleGroupTaskTodo } from './qqTodo';

/**
 * QQ 网关（WebSocket，出站连接，无需公网回调）：
 * 接收 C2C/群@消息与好友/群事件：绑定流程、解绑清理、群@任务消息 AI 录单（不做自由对话）。
 * op 协议：10 Hello(心跳) → 2 Identify / 6 Resume → 0 事件分发；7 重连、9 无效会话。
 * 断线指数退避重连；close 4009/op7 → Resume，4006/4007/op9 → 重新 Identify。
 */

const INTENTS_GROUP_AND_C2C = 1 << 25;

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
/** 网关帧（op/s/t/id 协议字段 + 事件负载 d） */
interface GatewayFrame {
  op?: number;
  d?: unknown;
  s?: number;
  t?: string;
  id?: string;
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
 * QQ 事件分发（导出供单测；import 本模块无副作用，网关由 startQQGateway 显式启动）。
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
        console.warn(`[qq-gateway] ${t}: 主动消息被拒`, d);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[qq-gateway] 事件处理失败 ${t}:`, err);
  }
}

// --- 连接生命周期 ---

interface GatewayState {
  sessionId: string | null;
  lastSeq: number | null;
  forceIdentify: boolean;
  /** 已处理事件 id 去重（同一 msg_id 可能重复推送），超 500 条 FIFO 淘汰 */
  seen: Set<string>;
}

/** 单次连接：连上 → 收发 → 关闭时 resolve（是否收到 READY 供退避重置） */
async function connectOnce(state: GatewayState): Promise<boolean> {
  const token = await getAccessToken();
  const gw = await fetch(`${apiBase()}/gateway`, {
    headers: { Authorization: `QQBot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!gw.ok) throw new Error(`GET /gateway HTTP ${gw.status}: ${await gw.text()}`);
  const { url } = (await gw.json()) as { url?: string };
  if (!url) throw new Error('GET /gateway 响应缺少 url');

  const { promise, resolve } = Promise.withResolvers<boolean>();
  {
    const ws = new WebSocket(url);
    let heartbeat: NodeJS.Timeout | null = null;
    let readySeen = false;
    /** 半连接探活：上一心跳未收到任何回包则判定连接已死 */
    let awaitingAck = false;
    // 握手守卫：对端不回复 Hello 时 ws 可能永不触发任何事件，15s 无 Hello 主动终止走重连
    const handshakeGuard = setTimeout(() => ws.terminate(), 15_000);

    const stopHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      awaitingAck = false;
    };
    const identify = () =>
      ws.send(JSON.stringify({
        op: 2,
        d: { token: `QQBot ${token}`, intents: INTENTS_GROUP_AND_C2C, shard: [0, 1], properties: {} },
      }));
    const resume = () =>
      ws.send(JSON.stringify({ op: 6, d: { token: `QQBot ${token}`, session_id: state.sessionId, seq: state.lastSeq } }));

    ws.on('message', (raw) => {
      awaitingAck = false; // 任何回包都证明连接存活
      let msg: GatewayFrame;
      try {
        msg = JSON.parse(raw.toString()) as GatewayFrame;
      } catch {
        return;
      }
      const { op, d, s, t, id } = msg;
      if (typeof s === 'number') state.lastSeq = s;
      switch (op) {
        case 10: { // Hello：起心跳，然后 Identify 或 Resume
          clearTimeout(handshakeGuard);
          stopHeartbeat();
          const hello = (d ?? {}) as { heartbeat_interval?: number };
          heartbeat = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (awaitingAck) {
              // 上一心跳无回包：半开连接，主动终止走重连
              ws.terminate();
              return;
            }
            awaitingAck = true;
            ws.send(JSON.stringify({ op: 1, d: state.lastSeq }));
          }, Number(hello.heartbeat_interval ?? 45_000));
          if (state.sessionId && state.lastSeq != null && !state.forceIdentify) resume();
          else identify();
          break;
        }
        case 0: // 事件分发
          if (t === 'READY') {
            state.sessionId = ((d ?? {}) as { session_id?: string }).session_id ?? state.sessionId;
            state.forceIdentify = false;
            readySeen = true;
            console.log('[qq-gateway] READY, session', state.sessionId);
          } else if (t) {
            const dedupKey =
              t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE' ? ((d ?? {}) as { id?: string }).id : id;
            if (dedupKey) {
              if (state.seen.has(dedupKey)) break;
              state.seen.add(dedupKey);
              if (state.seen.size > 500) state.seen.delete(state.seen.values().next().value!);
            }
            void handleQQEvent(t, d, id);
          }
          break;
        case 7: // 服务端要求重连：走 Resume
          ws.close(4009);
          break;
        case 9: // 无效会话：重新 Identify
          state.forceIdentify = true;
          state.sessionId = null;
          ws.close();
          break;
        default:
          break; // 11 心跳 ACK 等
      }
    });
    ws.on('error', (err) => console.error('[qq-gateway] ws error:', err));
    ws.on('close', (code) => {
      clearTimeout(handshakeGuard);
      stopHeartbeat();
      if (code === 4006 || code === 4007) {
        // 会话失效：重新 Identify
        state.forceIdentify = true;
        state.sessionId = null;
      }
      // 4009 及其他断线：保留 session，下次 op6 Resume
      resolve(readySeen);
    });
  }
  return promise;
}

async function connectLoop(): Promise<void> {
  const state: GatewayState = { sessionId: null, lastSeq: null, forceIdentify: false, seen: new Set() };
  let backoffMs = 1000;
  for (;;) {
    try {
      const readySeen = await connectOnce(state);
      if (readySeen) backoffMs = 1000;
    } catch (err) {
      console.error('[qq-gateway] 连接失败:', err);
    }
    console.warn(`[qq-gateway] ${backoffMs / 1000}s 后重连`);
    const { promise: nap, resolve: wake } = Promise.withResolvers<void>();
    setTimeout(wake, backoffMs);
    await nap;
    backoffMs = Math.min(backoffMs * 2, 60_000);
  }
}

let started = false;

/** 启动 QQ 网关长连接。未配置凭证或测试环境下静默跳过。 */
export function startQQGateway(): void {
  if (!qqConfigured() || process.env.NODE_ENV === 'test' || started) return;
  started = true;
  void connectLoop();
}
