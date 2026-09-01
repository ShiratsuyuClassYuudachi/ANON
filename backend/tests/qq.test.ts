import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { InviteCode } from '../src/models/InviteCode';
import { Project } from '../src/models/Project';
import { QQBindCode } from '../src/models/QQBindCode';
import { User } from '../src/models/User';
import { notify } from '../src/services/notifications';
import { createBindCode } from '../src/services/qqbot';
import { handleQQEvent } from '../src/services/qqEvents';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 QQ 发送（保留 createBindCode/consumeBindCode/qqConfigured 等真实实现），同 mailer mock 模式
vi.mock('../src/services/qqApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/qqApi')>();
  return {
    ...mod,
    sendC2CMessage: vi.fn().mockResolvedValue(true),
    sendGroupMessage: vi.fn().mockResolvedValue(true),
  };
});

import { sendC2CMessage, sendGroupMessage } from '../src/services/qqApi';
const sendC2CMock = vi.mocked(sendC2CMessage);
const sendGroupMock = vi.mocked(sendGroupMessage);

let owner: { token: string; user: { id: string; email: string } };
let staff: { token: string; user: { id: string; email: string } };
let projectId: string;

beforeEach(async () => {
  sendC2CMock.mockClear();
  sendGroupMock.mockClear();
  config.qq.appId = 'qq-test-appid';
  config.qq.appSecret = 'qq-test-secret';
  config.publicBaseUrl = '';

  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: 'QQ 通知测试活动' });
  projectId = p.body.project.id;
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

// config 在同一 fork 内跨测试文件共享：收尾恢复未配置态，避免其他文件的通知用例走真实 QQ 发送
afterAll(() => {
  config.qq.appId = '';
  config.qq.appSecret = '';
});

describe('个人绑定码', () => {
  it('POST /api/me/qq-bind-code 返回 6 位码，重复生成旧码失效；未配置时 503', async () => {
    const res = await request(app)
      .post('/api/me/qq-bind-code')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^\d{6}$/);
    expect(res.body.expiresAt).toBeTruthy();
    const firstCode = res.body.code as string;

    const res2 = await request(app)
      .post('/api/me/qq-bind-code')
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res2.status).toBe(201);
    // 单一有效码：旧码已删除，库里只剩一条
    expect(await QQBindCode.countDocuments({ kind: 'user', userId: staff.user.id })).toBe(1);
    expect(await QQBindCode.exists({ code: firstCode })).toBeFalsy();

    config.qq.appId = '';
    try {
      const res3 = await request(app)
        .post('/api/me/qq-bind-code')
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res3.status).toBe(503);
      expect(res3.body.error.code).toBe('qq_disabled');
    } finally {
      config.qq.appId = 'qq-test-appid';
    }
  });

  it('GET /api/me 暴露 qq 绑定状态（enabled/bound），DELETE 解绑', async () => {
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${staff.token}`);
    expect(me.body.qq).toEqual({ enabled: true, bound: false });

    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'qq-open-staff' });
    const me2 = await request(app).get('/api/me').set('Authorization', `Bearer ${staff.token}`);
    expect(me2.body.qq).toEqual({ enabled: true, bound: true });
    // openid 不外泄
    expect(JSON.stringify(me2.body)).not.toContain('qq-open-staff');

    const del = await request(app).delete('/api/me/qq-binding').set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(200);
    expect(del.body.qqBound).toBe(false);
    expect((await User.findById(staff.user.id).lean())!.qqOpenId).toBeUndefined();
  });
});

describe('项目群绑定码', () => {
  it('无 project:manage 权限 403；项目详情暴露 qqGroupBound/qqEnabled', async () => {
    const forbidden = await request(app)
      .post(`/api/projects/${projectId}/qq-bind-code`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .post(`/api/projects/${projectId}/qq-bind-code`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^\d{6}$/);

    const detail = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(detail.body.project.qqEnabled).toBe(true);
    expect(detail.body.project.qqGroupBound).toBe(false);

    const del = await request(app)
      .delete(`/api/projects/${projectId}/qq-binding`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
    expect(del.body.qqGroupBound).toBe(false);
  });
});

describe('QQ 事件绑定流程', () => {
  it('C2C「绑定 码」命中 → qqOpenId 落库 + 被动回复；重复推送同码回复无效提示', async () => {
    const res = await request(app)
      .post('/api/me/qq-bind-code')
      .set('Authorization', `Bearer ${staff.token}`);
    const code = res.body.code as string;

    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-1',
      author: { user_openid: 'qq-open-1' },
      content: `绑定 ${code}`,
    });
    expect((await User.findById(staff.user.id).lean())!.qqOpenId).toBe('qq-open-1');
    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    const [to, text, opts] = sendC2CMock.mock.calls[0];
    expect(to).toBe('qq-open-1');
    expect(text).toContain('绑定成功');
    expect(text).toContain('Staff');
    expect(opts).toEqual({ msgId: 'msg-1' });

    // 同一 msg 重复推送（码已消费）：不再绑定，回复无效提示
    sendC2CMock.mockClear();
    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-1',
      author: { user_openid: 'qq-open-1' },
      content: `绑定 ${code}`,
    });
    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][1]).toContain('绑定码无效');
    expect((await User.findById(staff.user.id).lean())!.qqOpenId).toBe('qq-open-1');
  });

  it('群@「绑定 码」命中项目码 → qqGroupOpenId 落库 + 群内回复', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/qq-bind-code`)
      .set('Authorization', `Bearer ${owner.token}`);
    const code = res.body.code as string;

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'gmsg-1',
      group_openid: 'grp-1',
      author: { member_openid: 'member-1' },
      content: `绑定：${code}`,
    });
    expect((await Project.findById(projectId).lean())!.qqGroupOpenId).toBe('grp-1');
    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    const [to, text, opts] = sendGroupMock.mock.calls[0];
    expect(to).toBe('grp-1');
    expect(text).toContain('已绑定项目');
    expect(text).toContain('QQ 通知测试活动');
    expect(opts).toEqual({ msgId: 'gmsg-1' });
  });

  it('过期码 → 回复无效提示，不落库', async () => {
    const { code } = await createBindCode('user', staff.user.id);
    await QQBindCode.updateOne({ code }, { expiresAt: new Date(Date.now() - 1000) });

    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-exp',
      author: { user_openid: 'qq-open-2' },
      content: `绑定 ${code}`,
    });
    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][1]).toContain('绑定码无效');
    expect((await User.findById(staff.user.id).lean())!.qqOpenId).toBeUndefined();
  });

  it('FRIEND_DEL / GROUP_DEL_ROBOT 清除对应绑定', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'qq-open-1' });
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: 'grp-1' });

    await handleQQEvent('FRIEND_DEL', { openid: 'qq-open-1' });
    await handleQQEvent('GROUP_DEL_ROBOT', { group_openid: 'grp-1' });

    expect((await User.findById(staff.user.id).lean())!.qqOpenId).toBeUndefined();
    expect((await Project.findById(projectId).lean())!.qqGroupOpenId).toBeUndefined();
    expect(sendC2CMock).not.toHaveBeenCalled();
    expect(sendGroupMock).not.toHaveBeenCalled();
  });
});

describe('QQ 通知渠道', () => {
  it('todo:assigned 只发已绑定用户单聊、不发群', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'qq-open-staff' });
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: 'grp-1' });

    const ok = await notify({
      projectId,
      type: 'todo:assigned',
      title: '你被指派了待办',
      body: '布置场地',
      recipients: [staff.user.id, owner.user.id],
    });
    expect(ok).toBe(true);
    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][0]).toBe('qq-open-staff');
    expect(sendC2CMock.mock.calls[0][1]).toContain('【你被指派了待办】');
    expect(sendGroupMock).not.toHaveBeenCalled();
  });

  it('milestone:approaching 发群 + 管理者单聊；PUBLIC_BASE_URL 配置时附查看链接', async () => {
    await User.updateOne({ _id: owner.user.id }, { qqOpenId: 'qq-open-owner' });
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: 'grp-1' });
    config.publicBaseUrl = 'https://app.example.com';
    try {
      const ok = await notify({
        projectId,
        type: 'milestone:approaching',
        title: '里程碑临近',
        body: '定稿日还剩 2 天',
        link: `/p/${projectId}?tab=milestones`,
        recipients: [owner.user.id, staff.user.id],
      });
      expect(ok).toBe(true);
      expect(sendGroupMock).toHaveBeenCalledTimes(1);
      expect(sendGroupMock.mock.calls[0][0]).toBe('grp-1');
      expect(sendGroupMock.mock.calls[0][1]).toContain(`查看：https://app.example.com/p/${projectId}?tab=milestones`);
      expect(sendC2CMock).toHaveBeenCalledTimes(1);
      expect(sendC2CMock.mock.calls[0][0]).toBe('qq-open-owner');
    } finally {
      config.publicBaseUrl = '';
    }
  });

  it('未配置凭证时静默成功：notify 返回 true、零发送、不阻塞去重标记', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'qq-open-staff' });
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: 'grp-1' });
    config.qq.appId = '';
    try {
      const ok = await notify({
        projectId,
        type: 'milestone:approaching',
        title: '里程碑临近',
        body: 'x',
        recipients: [staff.user.id],
      });
      expect(ok).toBe(true);
      expect(sendC2CMock).not.toHaveBeenCalled();
      expect(sendGroupMock).not.toHaveBeenCalled();
    } finally {
      config.qq.appId = 'qq-test-appid';
    }
  });

  it('有投递目标且全部失败 → 渠道抛错，notify 返回 false（cron 不写去重标记）', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'qq-open-staff' });
    sendC2CMock.mockResolvedValueOnce(false);
    const ok = await notify({
      projectId,
      type: 'todo:assigned',
      title: 'T',
      body: 'B',
      recipients: [staff.user.id],
    });
    expect(ok).toBe(false);
  });
});
