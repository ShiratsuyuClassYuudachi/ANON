import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { StageRundown } from '../src/models/StageRundown';
import { StageSignup } from '../src/models/StageSignup';
import { Todo } from '../src/models/Todo';
import { User } from '../src/models/User';
import { createBindCode } from '../src/services/qqbot';
import { handleQQEvent } from '../src/services/qqEvents';
import { createInviteCode, createSuperAdmin, registerUser } from './helpers';

vi.mock('../src/services/qqApi', async (original) => ({
  ...await original<typeof import('../src/services/qqApi')>(),
  sendGroupMessage: vi.fn().mockResolvedValue(true),
  sendC2CMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/services/ai', async (original) => ({
  ...await original<typeof import('../src/services/ai')>(),
  classifyIntake: vi.fn(), parseStageSignup: vi.fn(), parseTask: vi.fn(),
}));

import { classifyIntake, parseStageSignup, parseTask } from '../src/services/ai';
import { sendC2CMessage, sendGroupMessage } from '../src/services/qqApi';
const classify = vi.mocked(classifyIntake);
const parse = vi.mocked(parseStageSignup);
const sendGroup = vi.mocked(sendGroupMessage);
const sendC2c = vi.mocked(sendC2CMessage);
const parsed = { name: '追光', durationMin: 5, participants: [{ cn: '小明', contact: 'QQ 12345' }], note: '两个麦克风' };
const oldKey = config.ai.apiKey;
const oldBase = config.publicBaseUrl;
let owner: Awaited<ReturnType<typeof createSuperAdmin>>;
let manager: Awaited<ReturnType<typeof registerUser>>;
let project: Awaited<ReturnType<typeof Project.create>>;
let signup: Awaited<ReturnType<typeof StageSignup.create>>;
let group: string;
let openid: string;
let member: string;
let seq = 0;

async function batch(projectId = project._id, name = '第二批次') {
  return StageSignup.create({ projectId, name, startAt: new Date('2027-01-01T02:00:00Z'), endAt: new Date('2027-01-01T04:00:00Z'), createdBy: owner.user.id });
}

async function secondProject() {
  const p = await Project.create({ name: '第二活动', createdBy: owner.user.id, roles: [{ name: '录入员', permissions: ['tools:manage'] }], startDate: new Date('2025-01-01') });
  await Membership.create({ projectId: p._id, userId: manager.user.id, roleName: '录入员' });
  await batch(p._id);
  return p;
}

function groupEvent(content: string, over = {}) {
  return { id: `g-${++seq}`, group_openid: group, content, author: { member_openid: member, username: '录入员' }, ...over };
}
function c2cEvent(content: string) {
  return { id: `c-${++seq}`, content, author: { user_openid: openid } };
}
const groupMsg = (content: string, over = {}) => handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupEvent(content, over));
const c2cMsg = (content: string) => handleQQEvent('C2C_MESSAGE_CREATE', c2cEvent(content));
const groupText = () => sendGroup.mock.calls.at(-1)![1];
const c2cText = () => sendC2c.mock.calls.at(-1)![1];

beforeEach(async () => {
  vi.clearAllMocks();
  sendGroup.mockResolvedValue(true);
  sendC2c.mockResolvedValue(true);
  classify.mockResolvedValue('signup');
  parse.mockResolvedValue(structuredClone(parsed));
  vi.mocked(parseTask).mockResolvedValue({ isTask: true, title: '整理节目单', note: '', dueAt: null, nodeAt: null, remindAt: null });
  config.ai.apiKey = 'test-key';
  config.publicBaseUrl = 'https://anon.example';
  owner = await createSuperAdmin();
  await createInviteCode(owner.token);
  manager = await registerUser('CODE-1', 'manager@example.com', '录入员');
  project = await Project.create({ name: '舞台活动', createdBy: owner.user.id, roles: [{ name: '录入员', permissions: ['tools:manage'] }] });
  group = `group-${project._id}`;
  openid = `c2c-${manager.user.id}`;
  member = `member-${manager.user.id}`;
  await Project.updateOne({ _id: project._id }, { qqGroups: [{ groupOpenId: group, types: [] }] });
  await Membership.create({ projectId: project._id, userId: manager.user.id, roleName: '录入员' });
  await User.updateOne({ _id: manager.user.id }, { qqOpenId: openid, qqMemberIds: [{ groupOpenId: group, memberOpenId: member }] });
  signup = await batch(project._id, 'Day1');
});

afterAll(() => {
  config.ai.apiKey = oldKey;
  config.publicBaseUrl = oldBase;
});

describe('QQ 节目报名录入', () => {
  it('群内预览不落库，确认后网页可见、可审核并导入流程单', async () => {
    await groupMsg('帮小明报名歌曲追光，5分钟，QQ 12345，两个麦克风');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
    expect(groupText()).toContain('请确认节目报名');
    expect(groupText()).toContain('QQ 12345');
    expect(groupText()).toContain('@我');
    await groupMsg('确认');
    expect(groupText()).toContain('状态：待审核');
    expect(groupText()).toContain(`https://anon.example/p/${project._id}?tab=tools`);
    expect(sendGroup.mock.calls.at(-1)![2]).toEqual({ msgId: `g-${seq}` });
    const base = `/api/projects/${project._id}/stage-signups/${signup._id}`;
    const detail = await request(app).get(base).set('Authorization', `Bearer ${owner.token}`);
    const item = detail.body.signup.items[0];
    expect(item).toMatchObject({ ...parsed, status: 'pending', reviews: [] });
    const approved = await request(app).patch(`${base}/items/${item.id}/status`).set('Authorization', `Bearer ${owner.token}`).send({ status: 'approved' });
    expect(approved.status).toBe(200);
    const rundown = await StageRundown.create({ projectId: project._id, name: '流程单', startAt: new Date(), createdBy: owner.user.id });
    const imported = await request(app).post(`${base}/import`).set('Authorization', `Bearer ${owner.token}`).send({ rundownId: String(rundown._id) });
    expect(imported.status).toBe(200);
    expect(imported.body.rundown.items[0]).toMatchObject(parsed);
    expect(await Todo.countDocuments()).toBe(0);
  });

  it('私聊单项目、单批次直接预览，缺省报名人和备注保持为空', async () => {
    parse.mockResolvedValue({ ...parsed, participants: [], note: '' });
    await c2cMsg('报名追光，5分钟');
    expect(c2cText()).toContain('报名人：未提供');
    await c2cMsg('确认');
    expect(c2cText()).toContain('已录入节目');
    expect((await StageSignup.findById(signup._id))!.items[0].participants).toHaveLength(0);
  });

  it('私聊多项目、多批次逐步选序号，预览后才能保存', async () => {
    const p2 = await secondProject();
    const b2 = await batch(p2._id, 'Day2');
    await c2cMsg('报名追光，5分钟');
    expect(c2cText()).toContain('1. 第二活动');
    expect(parse).not.toHaveBeenCalled();
    await c2cMsg('1');
    expect(c2cText()).toContain('请选择报名批次');
    await c2cMsg('99');
    expect(c2cText()).toContain('序号无效');
    await c2cMsg('2');
    expect(c2cText()).toContain('批次：Day2');
    await c2cMsg('确认');
    expect((await StageSignup.findById(b2._id))!.items).toHaveLength(1);
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('群内多批次选择不会改变项目，已有舞台时段不限制提前报名', async () => {
    const b2 = await batch();
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('请选择报名批次');
    await groupMsg('2');
    await groupMsg('确认');
    expect((await StageSignup.findById(b2._id))!.items).toHaveLength(1);
  });

  it.each([
    { ...parsed, name: '' }, { ...parsed, durationMin: null },
    { ...parsed, durationMin: 0 }, { ...parsed, durationMin: 1.5 }, { ...parsed, durationMin: 1441 },
  ])('缺名称或时长非法时不保存：%j', async (value) => {
    parse.mockResolvedValue(value);
    await groupMsg('不完整的报名资料');
    expect(groupText()).toContain('完整重发');
    await groupMsg('确认');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
  });

  it('取消、0 和超时均丢弃会话，确认不能再保存', async () => {
    for (const cancel of ['取消', '0']) {
      await groupMsg('报名追光，5分钟');
      await groupMsg(cancel);
      expect(groupText()).toContain('已取消');
      await groupMsg('确认');
      expect(groupText()).toContain('没有待选择或待确认');
    }
    await groupMsg('报名追光，5分钟');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    try {
      await groupMsg('确认');
      expect(groupText()).toContain('重新发送');
    } finally {
      now.mockRestore();
    }
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
  });

  it('新资料替换旧预览，连续并发确认只保存一次', async () => {
    await groupMsg('报名旧节目，5分钟');
    parse.mockResolvedValue({ ...parsed, name: '新节目' });
    await groupMsg('报名新节目，5分钟');
    await Promise.all([groupMsg('确认'), groupMsg('确认')]);
    const doc = (await StageSignup.findById(signup._id))!;
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].name).toBe('新节目');
  });

  it('群内其他人不能确认别人的预览', async () => {
    await groupMsg('报名追光，5分钟');
    await groupMsg('确认', { author: { member_openid: 'other', username: '录入员' } });
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
    await groupMsg('确认');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(1);
  });

  it('同名未绑定用户没有录入权限；union_openid 绑定可作为群身份', async () => {
    await groupMsg('报名追光，5分钟', { author: { member_openid: 'unknown', username: '录入员' } });
    expect(groupText()).toContain('个人绑定码');
    expect(parse).not.toHaveBeenCalled();
    await User.updateOne({ _id: manager.user.id }, { qqUnionOpenId: 'union-manager' });
    const author = { member_openid: 'unknown', union_openid: 'union-manager' };
    await groupMsg('报名追光，5分钟', { author });
    await groupMsg('确认', { author });
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(1);
  });

  it('普通成员无权限，project:manage 可录入；超管群内沿用权限豁免', async () => {
    await Project.updateOne({ _id: project._id }, { roles: [{ name: '录入员', permissions: [] }] });
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('没有本项目的工具管理权限');
    await c2cMsg('报名追光，5分钟');
    expect(c2cText()).toContain('没有具有工具管理权限');
    await Project.updateOne({ _id: project._id }, { roles: [{ name: '录入员', permissions: ['project:manage'] }] });
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('请确认节目报名');
    await User.updateOne({ _id: owner.user.id }, { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'admin-member' }] });
    await groupMsg('报名追光，5分钟', { author: { member_openid: 'admin-member' } });
    expect(groupText()).toContain('请确认节目报名');
  });

  it.each(['权限撤销', '成员移除', '群换绑', '批次删除', '个人解绑'])('确认前复核：%s 后不得写入', async (change) => {
    await groupMsg('报名追光，5分钟');
    if (change === '权限撤销') await Project.updateOne({ _id: project._id }, { roles: [] });
    if (change === '成员移除') await Membership.deleteOne({ projectId: project._id, userId: manager.user.id });
    if (change === '群换绑') {
      const p2 = await secondProject();
      await Project.updateOne({ _id: project._id }, { qqGroups: [] });
      await Project.updateOne({ _id: p2._id }, { qqGroups: [{ groupOpenId: group, types: [] }] });
    }
    if (change === '批次删除') await StageSignup.deleteOne({ _id: signup._id });
    if (change === '个人解绑') await User.updateOne({ _id: manager.user.id }, { qqMemberIds: [] });
    await groupMsg('确认');
    expect(groupText()).not.toContain('已录入节目');
    const doc = await StageSignup.findById(signup._id);
    expect(doc?.items.length ?? 0).toBe(0);
  });

  it('私聊项目选择后被归档，不能继续录入', async () => {
    const p2 = await secondProject();
    await c2cMsg('报名追光，5分钟');
    await Project.updateOne({ _id: p2._id }, { status: 'archived' });
    await c2cMsg('1');
    expect(c2cText()).toContain('已不可用');
    expect(parse).not.toHaveBeenCalled();
  });

  it('没有批次时提示创建；AI 未配置、未绑定群时静默', async () => {
    await StageSignup.deleteOne({ _id: signup._id });
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('暂无报名批次');
    vi.clearAllMocks();
    config.ai.apiKey = '';
    await groupMsg('报名追光，5分钟');
    config.ai.apiKey = 'test-key';
    await groupMsg('报名追光，5分钟', { group_openid: 'unbound' });
    expect(classify).not.toHaveBeenCalled();
    expect(sendGroup).not.toHaveBeenCalled();
  });

  it('AI 分类或解析失败时不创建待办或节目', async () => {
    classify.mockResolvedValueOnce(null);
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('暂时不可用');
    parse.mockResolvedValueOnce(null);
    await groupMsg('报名追光，5分钟');
    expect(groupText()).toContain('解析暂时不可用');
    expect(await Todo.countDocuments()).toBe(0);
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
  });

  it('歧义选择报名或待办，普通工作描述仍创建待办', async () => {
    classify.mockResolvedValue('ambiguous');
    await groupMsg('小明的节目');
    expect(groupText()).toContain('1. 节目报名');
    await groupMsg('1');
    expect(groupText()).toContain('请确认节目报名');
    await groupMsg('取消');
    await groupMsg('小明的节目');
    await groupMsg('2');
    expect(await Todo.countDocuments()).toBe(1);
    classify.mockResolvedValue('todo');
    await groupMsg('周五前整理节目单');
    expect(await Todo.countDocuments()).toBe(2);
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
  });

  it('报名与待办项目选择不会抢同一个数字回复', async () => {
    await secondProject();
    classify.mockResolvedValue('todo');
    await c2cMsg('整理节目单');
    expect(c2cText()).toContain('这条待办属于哪个活动');
    classify.mockResolvedValue('signup');
    await c2cMsg('报名追光，5分钟');
    await c2cMsg('1');
    expect(c2cText()).toContain('请确认节目报名');
    await c2cMsg('确认');
    expect(await Todo.countDocuments()).toBe(0);
    classify.mockResolvedValue('todo');
    await c2cMsg('整理节目单');
    await c2cMsg('1');
    expect(await Todo.countDocuments()).toBe(1);
  });

  it('保存成功但发送失败不回复创建失败，重发确认不重复保存', async () => {
    await groupMsg('报名追光，5分钟');
    sendGroup.mockRejectedValueOnce(new Error('发送失败'));
    await groupMsg('确认');
    await groupMsg('确认');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(1);
    expect(sendGroup.mock.calls.map((c) => c[1]).join('\n')).not.toContain('录入失败');
  });

  it('两个录入者和网页并发追加不互相覆盖', async () => {
    await User.updateOne({ _id: owner.user.id }, { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'admin-member' }] });
    const admin = { author: { member_openid: 'admin-member' } };
    await Promise.all([groupMsg('报名追光，5分钟'), groupMsg('报名追光，5分钟', admin)]);
    const web = request(app).post(`/api/projects/${project._id}/stage-signups/${signup._id}/items`).set('Authorization', `Bearer ${owner.token}`).send({ name: '网页节目', durationMin: 10 });
    await Promise.all([groupMsg('确认'), groupMsg('确认', admin), web]);
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(3);
  });

  it('绑定和收集导出仍优先，开始导出会丢弃报名草稿', async () => {
    await c2cMsg('报名追光，5分钟');
    const { code } = await createBindCode('user', manager.user.id);
    await c2cMsg(`绑定 ${code}`);
    expect(c2cText()).toContain('绑定成功');
    await c2cMsg('确认');
    expect(c2cText()).toContain('没有待选择或待确认');
    await c2cMsg('报名追光，5分钟');
    await c2cMsg('开始导出');
    await c2cMsg('确认');
    expect(c2cText()).toContain('已收录');
    await c2cMsg('取消导出');
    await c2cMsg('确认');
    expect((await StageSignup.findById(signup._id))!.items).toHaveLength(0);
  });
});
