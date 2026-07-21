import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let outsider: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  owner = await createSuperAdmin();
  await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
  outsider = await registerUser('C1', 'o@example.com');
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = res.body.project.id;
});

describe('files', () => {
  it('成员可上传并下载文件', async () => {
    const up = await request(app)
      .post(`/api/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('hello file'), '说明.txt');
    expect(up.status).toBe(201);
    expect(up.body.file.filename).toBe('说明.txt');
    const down = await request(app)
      .get(`/api/files/${up.body.file.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toBe('hello file');
  });

  it('非成员下载返回 403', async () => {
    const up = await request(app)
      .post(`/api/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('x'), 'a.txt');
    const res = await request(app)
      .get(`/api/files/${up.body.file.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });
});
