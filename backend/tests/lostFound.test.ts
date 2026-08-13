import fs from 'fs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { File } from '../src/models/File';
import { InviteCode } from '../src/models/InviteCode';
import { LostFoundItem } from '../src/models/LostFoundItem';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { grantPermissionToAllRoles } from '../src/services/permissions';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;
let creatorId: string;

const BASE = () => `/api/projects/${projectId}/lostfound`;

/** 1×1 PNG（与 demoSeed 内置同款），使 sharp 预览链路真实跑通 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createItem(
  token: string,
  fields: Record<string, string> = {},
  withPhoto = false,
) {
  let req = request(app).post(BASE()).set('Authorization', `Bearer ${token}`);
  if (withPhoto) req = req.attach('photo', PNG, 'a.png');
  req = req.field('name', fields.name ?? '黑色伞');
  if (fields.note !== undefined) req = req.field('note', fields.note);
  if (fields.foundAt !== undefined) req = req.field('foundAt', fields.foundAt);
  if (fields.foundLocation !== undefined) req = req.field('foundLocation', fields.foundLocation);
  return req;
}

async function enableShare(token: string): Promise<string> {
  await request(app).put(`${BASE()}/share`).set('Authorization', `Bearer ${token}`).send({ enabled: true });
  const res = await request(app).get(`${BASE()}/share`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.share.token as string;
}

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  creatorId = creator.toString();
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
});

describe('lost found', () => {
  it('创建 201 全字段无照片；空名称 400；非法 foundAt 400', async () => {
    const res = await createItem(owner.token, {
      note: '伞骨有卡通贴纸',
      foundAt: '2026-10-17T10:00:00+08:00',
      foundLocation: 'A 馆入口',
    });
    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('黑色伞');
    expect(res.body.item.status).toBe('pending');
    expect(res.body.item.hasPhoto).toBe(false);

    const noName = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', '  ');
    expect(noName.status).toBe(400);

    const badDate = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', 'x')
      .field('foundAt', 'not-a-date');
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.message).toBe('无效的时间');
  });

  it('非图片照片 400「仅支持图片文件」', async () => {
    const res = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('photo', Buffer.from('x'), 'note.txt')
      .field('name', 'x');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('仅支持图片文件');
  });

  it('带 PNG 照片创建：hasPhoto、photo 端点 200 且为图片', async () => {
    const res = await createItem(owner.token, {}, true);
    expect(res.status).toBe(201);
    expect(res.body.item.hasPhoto).toBe(true);
    const photo = await request(app)
      .get(`${BASE()}/${res.body.item.id}/photo`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toMatch(/^image\/(webp|png)/);
  });

  it('staff（一般staff 预置角色）默认即可登记与管理——权限点默认授予所有角色', async () => {
    const res = await createItem(staff.token, {});
    expect(res.status).toBe(201);
    const claim = await request(app)
      .patch(`${BASE()}/${res.body.item.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'claimed', claimNote: '失主 QQ 12345' });
    expect(claim.status).toBe(200);
    const share = await request(app)
      .get(`${BASE()}/share`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(share.status).toBe(200);
  });

  it('去掉 lostfound:manage 的角色写操作 403，读仍 200', async () => {
    const item = (await createItem(owner.token, {})).body.item as { id: string };
    const project = await Project.findById(projectId);
    const role = project!.roles.find((r) => r.name === '一般staff')!;
    role.permissions = role.permissions.filter((p) => p !== 'lostfound:manage');
    await project!.save();

    const post = await createItem(staff.token, {});
    expect(post.status).toBe(403);
    const patch = await request(app)
      .patch(`${BASE()}/${item.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .field('name', 'y');
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`${BASE()}/${item.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
    const st = await request(app)
      .patch(`${BASE()}/${item.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ status: 'claimed' });
    expect(st.status).toBe(403);
    const share = await request(app)
      .put(`${BASE()}/share`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ enabled: true });
    expect(share.status).toBe(403);

    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('非项目成员不能访问', async () => {
    await InviteCode.create({ code: 'C2', createdBy: creatorId });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const res = await request(app).get(BASE()).set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('q 命中名称/描述/地点；status 过滤；foundAt 倒序', async () => {
    await createItem(owner.token, { name: '雨伞', note: '无', foundAt: '2026-10-17T10:00:00+08:00', foundLocation: '入口' });
    await createItem(owner.token, { name: '学生证', note: '蓝色卡套', foundAt: '2026-10-17T12:00:00+08:00', foundLocation: '摊位区' });
    const claimed = await createItem(owner.token, { name: '充电宝', foundAt: '2026-10-17T14:00:00+08:00', foundLocation: '休息区' });
    await request(app)
      .patch(`${BASE()}/${claimed.body.item.id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'claimed' });

    const byName = await request(app).get(`${BASE()}?q=学生证`).set('Authorization', `Bearer ${owner.token}`);
    expect(byName.body.items.map((i: { name: string }) => i.name)).toEqual(['学生证']);
    const byNote = await request(app).get(`${BASE()}?q=卡套`).set('Authorization', `Bearer ${owner.token}`);
    expect(byNote.body.items).toHaveLength(1);
    const byLoc = await request(app).get(`${BASE()}?q=摊位`).set('Authorization', `Bearer ${owner.token}`);
    expect(byLoc.body.items).toHaveLength(1);
    const pendingOnly = await request(app).get(`${BASE()}?status=pending`).set('Authorization', `Bearer ${owner.token}`);
    expect(pendingOnly.body.items.map((i: { name: string }) => i.name)).toEqual(['学生证', '雨伞']);
    const all = await request(app).get(BASE()).set('Authorization', `Bearer ${owner.token}`);
    expect(all.body.items.map((i: { name: string }) => i.name)).toEqual(['充电宝', '学生证', '雨伞']);
  });

  it('PATCH 改字段；removePhoto=1 移除照片并删 File', async () => {
    const res = await createItem(owner.token, {}, true);
    const id = res.body.item.id as string;
    const fileBefore = await File.findOne({ projectId });
    expect(fileBefore).not.toBeNull();

    const patch = await request(app)
      .patch(`${BASE()}/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', '折叠伞')
      .field('note', '新描述')
      .field('foundLocation', 'B 馆');
    expect(patch.status).toBe(200);
    expect(patch.body.item.name).toBe('折叠伞');
    expect(patch.body.item.note).toBe('新描述');
    expect(patch.body.item.foundLocation).toBe('B 馆');

    const rm = await request(app)
      .patch(`${BASE()}/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('removePhoto', '1');
    expect(rm.status).toBe(200);
    expect(rm.body.item.hasPhoto).toBe(false);
    expect(await File.findOne({ projectId })).toBeNull();
  });

  it('PATCH 换新照片：旧 File 删除、新 File 存在', async () => {
    const res = await createItem(owner.token, {}, true);
    const id = res.body.item.id as string;
    const before = (await File.findOne({ projectId }))!;
    const patch = await request(app)
      .patch(`${BASE()}/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('photo', PNG, 'b.png');
    expect(patch.status).toBe(200);
    expect(patch.body.item.hasPhoto).toBe(true);
    const after = await File.findOne({ projectId });
    expect(after).not.toBeNull();
    expect(after!._id.toString()).not.toBe(before._id.toString());
    expect(fs.existsSync(before.path)).toBe(false);
  });

  it('DELETE 级联：File 文档与存储对象清空', async () => {
    const res = await createItem(owner.token, {}, true);
    const id = res.body.item.id as string;
    const file = (await File.findOne({ projectId }))!;
    const itemDoc = (await LostFoundItem.findById(id))!;
    const previewRef = itemDoc.photoPreviewPath;

    const del = await request(app).delete(`${BASE()}/${id}`).set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
    expect(await LostFoundItem.findById(id)).toBeNull();
    expect(await File.findOne({ projectId })).toBeNull();
    expect(fs.existsSync(file.path)).toBe(false);
    if (previewRef) expect(fs.existsSync(previewRef)).toBe(false);
  });

  it('status 流转：claimed 记录时间与备注；pending 清空；非法值 400', async () => {
    const res = await createItem(owner.token, {});
    const id = res.body.item.id as string;
    const claim = await request(app)
      .patch(`${BASE()}/${id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'claimed', claimNote: '  失主 QQ 12345  ' });
    expect(claim.status).toBe(200);
    expect(claim.body.item.status).toBe('claimed');
    expect(claim.body.item.claimedAt).not.toBeNull();
    expect(claim.body.item.claimNote).toBe('失主 QQ 12345');

    const unclaim = await request(app)
      .patch(`${BASE()}/${id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'pending' });
    expect(unclaim.status).toBe(200);
    expect(unclaim.body.item.claimedAt).toBeNull();
    expect(unclaim.body.item.claimNote).toBe('');

    const bad = await request(app)
      .patch(`${BASE()}/${id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'archived' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('无效的状态');
  });

  it('share：惰性创建 token 稳定；开启；regenerate 换 token', async () => {
    const g1 = await request(app).get(`${BASE()}/share`).set('Authorization', `Bearer ${owner.token}`);
    expect(g1.status).toBe(200);
    expect(g1.body.share.enabled).toBe(false);
    expect(g1.body.share.token).toBeTruthy();
    const g2 = await request(app).get(`${BASE()}/share`).set('Authorization', `Bearer ${owner.token}`);
    expect(g2.body.share.token).toBe(g1.body.share.token);

    const regen = await request(app)
      .put(`${BASE()}/share`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ regenerate: true });
    expect(regen.status).toBe(200);
    expect(regen.body.share.token).not.toBe(g1.body.share.token);
  });

  it('公开端点：错 token 404；未开启 404；开启后 200 含 projectName 与物品', async () => {
    await createItem(owner.token, { name: '钱包' });
    const bad = await request(app).get('/api/public/lostfound/no-such-token');
    expect(bad.status).toBe(404);

    const shareRes = await request(app).get(`${BASE()}/share`).set('Authorization', `Bearer ${owner.token}`);
    const token = shareRes.body.share.token as string;
    const disabled = await request(app).get(`/api/public/lostfound/${token}`);
    expect(disabled.status).toBe(404);

    await request(app).put(`${BASE()}/share`).set('Authorization', `Bearer ${owner.token}`).send({ enabled: true });
    const pub = await request(app).get(`/api/public/lostfound/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.projectName).toBe('活动');
    expect(pub.body.items).toHaveLength(1);
  });

  it('公开响应为字段白名单：不含 claimNote/createdBy', async () => {
    const res = await createItem(owner.token, { name: '钥匙串' });
    await request(app)
      .patch(`${BASE()}/${res.body.item.id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'claimed', claimNote: '内部联系方式' });
    const token = await enableShare(owner.token);
    const pub = await request(app).get(`/api/public/lostfound/${token}`);
    expect(pub.status).toBe(200);
    const item = pub.body.items[0];
    expect(item.status).toBe('claimed');
    expect(item.claimedAt).not.toBeNull();
    expect(item).not.toHaveProperty('claimNote');
    expect(item).not.toHaveProperty('createdBy');
    expect(item).not.toHaveProperty('createdAt');
  });

  it('公开端点 q/status 过滤生效', async () => {
    await createItem(owner.token, { name: '雨伞', foundLocation: '入口' });
    const claimed = await createItem(owner.token, { name: '水杯', foundLocation: '舞台边' });
    await request(app)
      .patch(`${BASE()}/${claimed.body.item.id}/status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'claimed' });
    const token = await enableShare(owner.token);
    const byQ = await request(app).get(`/api/public/lostfound/${token}?q=舞台`);
    expect(byQ.body.items.map((i: { name: string }) => i.name)).toEqual(['水杯']);
    const byStatus = await request(app).get(`/api/public/lostfound/${token}?status=pending`);
    expect(byStatus.body.items.map((i: { name: string }) => i.name)).toEqual(['雨伞']);
  });

  it('公开照片 200；跨项目 itemId 404；regenerate 后旧 token 404', async () => {
    const res = await createItem(owner.token, {}, true);
    const itemId = res.body.item.id as string;
    const token = await enableShare(owner.token);
    const photo = await request(app).get(`/api/public/lostfound/${token}/items/${itemId}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toMatch(/^image\//);

    // 另一项目的物品 id 对本项目分享不可见
    const p2 = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '别的活动' });
    const other = await request(app)
      .post(`/api/projects/${p2.body.project.id}/lostfound`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', '别的物品')
      .attach('photo', PNG, 'c.png');
    expect(other.status).toBe(201);
    const cross = await request(app).get(`/api/public/lostfound/${token}/items/${other.body.item.id}/photo`);
    expect(cross.status).toBe(404);

    await request(app).put(`${BASE()}/share`).set('Authorization', `Bearer ${owner.token}`).send({ regenerate: true });
    const stale = await request(app).get(`/api/public/lostfound/${token}`);
    expect(stale.status).toBe(404);
  });

  it('迁移：既有角色缺失权限时启动补授函数幂等补回', async () => {
    const project = await Project.findById(projectId);
    for (const r of project!.roles) {
      r.permissions = r.permissions.filter((p) => p !== 'lostfound:manage');
    }
    await project!.save();
    await grantPermissionToAllRoles('lostfound:manage');
    const reloaded = await Project.findById(projectId);
    for (const r of reloaded!.roles) {
      expect(r.permissions).toContain('lostfound:manage');
    }
    // 幂等：重复执行不重复添加
    await grantPermissionToAllRoles('lostfound:manage');
    const again = await Project.findById(projectId);
    for (const r of again!.roles) {
      expect(r.permissions.filter((p) => p === 'lostfound:manage')).toHaveLength(1);
    }
  });
});
