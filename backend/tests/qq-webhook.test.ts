import nacl from 'tweetnacl';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { User } from '../src/models/User';
import { createBindCode } from '../src/services/qqbot';
import { createSuperAdmin } from './helpers';

// 拦截 QQ 发送，同 qq.test.ts 模式
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

// QQ 官方文档示例凭证与回调验证向量（bot.q.qq.com/wiki .../event-emit/webhook.html）
const SECRET = 'DG5g3B4j9X2KOErG';
const OFFICIAL = {
  plainToken: 'Arq0D5A61EgUu4OxUvOp',
  eventTs: '1725442341',
  signature:
    '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706',
};

/** 与官方算法一致的事件签名（timestamp + rawBody）；算法正确性由官方向量用例锚定 */
function signEvent(timestamp: string, rawBody: string): string {
  let seed = SECRET;
  while (seed.length < 32) seed += seed;
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(Buffer.from(seed.slice(0, 32), 'utf8')));
  const sig = nacl.sign.detached(new Uint8Array(Buffer.from(timestamp + rawBody, 'utf8')), pair.secretKey);
  return Buffer.from(sig).toString('hex');
}

function postWebhook(rawBody: string, headers: Record<string, string> = {}) {
  return request(app)
    .post('/api/qq/webhook')
    .set('Content-Type', 'application/json')
    .set(headers)
    .send(rawBody);
}

function signedPost(frame: Record<string, unknown>, timestamp = '1725442341') {
  const rawBody = JSON.stringify(frame);
  return postWebhook(rawBody, {
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Ed25519': signEvent(timestamp, rawBody),
  });
}

let owner: { token: string; user: { id: string } };

beforeEach(async () => {
  sendC2CMock.mockClear();
  config.qq.appId = 'qq-test-appid';
  config.qq.appSecret = SECRET;
  owner = await createSuperAdmin();
});

// config 在同一 fork 内跨测试文件共享：收尾恢复未配置态
afterAll(() => {
  config.qq.appId = '';
  config.qq.appSecret = '';
});

describe('QQ webhook 回调', () => {
  it('op 13 回调地址验证：签名与官方测试向量逐字节一致', async () => {
    const res = await postWebhook(JSON.stringify({ d: { plain_token: OFFICIAL.plainToken, event_ts: OFFICIAL.eventTs }, op: 13 }));
    expect(res.status).toBe(200);
    expect(res.body.plain_token).toBe(OFFICIAL.plainToken);
    expect(res.body.signature).toBe(OFFICIAL.signature);
  });

  it('op 13 缺少 plain_token/event_ts → 400；body 非 JSON → 400', async () => {
    const bad = await postWebhook(JSON.stringify({ d: {}, op: 13 }));
    expect(bad.status).toBe(400);
    const notJson = await postWebhook('not-json{{{');
    expect(notJson.status).toBe(400);
  });

  it('合法签名事件：C2C 绑定全流程走通并被动回复', async () => {
    const { code } = await createBindCode('user', owner.user.id);
    const res = await signedPost({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      id: 'evt-w1',
      d: { id: 'msg-w1', author: { user_openid: 'qq-open-wh1', union_openid: 'union-wh1' }, content: `绑定 ${code}` },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ opcode: 12 });

    // 路由先回包后异步处理：等副作用落库
    await vi.waitFor(async () => {
      const u = await User.findById(owner.user.id).lean();
      expect(u!.qqOpenId).toBe('qq-open-wh1');
      expect(u!.qqUnionOpenId).toBe('union-wh1');
    });
    expect(sendC2CMock).toHaveBeenCalledTimes(1);
    expect(sendC2CMock.mock.calls[0][1]).toContain('绑定成功');
  });

  it('签名非法/缺失 → 401，事件不处理', async () => {
    const frame = { op: 0, t: 'C2C_MESSAGE_CREATE', id: 'evt-w2', d: { id: 'msg-w2', author: { user_openid: 'qq-open-wh2' }, content: '绑定 123456' } };
    const rawBody = JSON.stringify(frame);

    const bad = await postWebhook(rawBody, { 'X-Signature-Timestamp': '1725442341', 'X-Signature-Ed25519': 'ab'.repeat(64) });
    expect(bad.status).toBe(401);

    const missing = await postWebhook(rawBody);
    expect(missing.status).toBe(401);
    expect(sendC2CMock).not.toHaveBeenCalled();
  });

  it('同一 msg_id 重投去重：回 200 但只处理一次', async () => {
    const { code } = await createBindCode('user', owner.user.id);
    const frame = {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      id: 'evt-w3',
      d: { id: 'msg-w3', author: { user_openid: 'qq-open-wh3' }, content: `绑定 ${code}` },
    };
    const first = await signedPost(frame);
    expect(first.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await User.findById(owner.user.id).lean())!.qqOpenId).toBe('qq-open-wh3');
    });

    // 码已消费 + 去重：若去重失效会再走一遍处理器并回复「绑定码无效」
    sendC2CMock.mockClear();
    const replay = await signedPost({ ...frame, id: 'evt-w3-retry' });
    expect(replay.status).toBe(200);
    expect(sendC2CMock).not.toHaveBeenCalled();
  });

  it('QQ 未配置 → 404', async () => {
    config.qq.appId = '';
    config.qq.appSecret = '';
    try {
      const res = await postWebhook(JSON.stringify({ d: { plain_token: 'x', event_ts: '1' }, op: 13 }));
      expect(res.status).toBe(404);
    } finally {
      config.qq.appId = 'qq-test-appid';
      config.qq.appSecret = SECRET;
    }
  });
});
