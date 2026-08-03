import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { File } from '../src/models/File';
import { Project } from '../src/models/Project';
import { Todo } from '../src/models/Todo';
import { TrialSession } from '../src/models/TrialSession';
import { User } from '../src/models/User';
import { sweepExpiredTrials } from '../src/services/trial';
import { createSuperAdmin, createInviteCode } from './helpers';

const TRIAL_EMAIL = 'admin@test.com';

async function trialLoginReq(password: string) {
  return request(app).post('/api/auth/login').send({ email: TRIAL_EMAIL, password });
}

describe('trial mode', () => {
  it('试用登录创建演示环境', async () => {
    const res = await trialLoginReq('trial-pass-123');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.isSuperAdmin).toBe(false);
    expect(res.body.user.email).toMatch(/^trial-/);
    expect(res.body.trialExpiresAt).toBeTruthy();

    const projects = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(projects.status).toBe(200);
    expect(projects.body.projects).toHaveLength(1);
    expect(projects.body.projects[0].name).toBe('2026 秋季同人展');

    const todos = await request(app)
      .get(`/api/projects/${projects.body.projects[0].id}/todos`)
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(todos.status).toBe(200);
    expect(todos.body.todos).toHaveLength(10);
  });

  it('同密码再登录进入同一环境', async () => {
    const first = await trialLoginReq('trial-pass-123');
    expect(first.status).toBe(200);
    const projectId = (await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${first.body.token}`)).body.projects[0].id;

    const created = await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${first.body.token}`)
      .send({ title: '试用新增待办' });
    expect(created.status).toBe(201);

    const second = await trialLoginReq('trial-pass-123');
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);

    const todos = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${second.body.token}`);
    expect(todos.body.todos).toHaveLength(11);
  });

  it('不同密码进入不同环境', async () => {
    const a = await trialLoginReq('trial-pass-aaa');
    const b = await trialLoginReq('trial-pass-bbb');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.user.id).not.toBe(a.body.user.id);

    const projects = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${b.body.token}`);
    expect(projects.body.projects).toHaveLength(1);
    expect(projects.body.projects[0].name).toBe('2026 秋季同人展');
  });

  it('真实用户占用试用邮箱时走正常登录', async () => {
    await createSuperAdmin(TRIAL_EMAIL);
    const res = await trialLoginReq('password123');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TRIAL_EMAIL);
    expect(res.body.trialExpiresAt).toBeUndefined();
    expect(await TrialSession.countDocuments()).toBe(0);
  });

  it('注册试用邮箱被拒', async () => {
    const { token } = await createSuperAdmin();
    const code = await createInviteCode(token, 'TRIAL-CODE');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ inviteCode: code, email: TRIAL_EMAIL, name: 'X', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_reserved');
  });

  it('过期后同密码登录自动销毁并重建', async () => {
    const first = await trialLoginReq('trial-pass-123');
    expect(first.status).toBe(200);

    await TrialSession.updateOne({}, { $set: { expiresAt: new Date(0) } });

    const second = await trialLoginReq('trial-pass-123');
    expect(second.status).toBe(200);
    expect(second.body.user.id).not.toBe(first.body.user.id);

    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${first.body.token}`);
    expect(me.status).toBe(401);

    expect(await Project.countDocuments({ name: '2026 秋季同人展' })).toBe(1);
  });

  it('sweepExpiredTrials 级联清理过期环境', async () => {
    const res = await trialLoginReq('trial-pass-123');
    expect(res.status).toBe(200);

    await TrialSession.updateOne({}, { $set: { expiresAt: new Date(0) } });
    expect(await sweepExpiredTrials()).toBe(1);

    expect(
      await User.countDocuments({ email: /demo\.anon\.local|trial\.anon\.local/ }),
    ).toBe(0);
    expect(await Todo.countDocuments()).toBe(0);
    expect(await File.countDocuments()).toBe(0);
    expect(await TrialSession.countDocuments()).toBe(0);
  });

  it('试用密码过短返回 400', async () => {
    const res = await trialLoginReq('short');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('/api/me 暴露试用到期时间', async () => {
    // 先建超管（引导注册要求零用户），再做试用登录
    const { token } = await createSuperAdmin();
    const normal = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`);
    expect(normal.status).toBe(200);
    expect(normal.body.trialExpiresAt).toBeNull();

    const login = await trialLoginReq('trial-pass-123');
    expect(login.status).toBe(200);
    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.trialExpiresAt).toBe(login.body.trialExpiresAt);
  });
});
