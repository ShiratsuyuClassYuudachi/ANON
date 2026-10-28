import fs from 'fs/promises';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { File } from '../src/models/File';
import { Project } from '../src/models/Project';
import { MATERIAL_CHUNK_BYTES, MATERIAL_MAX_BYTES } from '../src/middleware/upload';
import { createInviteCode, createSuperAdmin, registerUser } from './helpers';

let token: string;
let base: string;
let typeId: string;
let sessions: string[];

beforeEach(async () => {
  sessions = [];
  const owner = await createSuperAdmin();
  token = owner.token;
  const project = await request(app).post('/api/projects').auth(token, { type: 'bearer' }).send({ name: '上传测试' });
  base = `/api/projects/${project.body.project.id}/materials`;
  const type = await request(app).post(`${base}/types`).auth(token, { type: 'bearer' }).send({ name: '素材' });
  typeId = type.body.type.id;
});

afterEach(async () => {
  for (const id of sessions) await request(app).delete(`${base}/uploads/${id}`).auth(token, { type: 'bearer' });
  for (const file of await File.find()) await fs.unlink(file.path).catch(() => {});
});

async function start(size: number, filename = '设计稿.bin', mime = 'application/octet-stream') {
  const res = await request(app).post(`${base}/uploads`).auth(token, { type: 'bearer' }).send({ size, filename, mime });
  if (res.status === 201) sessions.push(res.body.uploadId);
  return res;
}

const chunk = (id: string, offset: number, bytes: Buffer, credential = token, url = base) =>
  request(app).put(`${url}/uploads/${id}`).auth(credential, { type: 'bearer' }).field('offset', String(offset)).attach('file', bytes, 'chunk');

async function grantArtistUpload(pid: string) {
  const project = (await Project.findById(pid))!;
  project.roles.find((role) => role.name === '美工')!.permissions.push('materials:manage');
  await project.save();
}

describe('物料分片上传', () => {
  it('既有 multipart 上传也允许超过原 20 MB 上限的物料', async () => {
    const res = await request(app).post(base).auth(token, { type: 'bearer' })
      .field('typeId', typeId).field('name', '大文件直传')
      .attach('file', Buffer.alloc(21 * 1024 * 1024), 'large.bin');
    expect(res.status).toBe(201);
    const versions = await request(app).get(`${base}/${res.body.resource.id}/versions`).auth(token, { type: 'bearer' });
    expect(versions.body.versions[0].file.size).toBe(21 * 1024 * 1024);
  });

  it('允许恰好 1 GB，并提供 8 MB 分片大小', async () => {
    const res = await start(MATERIAL_MAX_BYTES);
    expect(res.status).toBe(201);
    expect(res.body.chunkSize).toBe(8 * 1024 * 1024);
    expect((await request(app).delete(`${base}/uploads/${res.body.uploadId}`).auth(token, { type: 'bearer' })).status).toBe(200);
  });

  it('超过 1 GB 返回明确的 413 错误', async () => {
    const res = await start(MATERIAL_MAX_BYTES + 1);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'file_too_large', message: expect.stringContaining('1 GB') });
  });

  it.each([0, -1, 1.5, '123', null])('拒绝无效的文件大小 %s', async (size) => {
    const res = await request(app).post(`${base}/uploads`).auth(token, { type: 'bearer' }).send({ size, filename: 'x.bin' });
    expect(res.status).toBe(400);
  });

  it('未登录或无物料管理权限不能开启上传', async () => {
    expect((await request(app).post(`${base}/uploads`).send({ filename: 'x.bin', size: 1 })).status).toBe(401);
    const code = await createInviteCode(token);
    const staff = await registerUser(code, 'upload-staff@example.com');
    const pid = base.split('/')[3];
    const invite = await request(app).post(`/api/projects/${pid}/invites`).auth(token, { type: 'bearer' }).send({ roleName: '一般staff' });
    await request(app).post(`/api/invites/${invite.body.token}/accept`).auth(staff.token, { type: 'bearer' });
    const res = await request(app).post(`${base}/uploads`).auth(staff.token, { type: 'bearer' }).send({ filename: 'x.bin', size: 1 });
    expect(res.status).toBe(403);
  });

  it('跨用户和跨项目不能读写或消费他人的会话', async () => {
    const { body: { uploadId } } = await start(1);
    const code = await createInviteCode(token);
    const artist = await registerUser(code, 'upload-artist@example.com');
    const pid = base.split('/')[3];
    await grantArtistUpload(pid);
    const invite = await request(app).post(`/api/projects/${pid}/invites`).auth(token, { type: 'bearer' }).send({ roleName: '美工' });
    await request(app).post(`/api/invites/${invite.body.token}/accept`).auth(artist.token, { type: 'bearer' });
    expect((await chunk(uploadId, 0, Buffer.from('a'), artist.token)).status).toBe(404);
    expect((await request(app).delete(`${base}/uploads/${uploadId}`).auth(artist.token, { type: 'bearer' })).status).toBe(404);
    expect((await request(app).post(base).auth(artist.token, { type: 'bearer' }).send({ name: '越权', typeId, uploadId })).status).toBe(404);
    const other = await request(app).post('/api/projects').auth(token, { type: 'bearer' }).send({ name: '其他项目' });
    expect((await chunk(uploadId, 0, Buffer.from('a'), token, `/api/projects/${other.body.project.id}/materials`)).status).toBe(404);
    expect((await chunk(uploadId, 0, Buffer.from('a'))).status).toBe(200);
  });

  it('验证分片偏移、大小、完整性，成功后资源和下载内容一致且会话只能消费一次', async () => {
    const first = Buffer.alloc(MATERIAL_CHUNK_BYTES, 97);
    const last = Buffer.from('尾片');
    const { body: { uploadId } } = await start(first.length + last.length);
    expect((await chunk(uploadId, 1, first)).status).toBe(409);
    expect((await chunk(uploadId, 0, Buffer.from('short'))).status).toBe(400);
    expect((await chunk(uploadId, 0, first)).body.received).toBe(first.length);
    const finish = () => request(app).post(base).auth(token, { type: 'bearer' }).send({ typeId, name: '大文件', note: '初版', uploadId });
    expect((await finish()).body.error.code).toBe('upload_incomplete');
    expect((await chunk(uploadId, 0, first)).status).toBe(409);
    expect((await chunk(uploadId, first.length, last)).body.received).toBe(first.length + last.length);
    const created = await finish();
    expect(created.status).toBe(201);
    expect(created.body.resource.latestVersion).toBe(1);
    const versions = await request(app).get(`${base}/${created.body.resource.id}/versions`).auth(token, { type: 'bearer' });
    expect(versions.body.versions[0]).toMatchObject({ note: '初版', file: { filename: '设计稿.bin', size: first.length + last.length } });
    const download = await request(app).get(`${base}/${created.body.resource.id}/versions/1/download`).auth(token, { type: 'bearer' });
    expect(download.body).toEqual(Buffer.concat([first, last]));
    expect((await finish()).status).toBe(404);
  });

  it('分片也可以保存为新版本，并保留中文文件名、MIME 与备注', async () => {
    const resource = await request(app).post(base).auth(token, { type: 'bearer' }).send({ typeId, name: '资料' });
    const bytes = Buffer.from('# 说明\n正文');
    const { body: { uploadId } } = await start(bytes.length, '说明.md', 'text/markdown');
    await chunk(uploadId, 0, bytes);
    const res = await request(app).post(`${base}/${resource.body.resource.id}/versions`).auth(token, { type: 'bearer' }).send({ uploadId, note: '版本备注' });
    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({ version: 1, note: '版本备注', hasPreview: true, file: { filename: '说明.md', mime: 'text/markdown', size: bytes.length } });
  });

  it('分片超过 8 MB 返回 413，原会话仍可继续', async () => {
    const { body: { uploadId } } = await start(MATERIAL_CHUNK_BYTES + 1);
    const res = await chunk(uploadId, 0, Buffer.alloc(MATERIAL_CHUNK_BYTES + 1));
    expect(res.status).toBe(413);
    expect(res.body.error.message).toContain('8 MB');
    expect((await chunk(uploadId, 0, Buffer.alloc(MATERIAL_CHUNK_BYTES))).status).toBe(200);
  });

  it('取消会话后不能继续追加或消费', async () => {
    const { body: { uploadId } } = await start(1);
    expect((await request(app).delete(`${base}/uploads/${uploadId}`).auth(token, { type: 'bearer' })).status).toBe(200);
    expect((await chunk(uploadId, 0, Buffer.from('a'))).status).toBe(404);
    expect((await request(app).post(base).auth(token, { type: 'bearer' }).send({ typeId, name: '已取消', uploadId })).status).toBe(404);
  });

  it('并发初始化最多保留三个会话，取消后释放名额', async () => {
    const responses = await Promise.all([start(1), start(1), start(1), start(1)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 201, 201, 429]);
    await request(app).delete(`${base}/uploads/${sessions[0]}`).auth(token, { type: 'bearer' });
    expect((await start(1)).status).toBe(201);
  });

  it('新版本也必须通过实时资源可见范围校验', async () => {
    const code = await createInviteCode(token);
    const artist = await registerUser(code, 'hidden-artist@example.com');
    const pid = base.split('/')[3];
    await grantArtistUpload(pid);
    const invite = await request(app).post(`/api/projects/${pid}/invites`).auth(token, { type: 'bearer' }).send({ roleName: '美工' });
    await request(app).post(`/api/invites/${invite.body.token}/accept`).auth(artist.token, { type: 'bearer' });
    const created = await request(app).post(base).auth(token, { type: 'bearer' }).send({ typeId, name: '受限资源', visibility: { roleNames: ['主催'], userIds: [] } });
    const res = await request(app).post(`${base}/${created.body.resource.id}/versions`).auth(artist.token, { type: 'bearer' }).attach('file', Buffer.from('x'), 'x.txt');
    expect(res.status).toBe(403);
  });
});
