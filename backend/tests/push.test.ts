import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { PushSubscription } from '../src/models/PushSubscription';
import { User } from '../src/models/User';
import { notify } from '../src/services/notifications';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 web-push：测试中改为可断言的 mock
vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
    setVapidDetails: vi.fn(),
  },
}));

import webpush from 'web-push';
const sendMock = vi.mocked(webpush.sendNotification);
const setDetailsMock = vi.mocked(webpush.setVapidDetails);

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;

const SUB = {
  endpoint: 'https://push.example.com/abc',
  p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkRxZ8IpE2T-3d8gO4Vfjm3eXYbFq1l2kZ4s7QhVAA',
  auth: 'FI9zAHN9SpbuXc4bNFGJaw',
};

async function addSubscription(body: Record<string, unknown> = SUB, token = staff.token) {
  const res = await request(app)
    .post('/api/push/subscription')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(200);
  return res.body as { ok: true };
}

beforeEach(async () => {
  sendMock.mockClear();
  setDetailsMock.mockClear();
  const { config } = await import('../src/config');
  config.vapid.publicKey = 'test-public-key';
  config.vapid.privateKey = 'test-private-key';
  config.vapid.subject = 'mailto:test@example.com';
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '推送测试活动' });
  projectId = p.body.project.id;
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

afterAll(async () => {
  const { config } = await import('../src/config');
  config.vapid.publicKey = '';
  config.vapid.privateKey = '';
});

describe('push 订阅路由', () => {
  it('config 返回 VAPID 公钥，未配置返回 null', async () => {
    const res = await request(app)
      .get('/api/push/config')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe('test-public-key');

    const { config } = await import('../src/config');
    config.vapid.publicKey = '';
    const res2 = await request(app)
      .get('/api/push/config')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res2.body.publicKey).toBeNull();
    config.vapid.publicKey = 'test-public-key';
  });

  it('未登录 401', async () => {
    const res = await request(app).get('/api/push/config');
    expect(res.status).toBe(401);
  });

  it('订阅按 endpoint 去重 upsert', async () => {
    await addSubscription();
    await addSubscription({ ...SUB, p256dh: 'UPDATED-KEY-UPDATED-KEY-UPDATED-KEY-UPDATED' });
    const docs = await PushSubscription.find({ userId: staff.user.id }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].p256dh).toBe('UPDATED-KEY-UPDATED-KEY-UPDATED-KEY-UPDATED');
  });

  it('订阅校验：非法 endpoint / base64 拒绝', async () => {
    const bad = await request(app)
      .post('/api/push/subscription')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ ...SUB, endpoint: 'ftp://push.example.com/x' });
    expect(bad.status).toBe(400);

    const bad2 = await request(app)
      .post('/api/push/subscription')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ ...SUB, auth: 'not base64!!' });
    expect(bad2.status).toBe(400);
  });

  it('超上限时淘汰最旧订阅', async () => {
    for (let i = 0; i < 22; i++) {
      await addSubscription({ ...SUB, endpoint: `https://push.example.com/${i}` });
    }
    const docs = await PushSubscription.find({ userId: staff.user.id }).sort({ createdAt: 1 }).lean();
    expect(docs).toHaveLength(20);
    // 最旧的 2 条（0、1）被淘汰
    expect(docs[0].endpoint).toBe('https://push.example.com/2');
  });

  it('删除订阅', async () => {
    await addSubscription();
    const res = await request(app)
      .delete('/api/push/subscription')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ endpoint: SUB.endpoint });
    expect(res.body).toEqual({ ok: true, removed: 1 });
    expect(await PushSubscription.countDocuments({ userId: staff.user.id })).toBe(0);
    // 幂等：再删为 0
    const again = await request(app)
      .delete('/api/push/subscription')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ endpoint: SUB.endpoint });
    expect(again.body.removed).toBe(0);
  });
});

describe('WebPushChannel', () => {
  it('向收件人设备推送 JSON 载荷（标题/正文/跳转 URL/分组 tag）', async () => {
    await addSubscription();
    const ok = await notify({
      projectId,
      type: 'todo:assigned',
      title: '你被指派了待办：布置场地',
      body: '待办「布置场地」，截止 2026-08-01',
      link: `/p/${projectId}?tab=todos`,
      recipients: [staff.user.id],
    });
    expect(ok).toBe(true);
    expect(setDetailsMock).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'test-public-key',
      'test-private-key',
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [sub, message] = sendMock.mock.calls[0];
    expect(sub.endpoint).toBe(SUB.endpoint);
    expect(sub.keys).toEqual({ p256dh: SUB.p256dh, auth: SUB.auth });
    const data = JSON.parse(message as string);
    expect(data.title).toContain('布置场地');
    expect(data.url).toBe(`/p/${projectId}?tab=todos`);
    expect(data.tag).toBe('todo:assigned:' + projectId);
  });

  it('只推送收件人自己的设备，不推他人', async () => {
    await addSubscription(SUB, staff.token);
    await addSubscription({ ...SUB, endpoint: 'https://push.example.com/owner' }, owner.token);
    await notify({
      projectId,
      type: 'todo:assigned',
      title: 'T',
      body: 'B',
      recipients: [staff.user.id],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].endpoint).toBe(SUB.endpoint);
  });

  it('410 Gone 时清除失效订阅', async () => {
    // 先插入失效订阅，保证 find 顺序中它先被投递并命中 410
    await addSubscription({ ...SUB, endpoint: 'https://push.example.com/dead' });
    await addSubscription();
    sendMock
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce({ statusCode: 201 });
    await notify({ projectId, type: 'todo:assigned', title: 'T', body: 'B', recipients: [staff.user.id] });
    const docs = await PushSubscription.find({ userId: staff.user.id }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].endpoint).toBe(SUB.endpoint);
  });

  it('未配置 VAPID 时静默跳过，不调用 sendNotification', async () => {
    const { config } = await import('../src/config');
    config.vapid.publicKey = '';
    config.vapid.privateKey = '';
    try {
      await addSubscription();
      const ok = await notify({
        projectId,
        type: 'todo:assigned',
        title: 'T',
        body: 'B',
        recipients: [staff.user.id],
      });
      expect(ok).toBe(true);
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      config.vapid.publicKey = 'test-public-key';
      config.vapid.privateKey = 'test-private-key';
    }
  });
});
