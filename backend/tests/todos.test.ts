import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;

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
  // 邀请 staff 加入
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

async function addTodo(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/todos`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.todo as { id: string };
}

describe('todos', () => {
  it('成员可创建待办并出现在列表中', async () => {
    await addTodo(staff.token, {
      title: '定海报',
      category: '美工',
      assigneeIds: [staff.user.id],
      dueAt: '2026-08-01T10:00:00.000Z',
    });
    const res = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.todos).toHaveLength(1);
    expect(res.body.todos[0].assignees[0].name).toBe('Staff');
  });

  it('指派人必须是项目成员', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'X', assigneeIds: [owner.user.id.replace(/.$/, (c) => (c === '0' ? '1' : '0'))] });
    // 不存在的用户 id 也违反成员校验
    expect([400, 500]).toContain(res.status);
  });

  it('按类别筛选、按到期时间排序', async () => {
    await addTodo(owner.token, { title: 'A', category: '宣发', dueAt: '2026-08-03T00:00:00Z' });
    await addTodo(owner.token, { title: 'B', category: '美工', dueAt: '2026-08-01T00:00:00Z' });
    const res = await request(app)
      .get(`/api/projects/${projectId}/todos?sort=dueAt&order=asc`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.body.todos.map((t: { title: string }) => t.title)).toEqual(['B', 'A']);
    const filtered = await request(app)
      .get(`/api/projects/${projectId}/todos?category=美工`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(filtered.body.todos).toHaveLength(1);
  });

  it('一般staff 无 todo:manage，不能编辑/删除他人待办', async () => {
    const t = await addTodo(owner.token, { title: 'A' });
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/todos/${t.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ title: 'B' });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/todos/${t.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
  });
});
