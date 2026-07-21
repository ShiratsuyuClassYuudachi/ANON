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

  it('资源版本文件绕过 visibility 下载被拒绝', async () => {
    // 两名成员：visible 在资源可见名单内，excluded 不在
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    await InviteCode.create({ code: 'C3', createdBy: (await User.findOne())!._id });
    const visible = await registerUser('C2', 'v@example.com');
    const excluded = await registerUser('C3', 'e@example.com');
    for (const [user, roleName] of [
      [visible, '美工'],
      [excluded, '一般staff'],
    ] as const) {
      const inv = await request(app)
        .post(`/api/projects/${projectId}/invites`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ roleName });
      await request(app)
        .post(`/api/invites/${inv.body.token}/accept`)
        .set('Authorization', `Bearer ${user.token}`);
    }

    const type = await request(app)
      .post(`/api/projects/${projectId}/materials/types`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '海报' });
    const resource = await request(app)
      .post(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ typeId: type.body.type.id, name: '内部稿', visibility: { userIds: [visible.user.id], roleNames: [] } });
    expect(resource.status).toBe(201);
    const up = await request(app)
      .post(`/api/projects/${projectId}/materials/${resource.body.resource.id}/versions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('secret'), 's.txt');
    expect(up.status).toBe(201);
    const versions = await request(app)
      .get(`/api/projects/${projectId}/materials/${resource.body.resource.id}/versions`)
      .set('Authorization', `Bearer ${owner.token}`);
    const fileId = versions.body.versions[0].file.id as string;

    // 不在可见名单中的项目成员 → 403
    const denied = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${excluded.token}`);
    expect(denied.status).toBe(403);

    // 名单内成员 → 200
    const okMember = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${visible.token}`);
    expect(okMember.status).toBe(200);
    expect(okMember.text).toBe('secret');

    // 超管 → 200
    const okAdmin = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(okAdmin.status).toBe(200);
  });
});
