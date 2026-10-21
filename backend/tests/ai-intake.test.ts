import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { parseFinanceAmount } from '../src/services/financeEntries';
const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  chat = { completions: { create: complete } };
} }));
import { classifyIntake, parseStageSignup, parseFinance } from '../src/services/ai';

const oldKey = config.ai.apiKey;
const respond = (value: unknown) => complete.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(value) } }] });
beforeEach(() => {
  complete.mockReset();
  config.ai.apiKey = 'test-key';
});
afterAll(() => { config.ai.apiKey = oldKey; });

describe('AI 录入输出校验', () => {
  it('十进制大金额精确转分，超过安全整数范围则拒绝', () => {
    expect(parseFinanceAmount('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseFinanceAmount('120.50')).toBe(12050);
    expect(() => parseFinanceAmount('90071992547409.92')).toThrow('金额');
  });

  it('向 AI 传递合法提及引用并保留付款/平摊角色，服务端再映射用户身份', async () => {
    respond({ type: 'expense', amount: '120', note: '海报', payerName: '@成员1', splitNames: ['我', '@成员2'] });
    expect(await parseFinance('@成员1垫付120元，我和@成员2平摊', { mentions: ['@成员1', '@成员2'] })).toMatchObject({ payerName: '@成员1', splitNames: ['我', '@成员2'] });
    const prompt = complete.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('["@成员1","@成员2"]');
    expect(prompt).toContain('被 @ 不等于付款人');
  });
  it('记账保留缺失字段，不猜测金额和人名，十进制金额不经过浮点计算', async () => {
    const value = { type: 'expense', amount: '120.50', note: ' 海报 ', payerName: null, splitNames: null };
    respond(value);
    expect(await parseFinance('记账')).toEqual({ ...value, note: '海报' });
    respond({ ...value, type: null, amount: null });
    expect(await parseFinance('缺金额')).toMatchObject({ type: null, amount: null });
  });
  it.each([
    { type: 'transfer' }, { amount: 120.5 }, { amount: '1.234' }, { amount: '-1' },
    { amount: '1e3' }, { amount: 'NaN' }, { payerName: 12 }, { splitNames: [''] },
    { splitNames: [] }, { splitNames: [12] }, { note: null },
  ])('拒绝非法记账字段 %j', async (bad) => {
    respond({ type: 'expense', amount: '120.50', note: '海报', payerName: null, splitNames: null, ...bad });
    expect(await parseFinance('记账')).toBeNull();
  });

  it.each(['signup', 'todo', 'finance', 'ambiguous', 'none'] as const)('接受合法意图 %s', async (intent) => {
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
