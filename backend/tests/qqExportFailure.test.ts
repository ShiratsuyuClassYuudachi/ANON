import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { File } from '../src/models/File';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { handleQQEvent } from '../src/services/qqEvents';
import { createSuperAdmin, registerUser } from './helpers';

// 模拟存储层故障：storeBuffer 抛错（验证导出失败时用户能收到反馈而非静默）
vi.mock('../src/services/storage', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/storage')>();
  return { ...mod, storeBuffer: vi.fn().mockRejectedValue(new Error('disk full')) };
});
vi.mock('../src/services/qqApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/qqApi')>();
  return {
    ...mod,
    sendC2CMessage: vi.fn().mockResolvedValue(true),
    sendGroupMessage: vi.fn().mockResolvedValue(true),
  };
});

import { sendC2CMessage } from '../src/services/qqApi';
const sendC2CMock = vi.mocked(sendC2CMessage);

describe('QQ 聊天记录导出失败反馈', () => {
  beforeEach(async () => {
    sendC2CMock.mockClear();
    config.qq.appId = 'qq-test-appid';
    config.qq.appSecret = 'qq-test-secret';
    config.publicBaseUrl = 'https://app.example.com';
    await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const staff = await registerUser('C1', 's@example.com', 'Staff');
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
  });

  afterAll(() => {
    config.qq.appId = '';
    config.qq.appSecret = '';
    config.publicBaseUrl = '';
  });

  it('存储失败 → 回复「导出失败，请稍后重试」且不建档', async () => {
    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'f1',
      author: { user_openid: 'U-C2C' },
      content: '[聊天记录]',
      message_type: 102,
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: 'hi' }],
    });
    expect(sendC2CMock).toHaveBeenCalledWith('U-C2C', expect.stringContaining('导出失败'), { msgId: 'f1' });
    expect(await File.countDocuments()).toBe(0);
  });
});
