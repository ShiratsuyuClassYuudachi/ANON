import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let manager: { token: string; user: { id: string } };
let projectId: string;
let creatorId: string;

const BASE = () => `/api/projects/${projectId}/stage-signups`;
const START = '2026-10-17T10:00:00+08:00';
const END = '2026-10-17T12:00:00+08:00';

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createSignup(name = 'Day1 舞台报名', startAt = START, endAt = END) {
  const res = await request(app)
    .post(BASE())
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name, startAt, endAt });
  expect(res.status).toBe(201);
  return res.body.signup as { id: string };
}

async function addItem(sid: string, fields: Record<string, unknown>, token = owner.token) {
  return request(app)
    .post(`${BASE()}/${sid}/items`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: '节目', durationMin: 10, ...fields });
}

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  creatorId = creator.toString();
  await InviteCode.create({ code: 'C1', createdBy: creator });
  await InviteCode.create({ code: 'C2', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  manager = await registerUser('C2', 'm@example.com', 'Manager');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
  await invite(owner.token, manager, '主办');
});

describe('stage signups', () => {
  it('创建批次：201；空名称与 endAt<=startAt 400', async () => {
    const res = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Day1 舞台报名', startAt: START, endAt: END });
    expect(res.status).toBe(201);
    expect(res.body.signup.name).toBe('Day1 舞台报名');
    expect(res.body.signup.items).toEqual([]);

    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${owner.token}`);
    expect(list.body.signups[0].availableMin).toBe(120);

    const noName = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '  ', startAt: START, endAt: END });
    expect(noName.status).toBe(400);

    const badOrder = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'x', startAt: END, endAt: START });
    expect(badOrder.status).toBe(400);

    const equal = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'x', startAt: START, endAt: START });
    expect(equal.status).toBe(400);

    const badDate = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'x', startAt: 'not-a-date', endAt: END });
    expect(badDate.status).toBe(400);
  });

  it('权限：staff 写操作均 403，读列表与详情 200', async () => {
    const forbidden = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'x', startAt: START, endAt: END });
    expect(forbidden.status).toBe(403);

    const signup = await createSignup();
    const item = (await addItem(signup.id, { name: '开场舞', durationMin: 12 })).body.signup.items[0];

    expect((await addItem(signup.id, { name: 'x' }, staff.token)).status).toBe(403);

    const putReview = await request(app)
      .put(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ decision: 'approve' });
    expect(putReview.status).toBe(403);

    const patchStatus = await request(app)
      .patch(`${BASE()}/${signup.id}/items/${item.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'approved' });
    expect(patchStatus.status).toBe(403);

    const del = await request(app)
      .delete(`${BASE()}/${signup.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);

    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.signups.length).toBe(1);
    expect(list.body.signups[0].itemCount).toBe(1);
    expect(list.body.signups[0].approvedCount).toBe(0);

    const detail = await request(app)
      .get(`${BASE()}/${signup.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.signup.items.length).toBe(1);
  });

  it('item CRUD：durationMin 边界、participants 归一化、PATCH/DELETE、404', async () => {
    const signup = await createSignup();

    for (const v of [0, 1500, 1.5]) {
      const res = await addItem(signup.id, { durationMin: v });
      expect(res.status).toBe(400);
    }

    const created = await addItem(signup.id, {
      name: '开场舞',
      durationMin: 12,
      participants: [
        { cn: '阿喵', contact: 'QQ 11001001' },
        { cn: '  ', contact: 'x' },
        { cn: '露露' },
      ],
      note: '开场',
    });
    expect(created.status).toBe(201);
    const item = created.body.signup.items[0];
    expect(item.status).toBe('pending');
    expect(item.participants).toEqual([
      { cn: '阿喵', contact: 'QQ 11001001' },
      { cn: '露露', contact: '' },
    ]);

    const patched = await request(app)
      .patch(`${BASE()}/${signup.id}/items/${item.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ durationMin: 20, note: '改' });
    expect(patched.status).toBe(200);
    expect(patched.body.signup.items[0].durationMin).toBe(20);
    expect(patched.body.signup.items[0].note).toBe('改');

    const missing = 'ffffffffffffffffffffffff';
    const notFound = await request(app)
      .patch(`${BASE()}/${signup.id}/items/${missing}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ durationMin: 20 });
    expect(notFound.status).toBe(404);

    const del = await request(app)
      .delete(`${BASE()}/${signup.id}/items/${item.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
    expect(del.body.signup.items).toEqual([]);
  });

  it('review：upsert 本人一票、他人各一票、撤回幂等', async () => {
    const signup = await createSignup();
    const item = (await addItem(signup.id, { name: '宅歌连唱', durationMin: 20 })).body.signup.items[0];

    const bad = await request(app)
      .put(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'maybe' });
    expect(bad.status).toBe(400);

    const first = await request(app)
      .put(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'approve', comment: '稳' });
    expect(first.status).toBe(200);
    expect(first.body.signup.items[0].reviews.length).toBe(1);
    expect(first.body.signup.items[0].reviews[0].userName).toBe('Admin');
    expect(first.body.signup.items[0].reviews[0].decision).toBe('approve');
    expect(first.body.signup.items[0].reviews[0].comment).toBe('稳');

    const second = await request(app)
      .put(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'reject', comment: '撞档期' });
    expect(second.status).toBe(200);
    expect(second.body.signup.items[0].reviews.length).toBe(1);
    expect(second.body.signup.items[0].reviews[0].decision).toBe('reject');
    expect(second.body.signup.items[0].reviews[0].comment).toBe('撞档期');

    const third = await request(app)
      .put(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ decision: 'approve', comment: '可以' });
    expect(third.status).toBe(200);
    expect(third.body.signup.items[0].reviews.length).toBe(2);

    const withdrawn = await request(app)
      .delete(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.signup.items[0].reviews.length).toBe(1);
    expect(withdrawn.body.signup.items[0].reviews[0].userName).toBe('Manager');

    // 已无可撤 → 幂等 200，长度不变
    const again = await request(app)
      .delete(`${BASE()}/${signup.id}/items/${item.id}/review`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(again.status).toBe(200);
    expect(again.body.signup.items[0].reviews.length).toBe(1);
  });

  it('status：三值合法生效；非法值 400', async () => {
    const signup = await createSignup();
    const item = (await addItem(signup.id, { name: '走秀', durationMin: 25 })).body.signup.items[0];

    for (const status of ['approved', 'rejected', 'pending'] as const) {
      const res = await request(app)
        .patch(`${BASE()}/${signup.id}/items/${item.id}/status`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.signup.items[0].status).toBe(status);
    }

    const bad = await request(app)
      .patch(`${BASE()}/${signup.id}/items/${item.id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'maybe' });
    expect(bad.status).toBe(400);
  });

  it('import：approved 追加到 rundown、可重复追加、无 approved 400、rundownId 错 404', async () => {
    const rd = await request(app)
      .post(`/api/projects/${projectId}/stage-rundowns`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Day1 主舞台', startAt: START });
    expect(rd.status).toBe(201);
    const rundownId = rd.body.rundown.id as string;

    const signup = await createSignup();
    const itemA = (await addItem(signup.id, {
      name: '开场舞',
      durationMin: 12,
      participants: [{ cn: '阿喵', contact: 'QQ 11001001' }],
      note: '开场',
    })).body.signup.items[0];
    const itemB = (await addItem(signup.id, { name: '宅歌连唱', durationMin: 20 })).body.signup.items[1];
    await addItem(signup.id, { name: '随机宅舞', durationMin: 30 }); // 保持 pending，不应被导入

    for (const id of [itemA.id, itemB.id]) {
      const res = await request(app)
        .patch(`${BASE()}/${signup.id}/items/${id}/status`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'approved' });
      expect(res.status).toBe(200);
    }
    const imported = await request(app)
      .post(`${BASE()}/${signup.id}/import`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rundownId });
    expect(imported.status).toBe(200);
    expect(imported.body.rundown.items.length).toBe(2);
    expect(imported.body.rundown.items[0]).toMatchObject({
      name: '开场舞',
      durationMin: 12,
      participants: [{ cn: '阿喵', contact: 'QQ 11001001' }],
      note: '开场',
      attachments: [],
    });
    expect(imported.body.rundown.items[1].name).toBe('宅歌连唱');

    // 追加语义：再次导入不去重
    const again = await request(app)
      .post(`${BASE()}/${signup.id}/import`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rundownId });
    expect(again.status).toBe(200);
    expect(again.body.rundown.items.length).toBe(4);

    // 无 approved → 400
    const empty = await createSignup('Day2 舞台报名', '2026-10-18T10:00:00+08:00', '2026-10-18T12:00:00+08:00');
    await addItem(empty.id, { name: '待定节目', durationMin: 15 });
    const none = await request(app)
      .post(`${BASE()}/${empty.id}/import`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rundownId });
    expect(none.status).toBe(400);

    // rundownId 不属于本项目 → 404
    const bogus = await request(app)
      .post(`${BASE()}/${signup.id}/import`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rundownId: 'ffffffffffffffffffffffff' });
    expect(bogus.status).toBe(404);
  });
});
