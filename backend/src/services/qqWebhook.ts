import nacl from 'tweetnacl';
import { config } from '../config';

/**
 * QQ webhook 验签与回包签名（官方算法，见 bot.q.qq.com/wiki .../sign.html）：
 * seed = appSecret 倍增至 ≥32 字节后截断 → Ed25519 keypair。
 * 回调地址验证（op 13）：签名 event_ts + plain_token；
 * 事件回调验签：Ed25519 verify(timestamp + rawBody)，公钥同上。
 * 密钥对按 appSecret 缓存，测试改 config 后自动重建。
 */

let cached: { secret: string; pair: nacl.SignKeyPair } | null = null;

function keyPair(): nacl.SignKeyPair {
  const secret = config.qq.appSecret;
  if (!cached || cached.secret !== secret) {
    let seed = secret;
    while (seed.length < 32) seed += seed;
    const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(Buffer.from(seed.slice(0, 32), 'utf8')));
    cached = { secret, pair };
  }
  return cached.pair;
}

/** 回调地址验证：对 event_ts + plain_token 签名，返回 hex */
export function signValidation(eventTs: string, plainToken: string): string {
  const sig = nacl.sign.detached(new Uint8Array(Buffer.from(eventTs + plainToken, 'utf8')), keyPair().secretKey);
  return Buffer.from(sig).toString('hex');
}

/** 事件回调验签：timestamp + 原始 body，十六进制签名头 */
export function verifyCallback(timestamp: string, signatureHex: string, rawBody: Buffer): boolean {
  const sig = Buffer.from(signatureHex, 'hex');
  if (sig.length !== 64) return false;
  const msg = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
  return nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(sig), keyPair().publicKey);
}

// --- 事件去重（QQ 未收到 200 会重投；同 gateway 语义，内存 500 条 FIFO） ---

const seen = new Set<string>();

/** 已处理过返回 true（并记录） */
export function isDuplicate(key: string): boolean {
  if (seen.has(key)) return true;
  seen.add(key);
  if (seen.size > 500) seen.delete(seen.values().next().value!);
  return false;
}
