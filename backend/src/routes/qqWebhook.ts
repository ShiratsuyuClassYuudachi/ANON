import { raw, Router } from 'express';
import { handleQQEvent } from '../services/qqEvents';
import { qqConfigured } from '../services/qqApi';
import { isDuplicate, signValidation, verifyCallback } from '../services/qqWebhook';

/**
 * QQ 开放平台 webhook 回调（管理端配置：https://<域名>/api/qq/webhook，仅支持 443/8443/80/8080）。
 * 必须在全局 express.json() 之前挂载——验签需要原始请求体字节。
 * 事件帧与 WebSocket 网关同构（op/d/t/id）：
 *   op 13 回调地址验证（无签名头，以回包签名证明持有 secret）；
 *   op 0  事件分发，验签 + 去重后立即 200（QQ 回包窗口短，AI 解析等处理异步进行）。
 */
export const qqWebhookRouter = Router();

qqWebhookRouter.post('/webhook', raw({ type: () => true }), (req, res) => {
  if (!qqConfigured()) {
    res.status(404).json({ error: { code: 'qq_disabled', message: 'QQ 未配置' } });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  let frame: { op?: number; d?: unknown; t?: string; id?: string };
  try {
    frame = JSON.parse(rawBody.toString('utf8')) as typeof frame;
  } catch {
    res.status(400).json({ error: { code: 'bad_request', message: 'body 必须是 JSON' } });
    return;
  }
  // 外部输入：窄化为 unknown 字典后逐字段 typeof 校验，不做未检形状断言
  const dObj = frame.d && typeof frame.d === 'object' ? (frame.d as Record<string, unknown>) : undefined;

  if (frame.op === 13) {
    const plainToken = typeof dObj?.plain_token === 'string' ? dObj.plain_token : '';
    const eventTs = typeof dObj?.event_ts === 'string' ? dObj.event_ts : '';
    if (!plainToken || !eventTs) {
      res.status(400).json({ error: { code: 'bad_request', message: '缺少 plain_token/event_ts' } });
      return;
    }
    // 联调期观测：记录 QQ 侧宣告的 bot appid 与挑战值（plain_token 为一次性随机串，非敏感）
    console.log(`[qq] webhook op13 验证: appid=${req.header('X-Bot-Appid') ?? '?'} ts=${eventTs} token=${plainToken}`);
    res.json({ plain_token: plainToken, signature: signValidation(eventTs, plainToken) });
    return;
  }

  const timestamp = req.header('X-Signature-Timestamp') ?? '';
  const signature = req.header('X-Signature-Ed25519') ?? '';
  if (!timestamp || !signature || !verifyCallback(timestamp, signature, rawBody)) {
    res.status(401).json({ error: { code: 'invalid_signature', message: '签名校验失败' } });
    return;
  }

  const msgId = typeof dObj?.id === 'string' ? dObj.id : undefined;
  // 消息类事件按消息 id 去重：同一消息的 GROUP_MESSAGE_CREATE/GROUP_AT 双投递（全量+@ 同时订阅时）只处理一次
  const dedupKey = frame.t === 'C2C_MESSAGE_CREATE' || frame.t === 'GROUP_AT_MESSAGE_CREATE' || frame.t === 'GROUP_MESSAGE_CREATE' ? msgId : frame.id;
  const dup = dedupKey ? isDuplicate(dedupKey) : false;
  console.log(`[qq] webhook op0: t=${frame.t ?? '?'} msgId=${dedupKey ?? '?'} dup=${dup} len=${typeof dObj?.content === 'string' ? dObj.content.length : -1}`);

  // op 12 HTTP Callback ACK：webhook 模式标准回包（官方 opcode 表）；先回包再异步处理（AI 解析最长 30s+）
  res.json({ opcode: 12 });
  if (!dup && frame.t) void handleQQEvent(frame.t, frame.d, frame.id);
});
