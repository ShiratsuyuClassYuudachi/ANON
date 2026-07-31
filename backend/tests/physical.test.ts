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
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
});

describe('physical inventory', () => {
  it('GET categories 懒初始化默认分类', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBe(6);
    expect(res.body.categories[0].name).toBe('印刷品');
  });

  it('staff 无 materials:manage 不能创建分类', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: '自定义' });
    expect(res.status).toBe(403);
  });

  it('owner 创建物资并校验数量非负整数', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const catId = cats.body.categories[0].id;

    const ok = await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'A3 指引牌', categoryId: catId, unit: '块', plannedQty: 20, onHandQty: 0 });
    expect(ok.status).toBe(201);
    expect(ok.body.item.plannedQty).toBe(20);

    const bad = await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'X', categoryId: catId, plannedQty: -1 });
    expect(bad.status).toBe(400);

    const bad2 = await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'X', categoryId: catId, plannedQty: 1.5 });
    expect(bad2.status).toBe(400);
  });

  it('数量变动 log 累加并记录日志，负值拒绝', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const catId = cats.body.categories[0].id;
    const item = await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '对讲机', categoryId: catId, unit: '台', plannedQty: 10 });
    const itemId = item.body.item.id;

    const adj = await request(app)
      .post(`/api/projects/${projectId}/physical/items/${itemId}/log`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'adjust_on_hand', delta: 8, note: '到货' });
    expect(adj.status).toBe(200);
    expect(adj.body.item.onHandQty).toBe(8);

    // staff 也可记日志（成员即可）
    const adj2 = await request(app)
      .post(`/api/projects/${projectId}/physical/items/${itemId}/log`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ type: 'adjust_on_hand', delta: -10 });
    expect(adj2.status).toBe(400); // 不能为负

    const logs = await request(app)
      .get(`/api/projects/${projectId}/physical/items/${itemId}/logs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(logs.status).toBe(200);
    expect(logs.body.logs.length).toBe(1);
    expect(logs.body.logs[0].qty).toBe(8);
  });

  it('状态流转 log 更新 status', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const catId = cats.body.categories[0].id;
    const item = await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '横幅', categoryId: catId });
    const itemId = item.body.item.id;

    const ch = await request(app)
      .post(`/api/projects/${projectId}/physical/items/${itemId}/log`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'status_change', status: 'in_stock' });
    expect(ch.status).toBe(200);
    expect(ch.body.item.status).toBe('in_stock');

    const logs = await request(app)
      .get(`/api/projects/${projectId}/physical/items/${itemId}/logs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(logs.body.logs[0].type).toBe('status_change');
    expect(logs.body.logs[0].status).toBe('in_stock');
  });

  it('summary 按分类与总计聚合', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const catId = cats.body.categories[0].id;
    await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'A', categoryId: catId, plannedQty: 10, onHandQty: 4 });
    await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'B', categoryId: catId, plannedQty: 5, onHandQty: 5 });

    const sum = await request(app)
      .get(`/api/projects/${projectId}/physical/summary`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(sum.status).toBe(200);
    expect(sum.body.total.planned).toBe(15);
    expect(sum.body.total.onHand).toBe(9);
    expect(sum.body.total.count).toBe(2);
    expect(sum.body.byCategory[0].count).toBe(2);
  });

  it('删除分类：有物资时拒绝，空分类可删', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const catId = cats.body.categories[0].id;
    await request(app)
      .post(`/api/projects/${projectId}/physical/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'X', categoryId: catId });

    const blocked = await request(app)
      .delete(`/api/projects/${projectId}/physical/categories/${catId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(blocked.status).toBe(400);

    const emptyId = cats.body.categories[5].id;
    const ok = await request(app)
      .delete(`/api/projects/${projectId}/physical/categories/${emptyId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ok.status).toBe(200);
  });

  it('重排分类顺序', async () => {
    const cats = await request(app)
      .get(`/api/projects/${projectId}/physical/categories`)
      .set('Authorization', `Bearer ${owner.token}`);
    const ids: string[] = cats.body.categories.map((c: { id: string }) => c.id);
    const reversed = [...ids].reverse();

    const res = await request(app)
      .patch(`/api/projects/${projectId}/physical/categories/reorder`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ order: reversed });
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: { id: string }) => c.id)).toEqual(reversed);

    const bad = await request(app)
      .patch(`/api/projects/${projectId}/physical/categories/reorder`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ order: 'not-an-array' });
    expect(bad.status).toBe(400);
  });

  it('跨项目隔离：itemId 不属于本项目返回 404', async () => {
    const fakeId = '000000000000000000000099';
    const res = await request(app)
      .get(`/api/projects/${projectId}/physical/items/${fakeId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(404);
  });
});
