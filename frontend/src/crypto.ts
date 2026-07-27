// 浏览器端保险库加密：PBKDF2(SHA-256, 600000 次) 派生 AES-GCM 密钥
// 密文格式：ANONv2:<iterations>:<salt_b64>:<iv_b64>:<data_b64>，服务端只存密文、不存口令
// 旧格式 ANONv1（固定 100000 次迭代，无 iterations 字段）仍可按 v1 解密
const PREFIX_V1 = 'ANONv1';
const PREFIX_V2 = 'ANONv2';
const ITERATIONS_V1 = 100000;
const ITERATIONS = 600000;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassphrase(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return `${PREFIX_V2}:${ITERATIONS}:${toB64(salt)}:${toB64(iv)}:${toB64(new Uint8Array(data))}`;
}

export async function decryptWithPassphrase(packed: string, passphrase: string): Promise<string> {
  const parts = packed.split(':');
  let iterations: number;
  let saltB64: string | undefined;
  let ivB64: string | undefined;
  let dataB64: string | undefined;
  if (parts[0] === PREFIX_V1 && parts.length === 4) {
    // v1 旧格式：ANONv1:<salt>:<iv>:<data>，固定 100000 次迭代
    iterations = ITERATIONS_V1;
    [, saltB64, ivB64, dataB64] = parts;
  } else if (parts[0] === PREFIX_V2 && parts.length === 5) {
    iterations = Number(parts[1]);
    [, , saltB64, ivB64, dataB64] = parts;
  } else {
    throw new Error('密文格式无效');
  }
  if (!Number.isInteger(iterations) || iterations <= 0 || !saltB64 || !ivB64 || !dataB64)
    throw new Error('密文格式无效');
  try {
    const key = await deriveKey(passphrase, fromB64(saltB64), iterations);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) as BufferSource },
      key,
      fromB64(dataB64) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('解密失败：保险库口令错误或密文损坏');
  }
}
