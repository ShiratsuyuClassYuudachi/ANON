import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

describe('admin invite codes', () => {
  it('超管可创建（自动生成 code）并查看邀请码列表', async () => {
    const { token } = await createSuperAdmin();
    const created = await request(app)
      .post('/api/admin/invite-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-Z0-9-]{8,}$/);
    const list = await request(app)
      .get('/api/admin/invite-codes')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.inviteCodes).toHaveLength(1);
  });

  it('普通用户访问超管接口返回 403', async () => {
    const { token } = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'u1@example.com');
    const res = await request(app)
      .post('/api/admin/invite-codes')
      .set('Authorization', `Bearer ${u.token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
