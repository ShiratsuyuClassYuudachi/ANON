import crypto from 'crypto';
import sharp from 'sharp';
import { storeBuffer } from './storage';

const MAX_WIDTH = 800;
const MAX_BYTES = 100 * 1024;

/** 生成 WebP 预览图（宽 ≤800，逐步降质量使体积 ≤100KB），返回存储引用；失败返回 null */
export async function generatePreview(srcPath: string): Promise<string | null> {
  try {
    const img = sharp(srcPath).resize({ width: MAX_WIDTH, withoutEnlargement: true });
    let buf: Buffer | null = null;
    for (const quality of [80, 60, 40, 25]) {
      buf = await img.clone().webp({ quality }).toBuffer();
      if (buf.length <= MAX_BYTES) break;
    }
    if (!buf) return null;
    return await storeBuffer(buf, `previews/${crypto.randomUUID()}.webp`, 'image/webp');
  } catch {
    return null;
  }
}
