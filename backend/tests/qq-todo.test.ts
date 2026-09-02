import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { Activity } from '../src/models/Activity';
import { InviteCode } from '../src/models/InviteCode';
import { Project } from '../src/models/Project';
import { Todo } from '../src/models/Todo';
import { User } from '../src/models/User';
import { createBindCode } from '../src/services/qqbot';
import { handleQQEvent } from '../src/services/qqEvents';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 QQ 发送（保留 createBindCode/consumeBindCode/qqConfigured 等真实实现），同 qq.test.ts 模式
vi.mock('../src/services/qqApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/qqApi')>();
  return {
    ...mod,
    sendC2CMessage: vi.fn().mockResolvedValue(true),
    sendGroupMessage: vi.fn().mockResolvedValue(true),
  };
});

// 只替身 parseTask：aiConfigured 用真实实现（读 config.ai.apiKey），由测试控制开关
vi.mock('../src/services/ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/ai')>();
  return { ...mod, parseTask: vi.fn() };
});

import { parseTask } from '../src/services/ai';
import { sendC2CMessage, sendGroupMessage } from '../src/services/qqApi';
const parseTaskMock = vi.mocked(parseTask);
const sendGroupMock = vi.mocked(sendGroupMessage);
const sendC2CMock = vi.mocked(sendC2CMessage);

const GROUP = 'grp-ai-1';
const DEFAULT_PARSED = {
  isTask: true,
  title: '把海报送到印刷店',
  note: '',
  dueAt: '2026-09-05T18:00:00+08:00',
  nodeAt: null,
  remindAt: null,
};

let owner: { token: string; user: { id: string; email: string } };
let staff: { token: string; user: { id: string; email: string } };
let projectId: string;

beforeEach(async () => {
  sendGroupMock.mockClear();
  sendC2CMock.mockClear();
  parseTaskMock.mockReset();
  parseTaskMock.mockResolvedValue(DEFAULT_PARSED);
  config.ai.apiKey = 'test-key';
  config.publicBaseUrl = '';

  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: 'QQ AI 录单测试活动' });
  projectId = p.body.project.id;
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ roleName: '一般staff' });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${staff.token}`);
});

// config 在同一 fork 内跨测试文件共享：收尾恢复未配置态
afterAll(() => {
  config.ai.apiKey = '';
});

function groupTaskEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'gmsg-ai-1',
    group_openid: GROUP,
    content: '周五前把海报送到印刷店',
    author: { member_openid: 'member-sender', username: '群友甲' },
    ...over,
  };
}

function c2cTaskEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'cmsg-1',
    content: '周五前把海报送到印刷店',
    author: { user_openid: 'c2c-staff' },
    ...over,
  };
}

describe('QQ 群 AI 录单', () => {
  it('任务文本 + @已绑定成员 → 建单、指派、回复含标题与指派', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    await User.updateOne(
      { _id: staff.user.id },
      { qqMemberIds: [{ groupOpenId: GROUP, memberOpenId: 'member-staff' }] },
    );

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent({
      mentions: [{ member_openid: 'member-staff', username: 'StaffQQ' }],
    }));

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo).toBeTruthy();
    expect(todo!.title).toBe('把海报送到印刷店');
    expect(todo!.dueAt?.toISOString()).toBe('2026-09-05T10:00:00.000Z');
    expect(todo!.assigneeIds.map(String)).toEqual([staff.user.id]);
    // 发送者未绑定 → createdBy 回落项目创建者
    expect(todo!.createdBy.toString()).toBe(owner.user.id);

    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    const [to, text, opts] = sendGroupMock.mock.calls[0];
    expect(to).toBe(GROUP);
    expect(opts).toEqual({ msgId: 'gmsg-ai-1' });
    expect(text).toContain('已创建待办「把海报送到印刷店」');
    expect(text).toContain('指派：Staff');
    expect(text).toContain('截止：2026-09-05 18:00');
  });
  it('全量群消息（GROUP_MESSAGE_CREATE）@机器人 → 同样建单，机器人自身不进指派', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    await User.updateOne(
      { _id: staff.user.id },
      { qqMemberIds: [{ groupOpenId: GROUP, memberOpenId: 'member-staff' }] },
    );

    await handleQQEvent('GROUP_MESSAGE_CREATE', groupTaskEvent({
      mentions: [
        { username: 'ANON机器人', bot: true },
        { member_openid: 'member-staff', username: 'StaffQQ' },
      ],
    }));

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo).toBeTruthy();
    expect(todo!.assigneeIds.map(String)).toEqual([staff.user.id]);
    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMock.mock.calls[0][1]).not.toContain('未识别成员');
  });

  it('全量群消息未 @ 机器人 → 静默忽略', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });

    await handleQQEvent('GROUP_MESSAGE_CREATE', groupTaskEvent({
      mentions: [{ member_openid: 'member-staff', username: '群友乙' }],
    }));

    expect(await Todo.findOne({ projectId }).lean()).toBeNull();
    expect(parseTaskMock).not.toHaveBeenCalled();
    expect(sendGroupMock).not.toHaveBeenCalled();
  });

  it('发送者已群内绑定 → createdBy=该用户，活动动态含（QQ 群）', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    await User.updateOne(
      { _id: staff.user.id },
      { qqMemberIds: [{ groupOpenId: GROUP, memberOpenId: 'member-sender' }] },
    );

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent());

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo!.createdBy.toString()).toBe(staff.user.id);
    await vi.waitFor(async () => {
      const act = await Activity.findOne({ type: 'todo:create', projectId }).lean();
      expect(act?.message).toContain('（QQ 群）');
      expect(act?.message).toContain('群友甲');
    });
  });

  it('mention 仅昵称唯一匹配 → 指派成功', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent({
      mentions: [{ username: 'Staff' }],
    }));

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo!.assigneeIds.map(String)).toEqual([staff.user.id]);
    expect(sendGroupMock.mock.calls[0][1]).toContain('指派：Staff');
  });

  it('mention 全部未命中 → 无指派，回复含未识别成员', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent({
      mentions: [{ member_openid: 'member-unknown', username: 'Nobody' }],
    }));

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo!.assigneeIds).toEqual([]);
    const text = sendGroupMock.mock.calls[0][1];
    expect(text).toContain('未识别成员：@Nobody');
    expect(text).not.toContain('指派：');
  });

  it('parseTask 返回 null → 回复暂时不可用，不落库', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    parseTaskMock.mockResolvedValue(null);

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent());

    expect(await Todo.countDocuments({ projectId })).toBe(0);
    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMock.mock.calls[0][1]).toContain('暂时不可用');
  });

  it('parseTask 判 isTask=false → 回复未识别到任务内容，不落库', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    parseTaskMock.mockResolvedValue({ isTask: false, title: '', note: '', dueAt: null, nodeAt: null, remindAt: null });

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent());

    expect(await Todo.countDocuments({ projectId })).toBe(0);
    expect(sendGroupMock.mock.calls[0][1]).toContain('未识别到任务内容');
  });

  it('无指派无时间 → 照常建单，回复恰为标题行 + 查看链接', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    parseTaskMock.mockResolvedValue({ isTask: true, title: '买电池', note: '', dueAt: null, nodeAt: null, remindAt: null });
    config.publicBaseUrl = 'https://app.example.com';
    try {
      await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent({ mentions: [] }));

      const todo = await Todo.findOne({ projectId }).lean();
      expect(todo!.title).toBe('买电池');
      expect(todo!.assigneeIds).toEqual([]);
      expect(todo!.dueAt).toBeUndefined();
      expect(todo!.nodeAt).toBeUndefined();
      expect(todo!.remindAt).toBeUndefined();

      expect(sendGroupMock).toHaveBeenCalledTimes(1);
      expect(sendGroupMock.mock.calls[0][1]).toBe(
        `已创建待办「买电池」\n查看：https://app.example.com/p/${projectId}?tab=todos`,
      );
    } finally {
      config.publicBaseUrl = '';
    }
  });

  it('未绑定群 → 完全静默：不解析、不回复、不落库', async () => {
    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent({ group_openid: 'grp-unbound' }));

    expect(parseTaskMock).not.toHaveBeenCalled();
    expect(sendGroupMock).not.toHaveBeenCalled();
    expect(await Todo.countDocuments()).toBe(0);
  });

  it('AI 未配置 → 静默忽略', async () => {
    await Project.updateOne({ _id: projectId }, { qqGroupOpenId: GROUP });
    config.ai.apiKey = '';
    try {
      await handleQQEvent('GROUP_AT_MESSAGE_CREATE', groupTaskEvent());
      expect(parseTaskMock).not.toHaveBeenCalled();
      expect(sendGroupMock).not.toHaveBeenCalled();
      expect(await Todo.countDocuments()).toBe(0);
    } finally {
      config.ai.apiKey = 'test-key';
    }
  });
});

describe('QQ 绑定扩展字段', () => {
  it('群内个人绑定码 → qqMemberIds 对照表落库 + 回复关联账号', async () => {
    const { code } = await createBindCode('user', staff.user.id);

    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'gmsg-bind-1',
      group_openid: GROUP,
      author: { member_openid: 'member-staff', union_openid: 'union-staff', username: 'StaffQQ' },
      content: `绑定 ${code}`,
    });

    const u = (await User.findById(staff.user.id).lean())!;
    expect(u.qqMemberIds).toEqual([{ groupOpenId: GROUP, memberOpenId: 'member-staff' }]);
    expect(u.qqUnionOpenId).toBe('union-staff');
    expect(sendGroupMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMock.mock.calls[0][1]).toContain('已关联 ANON 账号「Staff」');
  });

  it('C2C 绑定携带 union_openid → qqUnionOpenId 落库', async () => {
    const { code } = await createBindCode('user', staff.user.id);

    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-u1',
      author: { user_openid: 'qq-open-u1', union_openid: 'union-u1' },
      content: `绑定 ${code}`,
    });

    const u = (await User.findById(staff.user.id).lean())!;
    expect(u.qqOpenId).toBe('qq-open-u1');
    expect(u.qqUnionOpenId).toBe('union-u1');
  });
});

describe('QQ 单聊 AI 录单', () => {
  // 第二项目并拉 staff 入项；startDate 控制序号顺序（早者序号 1：第二活动 < 测试活动）
  async function setupTwoProjects() {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'c2c-staff' });
    const p2 = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '第二活动' });
    const project2 = p2.body.project.id as string;
    const inv2 = await request(app)
      .post(`/api/projects/${project2}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ roleName: '一般staff' });
    await request(app)
      .post(`/api/invites/${inv2.body.token}/accept`)
      .set('Authorization', `Bearer ${staff.token}`);
    await Project.updateOne({ _id: projectId }, { startDate: new Date('2026-10-01') });
    await Project.updateOne({ _id: project2 }, { startDate: new Date('2026-09-01') });
    return project2;
  }

  it('未绑定发送者 → 回复绑定引导，不解析不落库', async () => {
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());

    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    const [to, text, opts] = sendC2CMock.mock.calls[0];
    expect(to).toBe('c2c-staff');
    expect(text).toContain('绑定 XXXXXX');
    expect(opts).toEqual({ msgId: 'cmsg-1' });
    expect(parseTaskMock).not.toHaveBeenCalled();
    expect(await Todo.countDocuments()).toBe(0);
  });

  it('绑定但无进行中活动 → 回复无活动提示，不落库', async () => {
    await InviteCode.create({ code: 'C2', createdBy: owner.user.id });
    const outsider = await registerUser('C2', 'o@example.com', 'Outsider');
    await User.updateOne({ _id: outsider.user.id }, { qqOpenId: 'c2c-outsider' });

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ author: { user_openid: 'c2c-outsider' } }));

    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][1]).toContain('没有进行中的活动');
    expect(parseTaskMock).not.toHaveBeenCalled();
    expect(await Todo.countDocuments()).toBe(0);
  });

  it('恰好一个进行中活动 → 直接建单：createdBy=发送者、无指派、回复含项目名', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'c2c-staff' });

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo).toBeTruthy();
    expect(todo!.title).toBe('把海报送到印刷店');
    expect(todo!.dueAt?.toISOString()).toBe('2026-09-05T10:00:00.000Z');
    expect(todo!.assigneeIds).toEqual([]);
    expect(todo!.createdBy.toString()).toBe(staff.user.id);
    const text = sendC2CMock.mock.calls[0][1];
    expect(text).toContain('已创建待办「把海报送到印刷店」');
    expect(text).toContain('到活动「QQ AI 录单测试活动」');
    expect(text).toContain('截止：2026-09-05 18:00');
    await vi.waitFor(async () => {
      const act = await Activity.findOne({ type: 'todo:create', projectId }).lean();
      expect(act?.message).toContain('（QQ 单聊）');
      expect(act?.message).toContain('Staff');
    });
  });

  it('多个进行中活动 → 回复序号列表（startDate 早者在前），回复序号建到所选活动，pending 消费后失效', async () => {
    const project2 = await setupTwoProjects();

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());

    expect(await Todo.countDocuments()).toBe(0);
    expect(parseTaskMock).not.toHaveBeenCalled();
    const listText = sendC2CMock.mock.calls[0][1];
    expect(listText).toContain('回复序号选择');
    expect(listText).toContain('1. 第二活动');
    expect(listText).toContain('2. QQ AI 录单测试活动');

    // 回复序号 2（新 msgId）→ 建到「QQ AI 录单测试活动」
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-2', content: '2' }));

    const todo = await Todo.findOne({ projectId }).lean();
    expect(todo).toBeTruthy();
    expect(todo!.createdBy.toString()).toBe(staff.user.id);
    expect(await Todo.countDocuments({ projectId: project2 })).toBe(0);
    expect(sendC2CMock.mock.calls[1][1]).toContain('到活动「QQ AI 录单测试活动」');
    expect(sendC2CMock.mock.calls[1][2]).toEqual({ msgId: 'cmsg-2' });

    // pending 已消费：再发 '2' → 提示没有待选择的活动
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-3', content: '2' }));
    expect(sendC2CMock.mock.calls[2][1]).toContain('没有待选择的活动');
    expect(await Todo.countDocuments()).toBe(1);
  });

  it('回复 0 → 取消，不落库', async () => {
    await setupTwoProjects();

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-2', content: '0' }));

    expect(sendC2CMock.mock.calls[1][1]).toContain('已取消');
    expect(await Todo.countDocuments()).toBe(0);
    expect(parseTaskMock).not.toHaveBeenCalled();
  });

  it('无效序号 → 提示序号无效且 pending 保留，重发合法序号成功建单', async () => {
    const project2 = await setupTwoProjects();

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-2', content: '9' }));

    expect(sendC2CMock.mock.calls[1][1]).toContain('序号无效');
    expect(sendC2CMock.mock.calls[1][1]).toContain('1-2');
    expect(await Todo.countDocuments()).toBe(0);

    // pending 保留：重发 '1' → 建到序号 1（startDate 早者 = 第二活动）
    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-3', content: '1' }));
    const todo = await Todo.findOne({ projectId: project2 }).lean();
    expect(todo).toBeTruthy();
    expect(sendC2CMock.mock.calls[2][1]).toContain('到活动「第二活动」');
  });

  it('pending 过期（10 分钟 TTL）→ 序号回复提示没有待选择的活动', async () => {
    await setupTwoProjects();

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());
    expect(sendC2CMock.mock.calls[0][1]).toContain('回复序号选择');

    // 不用 fake timers（避免影响 mongoose 心跳），只前移 Date.now
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    try {
      await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ id: 'cmsg-2', content: '1' }));
      expect(sendC2CMock.mock.calls[1][1]).toContain('没有待选择的活动');
      expect(await Todo.countDocuments()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('AI 未配置 → 完全静默：不解析、不回复、不落库', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'c2c-staff' });
    config.ai.apiKey = '';
    try {
      await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent());
      expect(parseTaskMock).not.toHaveBeenCalled();
      expect(sendC2CMock).not.toHaveBeenCalled();
      expect(await Todo.countDocuments()).toBe(0);
    } finally {
      config.ai.apiKey = 'test-key';
    }
  });

  it('绑定意图优先：「绑定 123456」→ 无效绑定码提示，不进入录单', async () => {
    await User.updateOne({ _id: staff.user.id }, { qqOpenId: 'c2c-staff' });

    await handleQQEvent('C2C_MESSAGE_CREATE', c2cTaskEvent({ content: '绑定 123456' }));

    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][1]).toContain('绑定码无效或已过期');
    expect(parseTaskMock).not.toHaveBeenCalled();
    expect(await Todo.countDocuments()).toBe(0);
  });
});
