import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';

const previewDir = path.resolve(config.uploadDir, 'previews');
fs.mkdirSync(previewDir, { recursive: true });

const MAX_WIDTH = 800;
const MAX_BYTES = 100 * 1024;

/** 生成 WebP 预览图（宽 ≤800，逐步降质量使体积 ≤100KB），返回预览文件路径；失败返回 null */
export async function generatePreview(srcPath: string): Promise<string | null> {
  try {
    const img = sharp(srcPath).resize({ width: MAX_WIDTH, withoutEnlargement: true });
    let buf: Buffer | null = null;
    for (const quality of [80, 60, 40, 25]) {
      buf = await img.clone().webp({ quality }).toBuffer();
      if (buf.length <= MAX_BYTES) break;
    }
    if (!buf) return null;
    const p = path.join(previewDir, crypto.randomUUID() + '.webp');
    await fs.promises.writeFile(p, buf);
    return p;
  } catch {
    return null;
  }
}
