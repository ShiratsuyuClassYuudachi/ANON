import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  chat = { completions: { create: complete } };
} }));
import { classifyIntake, parseStageSignup } from '../src/services/ai';

const oldKey = config.ai.apiKey;
const respond = (value: unknown) => complete.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(value) } }] });
beforeEach(() => {
  complete.mockReset();
  config.ai.apiKey = 'test-key';
});
afterAll(() => { config.ai.apiKey = oldKey; });

describe('AI 录入输出校验', () => {
  it.each(['signup', 'todo', 'ambiguous', 'none'] as const)('接受合法意图 %s', async (intent) => {
    respond({ intent });
    expect(await classifyIntake('消息')).toBe(intent);
  });
  it('非法 JSON、未知意图、网络失败均返回 null，未配置时不请求', async () => {
    complete.mockResolvedValueOnce({ choices: [{ message: { content: '不是 JSON' } }] });
    expect(await classifyIntake('消息')).toBeNull();
    respond({ intent: 'delete' });
    expect(await classifyIntake('消息')).toBeNull();
    complete.mockRejectedValueOnce(new Error('网络异常'));
    expect(await parseStageSignup('消息')).toBeNull();
    complete.mockClear();
    config.ai.apiKey = '';
    expect(await classifyIntake('消息')).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
  it('节目字段只接受预期类型，空报名人被过滤，缺时长保持 null', async () => {
    respond({ name: ' 追光 ', durationMin: null, participants: [{ cn: ' 小明 ', contact: ' QQ123 ' }, { cn: ' ', contact: '' }], note: ' 备注 ' });
    expect(await parseStageSignup('消息')).toEqual({ name: '追光', durationMin: null, participants: [{ cn: '小明', contact: 'QQ123' }], note: '备注' });
    for (const bad of [null, [], { name: 5 }, { name: '追光', durationMin: '5', participants: [], note: '' }, { name: '追光', durationMin: 5, participants: [{ cn: '小明', contact: 123 }], note: '' }]) {
      respond(bad);
      expect(await parseStageSignup('消息')).toBeNull();
    }
  });
});
