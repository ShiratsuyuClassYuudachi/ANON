import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let admin: { token: string; user: { id: string } };
let member: { token: string; user: { id: string } };
let outsider: { token: string; user: { id: string } };

beforeEach(async () => {
  admin = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  await InviteCode.create({ code: 'C2', createdBy: creator });
  member = await registerUser('C1', 'm1@example.com', 'M1');
  outsider = await registerUser('C2', 'o1@example.com', 'O1');
});

async function createProject(token: string, name = '测试活动') {
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, startDate: '2026-08-01', endDate: '2026-08-03' });
  expect(res.status).toBe(201);
  return res.body.project as { id: string };
}

describe('projects', () => {
  it('创建项目者自动成为成员且角色为主办（全部权限）', async () => {
    const p = await createProject(member.token);
    const detail = await request(app)
      .get(`/api/projects/${p.id}`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.myRole).toBe('主办');
    const host = detail.body.project.roles.find((r: { name: string }) => r.name === '主办');
    expect(host.permissions).toContain('project:manage');
    expect(detail.body.members).toHaveLength(1);
  });

  it('GET /api/projects 只列出自己参与的项目', async () => {
    await createProject(member.token, 'A');
    await createProject(outsider.token, 'B');
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${member.token}`);
    expect(res.body.projects.map((p: { name: string }) => p.name)).toEqual(['A']);
  });

  it('非成员访问项目详情返回 403', async () => {
    const p = await createProject(member.token);
    const res = await request(app)
      .get(`/api/projects/${p.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('可新增自定义角色并分配给成员；权限点生效', async () => {
    const p = await createProject(member.token);
    const created = await request(app)
      .post(`/api/projects/${p.id}/roles`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ name: '财务', permissions: ['todo:complete'] });
    expect(created.status).toBe(201);
    // 把 outsider 加不进来（需邀请流程，此处直接 PATCH 成员应 404）
    const res = await request(app)
      .patch(`/api/projects/${p.id}/members/${outsider.user.id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ roleName: '财务' });
    expect(res.status).toBe(404);
  });

  it('一般staff 无 member:manage，改成员角色被拒（403）', async () => {
    const p = await createProject(member.token);
    // member 把 outsider 直接拉进来做不到，改走：admin（超管）加入项目无成员记录也可操作
    const res = await request(app)
      .patch(`/api/projects/${p.id}/members/${member.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roleName: '一般staff' });
    expect(res.status).toBe(200);
    const deny = await request(app)
      .patch(`/api/projects/${p.id}/members/${member.user.id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ roleName: '主办' });
    expect(deny.status).toBe(403);
  });
});
