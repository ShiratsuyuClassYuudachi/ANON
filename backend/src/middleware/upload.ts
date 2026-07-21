import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { config } from '../config';

const dir = path.resolve(config.uploadDir);
fs.mkdirSync(dir, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** multer 以 latin1 解析文件名，中文名需要转回 UTF-8 */
export function fixFilename(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}
