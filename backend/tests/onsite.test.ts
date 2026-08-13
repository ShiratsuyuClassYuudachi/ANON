import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { Announcement } from '../src/models/Announcement';
import { Incident } from '../src/models/Incident';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { WorkModule } from '../src/models/WorkModule';
import { createSuperAdmin, registerUser } from './helpers';

// 幂等性断言手法：先把字段改成已知旧值，再触发重复操作，验证未被覆盖（不依赖真实时钟间隔）
const PAST = new Date('2020-01-01T00:00:00.000Z');
const PAST_ISO = PAST.toISOString();

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let staff2: { token: string; user: { id: string } };
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
  await InviteCode.create({ code: 'C2', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  staff2 = await registerUser('C2', 's2@example.com', 'Staff2');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '现场测试活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
  await invite(owner.token, staff2, '一般staff');
});

async function addModule(body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/work-modules`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.module as {
    id: string;
    assignees: {
      userId: string;
      confirmedAt: string | null;
      checkedInAt: string | null;
      completedAt: string | null;
    }[];
  };
}

describe('checkin / finish', () => {
  it('本人签到 → checkedInAt 写入且不影响 confirmedAt；重复签到幂等不覆盖时戳', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const r1 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/checkin`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r1.status).toBe(200);
    const a1 = r1.body.module.assignees[0];
    expect(a1.checkedInAt).not.toBeNull();
    expect(a1.confirmedAt).toBeNull();
    expect(a1.completedAt).toBeNull();
    await WorkModule.updateOne(
      { _id: m.id, 'assignees.userId': staff.user.id },
      { $set: { 'assignees.$.checkedInAt': PAST } },
    );
    const r2 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/checkin`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r2.status).toBe(200);
    expect(r2.body.module.assignees[0].checkedInAt).toBe(PAST_ISO);
  });

  it('finish：未签到时同时补 checkedInAt；重复完成幂等不覆盖时戳', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const r1 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/finish`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r1.status).toBe(200);
    const a1 = r1.body.module.assignees[0];
    expect(a1.completedAt).not.toBeNull();
    expect(a1.checkedInAt).not.toBeNull();
    await WorkModule.updateOne(
      { _id: m.id, 'assignees.userId': staff.user.id },
      { $set: { 'assignees.$.checkedInAt': PAST, 'assignees.$.completedAt': PAST } },
    );
    const r2 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/finish`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r2.body.module.assignees[0].completedAt).toBe(PAST_ISO);
    expect(r2.body.module.assignees[0].checkedInAt).toBe(PAST_ISO);
  });

  it('已签到后 finish 不覆盖 checkedInAt', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/checkin`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    await WorkModule.updateOne(
      { _id: m.id, 'assignees.userId': staff.user.id },
      { $set: { 'assignees.$.checkedInAt': PAST } },
    );
    const f = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/finish`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(f.body.module.assignees[0].checkedInAt).toBe(PAST_ISO);
    expect(f.body.module.assignees[0].completedAt).not.toBeNull();
  });

  it('非 assignee 签到/完成 → 400', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const checkin = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/checkin`)
      .set('Authorization', `Bearer ${staff2.token}`)
      .send({});
    expect(checkin.status).toBe(400);
    const finish = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/finish`)
      .set('Authorization', `Bearer ${staff2.token}`)
      .send({});
    expect(finish.status).toBe(400);
  });

  it('代办：staff 带他人 userId → 403；主办代办 → 200', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id, staff2.user.id] });
    const forbidden = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/checkin`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ userId: staff2.user.id });
    expect(forbidden.status).toBe(403);
    const ok = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/finish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: staff.user.id });
    expect(ok.status).toBe(200);
    const target = ok.body.module.assignees.find((a: { userId: string }) => a.userId === staff.user.id);
    expect(target.completedAt).not.toBeNull();
    expect(target.checkedInAt).not.toBeNull();
  });
});

describe('incidents', () => {
  it('普通成员可上报 → 201，形状正确且关联模块名联查', async () => {
    const m = await addModule({ name: '舞台协助', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ category: 'equipment', note: '音响没电了', moduleId: m.id });
    expect(res.status).toBe(201);
    expect(res.body.incident).toMatchObject({
      category: 'equipment',
      note: '音响没电了',
      moduleId: m.id,
      moduleName: '舞台协助',
      status: 'open',
      reporter: { userId: staff.user.id, name: 'Staff' },
    });
    expect(res.body.incident.createdAt).toBeTruthy();
  });

  it('校验：note 空/超长、category 非法、moduleId 非法或跨项目 → 400', async () => {
    const other = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '别的活动' });
    const otherMod = await request(app)
      .post(`/api/projects/${other.body.project.id}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '别人模块' });
    const bad: Record<string, unknown>[] = [
      { category: 'equipment', note: '  ' },
      { category: 'equipment', note: 'x'.repeat(501) },
      { category: 'nope', note: 'hi' },
      { category: 'equipment', note: 'hi', moduleId: 'not-an-object-id' },
      { category: 'equipment', note: 'hi', moduleId: otherMod.body.module.id },
    ];
    for (const body of bad) {
      const res = await request(app)
        .post(`/api/projects/${projectId}/onsite/incidents`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });

  it('可见范围：普通成员只看自己上报的，manage 看全部（列表与聚合一致）', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ category: 'staff', note: '人手不足' });
    await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff2.token}`)
      .send({ category: 'safety', note: '通道堵塞' });

    const mine = await request(app)
      .get(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.incidents).toHaveLength(1);
    expect(mine.body.incidents[0].note).toBe('人手不足');

    const all = await request(app)
      .get(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(all.body.incidents).toHaveLength(2);

    const aggStaff = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(aggStaff.body.incidents).toHaveLength(1);
    const aggOwner = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(aggOwner.body.incidents).toHaveLength(2);
  });

  it('resolve：普通成员 403；manage 解决幂等（resolvedAt 不刷新）', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ category: 'venue', note: '展位漏水' });
    const iid = created.body.incident.id as string;

    const forbidden = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents/${iid}/resolve`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const r1 = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents/${iid}/resolve`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(r1.status).toBe(200);
    expect(r1.body.incident.status).toBe('resolved');

    await Incident.updateOne({ _id: iid }, { $set: { resolvedAt: PAST } });
    const r2 = await request(app)
      .post(`/api/projects/${projectId}/onsite/incidents/${iid}/resolve`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(r2.status).toBe(200);
    expect((await Incident.findById(iid))!.resolvedAt!.getTime()).toBe(PAST.getTime());
  });
});

describe('GET /onsite 聚合', () => {
  it('响应带 myPermissions：现场页按权限显隐失物登记入口', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.myPermissions)).toBe(true);
    // 一般staff 预置角色默认含 lostfound:manage
    expect(res.body.myPermissions).toContain('lostfound:manage');
  });

  it('myModules：state 计算正确，按 current > upcoming(startAt 升) > done 排序，只含指派给自己的', async () => {
    const now = Date.now();
    const current = await addModule({
      name: '进行中',
      assigneeIds: [staff.user.id],
      startAt: new Date(now - 3600_000).toISOString(),
      endAt: new Date(now + 3600_000).toISOString(),
    });
    const upcomingLate = await addModule({
      name: '稍后',
      assigneeIds: [staff.user.id],
      startAt: new Date(now + 7200_000).toISOString(),
    });
    const upcomingSoon = await addModule({
      name: '马上',
      assigneeIds: [staff.user.id],
      startAt: new Date(now + 1800_000).toISOString(),
    });
    const done = await addModule({ name: '已完成', assigneeIds: [staff.user.id] });
    await addModule({ name: '别人的', assigneeIds: [staff2.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${done.id}/finish`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});

    const res = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.now).toBeTruthy();
    const names = res.body.myModules.map((m: { name: string }) => m.name);
    expect(names).toEqual(['进行中', '马上', '稍后', '已完成']);
    const byId = new Map(res.body.myModules.map((m: { id: string; state: string }) => [m.id, m.state]));
    expect(byId.get(current.id)).toBe('current');
    expect(byId.get(upcomingSoon.id)).toBe('upcoming');
    expect(byId.get(upcomingLate.id)).toBe('upcoming');
    expect(byId.get(done.id)).toBe('done');
    const doneItem = res.body.myModules.find((m: { id: string }) => m.id === done.id);
    expect(doneItem.myAssignee.completedAt).not.toBeNull();
    expect(doneItem.myAssignee.checkedInAt).not.toBeNull();
    expect(doneItem.myAssignee.confirmedAt).toBeNull();
    const currentItem = res.body.myModules.find((m: { id: string }) => m.id === current.id);
    expect(currentItem.myAssignee).toMatchObject({ confirmedAt: null, checkedInAt: null, completedAt: null });
  });

  it('emergency：只含 emergency/important 且未过期、按可见范围过滤，pinned 在前', async () => {
    const ownerId = owner.user.id;
    await Announcement.create({
      projectId,
      title: '普通公告',
      type: 'normal',
      publishedBy: ownerId,
    });
    await Announcement.create({
      projectId,
      title: '已过期紧急',
      type: 'emergency',
      publishedBy: ownerId,
      expiresAt: new Date(Date.now() - 1000),
    });
    await Announcement.create({
      projectId,
      title: '别人可见紧急',
      type: 'emergency',
      publishedBy: ownerId,
      visibility: { userIds: [staff2.user.id], roleNames: [] },
    });
    await Announcement.create({ projectId, title: '紧急通知', type: 'emergency', publishedBy: ownerId });
    await Announcement.create({
      projectId,
      title: '置顶重要',
      type: 'important',
      isPinned: true,
      publishedBy: ownerId,
    });

    const res = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    const titles = res.body.emergency.map((a: { title: string }) => a.title);
    expect(titles).toEqual(['置顶重要', '紧急通知']);
    expect(res.body.emergency[0].type).toBe('important');
    expect(res.body.emergency[1].type).toBe('emergency');
    expect(res.body.emergency[0].publishedAt).toBeTruthy();
    // staff 看不到限定给 staff2 的；超管 owner 不受可见范围限制
    const ownerView = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${owner.token}`);
    const ownerTitles = ownerView.body.emergency.map((a: { title: string }) => a.title);
    expect(ownerTitles).toContain('别人可见紧急');
    expect(ownerTitles).not.toContain('普通公告');
    expect(ownerTitles).not.toContain('已过期紧急');
  });

  it('contacts：只含填写了联系方式的成员，带 roleName', async () => {
    await User.updateOne(
      { _id: staff.user.id },
      { contacts: [{ platform: 'phone', value: '13800000000' }, { platform: 'wechat', value: 'wx123' }] },
    );
    const res = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0]).toMatchObject({
      userId: staff.user.id,
      name: 'Staff',
      roleName: '一般staff',
      contacts: [
        { platform: 'phone', value: '13800000000' },
        { platform: 'wechat', value: 'wx123' },
      ],
    });
  });
});
