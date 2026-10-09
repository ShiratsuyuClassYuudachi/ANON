import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { File } from '../src/models/File';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { handleQQEvent } from '../src/services/qqEvents';
import { appendCollect, cancelCollect, endCollect, getCollect, startCollect } from '../src/services/qqCollectSession';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 QQ 发送（同 qq.test.ts 的模块边界 mock 模式）
vi.mock('../src/services/qqApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/qqApi')>();
  return {
    ...mod,
    sendC2CMessage: vi.fn().mockResolvedValue(true),
    sendGroupMessage: vi.fn().mockResolvedValue(true),
  };
});

import { sendC2CMessage } from '../src/services/qqApi';
const sendC2CMock = vi.mocked(sendC2CMessage);

describe('qqCollectSession 会话模块', () => {
  it('开始/追加/结束/取消的生命周期', () => {
    startCollect('u-lc', { id: '507f1f77bcf86cd799439011', name: '测试员' });
    expect(getCollect('u-lc')?.userName).toBe('测试员');
    const r = appendCollect('u-lc', [{ author: '测试员', text: 'hi', images: [] }]);
    expect(r).toEqual({ total: 1, capped: false });
    const s = endCollect('u-lc');
    expect(s?.messages).toHaveLength(1);
    expect(getCollect('u-lc')).toBeNull();
    expect(cancelCollect('u-lc')).toBe(false);
  });

  it('重新开始会覆盖旧会话', () => {
    startCollect('u-rs', { id: '507f1f77bcf86cd799439011', name: 'A' });
    appendCollect('u-rs', [{ author: 'A', text: '旧内容', images: [] }]);
    startCollect('u-rs', { id: '507f1f77bcf86cd799439011', name: 'A' });
    expect(getCollect('u-rs')?.messages).toHaveLength(0);
    cancelCollect('u-rs');
  });

  it('超过 500 条截断并标记 capped/truncated', () => {
    startCollect('u-cap', { id: '507f1f77bcf86cd799439011', name: 'A' });
    const many = Array.from({ length: 600 }, (_, i) => ({ author: 'A', text: `m${i}`, images: [] }));
    const r = appendCollect('u-cap', many);
    expect(r).toEqual({ total: 500, capped: true });
    expect(getCollect('u-cap')?.truncated).toBe(true);
    // 截断后再追加不再生效
    expect(appendCollect('u-cap', [{ author: 'A', text: 'x', images: [] }])).toEqual({ total: 500, capped: true });
    cancelCollect('u-cap');
  });

  it('30 分钟未操作会话过期', () => {
    vi.useFakeTimers();
    try {
      startCollect('u-ttl', { id: '507f1f77bcf86cd799439011', name: 'A' });
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      expect(getCollect('u-ttl')).toBeNull();
      expect(appendCollect('u-ttl', [{ author: 'A', text: 'x', images: [] }])).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('C2C 收集模式（开始/结束导出）', () => {
  let owner: { token: string; user: { id: string } };
  let staff: { token: string; user: { id: string } };
  const OPENID = 'U-COLL';

  beforeEach(async () => {
    sendC2CMock.mockClear();
    // 默认禁网：直发图片抓取走 mock，个别用例再覆盖为成功路径
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no net')));
    config.qq.appId = 'qq-test-appid';
    config.qq.appSecret = 'qq-test-secret';
    config.publicBaseUrl = 'https://app.example.com';

    owner = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    staff = await registerUser('C1', 'coll@example.com', '收集员');
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: OPENID });
    cancelCollect(OPENID);
  });

  afterAll(() => {
    config.qq.appId = '';
    config.qq.appSecret = '';
    config.publicBaseUrl = '';
    vi.unstubAllGlobals();
  });

  const c2c = (id: string, d: Record<string, unknown>) =>
    handleQQEvent('C2C_MESSAGE_CREATE', { id, author: { user_openid: OPENID }, ...d });

  it('未绑定用户发「开始导出」→ 绑定引导，不建会话', async () => {
    await handleQQEvent('C2C_MESSAGE_CREATE', { id: 'm0', author: { user_openid: 'U-NOBIND' }, content: '开始导出' });
    expect(sendC2CMock).toHaveBeenCalledWith('U-NOBIND', expect.stringContaining('绑定'), { msgId: 'm0' });
    expect(getCollect('U-NOBIND')).toBeNull();
  });

  it('完整流程：文本/图片/语音/视频/合并转发合并为一个导出文件', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } })),
    );

    await c2c('m1', { content: '开始导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('已开始收集'), { msgId: 'm1' });

    await c2c('m2', { content: '第一条记录' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('已收录（本次共 1 条）'), { msgId: 'm2' });

    await c2c('m3', {
      content: '',
      attachments: [{ content_type: 'image/jpeg', filename: 'p.jpg', url: 'https://x.test/p.jpg', size: 100 }],
    });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('已收录（本次共 2 条）'), { msgId: 'm3' });

    await c2c('m4', {
      content: '',
      attachments: [{ content_type: 'voice', filename: 'v.silk', url: 'https://x.test/v.silk', asr_refer_text: '明天下午三点开会' }],
    });
    await c2c('m5', {
      content: '',
      attachments: [{ content_type: 'video/mp4', filename: 'v.mp4', url: 'https://x.test/v.mp4', size: 13212222 }],
    });

    // 收集期间的合并转发不即时导出，而是并入
    await c2c('m6', {
      message_type: 102,
      content: '[聊天记录]',
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: '转发里的内容' }],
    });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('已收录（本次共 5 条）'), { msgId: 'm6' });
    expect(sendC2CMock).not.toHaveBeenCalledWith(OPENID, expect.stringContaining('/dl/'), expect.anything());

    await c2c('m7', { content: '结束导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('/dl/'), { msgId: 'm7' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('仅本人可见'), { msgId: 'm7' });

    const f = await File.findOne({ uploadedBy: staff.user.id });
    expect(f).toBeTruthy();
    expect(f!.projectId).toBeFalsy();
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toContain('第一条记录');
    expect(down.text).toContain(`![p.jpg](data:image/png;base64,${png.toString('base64')})`);
    expect(down.text).toContain('[语音] 明天下午三点开会');
    expect(down.text).toContain('[视频] v.mp4（12.6MB）');
    expect(down.text).toContain('转发里的内容');
    // 会话已结束
    expect(getCollect(OPENID)).toBeNull();
  });

  it('「结束导出」无会话 → 提示；空会话 → 提示且不建档', async () => {
    await c2c('m10', { content: '结束导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('没有正在进行'), { msgId: 'm10' });

    await c2c('m11', { content: '开始导出' });
    await c2c('m12', { content: '结束导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('没有收集到任何内容'), { msgId: 'm12' });
    expect(await File.countDocuments()).toBe(0);
  });

  it('「取消导出」丢弃会话且不建档', async () => {
    await c2c('m20', { content: '开始导出' });
    await c2c('m21', { content: '一些内容' });
    await c2c('m22', { content: '取消导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('已取消'), { msgId: 'm22' });
    await c2c('m23', { content: '结束导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('没有正在进行'), { msgId: 'm23' });
    expect(await File.countDocuments()).toBe(0);
  });

  it('收集期间绑定码判断仍优先，不被收录', async () => {
    await c2c('m30', { content: '开始导出' });
    await c2c('m31', { content: '绑定 ZZ9999' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('绑定码无效'), { msgId: 'm31' });
    await c2c('m32', { content: '结束导出' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('没有收集到任何内容'), { msgId: 'm32' });
  });

  it('直发图片抓取失败时降级为文本占位', async () => {
    await c2c('m40', { content: '开始导出' });
    await c2c('m41', {
      content: '',
      attachments: [{ content_type: 'image/jpeg', filename: 'x.jpg', url: 'https://x.test/x.jpg', size: 100 }],
    });
    await c2c('m42', { content: '结束导出' });
    const f = await File.findOne({ uploadedBy: staff.user.id });
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.text).toContain('[图片] x.jpg');
    expect(down.text).not.toContain('x.test/x.jpg');
  });

  it('收集期间无可收集内容的消息回复提示', async () => {
    await c2c('m50', { content: '开始导出' });
    await c2c('m51', { content: '' });
    expect(sendC2CMock).toHaveBeenLastCalledWith(OPENID, expect.stringContaining('没有可收集的内容'), { msgId: 'm51' });
    cancelCollect(OPENID);
  });
});
