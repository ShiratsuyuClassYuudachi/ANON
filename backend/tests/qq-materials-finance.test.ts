import fs from 'fs/promises';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { File } from '../src/models/File';
import { Resource } from '../src/models/Resource';
import { ResourceType } from '../src/models/ResourceType';
import { ResourceVersion } from '../src/models/ResourceVersion';
import { Transaction } from '../src/models/Transaction';
import { Todo } from '../src/models/Todo';
import { handleQQEvent } from '../src/services/qqEvents';
import { clearQqMaterials } from '../src/services/qqMaterials';
import { deleteStored } from '../src/services/storage';
import { createSuperAdmin } from './helpers';

vi.mock('../src/services/qqApi', async (original) => ({
  ...await original<typeof import('../src/services/qqApi')>(),
  sendGroupMessage: vi.fn().mockResolvedValue(true), sendC2CMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/services/ai', async (original) => ({
  ...await original<typeof import('../src/services/ai')>(),
  classifyIntake: vi.fn(), parseFinance: vi.fn(), parseTask: vi.fn(),
}));
import { classifyIntake, parseFinance } from '../src/services/ai';
import { sendGroupMessage, sendC2CMessage } from '../src/services/qqApi';
const classify = vi.mocked(classifyIntake);
const parse = vi.mocked(parseFinance);
const sendG = vi.mocked(sendGroupMessage);
const sendC = vi.mocked(sendC2CMessage);
const oldKey = config.ai.apiKey;
let auth: Awaited<ReturnType<typeof createSuperAdmin>>;
let project: Awaited<ReturnType<typeof Project.create>>;
let type: Awaited<ReturnType<typeof ResourceType.create>>;
let group: string;
let openid: string;
let seq = 0;
const parsed = { type: 'expense' as const, amount: '120.50', note: '印刷海报', payerName: null, splitNames: null };
const attachment = { url: 'https://multimedia.nt.qq.com.cn/file?token=temporary', filename: '海报.txt', content_type: 'text/plain' };
const payload = (content = '', extra = {}) => ({ id: `m-${++seq}`, group_openid: group, author: { member_openid: 'sender' }, content, ...extra });
const g = (content: string, extra = {}) => handleQQEvent('GROUP_AT_MESSAGE_CREATE', payload(content, extra));
const c = (content: string, extra = {}) => handleQQEvent('C2C_MESSAGE_CREATE', payload(content, { group_openid: undefined, author: { user_openid: openid }, ...extra }));
const last = () => sendG.mock.calls.at(-1)?.[1] ?? '';
const lastC = () => sendC.mock.calls.at(-1)?.[1] ?? '';
const fakeFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response('物料正文', { headers: { 'content-type': 'text/plain' } })));

beforeEach(async () => {
  vi.clearAllMocks(); sendG.mockResolvedValue(true); sendC.mockResolvedValue(true);
  config.ai.apiKey = 'test'; classify.mockResolvedValue('finance'); parse.mockResolvedValue({ ...parsed });
  auth = await createSuperAdmin();
  group = `g-${auth.user.id}`; openid = `c-${auth.user.id}`;
  await User.updateOne({ _id: auth.user.id }, { isSuperAdmin: false, name: '录入员', qqOpenId: openid, qqMemberIds: [{ groupOpenId: group, memberOpenId: 'sender' }] });
  project = await Project.create({ name: '活动', startDate: new Date('2025-01-01'), createdBy: auth.user.id, roles: [{ name: '录入', permissions: ['materials:manage', 'finance:add'] }], qqGroups: [{ groupOpenId: group, types: [] }] });
  await Membership.create({ projectId: project._id, userId: auth.user.id, roleName: '录入' });
  type = await ResourceType.create({ projectId: project._id, name: '设计资料' });
  fakeFetch();
});
afterEach(async () => {
  await clearQqMaterials(payload());
  await clearQqMaterials(payload('', { group_openid: undefined, author: { user_openid: openid } }));
  for (const f of await File.find()) await deleteStored(f.path);
  for (const v of await ResourceVersion.find()) if (v.previewPath) await deleteStored(v.previewPath);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
afterAll(() => { config.ai.apiKey = oldKey; });

async function secondProject() {
  const p = await Project.create({ name: '第二活动', startDate: new Date('2027-01-01'), createdBy: auth.user.id, roles: project.roles });
  await Membership.create({ projectId: p._id, userId: auth.user.id, roleName: '录入' });
  await ResourceType.create({ projectId: p._id, name: '资料' });
  return p;
}

async function mentionedMember(name: string, data: Record<string, unknown> = {}) {
  const actor = await User.findById(auth.user.id);
  const user = await User.create({ name, email: `mention-${++seq}@example.com`, passwordHash: actor!.passwordHash, ...data });
  await Membership.create({ projectId: project._id, userId: user._id, roleName: '录入' });
  return user;
}

describe('QQ 记账 @成员', () => {
  it('群绑定优先于昵称，付款人和平摊人分别按语义引用，不受 ANON 同名影响', async () => {
    const payer = await mentionedMember('同名', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'payer-id' }] });
    const splitter = await mentionedMember('同名', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'split-id' }] });
    parse.mockResolvedValue({ ...parsed, payerName: '@成员1', splitNames: ['我', '@成员2', '@成员2'], note: '@成员1垫付海报' });
    await g('记账：<@!payer-id>垫付120.50元，我和<@split-id>平摊', { mentions: [
      { member_openid: 'payer-id', username: 'QQ小明' }, { member_openid: 'split-id', username: 'QQ小红' },
    ] });
    expect(parse).toHaveBeenCalledWith('记账：@成员1垫付120.50元，我和@成员2平摊', { mentions: ['@成员1', '@成员2'] });
    expect(last()).toContain('付款人：同名（@QQ小明）');
    expect(last()).toContain('平摊：录入员、同名（@QQ小红）');
    await g('确认');
    const tx = await Transaction.findOne();
    expect(String(tx?.payerUserId)).toBe(String(payer._id));
    expect(tx?.splitAmong.map(String)).toEqual([auth.user.id, String(splitter._id)]);
    expect(tx?.note).toBe('同名垫付海报'); expect(String(tx?.createdBy)).toBe(auth.user.id);
  });
  it('群成员昵称叫「我」时，文字中的本人仍指录入者，实际 @仍指该成员', async () => {
    const member = await mentionedMember('另一个人', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'called-me' }] });
    parse.mockResolvedValue({ ...parsed, payerName: '我', splitNames: ['我', '@成员1'] });
    await g('记账：我付120元，与<@called-me>平摊', { mentions: [{ member_openid: 'called-me', username: '我' }] });
    await g('确认'); const tx = await Transaction.findOne();
    expect(String(tx?.payerUserId)).toBe(auth.user.id); expect(tx?.splitAmong.map(String)).toEqual([auth.user.id, String(member._id)]);
  });
  it('union_openid 可跨场景匹配收入收款人', async () => {
    const payer = await mentionedMember('收款人', { qqUnionOpenId: 'union-payer' });
    parse.mockResolvedValue({ ...parsed, type: 'income', payerName: '@成员1' });
    await g('记账：@群昵称收到赞助120.50元', { mentions: [{ member_openid: 'not-bound-in-group', union_openid: 'union-payer', username: '群昵称' }] });
    expect(last()).toContain('收款人：收款人'); await g('确认');
    expect(String((await Transaction.findOne())?.payerUserId)).toBe(String(payer._id));
  });
  it('昵称唯一匹配作为兜底，模型返回 QQ 昵称也保留稳定绑定优先级', async () => {
    const payer = await mentionedMember('小明');
    parse.mockResolvedValue({ ...parsed, payerName: '@小明' });
    await g('记账：@小明垫付120元', { mentions: [{ username: '小明' }] }); await g('确认');
    expect(String((await Transaction.findOne())?.payerUserId)).toBe(String(payer._id));
  });
  it('群身份优先于冲突的 union 与唯一昵称', async () => {
    const payer = await mentionedMember('真正付款人', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'stable-id' }] });
    await mentionedMember('QQ昵称', { qqUnionOpenId: 'different-union' });
    parse.mockResolvedValue({ ...parsed, payerName: 'QQ昵称' });
    await g('记账：@QQ昵称垫付120元', { mentions: [{ member_openid: 'stable-id', union_openid: 'different-union', username: 'QQ昵称' }] }); await g('确认');
    expect(String((await Transaction.findOne())?.payerUserId)).toBe(String(payer._id));
  });
  it('机器人提及被剔除，通知对象不会自动成为付款或平摊人', async () => {
    await mentionedMember('小明', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'member-ming' }] });
    await g('记账：<@!robot>我付120元，全员平摊，@小明请知悉', { mentions: [
      { member_openid: 'robot', username: '机器人', bot: true }, { member_openid: 'member-ming', username: '小明' },
    ] });
    expect(parse).toHaveBeenCalledWith('记账：我付120元，全员平摊，@成员1请知悉', { mentions: ['@成员1'] });
    await g('确认'); const tx = await Transaction.findOne();
    expect(String(tx?.payerUserId)).toBe(auth.user.id); expect(tx?.splitAmong).toHaveLength(0);
  });
  it('未知提及不兜底本人或全员，提示绑定后重发', async () => {
    await g('记账：@不存在的人付120元', { mentions: [{ member_openid: 'unknown', username: '不存在的人' }] });
    expect(last()).toContain('未识别成员'); expect(parse).not.toHaveBeenCalled(); await g('确认'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('重名但没有稳定绑定时不能猜测成员', async () => {
    await mentionedMember('同名'); await mentionedMember('同名');
    await g('记账：@同名付120元', { mentions: [{ username: '同名' }] });
    expect(last()).toContain('未识别成员'); expect(parse).not.toHaveBeenCalled();
  });
  it('同一个群成员绑定到多人时拒绝，不能退回昵称绕过冲突', async () => {
    await mentionedMember('唯一昵称', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'collision' }] });
    await mentionedMember('另外一个人', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'collision' }] });
    await g('记账：@唯一昵称付120元', { mentions: [{ member_openid: 'collision', username: '唯一昵称' }] });
    expect(last()).toContain('未识别成员'); expect(parse).not.toHaveBeenCalled();
  });
  it('不使用其他群的 member_openid 对照表', async () => {
    await mentionedMember('ANON姓名', { qqMemberIds: [{ groupOpenId: 'other-group', memberOpenId: 'same-id' }] });
    await g('记账：@QQ昵称付120元', { mentions: [{ member_openid: 'same-id', username: 'QQ昵称' }] });
    expect(last()).toContain('未识别成员'); expect(parse).not.toHaveBeenCalled();
  });
  it('同一人重复提及和平摊引用按用户去重', async () => {
    const member = await mentionedMember('小明', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'ming' }] });
    parse.mockResolvedValue({ ...parsed, payerName: '@成员1', splitNames: ['@成员1', '@成员2'] });
    await g('记账：<@ming>付120元，由@小明平摊', { mentions: [
      { member_openid: 'ming', username: '小明' }, { member_openid: 'ming', username: '小明' },
    ] }); await g('确认'); expect((await Transaction.findOne())?.splitAmong.map(String)).toEqual([String(member._id)]);
  });
  it('预览后被提及成员解绑并换绑给别人，确认时拒绝保存', async () => {
    const old = await mentionedMember('原付款人', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'rebound' }] });
    const other = await mentionedMember('新绑定人');
    parse.mockResolvedValue({ ...parsed, payerName: '@成员1' });
    await g('记账：<@rebound>付120元', { mentions: [{ member_openid: 'rebound', username: '群昵称' }] });
    await User.updateOne({ _id: old._id }, { qqMemberIds: [] });
    await User.updateOne({ _id: other._id }, { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'rebound' }] });
    await g('确认'); expect(last()).toContain('成员绑定或项目归属已变化'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('预览后平摊成员退出项目，确认时拒绝保存', async () => {
    const member = await mentionedMember('小明', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'ming' }] });
    parse.mockResolvedValue({ ...parsed, splitNames: ['@成员1'] });
    await g('记账：我付120元，和@小明平摊', { mentions: [{ member_openid: 'ming', username: '小明' }] });
    await Membership.deleteOne({ projectId: project._id, userId: member._id });
    await g('确认'); expect(last()).toContain('项目归属已变化'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('选择录入类型时沿用原消息提及，忽略确认消息新提及', async () => {
    const member = await mentionedMember('小明', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'ming' }] });
    classify.mockResolvedValueOnce('ambiguous'); parse.mockResolvedValue({ ...parsed, payerName: '@成员1' });
    await g('记账：@小明付120元', { mentions: [{ member_openid: 'ming', username: '小明' }] });
    await g('3', { mentions: [{ member_openid: 'sender', username: '录入员' }] });
    await g('确认', { mentions: [{ member_openid: 'sender', username: '录入员' }] });
    expect(String((await Transaction.findOne())?.payerUserId)).toBe(String(member._id));
  });
  it('没有 QQ mentions 元数据的原生 @标记与模型编造引用均拒绝', async () => {
    await g('记账：<@unknown>付120元'); expect(last()).toContain('未收到完整'); expect(parse).not.toHaveBeenCalled();
    parse.mockResolvedValue({ ...parsed, payerName: '@成员99' }); await g('记账：我付120元'); expect(last()).toContain('未识别的 @成员引用');
    await g('确认'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('真实成员同名 QQ 昵称可以用原生提及区分，平铺同名昵称会要求重发', async () => {
    await mentionedMember('小明甲', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'a' }] });
    await mentionedMember('小明乙', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'b' }] });
    const mentions = [{ member_openid: 'a', username: '小明' }, { member_openid: 'b', username: '小明' }];
    parse.mockResolvedValue({ ...parsed, payerName: '@成员1', splitNames: ['@成员2'] });
    await g('记账：<@a>付120元，<@b>平摊', { mentions }); expect(last()).toContain('请确认记账'); await g('取消');
    await g('记账：@小明付120元', { mentions }); expect(last()).toContain('昵称有重名');
  });
  it('长昵称优先替换，含正则字符的昵称可正确解析', async () => {
    await mentionedMember('小明', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'short' }] });
    const long = await mentionedMember('小明（美工）', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'long' }] });
    await mentionedMember('特殊昵称', { qqMemberIds: [{ groupOpenId: group, memberOpenId: 'special' }] });
    parse.mockResolvedValue({ ...parsed, payerName: '@成员2', splitNames: ['@成员3'] });
    await g('记账：@小明（美工）付120元，@A.*(B)平摊，@小明知悉', { mentions: [
      { member_openid: 'short', username: '小明' }, { member_openid: 'long', username: '小明（美工）' }, { member_openid: 'special', username: 'A.*(B)' },
    ] });
    expect(parse).toHaveBeenCalledWith('记账：@成员2付120元，@成员3平摊，@成员1知悉', { mentions: ['@成员1', '@成员2', '@成员3'] });
    await g('确认'); expect(String((await Transaction.findOne())?.payerUserId)).toBe(String(long._id));
  });
});

describe('QQ 文字 AI 记账', () => {
  it('预览后确认才保存，网页可见、创建人为绑定成员，不产生待办', async () => {
    await g('记账：我印海报花了120.50元');
    expect(last()).toContain('请确认记账'); expect(last()).toContain('默认本人'); expect(last()).toContain('全员');
    expect(await Transaction.countDocuments()).toBe(0);
    await g('确认');
    const tx = await Transaction.findOne();
    expect(tx?.amountCents).toBe(12050); expect(String(tx?.createdBy)).toBe(auth.user.id); expect(String(tx?.payerUserId)).toBe(auth.user.id);
    expect(tx?.splitAmong).toHaveLength(0); expect(await Todo.countDocuments()).toBe(0);
    const res = await request(app).get(`/api/projects/${project._id}/finance`).set('Authorization', `Bearer ${auth.token}`);
    expect(res.status).toBe(200); expect(res.body.transactions[0].note).toBe('印刷海报'); expect(res.body.summary).toBeNull();
  });
  it('同时重复确认只写一笔，结果回复失败不会报记账失败', async () => {
    await g('我买海报花了120.50元'); sendG.mockResolvedValueOnce(false);
    await Promise.all([g('确认'), g('确认')]);
    expect(await Transaction.countDocuments()).toBe(1);
    expect(sendG.mock.calls.some((call) => call[1].startsWith('记账失败'))).toBe(false);
  });
  it('收入、指定付款人和平摊成员使用项目成员唯一姓名', async () => {
    parse.mockResolvedValue({ ...parsed, type: 'income', payerName: '录入员', splitNames: ['我'] });
    await g('记账：收到赞助120.50元'); expect(last()).toContain('收款人：录入员');
    await g('确认'); const tx = await Transaction.findOne();
    expect(tx?.type).toBe('income'); expect(tx?.splitAmong.map(String)).toEqual([auth.user.id]);
  });
  it.each([null, { ...parsed, type: null }, { ...parsed, amount: null }, { ...parsed, amount: '-10' }, { ...parsed, amount: '0' }, { ...parsed, amount: '1.234' }, { ...parsed, amount: '999999999999999999' }])('解析失败或缺失/非法金额不建草稿 %j', async (result) => {
    parse.mockResolvedValue(result); await g('记账'); await g('确认'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('未绑定身份及无记账权限的成员拒绝记账', async () => {
    await g('记账', { author: { member_openid: 'unbound', username: '录入员' } }); expect(last()).toContain('绑定');
    await Project.updateOne({ _id: project._id }, { roles: [{ name: '录入', permissions: ['materials:manage'] }] });
    await g('记账'); expect(last()).toContain('记账权限'); expect(parse).not.toHaveBeenCalled();
  });
  it('预览后权限撤销、群解绑时不能确认', async () => {
    await g('记账'); await Project.updateOne({ _id: project._id }, { qqGroups: [] });
    await g('确认'); expect(await Transaction.countDocuments()).toBe(0); expect(last()).toContain('不可用');
  });
  it('确认时绑定已变化则拒绝', async () => {
    await g('记账'); await User.updateOne({ _id: auth.user.id }, { qqMemberIds: [] });
    await g('确认'); expect(last()).toContain('绑定已变化'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('未知付款人不替换为本人', async () => {
    parse.mockResolvedValue({ ...parsed, payerName: '不存在的人' }); await g('记账');
    expect(last()).toContain('不存在或重名'); await g('确认'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('取消及十分钟过期不入账', async () => {
    await g('记账'); await g('取消'); await g('确认'); expect(await Transaction.countDocuments()).toBe(0);
    await g('记账'); const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    await g('确认'); expect(last()).toContain('过期'); expect(await Transaction.countDocuments()).toBe(0);
  });
  it('私聊多活动选择后确认，序号越界可重试', async () => {
    const p = await secondProject(); await c('记账'); expect(lastC()).toContain('属于哪个活动');
    await c('99'); expect(lastC()).toContain('序号无效');
    await c('2'); expect(lastC()).toContain('请确认记账'); await c('确认');
    expect(String((await Transaction.findOne())?.projectId)).toBe(String(p._id));
  });
  it('完整新记账替换草稿，开始上传会清掉记账草稿', async () => {
    await g('记账：120元'); parse.mockResolvedValue({ ...parsed, amount: '20' }); await g('记账：20元'); await g('确认');
    expect((await Transaction.findOne())?.amountCents).toBe(2000);
    await g('记账：新记录'); await g('开始上传物料'); await g('取消上传物料'); await g('确认');
    expect(await Transaction.countDocuments()).toBe(1);
  });
  it('AI 未配置时提示网页记账，物料不依赖 AI', async () => {
    config.ai.apiKey = ''; await g('记账：买海报花了20元'); expect(last()).toContain('需要配置 AI');
    await g('开始上传物料'); expect(last()).toContain('已开始上传物料'); expect(classify).not.toHaveBeenCalled();
  });
});

describe('QQ 物料上传会话', () => {
  it('同一附件消息通过两种群事件重复投递只收一次', async () => {
    await g('开始上传物料');
    const event = payload('', { attachments: [attachment] });
    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', event);
    await handleQQEvent('GROUP_MESSAGE_CREATE', event);
    await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(1);
  });
  it('图片使用现有预览生成逻辑，原文件和缩略图可通过网页读取', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff0000' } }).png().toBuffer();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } })));
    await g('开始上传物料');
    await g('', { attachments: [{ ...attachment, filename: '海报.png', content_type: 'image/png' }] });
    await g('结束上传物料');
    const r = await Resource.findOne(); const v = await ResourceVersion.findOne(); expect(v?.previewPath).toBeTruthy();
    const res = await request(app).get(`/api/projects/${project._id}/materials/${r?._id}/preview`).set('Authorization', `Bearer ${auth.token}`);
    expect(res.status).toBe(200); expect(res.headers['content-type']).toContain('image/webp');
  });

  it('单独文件消息暂存、结束后建物料及第一版本，网页可下载', async () => {
    await g('开始上传物料'); await g('用于舞台海报'); await g('', { attachments: [attachment] });
    expect(last()).toContain('本次共 1 个'); expect(await File.countDocuments()).toBe(0); expect(await Resource.countDocuments()).toBe(0);
    await g('结束上传物料'); const r = await Resource.findOne(); const v = await ResourceVersion.findOne();
    expect(r?.name).toBe('海报.txt'); expect(r?.description).toBe('用于舞台海报'); expect(v?.version).toBe(1);
    const res = await request(app).get(`/api/projects/${project._id}/materials/${r?._id}/versions/1/download`).set('Authorization', `Bearer ${auth.token}`);
    expect(res.status).toBe(200); expect(res.text).toBe('物料正文'); expect(classify).not.toHaveBeenCalled();
  });
  it('同发送者收到附件与结束并发时等待下载完成，重复结束不重复建档', async () => {
    await g('开始上传物料'); await Promise.all([g('', { attachments: [attachment] }), g('结束上传物料')]);
    await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(1); expect(await File.countDocuments()).toBe(1);
  });
  it('取消清理临时文件且不写入资源、文件或版本', async () => {
    const before = (await fs.readdir('/tmp')).filter((n) => n.startsWith('anon-qq-material-'));
    await g('开始上传物料'); await g('', { attachments: [attachment] }); await g('取消上传物料');
    expect(await Resource.countDocuments()).toBe(0); expect(await File.countDocuments()).toBe(0);
    expect((await fs.readdir('/tmp')).filter((n) => n.startsWith('anon-qq-material-'))).toEqual(before);
  });
  it('没有开始、没有附件或会话超时均不建空物料', async () => {
    await g('', { attachments: [attachment] }); expect(last()).toContain('开始上传物料');
    await g('开始上传物料'); await g('结束上传物料'); expect(last()).toContain('未收到文件');
    await g('开始上传物料'); await g('', { attachments: [attachment] });
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    await g('结束上传物料'); expect(last()).toContain('过期'); expect(await Resource.countDocuments()).toBe(0);
  });
  it('私聊选择活动和多个分类，不接收选择前文件', async () => {
    await secondProject(); const t2 = await ResourceType.create({ projectId: project._id, name: '第二分类' });
    await c('开始上传物料'); expect(lastC()).toContain('哪个活动'); await c('1'); expect(lastC()).toContain('物料分类');
    await c('', { attachments: [attachment] }); expect(lastC()).toContain('请先回复');
    await c('2'); await c('', { attachments: [attachment] }); await c('结束上传物料');
    expect(String((await Resource.findOne())?.typeId)).toBe(String(t2._id));
  });
  it('无分类时在结束时创建 QQ上传 分类', async () => {
    await type.deleteOne(); await g('开始上传物料'); expect(await ResourceType.countDocuments()).toBe(0);
    await g('', { attachments: [attachment] }); await g('结束上传物料'); expect((await ResourceType.findOne())?.name).toBe('QQ上传');
  });
  it('隐私分类不列出、不允许通过管理权限绕过可见范围', async () => {
    await ResourceType.updateOne({ _id: type._id }, { visibility: { userIds: [], roleNames: ['其他角色'] } });
    await g('开始上传物料'); expect(last()).toContain('暂无对你可见'); expect(last()).not.toContain('设计资料');
  });
  it('结束前权限撤销或分类可见性变化，拒绝保存并清理', async () => {
    await g('开始上传物料'); await g('', { attachments: [attachment] });
    await ResourceType.updateOne({ _id: type._id }, { visibility: { userIds: [], roleNames: ['其他角色'] } });
    await g('结束上传物料'); expect(last()).toContain('不可见'); expect(await File.countDocuments()).toBe(0);
  });
  it('附件失败可以重发，单文件大于20MB及非 QQ 地址均拒绝抓取', async () => {
    await g('开始上传物料'); await g('', { attachments: [{ ...attachment, size: 21 * 1024 * 1024 }, { ...attachment, url: 'http://127.0.0.1/admin' }] });
    expect(fetch).not.toHaveBeenCalled(); expect(last()).toContain('0 个');
    await g('', { attachments: [attachment] }); await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(1);
  });
  it('最多10个文件，超量提示分批', async () => {
    await g('开始上传物料'); await g('', { attachments: Array.from({ length: 11 }, () => attachment) });
    expect(last()).toContain('本次共 10 个'); expect(last()).toContain('最多10个');
    await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(10);
  });
  it('部分保存失败回滚该文件，重试只保存失败项', async () => {
    await g('开始上传物料'); await g('', { attachments: [attachment, { ...attachment, filename: '第二份.txt' }] });
    vi.spyOn(ResourceVersion, 'create').mockRejectedValueOnce(new Error('写入失败'));
    await g('结束上传物料'); expect(last()).toContain('1 个保存失败'); expect(await Resource.countDocuments()).toBe(1); expect(await File.countDocuments()).toBe(1);
    await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(2); expect(await File.countDocuments()).toBe(2);
  });
  it('同群其他发送者不能结束上传，全量群附件仅进入本人的会话', async () => {
    await g('开始上传物料'); await g('结束上传物料', { author: { member_openid: 'other' } });
    await handleQQEvent('GROUP_MESSAGE_CREATE', payload('', { attachments: [attachment], mentions: [] }));
    await g('结束上传物料'); expect(await Resource.countDocuments()).toBe(1);
  });
  it('导出与上传互斥，转发消息不会误建物料或记账', async () => {
    await c('开始上传物料'); await c('转发聊天记录', { message_type: 102 }); expect(lastC()).toContain('直接发送文件');
    await c('开始导出'); await c('取消导出'); await c('结束上传物料'); expect(lastC()).toContain('当前没有');
    expect(await Resource.countDocuments()).toBe(0); expect(await Transaction.countDocuments()).toBe(0);
  });
});
