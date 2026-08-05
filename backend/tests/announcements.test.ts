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

describe('announcements', () => {
  it('total 只统计当前用户可见公告，不泄露不可见数量', async () => {
    // 仅 owner 可见
    const hidden = await request(app)
      .post(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '仅管理员可见', visibility: { userIds: [owner.user.id], roleNames: [] } });
    expect(hidden.status).toBe(201);

    // 全员可见
    const pub = await request(app)
      .post(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: '全员公告', visibility: { userIds: [], roleNames: [] } });
    expect(pub.status).toBe(201);

    // staff 视角：total=1 且不含不可见条目
    const staffView = await request(app)
      .get(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(staffView.status).toBe(200);
    expect(staffView.body.total).toBe(1);
    expect(staffView.body.announcements).toHaveLength(1);
    expect(staffView.body.announcements[0].title).toBe('全员公告');

    // owner 视角：两条都可见
    const ownerView = await request(app)
      .get(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerView.body.total).toBe(2);
  });

  it('POST 非法 type 返回 400', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'X', type: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('POST 非法 expiresAt 返回 400', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/announcements`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'X', expiresAt: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});
