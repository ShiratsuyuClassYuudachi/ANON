import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { PlatformAccount } from '../src/models/PlatformAccount';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;

const USER_CIPHER = 'ANONv1:c2FsdDEyMw==:aXYxMjM0NTY3OA==:Y2lwaGVyZGF0YQ==';

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

async function addAccount(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/accounts`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.account as { id: string };
}

describe('accounts', () => {
  it('CRUD 与权限：无 accounts:manage 的成员只能查看', async () => {
    const denied = await request(app)
      .post(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ platform: 'QQ', account: '12345', mode: 'contact' });
    expect(denied.status).toBe(403);

    const a = await addAccount(owner.token, { platform: 'QQ', account: '12345', mode: 'contact' });
    const list = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.accounts).toHaveLength(1);
    expect(list.body.accounts[0].account).toBe('12345');

    const patch = await request(app)
      .patch(`/api/projects/${projectId}/accounts/${a.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ note: 'x' });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/accounts/${a.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);

    const okPatch = await request(app)
      .patch(`/api/projects/${projectId}/accounts/${a.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ note: '主号', platform: '小红书' });
    expect(okPatch.status).toBe(200);
    expect(okPatch.body.account.note).toBe('主号');
    const okDel = await request(app)
      .delete(`/api/projects/${projectId}/accounts/${a.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(okDel.status).toBe(200);
  });

  it('三种模式：full/otp/contact，otp 与 contact 不存密码', async () => {
    await addAccount(owner.token, {
      platform: 'B站',
      account: 'uid:1',
      mode: 'full',
      passwordCipher: USER_CIPHER,
    });
    await addAccount(owner.token, { platform: 'QQ', account: '67890', mode: 'otp' });
    await addAccount(owner.token, { platform: '微博', account: '@xx', mode: 'contact' });
    const list = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.body.accounts).toHaveLength(3);
    const byMode = Object.fromEntries(
      list.body.accounts.map((a: { mode: string; hasPassword: boolean }) => [a.mode, a]),
    );
    expect(byMode.full.hasPassword).toBe(true);
    expect(byMode.otp.hasPassword).toBe(false);
    expect(byMode.contact.hasPassword).toBe(false);
    // otp 模式展示添加人信息（便于索取二步验证码）
    expect(byMode.otp.addedBy.name).toBe('Admin');
    // contacts 仅 otp 模式返回，full/contact 不泄露
    expect(byMode.otp.addedBy.contacts).toEqual([]);
    expect(byMode.full.addedBy.contacts).toBeUndefined();
    expect(byMode.contact.addedBy.contacts).toBeUndefined();
    // 平台筛选
    const filtered = await request(app)
      .get(`/api/projects/${projectId}/accounts?platform=QQ`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(filtered.body.accounts).toHaveLength(1);
    // 非 full 模式 reveal 报错
    const reveal = await request(app)
      .post(`/api/projects/${projectId}/accounts/${byMode.otp.id}/reveal`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(reveal.status).toBe(400);
  });

  it('server 模式：服务端加密存储，reveal 返回原始明文', async () => {
    const plain = 'p@ssw0rd-密码';
    const a = await addAccount(owner.token, {
      platform: 'QQ',
      account: '111',
      mode: 'full',
      cipherKeySource: 'server',
      password: plain,
    });
    const doc = await PlatformAccount.findById(a.id);
    expect(doc!.passwordCipher).toBeTruthy();
    expect(doc!.passwordCipher).not.toContain(plain);
    expect(doc!.cipherKeySource).toBe('server');
    const reveal = await request(app)
      .post(`/api/projects/${projectId}/accounts/${a.id}/reveal`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(reveal.status).toBe(200);
    expect(reveal.body.password).toBe(plain);
  });

  it('user 模式：只存 ANONv1 密文，reveal 只回密文', async () => {
    const a = await addAccount(owner.token, {
      platform: 'QQ',
      account: '222',
      mode: 'full',
      passwordCipher: USER_CIPHER,
    });
    const doc = await PlatformAccount.findById(a.id).lean();
    expect(doc!.passwordCipher!.startsWith('ANONv1:')).toBe(true);
    expect(doc!.cipherKeySource).toBe('user');
    const list = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(list.body.accounts[0].passwordCipher).toBeUndefined();
    expect(list.body.accounts[0].cipher).toBeUndefined();
    const reveal = await request(app)
      .post(`/api/projects/${projectId}/accounts/${a.id}/reveal`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(reveal.status).toBe(200);
    expect(reveal.body.cipher).toBe(USER_CIPHER);
    expect(reveal.body.password).toBeUndefined();
    // 拒绝非 ANONv1 格式的明文密码
    const bad = await request(app)
      .post(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ platform: 'QQ', account: '333', mode: 'full', passwordCipher: 'plain-password' });
    expect(bad.status).toBe(400);
    // 拒绝结构不完整的 ANONv1 密文（必须恰好 ANONv1:<salt>:<iv>:<data> 且各段非空）
    for (const cipher of ['ANONv1:c2FsdA==', 'ANONv1:c2FsdA==:aXY=', 'ANONv1:c2FsdA==::ZGF0YQ==', 'ANONv1:c2FsdA==:aXY=:ZGF0YQ==:ZXh0cmE=']) {
      const res = await request(app)
        .post(`/api/projects/${projectId}/accounts`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ platform: 'QQ', account: '444', mode: 'full', passwordCipher: cipher });
      expect(res.status).toBe(400);
    }
  });

  it('PATCH 拒绝空的 platform/account，非法 visibility.userIds 返回 400', async () => {
    const a = await addAccount(owner.token, { platform: 'QQ', account: '12345', mode: 'contact' });
    for (const body of [{ platform: '' }, { platform: '   ' }, { account: '' }]) {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/accounts/${a.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body);
      expect(res.status).toBe(400);
    }
    // 非 ObjectId 的 userIds 应是 400 而非 CastError 500
    const badVis = await request(app)
      .patch(`/api/projects/${projectId}/accounts/${a.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ visibility: { userIds: ['not-an-objectid'], roleNames: [] } });
    expect(badVis.status).toBe(400);
    expect(badVis.body.error.code).toBe('bad_request');
  });

  it('可见范围：非空 visibility 仅列出用户/角色可见，优先于权限点', async () => {
    const hidden = await addAccount(owner.token, {
      platform: 'QQ',
      account: 'hidden',
      mode: 'contact',
      visibility: { userIds: [owner.user.id], roleNames: [] },
    });
    await addAccount(owner.token, {
      platform: 'QQ',
      account: 'by-role',
      mode: 'contact',
      visibility: { userIds: [], roleNames: ['一般staff'] },
    });
    await addAccount(owner.token, { platform: 'QQ', account: 'open', mode: 'contact' });

    const staffList = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`);
    const names = staffList.body.accounts.map((a: { account: string }) => a.account).sort();
    expect(names).toEqual(['by-role', 'open']);

    const ownerList = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerList.body.accounts).toHaveLength(3);

    // 不可见者 reveal 也被拒
    const reveal = await request(app)
      .post(`/api/projects/${projectId}/accounts/${hidden.id}/reveal`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(reveal.status).toBe(403);

    // 放开可见范围后 staff 可见
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/accounts/${hidden.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ visibility: { userIds: [], roleNames: [] } });
    expect(patch.status).toBe(200);
    const after = await request(app)
      .get(`/api/projects/${projectId}/accounts`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(after.body.accounts).toHaveLength(3);
  });
});
