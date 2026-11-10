import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { config } from '../config';

const dir = path.resolve(config.uploadDir);
fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: dir,
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
});

export const MATERIAL_MAX_BYTES = 1024 * 1024 * 1024;
export const MATERIAL_CHUNK_BYTES = 8 * 1024 * 1024;

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Multer 2.5 已将 fileSize 解释为允许的最大字节数，恰好达到上限仍可上传。
export const materialUpload = multer({ storage, limits: { fileSize: MATERIAL_MAX_BYTES } });
export const materialChunkUpload = multer({ storage, limits: { fileSize: MATERIAL_CHUNK_BYTES } });

/** multer 以 latin1 解析文件名，中文名需要转回 UTF-8 */
export function fixFilename(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}
