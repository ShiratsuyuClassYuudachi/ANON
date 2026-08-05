import request from 'supertest';
import jwt from 'jsonwebtoken';
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

describe('auth refresh tokens', () => {
  it('登录返回 refreshToken，refresh 轮换后旧 token 重放被拒', async () => {
    await createSuperAdmin();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();

    const rt = login.body.refreshToken as string;
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.token).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeTruthy();
    expect(refreshed.body.refreshToken).not.toBe(rt);

    // 新 access 可用
    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${refreshed.body.token}`);
    expect(me.status).toBe(200);

    // 旧 refreshToken 一次性作废：重放 401
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('invalid_refresh');
  });

  it('logout 吊销 refreshToken，之后 refresh 401', async () => {
    await createSuperAdmin();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    const rt = login.body.refreshToken as string;

    const out = await request(app).post('/api/auth/logout').send({ refreshToken: rt });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);

    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(refresh.status).toBe(401);
  });

  it('过期 access token 返回 401', async () => {
    const { user } = await createSuperAdmin();
    const expired = jwt.sign({ sub: user.id }, 'dev-only-insecure-secret', { expiresIn: '-1s' });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });
});
