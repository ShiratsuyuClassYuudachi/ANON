// 浏览器端保险库加密：PBKDF2(SHA-256, 100000 次) 派生 AES-GCM 密钥
// 密文格式：ANONv1:<salt_b64>:<iv_b64>:<data_b64>，服务端只存密文、不存口令
const PREFIX = 'ANONv1';
const ITERATIONS = 100000;

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

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassphrase(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return `${PREFIX}:${toB64(salt)}:${toB64(iv)}:${toB64(new Uint8Array(data))}`;
}

export async function decryptWithPassphrase(packed: string, passphrase: string): Promise<string> {
  const [prefix, saltB64, ivB64, dataB64] = packed.split(':');
  if (prefix !== PREFIX || !saltB64 || !ivB64 || !dataB64) throw new Error('密文格式无效');
  try {
    const key = await deriveKey(passphrase, fromB64(saltB64));
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
