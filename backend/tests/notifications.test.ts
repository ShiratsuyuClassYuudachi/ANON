import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { ReminderLog } from '../src/models/ReminderLog';
import { User } from '../src/models/User';
import { WeeklyReportLog } from '../src/models/WeeklyReportLog';
import {
  notificationChannels,
  notify,
  type NotificationChannel,
} from '../src/services/notifications';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 sendMail：未配置 SMTP 时为控制台存根，测试中改为可断言的 mock
vi.mock('../src/services/mailer', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/mailer')>();
  return { ...mod, sendMail: vi.fn().mockResolvedValue(undefined) };
});

import { sendMail } from '../src/services/mailer';
const sendMailMock = vi.mocked(sendMail);

let owner: { token: string; user: { id: string; email: string } };
let staff: { token: string; user: { id: string; email: string } };
let staff2: { token: string; user: { id: string; email: string } };
let projectId: string;

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function addTodo(body: Record<string, unknown>, token = owner.token) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/todos`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.todo as { id: string };
}

/** 等待 fire-and-forget 的 notify 落定（路由不 await 通知） */
async function waitForMails(count: number) {
  await vi.waitFor(() => {
    expect(sendMailMock).toHaveBeenCalledTimes(count);
  });
}

function mailCalls() {
  return sendMailMock.mock.calls.map(([to, subject, text]) => ({ to, subject, text }));
}

beforeEach(async () => {
  sendMailMock.mockClear();
  const { config } = await import('../src/config');
  config.cronSecret = 'cron-test';
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  await InviteCode.create({ code: 'C2', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  staff2 = await registerUser('C2', 's2@example.com', 'Staff2');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '通知测试活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
  await invite(owner.token, staff2, '一般staff');
});

describe('通知渠道接口', () => {
  it('notify 排除 actorId（自指派不通知）', async () => {
    const ok = await notify({
      projectId,
      type: 'todo:assigned',
      title: 'T',
      body: 'B',
      recipients: [staff.user.id, owner.user.id],
      actorId: owner.user.id,
    });
    expect(ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(mailCalls()[0].to).toEqual(['s@example.com']);
  });

  it('渠道失败互不影响：抛错渠道不阻断邮件，notify 返回 false', async () => {
    const failing: NotificationChannel = {
      id: 'test-fail',
      deliver: async () => {
        throw new Error('boom');
      },
    };
    notificationChannels.push(failing);
    try {
      const ok = await notify({
        projectId,
        type: 'todo:assigned',
        title: 'T',
        body: 'B',
        recipients: [staff.user.id],
      });
      expect(ok).toBe(false);
      expect(sendMailMock).toHaveBeenCalledTimes(1);
    } finally {
      notificationChannels.pop();
    }
  });

  it('无收件人时静默成功', async () => {
    const ok = await notify({
      projectId,
      type: 'todo:assigned',
      title: 'T',
      body: 'B',
      recipients: [],
    });
    expect(ok).toBe(true);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('待办通知', () => {
  it('创建待办：通知指派人、排除操作者本人', async () => {
    await addTodo({ title: '布置场地', assigneeIds: [staff.user.id, owner.user.id] });
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to).toEqual(['s@example.com']);
    expect(call.subject).toContain('你被指派了待办');
    expect(call.subject).toContain('布置场地');
  });

  it('改派待办：只通知新增指派人，相同集合不重复', async () => {
    const todo = await addTodo({ title: '联系场地方', assigneeIds: [staff.user.id] });
    await waitForMails(1);
    sendMailMock.mockClear();

    const res = await request(app)
      .patch(`/api/projects/${projectId}/todos/${todo.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [staff.user.id, staff2.user.id] });
    expect(res.status).toBe(200);
    await waitForMails(1);
    expect(mailCalls()[0].to).toEqual(['s2@example.com']);

    sendMailMock.mockClear();
    await request(app)
      .patch(`/api/projects/${projectId}/todos/${todo.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [staff.user.id, staff2.user.id] });
    await new Promise((r) => setTimeout(r, 30));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('完成待办：通知其他指派人、排除完成者', async () => {
    const todo = await addTodo({ title: '制作物料', assigneeIds: [staff.user.id, staff2.user.id] });
    // 邮件渠道合并收件人为一次 sendMail（to 数组）
    await waitForMails(1);
    expect(mailCalls()[0].to.sort()).toEqual(['s2@example.com', 's@example.com']);
    sendMailMock.mockClear();

    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${todo.id}/complete`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to).toEqual(['s2@example.com']);
    expect(call.subject).toContain('待办已完成');
  });
});

describe('现场任务通知', () => {
  it('创建现场任务：通知新分配成员、排除操作者', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '入场检票', assigneeIds: [staff.user.id, owner.user.id] });
    expect(res.status).toBe(201);
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to).toEqual(['s@example.com']);
    expect(call.subject).toContain('被分配了现场任务');
    expect(call.subject).toContain('入场检票');
  });

  it('调整现场任务：只通知新增成员', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '摊位布置', assigneeIds: [staff.user.id] });
    expect(res.status).toBe(201);
    await waitForMails(1);
    sendMailMock.mockClear();

    const mid = res.body.module.id as string;
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${mid}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [staff.user.id, staff2.user.id] });
    expect(patch.status).toBe(200);
    await waitForMails(1);
    expect(mailCalls()[0].to).toEqual(['s2@example.com']);
  });
});

describe('公告通知', () => {
  it('重要/紧急公告通知可见成员，普通公告不通知', async () => {
    const post = async (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/projects/${projectId}/announcements`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body);

    await post({ title: '普通消息', content: '无', type: 'normal' });
    await new Promise((r) => setTimeout(r, 30));
    expect(sendMailMock).not.toHaveBeenCalled();

    await post({ title: '设备变动', content: '临时换场地', type: 'important' });
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to.sort()).toEqual(['s2@example.com', 's@example.com']);
    expect(call.subject).toContain('【重要】公告');
    expect(call.subject).toContain('设备变动');

    sendMailMock.mockClear();
    await post({ title: '火警演练', content: '立即撤离', type: 'emergency' });
    await waitForMails(1);
    expect(mailCalls()[0].subject).toContain('【紧急】公告');
  });

  it('重要公告按可见范围过滤收件人', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '内部消息', content: 'x', type: 'important', visibility: { roleNames: ['一般staff'] } });
    expect(res.status).toBe(201);
    await waitForMails(1);
    expect(mailCalls()[0].to.sort()).toEqual(['s2@example.com', 's@example.com']);
  });
});

describe('现场异常通知', () => {
  it('异常上报通知项目管理者（操作者除外）', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ category: 'equipment', note: '音响坏了' });
    expect(res.status).toBe(201);
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to).toEqual(['admin@example.com']);
    expect(call.subject).toContain('设备故障');
    expect(call.text).toContain('音响坏了');
  });
});

describe('cron 提醒走通知管线', () => {
  async function runReminders() {
    return request(app).post('/api/cron/reminders').set('Authorization', 'Bearer cron-test');
  }

  it('待办到期提醒发送且 ReminderLog 去重', async () => {
    await addTodo({
      title: '过期事项',
      assigneeIds: [staff.user.id],
      dueAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    await waitForMails(1); // 创建时的指派邮件
    sendMailMock.mockClear();

    const first = await runReminders();
    expect(first.status).toBe(200);
    expect(first.body.sent).toBe(1);
    expect(mailCalls()[0].subject).toContain('到期提醒');

    const second = await runReminders();
    expect(second.body.sent).toBe(0);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(await ReminderLog.countDocuments()).toBe(1);
  });

  it('里程碑临近通知管理者且去重', async () => {
    const ms = await request(app)
      .post(`/api/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '定稿日', date: new Date(Date.now() + 2 * 86400_000).toISOString() });
    expect(ms.status).toBe(201);

    const first = await runReminders();
    expect(first.body.sent).toBe(1);
    expect(mailCalls()[0].to).toEqual(['admin@example.com']);
    expect(mailCalls()[0].subject).toContain('里程碑临近');

    await runReminders();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('周报通过通知管线发送且 WeeklyReportLog 去重', async () => {
    const run = () =>
      request(app).post('/api/cron/weekly-report').set('Authorization', 'Bearer cron-test');

    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body.sent).toBe(1);
    expect(mailCalls()[0].to).toEqual(['admin@example.com']);
    expect(mailCalls()[0].subject).toContain('周报');

    await run();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(await WeeklyReportLog.countDocuments()).toBe(1);
  });
});

describe('风险通知', () => {
  it('新检测 warning 风险通知管理者，info 不通知', async () => {
    // todo:overdue = warning，todo:no_assignee = info —— 只应发出 warning 那一封
    await addTodo({
      title: '过期无负责人',
      dueAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 30));
    sendMailMock.mockClear();

    const res = await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    await waitForMails(1);
    const [call] = mailCalls();
    expect(call.to).toEqual(['admin@example.com']);
    expect(call.subject).toContain('【风险】');
    expect(call.subject).toContain('待办已逾期');

    // 再次 evaluate：已有风险不重复通知
    sendMailMock.mockClear();
    await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
