import { describe, expect, it } from 'vitest';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { WorkModule } from '../src/models/WorkModule';
import { memberNameMap, moduleJson } from '../src/services/workModules';

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
