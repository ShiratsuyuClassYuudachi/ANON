import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../utils/errors';

// 服务端加密（可选旧版兼容）：PLATFORM_CRYPTO_KEY（缺省回退 JWT_SECRET）SHA-256 派生密钥，AES-256-GCM
// 密文格式：<iv_b64>:<tag_b64>:<data_b64>
function key(): Buffer {
  return createHash('sha256')
    .update(process.env.PLATFORM_CRYPTO_KEY || config.jwtSecret)
    .digest();
}

export function serverEncrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function serverDecrypt(packed: string): string {
  const [ivB64, tagB64, dataB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new AppError(500, 'bad_cipher', '密文格式无效');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new AppError(500, 'bad_cipher', '密文解密失败');
  }
}
