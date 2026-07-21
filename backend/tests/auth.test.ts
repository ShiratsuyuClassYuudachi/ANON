import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

describe('auth', () => {
  it('无邀请码注册被拒绝', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.c', name: 'A', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_invite');
  });

  it('首个 SUPER_ADMIN_EMAIL 用户可无邀请码注册并成为超管', async () => {
    const { user } = await createSuperAdmin();
    const dbUser = await User.findOne({ email: 'admin@example.com' });
    expect(dbUser?.isSuperAdmin).toBe(true);
    expect(user.id).toBe(dbUser!._id.toString());
  });

  it('有效邀请码注册成功，邀请码被标记已用', async () => {
    await createSuperAdmin();
    await InviteCode.create({ code: 'ABC', createdBy: (await User.findOne())!._id });
    const { user, token } = await registerUser('ABC', 'u1@example.com');
    expect(token).toBeTruthy();
    expect(user.email).toBe('u1@example.com');
    const code = await InviteCode.findOne({ code: 'ABC' });
    expect(code?.usedBy?.toString()).toBe(user.id);
  });

  it('重复使用同一邀请码被拒绝', async () => {
    await createSuperAdmin();
    await InviteCode.create({ code: 'ABC', createdBy: (await User.findOne())!._id });
    await registerUser('ABC', 'u1@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ inviteCode: 'ABC', email: 'u2@example.com', name: 'U2', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('重复邮箱注册返回 409', async () => {
    await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    await registerUser('C1', 'u1@example.com');
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ inviteCode: 'C2', email: 'u1@example.com', name: 'X', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('登录成功返回 token，错误密码 401', async () => {
    await createSuperAdmin();
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('受保护接口无 token 返回 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });
});
