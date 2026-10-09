import type { Types } from 'mongoose';
import type { ExportMessage } from './qqChatExport';

/**
 * C2C「开始导出/结束导出」收集模式的会话状态（纯内存）。
 * 单副本部署可用；重启丢失进行中会话（可接受：结束时提示「没有正在进行的导出」）。
 * 惰性过期：访问时检查 TTL，不跑后台定时器。
 */

export interface CollectSession {
  userId: Types.ObjectId;
  userName: string;
  messages: ExportMessage[];
  startedAt: number;
  truncated: boolean;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_COLLECT = 500;

const sessions = new Map<string, CollectSession>();

/** 开启（或重新开始）收集会话 */
export function startCollect(openid: string, user: { id: string | Types.ObjectId; name: string }): void {
  sessions.set(openid, {
    userId: user.id as Types.ObjectId,
    userName: user.name || '未知',
    messages: [],
    startedAt: Date.now(),
    truncated: false,
  });
}

/** 取进行中的会话；过期即删除并返回 null */
export function getCollect(openid: string): CollectSession | null {
  const s = sessions.get(openid);
  if (!s) return null;
  if (Date.now() - s.startedAt > TTL_MS) {
    sessions.delete(openid);
    return null;
  }
  return s;
}

/** 追加消息；无会话返回 null，超上限截断并标记 */
export function appendCollect(openid: string, msgs: ExportMessage[]): { total: number; capped: boolean } | null {
  const s = getCollect(openid);
  if (!s) return null;
  const room = MAX_COLLECT - s.messages.length;
  const capped = msgs.length > room;
  s.messages.push(...msgs.slice(0, Math.max(room, 0)));
  if (capped) s.truncated = true;
  return { total: s.messages.length, capped };
}

/** 结束并取出会话（无会话返回 null） */
export function endCollect(openid: string): CollectSession | null {
  const s = getCollect(openid);
  sessions.delete(openid);
  return s;
}

/** 取消并丢弃会话；返回是否存在过会话 */
export function cancelCollect(openid: string): boolean {
  return sessions.delete(openid);
}
