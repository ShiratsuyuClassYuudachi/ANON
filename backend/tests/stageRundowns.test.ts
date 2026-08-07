import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { File } from '../src/models/File';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;
let creatorId: string;

const BASE = () => `/api/projects/${projectId}/stage-rundowns`;

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createRundown(name = 'Day1 主舞台', startAt = '2026-10-17T10:00:00+08:00') {
  const res = await request(app)
    .post(BASE())
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name, startAt });
  expect(res.status).toBe(201);
  return res.body.rundown as { id: string };
}

async function addItem(rid: string, fields: Record<string, string>, withFile = false) {
  let req = request(app)
    .post(`${BASE()}/${rid}/items`)
    .set('Authorization', `Bearer ${owner.token}`);
  if (withFile) req = req.attach('files', Buffer.from('x'), 'bgm.txt');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
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

describe('stage rundowns', () => {
  it('owner 创建 rundown；空名称与非法时间 400', async () => {
    const res = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Day1 主舞台', startAt: '2026-10-17T10:00:00+08:00' });
    expect(res.status).toBe(201);
    expect(res.body.rundown.name).toBe('Day1 主舞台');
    expect(res.body.rundown.items).toEqual([]);

    const noName = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '  ', startAt: '2026-10-17T10:00:00+08:00' });
    expect(noName.status).toBe(400);

    const badDate = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'x', startAt: 'not-a-date' });
    expect(badDate.status).toBe(400);
  });

  it('staff 无 tools:manage 不能创建；成员可读列表', async () => {
    const forbidden = await request(app)
      .post(BASE())
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'x', startAt: '2026-10-17T10:00:00+08:00' });
    expect(forbidden.status).toBe(403);

    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${staff.token}`);
    expect(list.status).toBe(200);
    expect(list.body.rundowns).toEqual([]);
  });

  it('非项目成员不能访问', async () => {
    await InviteCode.create({ code: 'C2', createdBy: creatorId });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const res = await request(app).get(BASE()).set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('添加节目：participants 归一化、附件解析', async () => {
    const rundown = await createRundown();
    const res = await addItem(rundown.id, {
      name: '开场舞',
      durationMin: '12',
      participants: JSON.stringify([
        { cn: '阿喵', contact: 'QQ 11001001' },
        { cn: '  ', contact: 'x' },
        { cn: '露露' },
      ]),
    }, true);
    expect(res.status).toBe(201);
    expect(res.body.item.participants).toEqual([
      { cn: '阿喵', contact: 'QQ 11001001' },
      { cn: '露露', contact: '' },
    ]);
    expect(res.body.item.attachments.length).toBe(1);

    const detail = await request(app)
      .get(`${BASE()}/${rundown.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rundown.items[0].attachments[0].filename).toBe('bgm.txt');
    expect(detail.body.rundown.items[0].attachments[0].mime).toBeDefined();
  });

  it('durationMin 边界：1–1440 整数', async () => {
    const rundown = await createRundown();
    for (const v of ['0', '-5', '1.5', '1441']) {
      const res = await addItem(rundown.id, { name: 'x', durationMin: v });
      expect(res.status).toBe(400);
    }
    const ok = await addItem(rundown.id, { name: 'x', durationMin: '1440' });
    expect(ok.status).toBe(201);
  });

  it('participants 非法 JSON 400', async () => {
    const rundown = await createRundown();
    const res = await addItem(rundown.id, { name: 'x', durationMin: '10', participants: '{bad' });
    expect(res.status).toBe(400);
  });

  it('编辑节目：改时长、removeAttachmentIds 移除附件', async () => {
    const rundown = await createRundown();
    const created = await addItem(rundown.id, { name: '开场舞', durationMin: '12' }, true);
    const item = created.body.item;
    const res = await request(app)
      .patch(`${BASE()}/${rundown.id}/items/${item.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('durationMin', '20')
      .field('removeAttachmentIds', JSON.stringify([item.attachments[0].id]));
    expect(res.status).toBe(200);
    expect(res.body.item.durationMin).toBe(20);
    expect(res.body.item.attachments).toEqual([]);
  });

  it('reorder：顺序生效；id 不一一对应 400', async () => {
    const rundown = await createRundown();
    const a = (await addItem(rundown.id, { name: 'A', durationMin: '10' })).body.item;
    const b = (await addItem(rundown.id, { name: 'B', durationMin: '10' })).body.item;

    const ok = await request(app)
      .patch(`${BASE()}/${rundown.id}/items/reorder`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ order: [b.id, a.id] });
    expect(ok.status).toBe(200);
    expect(ok.body.rundown.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);

    const missing = await request(app)
      .patch(`${BASE()}/${rundown.id}/items/reorder`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ order: [a.id] });
    expect(missing.status).toBe(400);

    const extra = await request(app)
      .patch(`${BASE()}/${rundown.id}/items/reorder`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ order: [a.id, b.id, 'ffffffffffffffffffffffff'] });
    expect(extra.status).toBe(400);
  });

  it('删除级联：节目附件与 rundown 附件清理', async () => {
    const rundown = await createRundown();
    const first = (await addItem(rundown.id, { name: 'A', durationMin: '10' }, true)).body.item;
    const second = (await addItem(rundown.id, { name: 'B', durationMin: '10' }, true)).body.item;
    const firstFileId = first.attachments[0].id;
    const secondFileId = second.attachments[0].id;

    const delItem = await request(app)
      .delete(`${BASE()}/${rundown.id}/items/${first.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delItem.status).toBe(200);
    expect(await File.findById(firstFileId)).toBeNull();

    const delRundown = await request(app)
      .delete(`${BASE()}/${rundown.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delRundown.status).toBe(200);
    expect(await File.findById(secondFileId)).toBeNull();
  });
});
