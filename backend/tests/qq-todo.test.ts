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
import { handleQQEvent } from '../src/services/qqGateway';
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
import { sendGroupMessage } from '../src/services/qqApi';
const parseTaskMock = vi.mocked(parseTask);
const sendGroupMock = vi.mocked(sendGroupMessage);

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
