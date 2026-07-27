import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { WorkModule } from '../src/models/WorkModule';
import { memberNameMap, moduleJson } from '../src/services/workModules';
import { createSuperAdmin, registerUser } from './helpers';

// 直接建数据的轻量装配：一个项目 + 两个成员（不走路由）
async function seedProjectWithMembers() {
  const u1 = await User.create({ email: 'a@x.com', name: '甲', passwordHash: 'x' });
  const u2 = await User.create({ email: 'b@x.com', name: '乙', passwordHash: 'x' });
  const project = await Project.create({ name: 'CP31', createdBy: u1._id, roles: [{ name: '主办', permissions: ['project:manage'] }] });
  await Membership.create({ projectId: project._id, userId: u1._id, roleName: '主办' });
  await Membership.create({ projectId: project._id, userId: u2._id, roleName: '一般staff' });
  return { u1, u2, project };
}

describe('WorkModule 模型', () => {
  it('requiredCount 默认 1，assignees 默认空数组', async () => {
    const { u1, project } = await seedProjectWithMembers();
    const m = await WorkModule.create({ projectId: project._id, name: '检票', createdBy: u1._id });
    expect(m.requiredCount).toBe(1);
    expect(m.assignees).toHaveLength(0);
  });

  it('requiredCount < 1 被拒绝', async () => {
    const { u1, project } = await seedProjectWithMembers();
    await expect(
      WorkModule.create({ projectId: project._id, name: '检票', requiredCount: 0, createdBy: u1._id }),
    ).rejects.toThrow();
  });
});

describe('workModules 服务层', () => {
  it('memberNameMap 返回项目成员 userId→姓名', async () => {
    const { u1, u2, project } = await seedProjectWithMembers();
    const names = await memberNameMap(project._id);
    expect(names.get(String(u1._id))).toBe('甲');
    expect(names.get(String(u2._id))).toBe('乙');
  });

  it('moduleJson 输出统一形状（含确认字段与姓名）', async () => {
    const { u1, u2, project } = await seedProjectWithMembers();
    const names = await memberNameMap(project._id);
    const m = await WorkModule.create({
      projectId: project._id,
      name: '舞台协助',
      location: 'A 馆',
      requiredCount: 3,
      createdBy: u1._id,
      assignees: [{ userId: u2._id, confirmedAt: new Date('2026-08-01T10:00:00Z'), confirmedBy: u1._id }],
    });
    const j = moduleJson(m, names);
    expect(j).toMatchObject({
      name: '舞台协助',
      location: 'A 馆',
      requiredCount: 3,
      assignees: [{ userId: String(u2._id), name: '乙', confirmedBy: String(u1._id) }],
    });
    expect(j.assignees[0].confirmedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(j.startAt).toBeNull();
  });
});

describe('work-modules 路由', () => {
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

  async function addModule(body: Record<string, unknown>) {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.module as {
      id: string;
      requiredCount: number;
      assignees: { userId: string; name: string; confirmedAt: string | null; confirmedBy: string | null }[];
    };
  }

  it('创建模块（主办）→ 201 且形状正确', async () => {
    const m = await addModule({ name: '检票', requiredCount: 2, location: 'A 馆', assigneeIds: [staff.user.id] });
    expect(m.requiredCount).toBe(2);
    expect(m.assignees).toHaveLength(1);
    expect(m.assignees[0]).toMatchObject({ userId: staff.user.id, name: 'Staff', confirmedAt: null });
  });

  it('校验：name 空 / requiredCount<1 / startAt>endAt / 非成员 assigneeIds → 均 400', async () => {
    const bad: Record<string, unknown>[] = [
      { name: '  ' },
      { name: 'X', requiredCount: 0 },
      { name: 'X', startAt: '2026-08-02T00:00:00.000Z', endAt: '2026-08-01T00:00:00.000Z' },
      { name: 'X', assigneeIds: [staff.user.id.replace(/.$/, (c) => (c === '0' ? '1' : '0'))] },
    ];
    for (const body of bad) {
      const res = await request(app)
        .post(`/api/projects/${projectId}/work-modules`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });

  it('权限：一般staff 创建/修改/删除 → 403；非成员访问列表 → 403', async () => {
    const m = await addModule({ name: '检票' });
    const post = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'X' });
    expect(post.status).toBe(403);
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'Y' });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
    // 非项目成员（第三个用户，不进项目）
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const list = await request(app)
      .get(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(list.status).toBe(403);
  });

  it('成员可读列表 GET → { modules }，含姓名联查', async () => {
    await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await addModule({ name: '舞台协助' });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.modules).toHaveLength(2);
    expect(res.body.modules[0].assignees[0]?.name).toBe('Staff');
  });

  it('PATCH 替换 assignees：留任成员确认记录保留，被移除者清除', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id, staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const res = await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [owner.user.id] });
    expect(res.status).toBe(200);
    expect(res.body.module.assignees).toHaveLength(1);
    expect(res.body.module.assignees[0].userId).toBe(owner.user.id);
    expect(res.body.module.assignees[0].confirmedAt).not.toBeNull();
  });

  it('confirm：本人确认自己的分配 → confirmedAt/confirmedBy=本人', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.module.assignees[0].confirmedAt).not.toBeNull();
    expect(res.body.module.assignees[0].confirmedBy).toBe(staff.user.id);
  });

  it('confirm：重复确认幂等，不刷新时戳', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const r1 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const t1 = r1.body.module.assignees[0].confirmedAt;
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r2.body.module.assignees[0].confirmedAt).toBe(t1);
  });

  it('confirm：staff 带他人 userId → 403；主办带 userId 代确认 → 200 且 confirmedBy=主办', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const forbidden = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ userId: owner.user.id });
    expect(forbidden.status).toBe(403);
    const ok = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: staff.user.id });
    expect(ok.status).toBe(200);
    expect(ok.body.module.assignees[0].confirmedBy).toBe(owner.user.id);
  });

  it('confirm：目标不在 assignees 中 → 400', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('unconfirm：清除确认字段', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/unconfirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.module.assignees[0].confirmedAt).toBeNull();
    expect(res.body.module.assignees[0].confirmedBy).toBeNull();
  });

  it('单条操作防跨项目：用别的项目的 mid PATCH/confirm → 404', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id] });
    const p2 = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '另一个活动' });
    const pid2 = p2.body.project.id;
    const patch = await request(app)
      .patch(`/api/projects/${pid2}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Y' });
    expect(patch.status).toBe(404);
    const confirm = await request(app)
      .post(`/api/projects/${pid2}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(confirm.status).toBe(404);
  });
});

describe('work-sheet 端点', () => {
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

  async function addModule(body: Record<string, unknown>) {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.module as { id: string };
  }

  it('本人任务单：只含分配给自己的模块，含项目名/姓名/generatedAt', async () => {
    await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await addModule({ name: '摊位引导', assigneeIds: [staff.user.id, owner.user.id] });
    await addModule({ name: '主办专属', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('活动');
    expect(res.body.user).toMatchObject({ id: staff.user.id, name: 'Staff' });
    expect(Number.isNaN(Date.parse(res.body.generatedAt))).toBe(false);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((m: { name: string }) => m.name).sort()).toEqual(['摊位引导', '检票']);
  });

  it('未分配的本人任务单 → items 为空数组', async () => {
    await addModule({ name: '主办专属', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('staff 查他人的任务单 → 403；主办查任意成员 → 200', async () => {
    const forbidden = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${owner.user.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(forbidden.status).toBe(403);
    const ok = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${staff.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(staff.user.id);
  });

  it('目标用户非项目成员 → 404', async () => {
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${outsider.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('items 内确认状态与模块一致', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    const mine = res.body.items[0].assignees.find((a: { userId: string }) => a.userId === staff.user.id);
    expect(mine.confirmedAt).not.toBeNull();
    expect(mine.confirmedBy).toBe(staff.user.id);
  });
});
