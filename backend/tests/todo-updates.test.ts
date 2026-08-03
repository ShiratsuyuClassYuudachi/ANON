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
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

async function addTodo(body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/todos`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send(body);
  return res.body.todo as { id: string };
}

describe('todo updates', () => {
  it('被指派的 staff 可提交带备注和附件的进度', async () => {
    const t = await addTodo({ title: '定海报', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('note', '初稿完成 50%')
      .attach('files', Buffer.from('png'), '进度.png');
    expect(res.status).toBe(201);
    expect(res.body.todo.updates[0].note).toBe('初稿完成 50%');
    expect(res.body.todo.updates[0].createdByName).toBe('Staff');
    expect(res.body.todo.updates[0].attachments[0].filename).toBe('进度.png');
  });

  it('未被指派的 staff 不能提交进度', async () => {
    const t = await addTodo({ title: '定海报' });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('note', '初稿完成 50%');
    expect(res.status).toBe(403);
  });

  it('无备注且无附件时拒绝提交', async () => {
    const t = await addTodo({ title: '定海报', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('note', '');
    expect(res.status).toBe(400);
  });

  it('已完成待办不能提交进度', async () => {
    const t = await addTodo({ title: '定海报' });
    await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/complete`)
      .set('Authorization', `Bearer ${owner.token}`);
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('note', '补充进度');
    expect(res.status).toBe(409);
  });

  it('todo:manage 持有者可对任意待办提交进度', async () => {
    const t = await addTodo({ title: '定海报' });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('note', '管理者代报进度');
    expect(res.status).toBe(201);
  });

  it('进度写入列表序列化（updates 长度与内容）', async () => {
    const t = await addTodo({ title: '定海报', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/updates`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('note', '初稿完成 50%');
    const res = await request(app)
      .get(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`);
    const target = res.body.todos.find((x: { id: string }) => x.id === t.id);
    expect(target.updates).toHaveLength(1);
    expect(target.updates[0].note).toBe('初稿完成 50%');
    expect(target.updates[0].createdByName).toBe('Staff');
  });
});
