import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { config } from '../config';
import { MATERIAL_CHUNK_BYTES, MATERIAL_MAX_BYTES } from '../middleware/upload';
import { AppError } from '../utils/errors';

interface UploadSession {
  projectId: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  received: number;
  path: string;
  touchedAt: number;
  busy: boolean;
}

const dir = path.resolve(config.uploadDir, '.material-uploads');
const sessions = new Map<string, UploadSession>();
const TTL = 24 * 60 * 60 * 1000;
fs.mkdirSync(dir, { recursive: true });

/** 清理中断上传；重启后失去会话的暂存文件也按修改时间过期回收。 */
async function sweep() {
  const cutoff = Date.now() - TTL;
  for (const [id, session] of sessions) {
    if (!session.busy && session.touchedAt < cutoff) sessions.delete(id);
  }
  for (const name of await fs.promises.readdir(dir)) {
    const filename = path.join(dir, name);
    const stat = await fs.promises.stat(filename).catch(() => null);
    if (stat && stat.mtimeMs < cutoff && ![...sessions.values()].some((s) => s.path === filename && s.busy)) {
      await fs.promises.unlink(filename).catch(() => {});
    }
  }
}
const timer = setInterval(() => { void sweep().catch(() => {}); }, 60 * 60 * 1000);
timer.unref();
void sweep().catch(() => {});

function ownSession(id: string, projectId: string, userId: string) {
  const session = sessions.get(id);
  if (!session || session.projectId !== projectId || session.userId !== userId || session.touchedAt < Date.now() - TTL) {
    throw new AppError(404, 'not_found', '上传会话不存在或已过期，请重新上传');
  }
  if (session.busy) throw new AppError(409, 'upload_busy', '文件正在处理，请稍后重试');
  return session;
}

export async function startMaterialUpload(projectId: string, userId: string, input: { filename?: unknown; mime?: unknown; size?: unknown }) {
  if (typeof input.filename !== 'string' || !input.filename.trim() || input.filename.length > 255) {
    throw new AppError(400, 'bad_request', '文件名无效');
  }
  if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new AppError(400, 'bad_request', '文件大小无效');
  }
  if (input.size > MATERIAL_MAX_BYTES) throw new AppError(413, 'file_too_large', '单个物料文件不能超过 1 GB（1024 MB）');
  if ([...sessions.values()].filter((s) => s.userId === userId && s.touchedAt >= Date.now() - TTL).length >= 3) {
    throw new AppError(429, 'upload_limit', '同时上传的文件过多，请完成或取消其他上传后重试');
  }
  const id = crypto.randomUUID();
  const filename = path.join(dir, id);
  const session: UploadSession = {
    projectId, userId, filename: path.basename(input.filename),
    mime: typeof input.mime === 'string' && input.mime.length <= 255 ? input.mime : 'application/octet-stream',
    size: input.size, received: 0, path: filename, touchedAt: Date.now(), busy: false,
  };
  // 先登记，避免并发初始化绕过会话数量限制。
  sessions.set(id, session);
  try {
    await fs.promises.writeFile(filename, '', { flag: 'wx' });
  } catch (error) {
    sessions.delete(id);
    throw error;
  }
  return { uploadId: id, chunkSize: MATERIAL_CHUNK_BYTES };
}

export async function appendMaterialChunk(id: string, projectId: string, userId: string, offset: number, file: Express.Multer.File) {
  const session = ownSession(id, projectId, userId);
  if (!Number.isSafeInteger(offset) || offset !== session.received) {
    throw new AppError(409, 'upload_offset', '文件分片顺序不正确，请重新上传');
  }
  const expected = Math.min(MATERIAL_CHUNK_BYTES, session.size - session.received);
  if (file.size !== expected || expected === 0) throw new AppError(400, 'bad_request', '文件分片大小不正确');
  session.busy = true;
  try {
    await pipeline(fs.createReadStream(file.path), fs.createWriteStream(session.path, { flags: 'a' }));
    session.received += file.size;
    session.touchedAt = Date.now();
    return { received: session.received };
  } catch (error) {
    // 写入中断可能留下半片，回滚到已确认偏移。
    await fs.promises.truncate(session.path, session.received).catch(() => {});
    throw error;
  } finally {
    session.busy = false;
  }
}

/** 完整上传仅能消费一次，移出暂存目录后交给既有预览与存储管线。 */
export async function takeMaterialUpload(id: string, projectId: string, userId: string): Promise<Express.Multer.File> {
  const session = ownSession(id, projectId, userId);
  if (session.received !== session.size) throw new AppError(400, 'upload_incomplete', '文件尚未上传完整');
  session.busy = true;
  try {
    const filename = crypto.randomUUID() + path.extname(session.filename);
    const destination = path.resolve(config.uploadDir);
    const target = path.join(destination, filename);
    await fs.promises.rename(session.path, target);
    sessions.delete(id);
    return {
      fieldname: 'file', originalname: Buffer.from(session.filename, 'utf8').toString('latin1'),
      encoding: '7bit', mimetype: session.mime, size: session.size,
      destination, filename, path: target,
    } as Express.Multer.File;
  } finally {
    session.busy = false;
  }
}

export async function cancelMaterialUpload(id: string, projectId: string, userId: string) {
  const session = ownSession(id, projectId, userId);
  session.busy = true;
  try {
    await fs.promises.unlink(session.path);
    sessions.delete(id);
  } finally {
    session.busy = false;
  }
}
