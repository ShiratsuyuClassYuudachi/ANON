import request from 'supertest';
import sharp from 'sharp';
import mongoose, { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let artist: { token: string; user: { id: string } };
let projectId: string;

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  await InviteCode.create({ code: 'C2', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  artist = await registerUser('C2', 'a@example.com', 'Artist');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
  await invite(owner.token, artist, '美工');
});

async function pngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
}

async function addType(token: string, name = '海报', visibility?: unknown) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/materials/types`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name, visibility });
  expect(res.status).toBe(201);
  return res.body.type as { id: string; name: string };
}

async function addResource(token: string, typeId: string, name = '主视觉', visibility?: unknown) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/materials`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typeId, name, visibility });
  expect(res.status).toBe(201);
  return res.body.resource as { id: string; name: string; latestVersion: number };
}

async function uploadVersion(token: string, resourceId: string, buf: Buffer, filename: string) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/materials/${resourceId}/versions`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buf, filename);
  expect(res.status).toBe(201);
  return res.body.version as { version: number; hasPreview: boolean };
}

describe('materials: 类型与资源 CRUD', () => {
  it('类型 CRUD', async () => {
    const t = await addType(owner.token);
    const list = await request(app)
      .get(`/api/projects/${projectId}/materials/types`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.types.map((x: { name: string }) => x.name)).toEqual(['海报']);

    const patch = await request(app)
      .patch(`/api/projects/${projectId}/materials/types/${t.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '宣传图' });
    expect(patch.status).toBe(200);
    expect(patch.body.type.name).toBe('宣传图');

    const del = await request(app)
      .delete(`/api/projects/${projectId}/materials/types/${t.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
  });

  it('无 materials:manage 权限的成员不能增删改类型/资源', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/materials/types`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: '海报' });
    expect(res.status).toBe(403);
    const t = await addType(owner.token);
    const r = await request(app)
      .post(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ typeId: t.id, name: 'X' });
    expect(r.status).toBe(403);
  });

  it('资源 CRUD，删除非空类型被拒绝', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const delType = await request(app)
      .delete(`/api/projects/${projectId}/materials/types/${t.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delType.status).toBe(400);

    const patch = await request(app)
      .patch(`/api/projects/${projectId}/materials/${r.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ description: '主视觉图' });
    expect(patch.status).toBe(200);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/materials/${r.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
  });
});

describe('materials: 版本', () => {
  it('上传新版本递增且最新版为默认', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const v1 = await uploadVersion(owner.token, r.id, Buffer.from('v1-content'), 'a.txt');
    expect(v1.version).toBe(1);
    const v2 = await uploadVersion(owner.token, r.id, Buffer.from('v2-content'), 'a.txt');
    expect(v2.version).toBe(2);

    const detail = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(detail.body.resource.latestVersion).toBe(2);

    const list = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('老版本可下载', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    await uploadVersion(owner.token, r.id, Buffer.from('v1-content'), 'a.txt');
    await uploadVersion(owner.token, r.id, Buffer.from('v2-content'), 'a.txt');
    const down = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/download`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toBe('v1-content');
  });

  it('图片上传生成 ≤100KB 的 WebP 预览', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const v = await uploadVersion(owner.token, r.id, await pngBuffer(), 'poster.png');
    expect(v.hasPreview).toBe(true);
    const preview = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('image/webp');
    expect(preview.body.length).toBeLessThanOrEqual(100 * 1024);
  });

  it('PDF 与音视频版本可内联预览', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const v1 = await uploadVersion(owner.token, r.id, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'), 'guide.pdf');
    expect(v1.hasPreview).toBe(true);
    const p1 = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p1.status).toBe(200);
    expect(p1.headers['content-type']).toContain('application/pdf');
    const pl = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(pl.status).toBe(200);
    expect(pl.headers['content-type']).toContain('application/pdf');
    const list = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${staff.token}`);
    const item = (list.body.resources as { id: string; hasPreview: boolean }[]).find((x) => x.id === r.id);
    expect(item?.hasPreview).toBe(true);

    const v2 = await uploadVersion(owner.token, r.id, Buffer.from('fake-mp4'), 'clip.mp4');
    expect(v2.hasPreview).toBe(true);
    const p2 = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/2/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p2.status).toBe(200);
    expect(p2.headers['content-type']).toContain('video/mp4');

    const v3 = await uploadVersion(owner.token, r.id, Buffer.from('fake-mov'), 'clip.mov');
    expect(v3.hasPreview).toBe(true);
    const p3 = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/3/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p3.status).toBe(200);
    expect(p3.headers['content-type']).toContain('video/quicktime');
  });

  it('Markdown 可预览，扩展名兜底 text/plain', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const v1 = await uploadVersion(owner.token, r.id, Buffer.from('# 标题\n正文'), 'notes.md');
    expect(v1.hasPreview).toBe(true);
    const p1 = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p1.status).toBe(200);
    expect(p1.headers['content-type']).toContain('text/markdown');

    const res2 = await request(app)
      .post(`/api/projects/${projectId}/materials/${r.id}/versions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('# 误报为纯文本'), { filename: 'plain-md.md', contentType: 'text/plain' });
    expect(res2.status).toBe(201);
    expect(res2.body.version.hasPreview).toBe(true);
    const p2 = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/2/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p2.status).toBe(200);
  });

  it('SVG 不内联预览（防 XSS 白名单不放宽）', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const v = await uploadVersion(owner.token, r.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'icon.svg');
    expect(v.hasPreview).toBe(false);
    const p = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p.status).toBe(404);
  });

  it('原型链属性名 mime（constructor）不可绕过白名单', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id);
    const res = await request(app)
      .post(`/api/projects/${projectId}/materials/${r.id}/versions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.bin', contentType: 'constructor' });
    expect(res.status).toBe(201);
    expect(res.body.version.hasPreview).toBe(false);
    const p = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/preview`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(p.status).toBe(404);
  });
});

describe('materials: 可见范围', () => {
  it('资源设置 visibility 后，不在名单中的成员看不到', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id, '内部稿', {
      userIds: [artist.user.id],
      roleNames: [],
    });
    await uploadVersion(owner.token, r.id, Buffer.from('secret'), 's.txt');

    const list = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.body.resources).toHaveLength(0);

    const get = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(get.status).toBe(403);

    const down = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/download`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(403);

    // 名单中的成员可见
    const visible = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${artist.token}`);
    expect(visible.body.resources).toHaveLength(1);
  });

  it('资源 visibility 优先于类型 visibility', async () => {
    const t = await addType(owner.token, '内部类型', { userIds: [], roleNames: ['美工'] });
    // 类型对 staff 不可见
    const typeList = await request(app)
      .get(`/api/projects/${projectId}/materials/types`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(typeList.body.types).toHaveLength(0);

    // 类型下的资源默认继承类型可见范围：staff 不可见
    const r1 = await addResource(owner.token, t.id, '继承类型');
    const list1 = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list1.body.resources.map((x: { id: string }) => x.id)).not.toContain(r1.id);

    // 资源自身 visibility 非空时覆盖类型：staff 可见
    const r2 = await addResource(owner.token, t.id, '覆盖类型', {
      userIds: [staff.user.id],
      roleNames: [],
    });
    const list2 = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list2.body.resources.map((x: { id: string }) => x.id)).toContain(r2.id);
  });
});

describe('materials: 旧版版本文档兼容', () => {
  it('filePath 时代版本（无 fileId）不拖垮列表/版本/下载端点', async () => {
    const t = await addType(owner.token);
    const r = await addResource(owner.token, t.id, '旧资源');
    // raw insert 绕过 mongoose 校验，模拟 filePath 时代的历史版本文档
    await mongoose.connection.db!.collection('resourceversions').insertOne({
      projectId: new Types.ObjectId(projectId),
      resourceId: new Types.ObjectId(r.id),
      version: 1,
      note: '初稿',
      filePath: '/dev/null',
      previewPath: null,
      mimeType: 'image/png',
      size: 1024,
      createdBy: new Types.ObjectId(owner.user.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const list = await request(app)
      .get(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    const row = list.body.resources.find((x: { id: string }) => x.id === r.id);
    expect(row).toBeTruthy();
    expect(row.latestVersion).toBe(1);
    expect(row.hasPreview).toBe(false);

    const detail = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.resource.latestVersion).toBe(1);

    const versions = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(versions.status).toBe(200);
    expect(versions.body.versions[0].file).toBeNull();
    expect(versions.body.versions[0].hasPreview).toBe(false);

    const download = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/download`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(download.status).toBe(404);
    expect(download.body.error.message).toContain('文件不存在');

    const preview = await request(app)
      .get(`/api/projects/${projectId}/materials/${r.id}/versions/1/preview`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(preview.status).toBe(404);
  });
});
