import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { signToken } from '../src/utils/jwt';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;
let projectB: string;

async function invite(pid: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${pid}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createTool(pid: string, fields: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/projects/${pid}/custom-tools`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '插件', url: 'https://tools.example.com', passToken: true, ...fields });
  expect(res.status).toBe(201);
  return res.body.tool as { id: string };
}

async function exchangeKey(pid: string, toolId: string, userToken: string) {
  const launch = await request(app)
    .post(`/api/projects/${pid}/custom-tools/${toolId}/launch`)
    .set('Authorization', `Bearer ${userToken}`);
  expect(launch.status).toBe(200);
  const res = await request(app).post('/api/open/exchange').send({ launchToken: launch.body.launchToken });
  expect(res.status).toBe(201);
  return res.body as { apiKey: string; expiresAt: string; scopes: string[]; projectId: string };
}

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动A' });
  projectId = p.body.project.id;
  const p2 = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动B' });
  projectB = p2.body.project.id;
  await invite(projectId, staff, '一般staff');
});

describe('openapi exchange', () => {
  it('exchange 收窄：工具 scopes ∩ 用户角色权限', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create', 'todo:manage'] });
    // 一般staff 仅持有 todo:create，不含 todo:manage
    const r = await exchangeKey(projectId, tool.id, staff.token);
    expect(r.scopes).toEqual(['todo:create']);
    expect(r.projectId).toBe(projectId);
    expect(r.apiKey.startsWith('anonk_')).toBe(true);
  });

  it('伪造 launchToken（乱串 / 用户 JWT）→ 401 invalid_launch_token', async () => {
    const junk = await request(app).post('/api/open/exchange').send({ launchToken: 'garbage' });
    expect(junk.status).toBe(401);
    expect(junk.body.error.code).toBe('invalid_launch_token');
    // kind 隔离：signToken 签的用户态 JWT 不能当启动令牌
    const userJwt = await request(app).post('/api/open/exchange').send({ launchToken: signToken(staff.user.id) });
    expect(userJwt.status).toBe(401);
    expect(userJwt.body.error.code).toBe('invalid_launch_token');
  });

  it('apikey 实战：读 200；有 scope 写 201；无 scope 写 403；伪造 key 401', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create'] });
    const { apiKey } = await exchangeKey(projectId, tool.id, staff.token);

    const list = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(list.status).toBe(200);

    const created = await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: '插件建的待办' });
    expect(created.status).toBe(201);

    // 无 todo:create 的 key（工具未勾选权限点）
    const tool0 = await createTool(projectId, { name: '无权限插件', scopes: [] });
    const { apiKey: key0 } = await exchangeKey(projectId, tool0.id, staff.token);
    const denied = await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${key0}`)
      .send({ title: 'x' });
    expect(denied.status).toBe(403);

    const forged = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', 'Bearer anonk_deadbeef');
    expect(forged.status).toBe(401);
  });

  it('跨项目：A 项目的 key 调 B 项目接口 → 403 api_key_wrong_project', async () => {
    await invite(projectB, staff, '一般staff'); // 同为 B 成员，隔离纯由 key 绑定决定
    const tool = await createTool(projectId, { scopes: ['todo:create'] });
    const { apiKey } = await exchangeKey(projectId, tool.id, staff.token);
    const res = await request(app)
      .get(`/api/projects/${projectB}/todos`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('api_key_wrong_project');
  });

  it('围栏：带 key 调 /api/me 与 /api/files/:id → 403 api_key_forbidden（先于 404）', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create'] });
    const { apiKey } = await exchangeKey(projectId, tool.id, staff.token);
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${apiKey}`);
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('api_key_forbidden');
    const file = await request(app)
      .get(`/api/files/${new Types.ObjectId()}`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(file.status).toBe(403);
    expect(file.body.error.code).toBe('api_key_forbidden');
  });

  it('顶替：同 (user, tool) 再次 exchange → 旧 key 401、新 key 200', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create'] });
    const first = await exchangeKey(projectId, tool.id, staff.token);
    const second = await exchangeKey(projectId, tool.id, staff.token);
    expect(first.apiKey).not.toBe(second.apiKey);
    const oldKey = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${first.apiKey}`);
    expect(oldKey.status).toBe(401);
    const newKey = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${second.apiKey}`);
    expect(newKey.status).toBe(200);
  });

  it('GET /api/open/me：带 key 返回身份与权限交集；带用户 JWT → 403 api_key_required', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create', 'todo:manage'] });
    const { apiKey } = await exchangeKey(projectId, tool.id, staff.token);
    const res = await request(app).get('/api/open/me').set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: staff.user.id, name: 'Staff' });
    expect(res.body.project).toMatchObject({ id: projectId, name: '活动A' });
    expect(res.body.permissions).toEqual(['todo:create']); // todo:manage 超角色权限被收窄
    expect(res.body.expiresAt).toBeTruthy();

    const withJwt = await request(app).get('/api/open/me').set('Authorization', `Bearer ${staff.token}`);
    expect(withJwt.status).toBe(403);
    expect(withJwt.body.error.code).toBe('api_key_required');
  });

  it('keys 列表仅本人；DELETE 他人 key 404；撤销后该 key 401', async () => {
    const tool = await createTool(projectId, { scopes: ['todo:create'] });
    const mine = await exchangeKey(projectId, tool.id, staff.token);
    const owners = await exchangeKey(projectId, tool.id, owner.token);

    const list = await request(app).get('/api/open/keys').set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.keys).toHaveLength(1);
    expect(list.body.keys[0]).toMatchObject({ name: '插件', projectId, toolName: '插件', expiresAt: expect.any(String) });

    const delOther = await request(app)
      .delete(`/api/open/keys/${list.body.keys[0].id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delOther.status).toBe(404);

    const myKeyId = list.body.keys[0].id;
    const del = await request(app)
      .delete(`/api/open/keys/${myKeyId}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(200);
    const after = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${mine.apiKey}`);
    expect(after.status).toBe(401);
    // 他人（owner）的 key 不受影响
    const ownerKey = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owners.apiKey}`);
    expect(ownerKey.status).toBe(200);
  });
});

describe('openapi self-serve keys', () => {
  it('自助生成：201 + 一次性原文；name 空 400；非成员 403；scopes 收窄为实际权限', async () => {
    const res = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ projectId, name: '走查脚本', scopes: ['todo:create', 'finance:manage', 'project:manage'] });
    expect(res.status).toBe(201);
    expect(res.body.apiKey.startsWith('anonk_')).toBe(true);
    // 一般staff 仅持 todo:create，三个请求权限点仅留一个
    expect(res.body.key.scopes).toEqual(['todo:create']);
    expect(res.body.key).toMatchObject({ name: '走查脚本', projectId, toolId: null, toolName: null });

    const noName = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ projectId, name: ' ' });
    expect(noName.status).toBe(400);

    const notMember = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ projectId: projectB, name: 'x' });
    expect(notMember.status).toBe(403);

    // 该 key 可读、写超 scope 403
    const key = res.body.apiKey as string;
    const list = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${key}`);
    expect(list.status).toBe(200);
    const denied = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${key}`)
      .send({ name: '改名' });
    expect(denied.status).toBe(403);

    // 密钥不能再造密钥
    const recurse = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${key}`)
      .send({ projectId, name: '子密钥' });
    expect(recurse.status).toBe(403);
    expect(recurse.body.error.code).toBe('api_key_forbidden');

    // GET /api/open/me 带自助 key 正常
    const me = await request(app).get('/api/open/me').set('Authorization', `Bearer ${key}`);
    expect(me.status).toBe(200);
    expect(me.body.permissions).toEqual(['todo:create']);
  });

  it('永久密钥：permanent=true → expiresAt null 且可用；默认 30 天', async () => {
    const perm = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ projectId, name: '常驻脚本', scopes: ['todo:create'], permanent: true });
    expect(perm.status).toBe(201);
    expect(perm.body.key.expiresAt).toBeNull();

    const me = await request(app).get('/api/open/me').set('Authorization', `Bearer ${perm.body.apiKey}`);
    expect(me.status).toBe(200);
    expect(me.body.expiresAt).toBeNull();

    const list = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${perm.body.apiKey}`);
    expect(list.status).toBe(200);

    const def = await request(app)
      .post('/api/open/keys')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ projectId, name: '临时脚本' });
    expect(def.status).toBe(201);
    const expires = new Date(def.body.key.expiresAt).getTime();
    expect(expires - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(expires - Date.now()).toBeLessThan(31 * 24 * 3600 * 1000);
  });
});
