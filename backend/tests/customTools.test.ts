import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { ApiKey } from '../src/models/ApiKey';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let outsider: { token: string; user: { id: string } };
let projectId: string;

const BASE = () => `/api/projects/${projectId}/custom-tools`;

async function invite(user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createTool(fields: Record<string, unknown> = {}, token = owner.token) {
  return request(app)
    .post(BASE())
    .set('Authorization', `Bearer ${token}`)
    .send({ name: '签到组件', url: 'https://tools.example.com', ...fields });
}

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  await InviteCode.create({ code: 'C2', createdBy: creator });
  await InviteCode.create({ code: 'C3', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  outsider = await registerUser('C2', 'o@example.com', 'Outsider');
  const third = await registerUser('C3', 'm@example.com', 'Manager');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(staff, '一般staff');
  await invite(third, '主办');
});

describe('custom tools', () => {
  it('创建 201 + 成员可读列表（字段齐全、createdBy 名解析）', async () => {
    const res = await createTool({ description: '自研组件', mode: 'link', passToken: true, scopes: ['todo:create'] });
    expect(res.status).toBe(201);
    expect(res.body.tool).toMatchObject({
      name: '签到组件',
      url: 'https://tools.example.com',
      description: '自研组件',
      mode: 'link',
      passToken: true,
      scopes: ['todo:create'],
      createdBy: { userId: owner.user.id, name: 'Admin' },
    });
    expect(res.body.tool.createdAt).toBeTruthy();

    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.tools).toHaveLength(1);
    expect(list.body.tools[0].id).toBe(res.body.tool.id);
  });

  it('校验：空名 400；javascript: URL 400 invalid_url；非法 mode 400；scopes 非法项被过滤', async () => {
    const noName = await createTool({ name: '  ' });
    expect(noName.status).toBe(400);

    const badUrl = await createTool({ url: 'javascript:alert(1)' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.code).toBe('invalid_url');

    const notUrl = await createTool({ url: 'not a url' });
    expect(notUrl.status).toBe(400);
    expect(notUrl.body.error.code).toBe('invalid_url');

    const badMode = await createTool({ mode: 'popup' });
    expect(badMode.status).toBe(400);

    const ok = await createTool({ scopes: ['todo:create', 'not:a:perm', 'finance:manage'] });
    expect(ok.status).toBe(201);
    expect(ok.body.tool.scopes).toEqual(['todo:create', 'finance:manage']);
  });

  it('无 tools:manage 的一般staff：POST/PATCH/DELETE 403，launch 不受影响', async () => {
    const created = await createTool({ passToken: true });
    expect(created.status).toBe(201);
    const tid = created.body.tool.id;

    const post = await createTool({ name: '越权' }, staff.token);
    expect(post.status).toBe(403);
    const patch = await request(app)
      .patch(`${BASE()}/${tid}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: '改名' });
    expect(patch.status).toBe(403);
    const del = await request(app).delete(`${BASE()}/${tid}`).set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);

    const launch = await request(app)
      .post(`${BASE()}/${tid}/launch`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(launch.status).toBe(200);
    expect(launch.body.launchToken).toBeTruthy();
  });

  it('非成员 GET 403', async () => {
    const res = await request(app).get(BASE()).set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('PATCH 编辑生效；DELETE 后列表为空且该工具 ApiKey 被级联删除', async () => {
    const created = await createTool({ passToken: true, scopes: ['todo:create'] });
    const tid = created.body.tool.id;

    const patched = await request(app)
      .patch(`${BASE()}/${tid}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '改名组件', mode: 'link' });
    expect(patched.status).toBe(200);
    expect(patched.body.tool.name).toBe('改名组件');
    expect(patched.body.tool.mode).toBe('link');
    expect(patched.body.tool.url).toBe('https://tools.example.com');

    // 先兑换一把 key，再删工具验证级联
    const launch = await request(app)
      .post(`${BASE()}/${tid}/launch`)
      .set('Authorization', `Bearer ${owner.token}`);
    const exchanged = await request(app).post('/api/open/exchange').send({ launchToken: launch.body.launchToken });
    expect(exchanged.status).toBe(201);
    expect(await ApiKey.countDocuments({ toolId: tid })).toBe(1);

    const del = await request(app).delete(`${BASE()}/${tid}`).set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${owner.token}`);
    expect(list.body.tools).toEqual([]);
    expect(await ApiKey.countDocuments({ toolId: tid })).toBe(0);
  });

  it('launch：passToken=false 400；true 200', async () => {
    const off = await createTool();
    const res1 = await request(app)
      .post(`${BASE()}/${off.body.tool.id}/launch`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res1.status).toBe(400);

    const on = await createTool({ name: '带身份', passToken: true });
    const res2 = await request(app)
      .post(`${BASE()}/${on.body.tool.id}/launch`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res2.status).toBe(200);
    expect(typeof res2.body.launchToken).toBe('string');
  });
});
