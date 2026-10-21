import { config } from '../config';
import { Membership } from '../models/Membership';
import { User, type UserDoc } from '../models/User';
import type { ProjectDoc } from '../models/Project';
import { AppError } from '../utils/errors';
import { aiConfigured, parseFinance } from './ai';
import { createFinanceEntry, parseFinanceAmount } from './financeEntries';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { checkedQqProject, qqProjects, qqSessionKey, resolveQqUser, type QqMessage } from './qqContext';

type Entry = { type: 'income' | 'expense'; amountCents: number; note: string; payerUserId: string; splitAmong: string[] };
type State = { expiresAt: number; userId: string; original: QqMessage } & (
  | { step: 'project'; projectIds: string[] }
  | { step: 'confirm'; projectId: string; entry: Entry }
);
const sessions = new Map<string, State>();
const TTL = 10 * 60_000;
const reply = (d: QqMessage, text: string) => d.group_openid
  ? sendGroupMessage(d.group_openid, text, { msgId: d.id })
  : sendC2CMessage(d.author!.user_openid!, text, { msgId: d.id });

export function clearQqFinance(d: QqMessage): void {
  const key = qqSessionKey(d);
  if (key) sessions.delete(key);
}
function save(key: string, state: State): void {
  for (const [k, s] of sessions) if (s.expiresAt <= Date.now()) sessions.delete(k);
  sessions.set(key, state);
}

async function preview(original: QqMessage, current: QqMessage, user: UserDoc, project: ProjectDoc): Promise<void> {
  const parsed = await parseFinance(original.content ?? '');
  if (!parsed) {
    await reply(current, '记账解析暂时不可用，请稍后重试，或在 ANON 财务页手动添加。');
    return;
  }
  if (!parsed.type || parsed.amount === null) {
    await reply(current, '请一次说明一笔已发生的收支、人民币金额和事由，例如「记账：我买海报支出120.50元，全员平摊」。多笔账请拆开发送。');
    return;
  }
  const amountCents = parseFinanceAmount(parsed.amount);
  const ms = await Membership.find({ projectId: project._id }).lean();
  const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
  const resolveName = (name: string | null) => {
    const found = name === null || ['我', '本人', '自己'].includes(name)
      ? users.filter((u) => String(u._id) === String(user._id)) : users.filter((u) => u.name === name);
    if (found.length !== 1) throw new AppError(400, 'bad_request', `成员「${name ?? user.name}」不存在或重名，请在网页选择成员，或使用唯一姓名完整重发。`);
    return found[0];
  };
  const payer = resolveName(parsed.payerName);
  const split = parsed.splitNames?.map(resolveName) ?? [];
  const entry: Entry = { type: parsed.type, amountCents, note: parsed.note, payerUserId: String(payer._id), splitAmong: [...new Set(split.map((u) => String(u._id)))] };
  save(qqSessionKey(current)!, { step: 'confirm', original, userId: String(user._id), projectId: String(project._id), entry, expiresAt: Date.now() + TTL });
  await reply(current, `请确认记账：\n活动：${project.name}\n类型：${entry.type === 'income' ? '收入' : '支出'}\n金额：${(amountCents / 100).toFixed(2)} 元\n${entry.type === 'income' ? '收款人' : '付款人'}：${payer.name}${parsed.payerName === null ? '（默认本人）' : ''}\n平摊：${split.length ? split.map((u) => u.name).join('、') : '全员（随项目成员变动）'}\n事由：${entry.note || '未提供'}\n回复「确认」保存，回复「取消」或 0 放弃；修改请完整重发。${current.group_openid ? '\n群内回复请继续 @我。' : ''}`);
}

export async function beginQqFinance(original: QqMessage, current = original): Promise<void> {
  clearQqFinance(current);
  if (!aiConfigured()) {
    await reply(current, '记账需要配置 AI，当前暂不可用，请在 ANON 财务页手动添加。');
    return;
  }
  try {
    const user = await resolveQqUser(current);
    if (!user) {
      await reply(current, '请先在 ANON「我的」页生成个人绑定码并发送「绑定 XXXXXX」关联账号，再使用记账功能。');
      return;
    }
    const projects = await qqProjects(current, user, 'finance');
    if (!projects.length) await reply(current, '没有可记账的活动，请检查群绑定、活动状态及记账权限。');
    else if (projects.length === 1) await preview(original, current, user, projects[0]);
    else {
      save(qqSessionKey(current)!, { step: 'project', original, userId: String(user._id), projectIds: projects.map((p) => String(p._id)), expiresAt: Date.now() + TTL });
      await reply(current, `这笔账属于哪个活动？回复序号选择（0 取消）：\n${projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
    }
  } catch (err) { await fail(current, err); }
}

async function fail(d: QqMessage, err: unknown): Promise<void> {
  clearQqFinance(d);
  console.error('[qq-finance] 记账失败:', err instanceof AppError ? err.code : 'internal');
  await reply(d, err instanceof AppError ? err.message : '记账失败，请稍后重新发送，或在 ANON 财务页手动添加。').catch(() => {});
}

/** 仅消费已有记账会话的控制回复；完整新消息交回统一意图分流。 */
export async function handleQqFinance(d: QqMessage): Promise<boolean> {
  const key = qqSessionKey(d);
  if (!key || !d.id) return false;
  const content = (d.content ?? '').trim();
  const state = sessions.get(key);
  if (!state) return false;
  if (state.expiresAt <= Date.now()) {
    sessions.delete(key);
    if (/^(确认|取消|\d+)$/.test(content)) {
      await reply(d, '记账草稿已过期，请重新发送完整记账内容。');
      return true;
    }
    return false;
  }
  if (!/^(确认|取消|\d+)$/.test(content)) { sessions.delete(key); return false; }
  try {
    if (content === '取消' || content === '0') { sessions.delete(key); await reply(d, '已取消本次记账。'); return true; }
    const user = await resolveQqUser(d);
    if (!user || String(user._id) !== state.userId) throw new AppError(403, 'forbidden', '账号绑定已变化，请重新发送完整记账内容。');
    if (state.step === 'project') {
      const index = Number(content) - 1;
      if (!/^\d+$/.test(content) || !Number.isSafeInteger(index) || index < 0 || index >= state.projectIds.length) {
        await reply(d, `序号无效，请回复 1-${state.projectIds.length}，或 0 取消。`);
      } else {
        const project = await checkedQqProject(d, user, state.projectIds[index], 'finance');
        sessions.delete(key);
        await preview(state.original, d, user, project);
      }
      return true;
    }
    if (content !== '确认') { await reply(d, '请回复「确认」保存记账，或「取消」放弃。'); return true; }
    sessions.delete(key);
    const project = await checkedQqProject(d, user, state.projectId, 'finance');
    const tx = await createFinanceEntry({ ...state.entry, projectId: project._id, userId: String(user._id), userName: user.name });
    const delivered = await reply(d, `已记账：${tx.type === 'income' ? '收入' : '支出'} ${(tx.amountCents / 100).toFixed(2)} 元\n活动：${project.name}\n事由：${tx.note || '未提供'}${config.publicBaseUrl ? `\n查看：${config.publicBaseUrl}/p/${project._id}?tab=finance` : ''}`).catch(() => false);
    if (!delivered) console.error('[qq-finance] 账目已保存，但结果回复失败');
  } catch (err) { await fail(d, err); }
  return true;
}
