import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { InviteCode } from '../src/models/InviteCode';
import { Project } from '../src/models/Project';
import { ReminderLog } from '../src/models/ReminderLog';
import { Todo } from '../src/models/Todo';
import { User } from '../src/models/User';
import { QQ_GROUP_TYPE_KEYS } from '../src/services/qqbot';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 QQ 发送（保留真实渠道逻辑），同 qq.test.ts mock 模式
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

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  config.cronSecret = 'cron-test';
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

describe('cron reminders', () => {
  it('密钥错误返回 401', async () => {
    const res = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('到期提醒发送一次且不重复', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: '过期事项',
        assigneeIds: [staff.user.id],
        dueAt: new Date(Date.now() - 3600_000).toISOString(),
        remindAt: new Date(Date.now() - 7200_000).toISOString(),
      });
    const first = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer cron-test');
    expect(first.status).toBe(200);
    expect(first.body.sent).toBe(2); // remind + due 各一封
    const second = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer cron-test');
    expect(second.body.sent).toBe(0);
    expect(await ReminderLog.countDocuments()).toBe(2);
  });

  it('未完成且未到时间的不发送', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: '未来事项',
        assigneeIds: [staff.user.id],
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
      });
    const res = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer cron-test');
    expect(res.body.sent).toBe(0);
  });

  it('群来源待办的节点提醒只回来源群（cron → 渠道 metadata 接线）', async () => {
    config.qq.appId = 'qq-test-appid';
    config.qq.appSecret = 'qq-test-secret';
    sendC2CMock.mockClear();
    sendGroupMock.mockClear();
    await Project.updateOne(
      { _id: projectId },
      {
        qqGroups: [
          { groupOpenId: 'grp-A', types: QQ_GROUP_TYPE_KEYS },
          { groupOpenId: 'grp-B', types: QQ_GROUP_TYPE_KEYS },
        ],
      },
    );
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: '群来源事项',
        assigneeIds: [staff.user.id],
        remindAt: new Date(Date.now() - 3600_000).toISOString(),
      });
    await Todo.updateOne({ projectId }, { qqSourceGroupOpenId: 'grp-A' });

    const res = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer cron-test');
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMock.mock.calls[0][0]).toBe('grp-A');
    expect(sendC2CMock).not.toHaveBeenCalled();
  });
});

// config 在同一 fork 内跨测试文件共享：收尾恢复未配置态，避免其他文件走真实 QQ 发送
afterAll(() => {
  config.qq.appId = '';
  config.qq.appSecret = '';
});
