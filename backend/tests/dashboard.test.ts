import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
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

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '看板测试活动', startDate: '2026-12-01T09:00:00.000Z', endDate: '2026-12-02T18:00:00.000Z' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
});

describe('dashboard', () => {
  it('GET /dashboard 返回完整看板数据', async () => {
    // 创建待办
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '测试待办', assigneeIds: [staff.user.id] });

    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.metrics).toBeDefined();
    expect(res.body.summary.modules.todos.total).toBe(1);
    expect(res.body.myActions).toBeDefined();
    expect(res.body.risks).toBeDefined();
    expect(res.body.schedule).toBeDefined();
  });

  it('有 finance:add 权限的 staff 可以看到财务摘要', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.modules.finance).not.toBeNull();
  });

  it('owner 可以看到财务摘要', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.modules.finance).not.toBeNull();
  });

  it('待我处理包含指派给我的待办', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '我的任务', assigneeIds: [staff.user.id] });

    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.myActions.items.length).toBe(1);
    expect(res.body.myActions.items[0].title).toBe('我的任务');
    expect(res.body.myActions.items[0].action).toBe('complete');
  });

  it('待我处理包含未确认的现场任务', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '检票', requiredCount: 2, assigneeIds: [staff.user.id] });

    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    const workActions = res.body.myActions.items.filter((a: { sourceType: string }) => a.sourceType === 'work');
    expect(workActions.length).toBe(1);
    expect(workActions[0].action).toBe('confirm');
  });

  it('日程包含近期到期的待办', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '明天到期', dueAt: tomorrow });

    const res = await request(app)
      .get(`/api/projects/${projectId}/dashboard`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    const allItems = res.body.schedule.groups.flatMap((g: { items: unknown[] }) => g.items);
    expect(allItems.some((i: { title: string }) => i.title === '明天到期')).toBe(true);
  });
});

describe('risks', () => {
  it('人员不足产生 critical 风险', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '入口检票', requiredCount: 4, assigneeIds: [staff.user.id] });

    const evalRes = await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(evalRes.status).toBe(200);
    const shortage = evalRes.body.risks.find((r: { ruleCode: string }) => r.ruleCode === 'work:staff_shortage');
    expect(shortage).toBeDefined();
    expect(shortage.level).toBe('critical');
  });

  it('补足人员后风险自动解除', async () => {
    const wm = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '入口检票', requiredCount: 2, assigneeIds: [staff.user.id] });
    const wmId = wm.body.module.id;

    await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);

    // 补足人员
    await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${wmId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [staff.user.id, owner.user.id] });

    const res = await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    const shortage = res.body.risks.find((r: { ruleCode: string }) => r.ruleCode === 'work:staff_shortage');
    expect(shortage).toBeUndefined();
  });

  it('忽略风险需要原因且需要 project:manage', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '检票', requiredCount: 3, assigneeIds: [] });
    const evalRes = await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    const riskId = evalRes.body.risks[0].id;

    // staff 无权忽略
    const staffRes = await request(app)
      .post(`/api/projects/${projectId}/risks/${riskId}/ignore`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ reason: '测试' });
    expect(staffRes.status).toBe(403);

    // 缺少原因
    const noReason = await request(app)
      .post(`/api/projects/${projectId}/risks/${riskId}/ignore`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(noReason.status).toBe(400);

    // 正常忽略
    const ok = await request(app)
      .post(`/api/projects/${projectId}/risks/${riskId}/ignore`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reason: '已线下确认' });
    expect(ok.status).toBe(200);
    expect(ok.body.risk.status).toBe('ignored');
    expect(ok.body.risk.ignoreReason).toBe('已线下确认');
  });

  it('恢复已忽略的风险', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '检票', requiredCount: 3, assigneeIds: [] });
    const evalRes = await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    const riskId = evalRes.body.risks[0].id;

    await request(app)
      .post(`/api/projects/${projectId}/risks/${riskId}/ignore`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reason: '临时忽略' });

    const restore = await request(app)
      .post(`/api/projects/${projectId}/risks/${riskId}/restore`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(restore.status).toBe(200);
    expect(restore.body.risk.status).toBe('active');
    expect(restore.body.risk.ignoreReason).toBeNull();
  });

  it('健康度计算正确', async () => {
    // 无风险 → normal
    let res = await request(app)
      .get(`/api/projects/${projectId}/risks`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.body.health).toBe('normal');

    // 产生 critical → critical
    await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '检票', requiredCount: 5, assigneeIds: [] });
    await request(app)
      .post(`/api/projects/${projectId}/risks/evaluate`)
      .set('Authorization', `Bearer ${owner.token}`);
    res = await request(app)
      .get(`/api/projects/${projectId}/risks`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.body.health).toBe('critical');
  });
});
