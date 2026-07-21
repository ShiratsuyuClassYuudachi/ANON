import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { ReminderLog } from '../src/models/ReminderLog';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  const { config } = await import('../src/config');
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
});
