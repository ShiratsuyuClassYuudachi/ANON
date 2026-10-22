import { config } from '../config';
import { Project, type ProjectDoc } from '../models/Project';
import { StageSignup } from '../models/StageSignup';
import type { UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { classifyIntake, parseStageSignup } from './ai';
import { checkedQqProject, qqCanWrite, qqProjects, qqSessionKey as sessionKey, resolveQqUser as resolveUser, type QqMessage } from './qqContext';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { clearPendingC2cTodo, handleC2cTaskTodo, handleGroupTaskTodo } from './qqTodo';
import { beginQqFinance, clearQqFinance } from './qqFinance';
import { addSignupItem, type SignupItemInput } from './stageSignups';

/** 群与单聊共享的消息分流；绑定、导出由 qqEvents 优先处理。 */
export type QqIntakePayload = QqMessage;

type Session = { expiresAt: number; original: QqIntakePayload } & (
  | { step: 'intent' }
  | { step: 'project'; userId: string; projectIds: string[] }
  | { step: 'batch'; userId: string; projectId: string; signupIds: string[]; item: SignupItemInput }
  | { step: 'confirm'; userId: string; projectId: string; signupId: string; item: SignupItemInput }
);

const sessions = new Map<string, Session>();
const queues = new Map<string, Promise<void>>();
const TTL_MS = 10 * 60_000;

/** 只用于将同一发送者的群内控制回复交回已有会话；到期仍由处理器给出提示。 */
export function hasQqIntake(d: QqIntakePayload): boolean {
  const key = sessionKey(d);
  return !!key && sessions.has(key);
}

/** 绑定或进入导出时丢弃草稿；保存前仍会复核身份，不能借旧会话跨账号提交。 */
export function clearQqIntake(d: QqIntakePayload): void {
  const key = sessionKey(d);
  if (key) sessions.delete(key);
  clearQqFinance(d);
  if (!d.group_openid && d.author?.user_openid) clearPendingC2cTodo(d.author.user_openid);
}

function save(key: string, state: Session): void {
  for (const [k, s] of sessions) if (s.expiresAt <= Date.now()) sessions.delete(k);
  sessions.set(key, state);
}

const canManage = (user: UserDoc, project: ProjectDoc) => qqCanWrite(user, project, 'signup');
const checkedProject = (d: QqIntakePayload, user: UserDoc, id: string) => checkedQqProject(d, user, id, 'signup');

type Reply = (text: string) => Promise<boolean>;

async function runTodo(original: QqIntakePayload, current: QqIntakePayload): Promise<void> {
  const d = { ...original, id: current.id };
  if (d.group_openid) await handleGroupTaskTodo(d);
  else await handleC2cTaskTodo(d);
}

async function preview(
  key: string, original: QqIntakePayload, user: UserDoc, project: ProjectDoc,
  signupId: string, item: SignupItemInput, reply: Reply,
): Promise<void> {
  const signup = await StageSignup.findOne({ _id: signupId, projectId: project._id }).lean();
  if (!signup) throw new AppError(404, 'not_found', '报名批次已不存在，请重新发送节目资料。');
  save(key, { step: 'confirm', original, userId: String(user._id), projectId: String(project._id), signupId, item, expiresAt: Date.now() + TTL_MS });
  const participants = item.participants.map((p) => `${p.cn}${p.contact ? `（${p.contact}）` : ''}`).join('、') || '未提供';
  await reply(`请确认节目报名：\n活动：${project.name}\n批次：${signup.name}\n节目：${item.name}\n时长：${item.durationMin} 分钟\n报名人：${participants}\n备注：${item.note || '无'}\n回复「确认」保存为待审核，回复「取消」或 0 放弃；修改资料请完整重发。${original.group_openid ? '\n群内回复请继续 @我。' : ''}`);
}

async function chooseBatch(key: string, original: QqIntakePayload, user: UserDoc, project: ProjectDoc, reply: Reply): Promise<void> {
  const parsed = await parseStageSignup(original.content ?? '');
  if (!parsed) {
    await reply('节目资料解析暂时不可用，请稍后重试，或在 ANON 舞台报名审核页手动添加。');
    return;
  }
  if (!parsed.name || parsed.durationMin === null || !Number.isInteger(parsed.durationMin) || parsed.durationMin < 1 || parsed.durationMin > 1440) {
    await reply('请一次提供一个节目的名称和时长（1–1440 分钟整数），补全后完整重发。例如「帮小明报名歌曲《追光》，5分钟，QQ 12345」。');
    return;
  }
  const item: SignupItemInput = { ...parsed, durationMin: parsed.durationMin };
  const signups = await StageSignup.find({ projectId: project._id }).sort({ startAt: 1, createdAt: 1, _id: 1 }).lean();
  if (!signups.length) {
    await reply('该活动暂无报名批次，请先在 ANON「工具 → 舞台报名审核」创建批次，再重新发送节目资料。');
  } else if (signups.length === 1) {
    await preview(key, original, user, project, String(signups[0]._id), item, reply);
  } else {
    save(key, { step: 'batch', original, userId: String(user._id), projectId: String(project._id), signupIds: signups.map((s) => String(s._id)), item, expiresAt: Date.now() + TTL_MS });
    await reply(`请选择报名批次，回复序号（0 取消）：\n${signups.map((s, i) => `${i + 1}. ${s.name}（${s.startAt.toISOString()}）`).join('\n')}`);
  }
}

async function beginSignup(key: string, original: QqIntakePayload, current: QqIntakePayload, reply: Reply): Promise<void> {
  const user = await resolveUser(current);
  if (!user) {
    await reply('请先在 ANON「我的」页生成个人绑定码，并在当前会话发送「绑定 XXXXXX」关联账号；录入节目需要工具管理权限。');
    return;
  }
  if (current.group_openid) {
    const project = await Project.findOne({ 'qqGroups.groupOpenId': current.group_openid });
    if (!project || !await canManage(user, project)) {
      await reply('你没有本项目的工具管理权限，无法通过机器人录入节目。');
      return;
    }
    await chooseBatch(key, original, user, project, reply);
    return;
  }
  const eligible = await qqProjects(current, user, 'signup');
  if (!eligible.length) {
    await reply('你当前没有具有工具管理权限的进行中活动，暂无可录入节目的项目。');
  } else if (eligible.length === 1) {
    await chooseBatch(key, original, user, eligible[0], reply);
  } else {
    save(key, { step: 'project', original, userId: String(user._id), projectIds: eligible.map((p) => String(p._id)), expiresAt: Date.now() + TTL_MS });
    await reply(`这条节目报名属于哪个活动？回复序号选择（0 取消）：\n${eligible.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
  }
}

async function processIntake(d: QqIntakePayload, key: string): Promise<void> {
  const content = (d.content ?? '').trim();
  const reply: Reply = (text) => d.group_openid
    ? sendGroupMessage(d.group_openid, text, { msgId: d.id })
    : sendC2CMessage(d.author!.user_openid!, text, { msgId: d.id });
  try {
    let state = sessions.get(key);
    if (state && state.expiresAt <= Date.now()) {
      sessions.delete(key);
      state = undefined;
    }
    const numeric = /^\d+$/.test(content);
    const control = numeric || content === '确认' || content === '取消' || content === '节目报名' || content === '待办' || (state?.step === 'intent' && content === '记账');
    if (control && state) {
      if (content === '取消' || content === '0') {
        sessions.delete(key);
        await reply('已取消本次录入。');
        return;
      }
      if (state.step === 'intent') {
        if (content === '1' || content === '节目报名') {
          sessions.delete(key);
          await beginSignup(key, state.original, d, reply);
        } else if (content === '2' || content === '待办') {
          sessions.delete(key);
          await runTodo(state.original, d);
        } else if (content === '3' || content === '记账') {
          sessions.delete(key);
          await beginQqFinance(state.original, d);
        } else {
          await reply('请回复 1 选择节目报名，2 选择待办，3 选择记账，或 0 取消。');
        }
        return;
      }
      const user = await resolveUser(d);
      if (!user || String(user._id) !== state.userId) {
        throw new AppError(403, 'forbidden', '账号绑定已变化，请重新绑定后发送节目资料。');
      }
      if (state.step === 'project' || state.step === 'batch') {
        const ids = state.step === 'project' ? state.projectIds : state.signupIds;
        const index = Number(content) - 1;
        if (!numeric || !Number.isSafeInteger(index) || index < 0 || index >= ids.length) {
          await reply(`序号无效，请回复 1-${ids.length} 之间的数字，或回复 0 取消。`);
          return;
        }
        const project = await checkedProject(d, user, state.step === 'project' ? ids[index] : state.projectId);
        sessions.delete(key);
        if (state.step === 'project') await chooseBatch(key, state.original, user, project, reply);
        else await preview(key, state.original, user, project, ids[index], state.item, reply);
        return;
      }
      if (content !== '确认') {
        await reply('请回复「确认」保存，或「取消」放弃；修改资料请完整重发。');
        return;
      }
      // 先消费会话，再写库。同发送者串行处理，重复确认不会再次追加。
      sessions.delete(key);
      const project = await checkedProject(d, user, state.projectId);
      const signup = await addSignupItem(project._id, state.signupId, state.item);
      let text = `已录入节目「${state.item.name}」\n活动：${project.name}\n批次：${signup.name}\n状态：待审核`;
      if (config.publicBaseUrl) text += `\n查看：${config.publicBaseUrl}/p/${project._id}?tab=tools`;
      // 已成功保存，发送失败只能记录，不能再回「创建失败」诱导用户重复提交。
      const delivered = await reply(text).catch(() => false);
      if (!delivered) console.error('[qq-intake] 节目已保存，但结果回复失败');
      return;
    }
    if (control) {
      if (content === '取消') {
        clearQqIntake(d);
        await reply('已取消本次录入。');
      } else if (numeric && !d.group_openid) await handleC2cTaskTodo(d);
      else await reply('没有待选择或待确认的录入，请重新发送完整节目或记账资料。');
      return;
    }
    // 完整新消息替换上一次意图、节目草稿或待办项目选择。
    clearQqIntake(d);
    if (!d.group_openid && !await resolveUser(d)) {
      await reply('先在 ANON「我的」页生成绑定码并发送「绑定 XXXXXX」关联账号，之后可发送任务描述或节目报名资料。');
      return;
    }
    const intent = await classifyIntake(content);
    if (intent === 'signup') await beginSignup(key, d, d, reply);
    else if (intent === 'todo') await runTodo(d, d);
    else if (intent === 'finance') await beginQqFinance(d);
    else if (intent === 'ambiguous') {
      save(key, { step: 'intent', original: d, expiresAt: Date.now() + TTL_MS });
      await reply('这条消息要录入什么？\n1. 节目报名（一次一个）\n2. 待办\n3. 记账\n回复序号选择，或 0 取消；多个节目、账目或多种事项请拆开重发。');
    } else if (intent === 'none') await reply('未识别到录入内容。可以发送要办的事项，一个节目的名称、时长等报名资料，或已发生的收支描述。');
    else await reply('消息识别暂时不可用，请稍后重试，或在 ANON 网页手动录入。');
  } catch (err) {
    sessions.delete(key);
    console.error('[qq-intake] 录入失败:', err instanceof AppError ? err.code : 'internal');
    await reply(err instanceof AppError ? err.message : '录入失败，请稍后重试，或在 ANON 网页手动添加。').catch(() => {});
  }
}

export async function handleQqIntake(d: QqIntakePayload): Promise<void> {
  if (!d.id || !d.content?.trim()) return;
  const key = sessionKey(d);
  // 某些旧群事件无 author：仍保留待办入口，但不给节目写权限。
  if (!key) {
    if (d.group_openid) {
      const intent = await classifyIntake(d.content);
      if (intent === 'todo') await handleGroupTaskTodo(d);
      else await sendGroupMessage(d.group_openid, '请先通过个人绑定码关联账号，再重新发送节目资料。', { msgId: d.id });
    }
    return;
  }
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => processIntake(d, key));
  queues.set(key, task);
  try {
    await task;
  } finally {
    if (queues.get(key) === task) queues.delete(key);
  }
}
