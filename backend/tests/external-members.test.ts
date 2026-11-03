import request from 'supertest';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { ApiKey } from '../src/models/ApiKey';
import { ExternalMember } from '../src/models/ExternalMember';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { Todo } from '../src/models/Todo';
import { User } from '../src/models/User';
import { WorkModule } from '../src/models/WorkModule';
import { deleteDemoData } from '../src/services/demoSeed';
import { computeRisks } from '../src/services/risk';
import { notificationChannels } from '../src/services/notifications';
import { config } from '../src/config';
import { createSuperAdmin, createInviteCode, registerUser } from './helpers';

let owner: Awaited<ReturnType<typeof createSuperAdmin>>;
let staff: Awaited<ReturnType<typeof registerUser>>;
let pid: string;
const auth = () => ({ Authorization: `Bearer ${owner.token}` });
const staffAuth = () => ({ Authorization: `Bearer ${staff.token}` });
const base = () => `/api/projects/${pid}`;
const create = async (body: Record<string, unknown> = { name: '小夏' }) => {
  const r = await request(app).post(`${base()}/external-members`).set(auth()).send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.externalMember;
};
const todo = async (externalId: string, assigneeIds: string[] = []) => {
  const r = await request(app).post(`${base()}/todos`).set(auth()).send({ title: '筹备任务', assigneeIds, externalAssigneeIds: [externalId] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.todo;
};
const work = async (externalId: string, assigneeIds: string[] = []) => {
  const r = await request(app).post(`${base()}/work-modules`).set(auth()).send({ name: '检票', requiredCount: 2, assigneeIds, externalAssigneeIds: [externalId] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.module;
};
const link = (id: string, userId = staff.user.id) => request(app).post(`${base()}/external-members/${id}/link`).set(auth()).send({ userId });

beforeEach(async () => {
  owner = await createSuperAdmin();
  await createInviteCode(owner.token);
  staff = await registerUser('CODE-1', 'staff@example.com', '小夏账号');
  const r = await request(app).post('/api/projects').set(auth()).send({ name: '成员测试活动' });
  pid = r.body.project.id;
  await Membership.create({ projectId: pid, userId: staff.user.id, roleName: '一般staff' });
});

describe('未注册成员档案', () => {
  it('只填姓名即可建档，支持岗位和多条联系方式，不创建假账号', async () => {
    const count = await User.countDocuments();
    const m = await create({ name: ' 小夏 ', duty: '检票、舞台协助', contacts: [{ platform: 'QQ', value: '123456' }, { platform: 'phone', value: '13800138000' }] });
    expect(m).toMatchObject({ name: '小夏', duty: '检票、舞台协助', archivedAt: null, linkedUserId: null });
    expect(await User.countDocuments()).toBe(count);
    expect((await create()).contacts).toEqual([]);
    const list = await request(app).get(`${base()}/external-members`).set(staffAuth());
    expect(list.body.externalMembers[0].contacts).toHaveLength(2);
    const detail = await request(app).get(base()).set(auth());
    expect(detail.body.externalMembers).toHaveLength(2);
    expect(detail.body.members).toHaveLength(2);
  });

  it('拒绝空姓名、不完整联系方式及错误类型，编辑支持清空可选字段', async () => {
    for (const body of [{ name: ' ' }, { name: [] }, { name: '甲', contacts: [{}] }, { name: '甲', duty: [] }, { name: '甲', contacts: 'QQ' }]) {
      expect((await request(app).post(`${base()}/external-members`).set(auth()).send(body)).status).toBe(400);
    }
    const m = await create({ name: '甲', duty: '检票', contacts: [{ platform: 'QQ', value: '123' }] });
    const r = await request(app).patch(`${base()}/external-members/${m.id}`).set(auth()).send({ name: '乙', duty: '', contacts: [] });
    expect(r.body.externalMember).toMatchObject({ name: '乙', duty: '', contacts: [] });
    expect((await request(app).patch(`${base()}/external-members/${m.id}`).set(auth()).send({ archived: 'true' })).status).toBe(400);
    expect((await request(app).get(`${base()}/external-members?includeArchived=bad`).set(auth())).status).toBe(400);
  });

  it('普通成员可查看但不能管理档案、关联或代操作', async () => {
    const m = await create();
    const w = await work(m.id);
    for (const r of [
      await request(app).post(`${base()}/external-members`).set(staffAuth()).send({ name: '乙' }),
      await request(app).patch(`${base()}/external-members/${m.id}`).set(staffAuth()).send({ duty: '乙' }),
      await request(app).post(`${base()}/external-members/${m.id}/link`).set(staffAuth()).send({ userId: staff.user.id }),
      await request(app).post(`${base()}/work-modules/${w.id}/confirm`).set(staffAuth()).send({ externalMemberId: m.id }),
      await request(app).get(`${base()}/work-sheet/external/${m.id}`).set(staffAuth()),
    ]) expect(r.status).toBe(403);
  });

  it('跨项目、非法ID及混淆账号和档案ID均被拒绝', async () => {
    const m = await create();
    const other = await Project.create({ name: '另一个项目', createdBy: owner.user.id });
    const external = await ExternalMember.create({ projectId: other._id, name: '外项目', createdBy: owner.user.id });
    for (const endpoint of ['todos', 'work-modules']) {
      for (const id of [String(external._id), '非法', staff.user.id]) {
        const r = await request(app).post(`${base()}/${endpoint}`).set(auth()).send({ title: '任务', name: '任务', externalAssigneeIds: [id] });
        expect(r.status).toBe(400);
      }
    }
    expect((await request(app).patch(`${base()}/external-members/${external._id}`).set(auth()).send({ name: '禁止' })).status).toBe(404);
    expect((await request(app).post(`${base()}/todos`).set(auth()).send({ title: '任务', assigneeIds: [m.id] })).status).toBe(400);
    expect((await link(m.id, '000000000000000000000000')).status).toBe(400);
    expect((await request(app).get(`${base()}/todos?externalAssignee=${external._id}`).set(auth())).status).toBe(400);
  });

  it('归档保留原指派、状态及历史，可保留旧指派但不能增加新指派；恢复后可重用', async () => {
    const m = await create({ name: '小夏', contacts: [{ platform: 'QQ', value: '123' }] });
    const t = await todo(m.id);
    const w = await work(m.id);
    await request(app).post(`${base()}/work-modules/${w.id}/confirm`).set(auth()).send({ externalMemberId: m.id });
    expect((await request(app).patch(`${base()}/external-members/${m.id}`).set(auth()).send({ archived: true })).status).toBe(200);
    expect((await request(app).get(`${base()}/external-members`).set(auth())).body.externalMembers).toHaveLength(0);
    expect((await request(app).get(`${base()}/external-members?includeArchived=true`).set(auth())).body.externalMembers).toHaveLength(1);
    const kept = await request(app).patch(`${base()}/work-modules/${w.id}`).set(auth()).send({ externalAssigneeIds: [m.id], name: '检票调整' });
    expect(kept.status).toBe(200);
    expect(kept.body.module.externalAssignees[0].confirmedAt).toBeTruthy();
    expect((await request(app).patch(`${base()}/todos/${t.id}`).set(auth()).send({ note: '保留历史' })).body.todo.externalAssignees).toHaveLength(1);
    expect((await request(app).post(`${base()}/todos`).set(auth()).send({ title: '新任务', externalAssigneeIds: [m.id] })).status).toBe(400);
    expect((await request(app).get(`${base()}/onsite`).set(auth())).body.contacts.some((c: any) => c.externalMemberId === m.id)).toBe(false);
    expect((await request(app).get(`${base()}/work-sheet/external/${m.id}`).set(auth())).body.items).toHaveLength(1);
    await request(app).patch(`${base()}/external-members/${m.id}`).set(auth()).send({ archived: false });
    await todo(m.id);
  });
});

describe('混合指派与账号关联', () => {
  it('两类任务混合指派、外部负责人筛选与统计均生效，不误报无负责人', async () => {
    const m = await create();
    const t = await todo(m.id, [staff.user.id]);
    const w = await work(m.id, [staff.user.id]);
    expect(t.assignees).toHaveLength(1);
    expect(t.externalAssignees).toHaveLength(1);
    expect(w.externalAssignees[0].externalMemberId).toBe(m.id);
    const listed = await request(app).get(`${base()}/todos?externalAssignee=${m.id}`).set(auth());
    expect(listed.body.todos.map((x: any) => x.id)).toEqual([t.id]);
    const summary = await request(app).get(`${base()}/dashboard/summary`).set(auth());
    expect(summary.body.metrics.memberCount).toBe(3);
    expect(summary.body.modules.work.totalAssigned).toBe(2);
    await request(app).patch(`${base()}/todos/${t.id}`).set(auth()).send({ assigneeIds: [] });
    await computeRisks((await Project.findById(pid))!);
    const risks = await request(app).get(`${base()}/risks`).set(auth());
    expect(risks.body.risks.some((r: any) => r.ruleCode === 'todo:no_assignee')).toBe(false);
  });

  it('管理员代确认、签到、完成幂等，实际确认人保留，拒绝两种目标混传', async () => {
    const m = await create(); const w = await work(m.id);
    let completed: string | null = null;
    for (const action of ['confirm', 'checkin', 'finish', 'finish']) {
      const r = await request(app).post(`${base()}/work-modules/${w.id}/${action}`).set(auth()).send({ externalMemberId: m.id });
      expect(r.status).toBe(200);
      const a = r.body.module.externalAssignees[0];
      expect(a.confirmedBy).toBe(owner.user.id);
      if (action === 'finish') { if (completed) expect(a.completedAt).toBe(completed); completed = a.completedAt; }
    }
    expect((await request(app).post(`${base()}/work-modules/${w.id}/confirm`).set(auth()).send({ externalMemberId: m.id, userId: staff.user.id })).status).toBe(400);
    const r = await request(app).post(`${base()}/work-modules/${w.id}/unconfirm`).set(auth()).send({ externalMemberId: m.id });
    expect(r.body.module.externalAssignees[0]).toMatchObject({ confirmedAt: null, confirmedBy: null, completedAt: completed });
  });

  it('关联不改写任务，账号即时获得本人待办、现场任务、任务单与完成权限', async () => {
    const m = await create({ name: '原姓名', duty: '舞台协助', contacts: [{ platform: 'QQ', value: '123' }] });
    const t = await todo(m.id); const w = await work(m.id);
    expect((await request(app).post(`${base()}/todos/${t.id}/updates`).set(staffAuth()).field('note', '无权')).status).toBe(403);
    expect((await link(m.id)).status).toBe(200);
    expect((await Todo.findById(t.id))!.externalAssigneeIds.map(String)).toEqual([m.id]);
    expect((await WorkModule.findById(w.id))!.assignees).toHaveLength(0);
    const list = await request(app).get(`${base()}/todos?assignee=${staff.user.id}`).set(staffAuth());
    expect(list.body.todos[0].assignees).toEqual([{ userId: staff.user.id, name: '小夏账号' }]);
    expect(list.body.todos[0].externalAssignees).toEqual([]);
    const actions = await request(app).get(`${base()}/dashboard/my-actions`).set(staffAuth());
    expect(actions.body.items.map((x: any) => x.id).sort()).toEqual([t.id, w.id].sort());
    expect((await request(app).get(`${base()}/work-sheet`).set(staffAuth())).body.items).toHaveLength(1);
    expect((await request(app).get(`${base()}/onsite`).set(staffAuth())).body.myModules).toHaveLength(1);
    expect((await request(app).post(`${base()}/work-modules/${w.id}/confirm`).set(staffAuth()).send({})).status).toBe(200);
    expect((await request(app).post(`${base()}/todos/${t.id}/updates`).set(staffAuth()).field('note', '本人接续')).status).toBe(201);
    expect((await request(app).post(`${base()}/todos/${t.id}/complete`).set(staffAuth()).field('completionNote', '已完成')).status).toBe(200);
    const detail = await request(app).get(base()).set(staffAuth());
    expect(detail.body.members.find((x: any) => x.userId === staff.user.id).externalProfiles[0].duty).toBe('舞台协助');
    expect((await User.findById(staff.user.id))!.contacts).toHaveLength(0);
    expect((await Membership.findOne({ projectId: pid, userId: staff.user.id }))!.roleName).toBe('一般staff');
  });

  it('重复身份合并为一人，保留最早状态和对应确认人，取消确认不会被旧记录恢复', async () => {
    const m = await create(); const w = await work(m.id, [staff.user.id]);
    const early = new Date('2026-01-01'); const late = new Date('2026-02-01');
    const doc = (await WorkModule.findById(w.id))!;
    doc.assignees[0].confirmedAt = late; doc.assignees[0].confirmedBy = doc.createdBy;
    doc.externalAssignees[0].confirmedAt = early; doc.externalAssignees[0].confirmedBy = doc.createdBy;
    doc.externalAssignees[0].checkedInAt = early; doc.externalAssignees[0].completedAt = late;
    await doc.save();
    const t = await todo(m.id, [staff.user.id]);
    await link(m.id);
    const modules = await request(app).get(`${base()}/work-modules`).set(auth());
    expect(modules.body.modules[0].assignees).toHaveLength(1);
    expect(modules.body.modules[0].assignees[0]).toMatchObject({ confirmedAt: early.toISOString(), checkedInAt: early.toISOString(), completedAt: late.toISOString() });
    expect((await request(app).get(`${base()}/todos`).set(auth())).body.todos.find((x: any) => x.id === t.id).assignees).toHaveLength(1);
    await request(app).post(`${base()}/work-modules/${w.id}/unconfirm`).set(staffAuth()).send({});
    const again = await request(app).get(`${base()}/work-modules`).set(auth());
    expect(again.body.modules[0].assignees[0].confirmedAt).toBeNull();
    expect((await request(app).get(`${base()}/dashboard/summary`).set(auth())).body.modules.work.totalAssigned).toBe(1);
  });

  it('关联前打开的旧表单保存时仍保留外部指派的确认和完成状态', async () => {
    const m = await create(); const w = await work(m.id);
    await request(app).post(`${base()}/work-modules/${w.id}/confirm`).set(auth()).send({ externalMemberId: m.id });
    await request(app).post(`${base()}/work-modules/${w.id}/finish`).set(auth()).send({ externalMemberId: m.id });
    await link(m.id);
    const r = await request(app).patch(`${base()}/work-modules/${w.id}`).set(auth()).send({ assigneeIds: [], externalAssigneeIds: [m.id], name: '旧表单保存' });
    expect(r.status).toBe(200);
    expect(r.body.module.assignees[0]).toMatchObject({ userId: staff.user.id, confirmedBy: owner.user.id });
    expect(r.body.module.assignees[0].completedAt).toBeTruthy();
    expect(r.body.module.externalAssignees).toHaveLength(0);
  });

  it('重复关联幂等，冲突关联被拒绝，并发改绑只允许一个目标成功', async () => {
    const m = await create();
    const first = await link(m.id); const again = await link(m.id);
    expect(first.body.externalMember.linkedAt).toBe(again.body.externalMember.linkedAt);
    expect((await link(m.id, owner.user.id)).status).toBe(409);
    const next = await create();
    const results = await Promise.all([link(next.id), link(next.id, owner.user.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('关联账号被移出项目后失去访问权；不能用档案恢复成员资格', async () => {
    const m = await create(); const t = await todo(m.id); await link(m.id);
    await Membership.deleteOne({ projectId: pid, userId: staff.user.id });
    expect((await request(app).get(base()).set(staffAuth())).status).toBe(403);
    expect((await request(app).post(`${base()}/todos/${t.id}/complete`).set(staffAuth()).send({})).status).toBe(403);
    expect((await link(m.id)).status).toBe(400);
  });

  it('API密钥沿用项目绑定与scope交集，成员管理scope不能越权分配任务', async () => {
    const key = 'anonk_' + 'a'.repeat(64);
    await ApiKey.create({ name: '成员工具', userId: owner.user.id, projectId: pid, scopes: ['member:manage'], keyHash: createHash('sha256').update(key).digest('hex') });
    const r = await request(app).post(`${base()}/external-members`).set('Authorization', `Bearer ${key}`).send({ name: 'MCP成员' });
    expect(r.status).toBe(201);
    expect((await request(app).post(`${base()}/todos`).set('Authorization', `Bearer ${key}`).send({ title: '禁止', externalAssigneeIds: [r.body.externalMember.id] })).status).toBe(403);
    const other = await Project.create({ name: '别的项目', createdBy: owner.user.id });
    expect((await request(app).get(`/api/projects/${other._id}/external-members`).set('Authorization', `Bearer ${key}`)).status).toBe(403);
  });

  it('只录QQ号不投递通知，关联后到期提醒只使用真实账号渠道', async () => {
    const m = await create({ name: '小夏', contacts: [{ platform: 'QQ', value: '123' }] });
    const deliver = vi.spyOn(notificationChannels[0], 'deliver').mockResolvedValue();
    const oldSecret = config.cronSecret;
    try {
      const t = await todo(m.id);
      expect(deliver).not.toHaveBeenCalled();
      await link(m.id);
      await Todo.updateOne({ _id: t.id }, { $set: { dueAt: new Date(Date.now() - 1000) } });
      config.cronSecret = 'external-reminder-test';
      expect((await request(app).post('/api/cron/reminders').set('Authorization', 'Bearer external-reminder-test')).status).toBe(200);
      expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ type: 'todo:due' }), [expect.objectContaining({ userId: staff.user.id, email: 'staff@example.com' })]);
    } finally { deliver.mockRestore(); config.cronSecret = oldSecret; }
  });

  it('演示/试用项目级联销毁时清理新增档案', async () => {
    await create();
    await deleteDemoData({ projectId: (await Project.findById(pid))!._id, userIds: [] });
    expect(await ExternalMember.countDocuments({ projectId: pid })).toBe(0);
  });
});
