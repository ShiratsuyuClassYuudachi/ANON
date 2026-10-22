import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { StageSignup } from '../src/models/StageSignup';
import { Transaction } from '../src/models/Transaction';
import { User } from '../src/models/User';
import { cancelCollect, getCollect, startCollect } from '../src/services/qqCollectSession';
import { handleQQEvent } from '../src/services/qqEvents';
import { clearQqIntake } from '../src/services/qqIntake';
import { clearQqMaterials, hasQqMaterials } from '../src/services/qqMaterials';
import { type QqMessage } from '../src/services/qqContext';
import { createSuperAdmin } from './helpers';

vi.mock('../src/services/qqApi', async (original) => ({
  ...await original<typeof import('../src/services/qqApi')>(),
  sendGroupMessage: vi.fn().mockResolvedValue(true),
  sendC2CMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/services/ai', async (original) => ({
  ...await original<typeof import('../src/services/ai')>(),
  classifyIntake: vi.fn(), parseStageSignup: vi.fn(), parseFinance: vi.fn(), parseTask: vi.fn(),
}));

import { classifyIntake, parseFinance, parseStageSignup, parseTask } from '../src/services/ai';
import { sendC2CMessage, sendGroupMessage } from '../src/services/qqApi';
const sendC2c = vi.mocked(sendC2CMessage);
const sendGroup = vi.mocked(sendGroupMessage);
const classify = vi.mocked(classifyIntake);
const savedConfig = { key: config.ai.apiKey, appId: config.qq.appId };
const TOPICS = ['绑定', '待办', '报名', '记账', '物料', '导出'];
let seq = 0;
let openid: string;
let group: string;
const c2c = (content: string, extra = {}) => handleQQEvent('C2C_MESSAGE_CREATE', {
  id: `help-${++seq}`, author: { user_openid: openid }, content, ...extra,
});
const groupMessage = (content: string, extra = {}, event = 'GROUP_AT_MESSAGE_CREATE') => handleQQEvent(event, {
  id: `help-${++seq}`, group_openid: group, author: { member_openid: 'visitor' }, content, ...extra,
});
const text = () => sendC2c.mock.calls.at(-1)![1];

beforeEach(() => {
  vi.clearAllMocks();
  config.ai.apiKey = '';
  config.qq.appId = 'help-bot';
  openid = `help-user-${++seq}`;
  group = `help-group-${seq}`;
});

afterEach(async () => {
  cancelCollect(openid);
  const d: QqMessage = { author: { user_openid: openid } };
  clearQqIntake(d);
  await clearQqMaterials(d);
});

afterAll(() => {
  config.ai.apiKey = savedConfig.key;
  config.qq.appId = savedConfig.appId;
});

async function actor() {
  const owner = await createSuperAdmin();
  await User.updateOne({ _id: owner.user.id }, { qqOpenId: openid });
  const project = await Project.create({ name: '帮助菜单走查', createdBy: owner.user.id });
  await Membership.create({ projectId: project._id, userId: owner.user.id, roleName: '主办' });
  return { owner, project };
}

describe('QQ 帮助入口与消息边界', () => {
  it.each(['帮助', '菜单', '/help', 'help', '  /HELP  '])('未绑定且未配 AI 也可发送 %s 查看总菜单', async (command) => {
    await c2c(command);
    expect(sendC2c).toHaveBeenCalledTimes(1);
    expect(sendC2c.mock.calls[0][2]).toEqual({ msgId: `help-${seq}` });
    for (const topic of TOPICS) expect(text()).toContain(`帮助 ${topic}`);
    expect(text()).toContain('当前未启用 AI');
    expect(classify).not.toHaveBeenCalled();
    expect(await User.countDocuments()).toBe(0);
  });

  it.each(TOPICS)('帮助 %s 直接回复对应操作，不触发绑定或 AI', async (topic) => {
    await c2c(`帮助 ${topic}`);
    expect(text()).toContain('【');
    expect(text()).toContain('发送「帮助」返回总菜单');
    expect(classify).not.toHaveBeenCalled();
    expect(sendC2c).toHaveBeenCalledTimes(1);
  });

  it.each(['不存在', 'constructor', '__proto__'])('未知主题 %s 返回菜单', async (topic) => {
    await c2c(`帮助 ${topic}`);
    expect(text()).toContain('未找到该帮助主题');
    expect(text()).toContain('帮助 绑定');
    expect(classify).not.toHaveBeenCalled();
  });

  it('已启用 AI 的菜单不提示 AI 暂不可用', async () => {
    config.ai.apiKey = 'test-key';
    await c2c('菜单');
    expect(text()).not.toContain('当前未启用 AI');
    expect(classify).not.toHaveBeenCalled();
  });

  it.each(['<@help-bot> 帮助', '帮助 <@!help-bot>', '@ANON 帮助'])('未绑定项目的群可携带机器人提及查看 %s', async (command) => {
    await groupMessage(command, { mentions: [{ member_openid: 'help-bot', username: 'ANON', bot: true }] });
    expect(sendGroup).toHaveBeenCalledWith(group, expect.stringContaining('ANON 机器人帮助'), { msgId: `help-${seq}` });
    expect(classify).not.toHaveBeenCalled();
    expect(await Project.countDocuments()).toBe(0);
  });

  it('全量群消息需 @机器人 才触发帮助，普通群聊不回复', async () => {
    await groupMessage('帮助', {}, 'GROUP_MESSAGE_CREATE');
    expect(sendGroup).not.toHaveBeenCalled();
    await groupMessage('<@help-bot> 帮助 绑定', { mentions: [{ member_openid: 'help-bot', bot: true }] }, 'GROUP_MESSAGE_CREATE');
    expect(sendGroup).toHaveBeenCalledWith(group, expect.stringContaining('【绑定与通知】'), expect.anything());
  });

  it.each([102, 103])('富消息类型 %s 中的帮助文本仍交给聊天记录收集', async (message_type) => {
    startCollect(openid, { id: '507f1f77bcf86cd799439011', name: '测试员' });
    await c2c('帮助', { message_type, msg_elements: [{ message_type: 0, author: { username: '朋友' }, content: '帮助' }] });
    expect(text()).not.toContain('ANON 机器人帮助');
    expect(getCollect(openid)).not.toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  it('带附件的帮助文字作为收集内容，独立帮助不混入记录且不结束会话', async () => {
    startCollect(openid, { id: '507f1f77bcf86cd799439011', name: '测试员' });
    await c2c('帮助', { attachments: [{ content_type: 'video/mp4', filename: '演出.mp4', size: 1 }] });
    expect(text()).toContain('已收录');
    const count = getCollect(openid)!.messages.length;
    await c2c('帮助 导出');
    expect(text()).toContain('【聊天记录导出】');
    expect(getCollect(openid)!.messages).toHaveLength(count);
    await c2c('继续收集');
    expect(getCollect(openid)!.messages).toHaveLength(count + 1);
  });

  it('普通任务中的帮助字样不作为菜单，继续进行 AI 分流', async () => {
    await actor();
    config.ai.apiKey = 'test-key';
    classify.mockResolvedValue('none');
    await c2c('请帮助我整理报名资料');
    expect(classify).toHaveBeenCalledWith('请帮助我整理报名资料');
    expect(text()).not.toContain('ANON 机器人帮助');
  });

  it.each(['FRIEND_ADD', 'GROUP_ADD_ROBOT'])('%s 欢迎消息提供可发现的总菜单', async (event) => {
    await handleQQEvent(event, { openid, group_openid: group }, 'help-event');
    const send = event === 'FRIEND_ADD' ? sendC2c : sendGroup;
    expect(send).toHaveBeenCalledWith(event === 'FRIEND_ADD' ? openid : group, expect.stringContaining('帮助 报名'), { eventId: 'help-event' });
  });

  it('没有消息 ID 时不尝试发送主动帮助', async () => {
    await c2c('帮助', { id: undefined });
    await groupMessage('帮助', { id: undefined });
    expect(sendC2c).not.toHaveBeenCalled();
    expect(sendGroup).not.toHaveBeenCalled();
  });
});

describe('查看帮助保留进行中的操作', () => {
  it('报名预览期间看帮助后仍可确认原节目，不重新调用 AI', async () => {
    const { owner, project } = await actor();
    config.ai.apiKey = 'test-key';
    classify.mockResolvedValue('signup');
    vi.mocked(parseStageSignup).mockResolvedValue({ name: '追光', durationMin: 5, participants: [], note: '' });
    const signup = await StageSignup.create({ projectId: project._id, name: 'Day1', createdBy: owner.user.id, startAt: new Date(), endAt: new Date(Date.now() + 3600_000) });
    await c2c('报名歌曲追光，5分钟');
    expect(text()).toContain('请确认节目报名');
    await c2c('帮助 报名');
    expect(text()).toContain('【舞台节目报名】');
    await c2c('确认');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(1);
    expect(text()).toContain('已录入节目');
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('记账预览期间看菜单后仍保存原账目', async () => {
    const { project } = await actor();
    config.ai.apiKey = 'test-key';
    classify.mockResolvedValue('finance');
    vi.mocked(parseFinance).mockResolvedValue({ type: 'expense', amount: '120.50', note: '买海报', payerName: null, splitNames: null });
    await c2c('记账：我买海报支出120.50元');
    expect(text()).toContain('请确认');
    await c2c('菜单');
    await c2c('确认');
    expect(await Transaction.findOne({ projectId: project._id }).lean()).toMatchObject({ amountCents: 12050, note: '买海报' });
    expect(text()).toContain('已记账');
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('物料上传中查看帮助不作为说明，也不清除上传会话', async () => {
    await actor();
    await c2c('开始上传物料');
    expect(text()).toContain('已开始上传物料');
    const d: QqMessage = { author: { user_openid: openid } };
    expect(hasQqMaterials(d)).toBe(true);
    await c2c('帮助 物料');
    expect(text()).toContain('【物料上传】');
    expect(hasQqMaterials(d)).toBe(true);
    await c2c('取消上传物料');
    expect(text()).toContain('已取消上传');
    expect(hasQqMaterials(d)).toBe(false);
    expect(parseTask).not.toHaveBeenCalled();
  });
});
