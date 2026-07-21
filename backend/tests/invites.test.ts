import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { Membership } from '../src/models/Membership';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let guest: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  guest = await registerUser('C1', 'g1@example.com', 'G1');
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = res.body.project.id;
});

async function createInvite(body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff', ...body });
  expect(res.status).toBe(201);
  return res.body as { token: string; url: string };
}

describe('project invites', () => {
  it('开放链接：登录用户接受后成为成员', async () => {
    const { token } = await createInvite();
    const info = await request(app)
      .get(`/api/invites/${token}`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(info.status).toBe(200);
    expect(info.body.invite.projectName).toBe('活动');
    const accept = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(accept.status).toBe(200);
    const m = await Membership.findOne({ projectId, userId: guest.user.id });
    expect(m?.roleName).toBe('一般staff');
  });

  it('指定用户的链接被他人接受返回 403', async () => {
    const { token } = await createInvite({ targetUserId: owner.user.id });
    const res = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(403);
  });

  it('重复接受返回 410', async () => {
    const { token } = await createInvite();
    await request(app).post(`/api/invites/${token}/accept`).set('Authorization', `Bearer ${guest.token}`);
    const again = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(again.status).toBe(410);
  });
});
