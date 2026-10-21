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
