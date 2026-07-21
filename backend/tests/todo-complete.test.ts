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

describe('todo complete', () => {
  it('被指派的 staff 可带备注和附件完成待办', async () => {
    const t = await addTodo({ title: '定海报', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/complete`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('completionNote', '已完成初稿')
      .attach('files', Buffer.from('png-data'), '海报.png');
    expect(res.status).toBe(200);
    expect(res.body.todo.status).toBe('done');
    expect(res.body.todo.completionNote).toBe('已完成初稿');
    expect(res.body.todo.attachments[0].filename).toBe('海报.png');
  });

  it('未被指派的 staff 不能完成', async () => {
    const t = await addTodo({ title: '定海报' });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/complete`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('completionNote', '');
    expect(res.status).toBe(403);
  });

  it('todo:manage 持有者可完成任意待办', async () => {
    const t = await addTodo({ title: '定海报' });
    const res = await request(app)
      .post(`/api/projects/${projectId}/todos/${t.id}/complete`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
  });
});
