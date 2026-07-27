import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

describe('onboarding', () => {
  it('注册响应 onboardedAt 为 null', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.onboardedAt).toBeNull();
    void admin;
  });

  it('POST /api/me/onboarded 写入时戳，GET /api/me 一致', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const res = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.user.onboardedAt).not.toBeNull();
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.body.user.onboardedAt).toBe(res.body.user.onboardedAt);
    void admin;
  });

  it('重复 POST 幂等，不刷新时代码', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const r1 = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    expect(r2.body.user.onboardedAt).toBe(r1.body.user.onboardedAt);
    void admin;
  });
});
