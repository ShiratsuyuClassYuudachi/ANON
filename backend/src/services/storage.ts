import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { setTimeout as delay } from 'timers/promises';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Response } from 'express';
import type { Types } from 'mongoose';
import { config } from '../config';
import { fixFilename } from '../middleware/upload';
import { File, type FileDoc } from '../models/File';

/**
 * 文件存储抽象：配置了 S3_ENDPOINT 时写入 S3 兼容对象存储，否则写本地磁盘。
 * 数据库中的引用（File.path / ResourceVersion.previewPath）：
 *   本地 → 绝对路径（与历史数据兼容）；S3 → "s3:<key>"
 */

const S3_PREFIX = 's3:';

export function s3Enabled(): boolean {
  return !!(config.s3.endpoint && config.s3.accessKey && config.s3.secretKey);
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
      forcePathStyle: true, // MinIO 等自建服务需要 path-style
    });
  }
  return _client;
}

export function isS3Ref(ref: string): boolean {
  return ref.startsWith(S3_PREFIX);
}

/** 将 multer 上传的文件落入最终存储并创建 File 文档（S3 模式下暂存文件随上传删除） */
export async function persistUploads(
  files: Express.Multer.File[],
  projectId: Types.ObjectId,
  userId: string | Types.ObjectId | undefined,
): Promise<FileDoc[]> {
  if (!files.length) return [];
  const refs = await Promise.all(
    files.map((f) => storeFile(f.path, `${projectId.toString()}/${path.basename(f.path)}`, f.mimetype)),
  );
  return File.insertMany(
    files.map((f, i) => ({
      projectId,
      filename: fixFilename(f.originalname),
      path: refs[i],
      mime: f.mimetype,
      size: f.size,
      uploadedBy: userId as Types.ObjectId,
    })),
  );
}

/** 启动时确保 bucket 存在；失败仅告警（MinIO 可能尚未就绪，首个写入时会再试） */
export async function initStorage(retries = 5): Promise<void> {
  if (!s3Enabled()) return;
  for (let i = 0; i < retries; i++) {
    try {
      await client().send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
      return;
    } catch (e) {
      const code = e instanceof S3ServiceException ? e.name : '';
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') return;
      if (i === retries - 1) {
        console.warn(`[storage] 无法确认 S3 bucket ${config.s3.bucket}（${(e as Error).message}），首次上传时将重试`);
        return;
      }
      await delay(2000);
    }
  }
}

async function putWithBucketRetry(key: string, body: PutObjectCommand['input']['Body'], mime: string) {
  try {
    await client().send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: mime }));
  } catch (e) {
    if (e instanceof S3ServiceException && e.name === 'NoSuchBucket') {
      await client().send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
      await client().send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: mime }));
      return;
    }
    throw e;
  }
}

/** 本地目录写入（本地模式专用），返回绝对路径 */
async function storeLocal(key: string, buf: Buffer): Promise<string> {
  const p = path.resolve(config.uploadDir, key);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, buf);
  return p;
}

/**
 * 将 multer 暂存的本地文件落入最终存储，返回持久化引用。
 * S3 模式：上传后删除暂存文件；本地模式：原地保留（与历史行为一致）。
 */
export async function storeFile(tmpPath: string, key: string, mime: string): Promise<string> {
  if (!s3Enabled()) return path.resolve(tmpPath);
  await putWithBucketRetry(key, fs.createReadStream(tmpPath), mime);
  await fs.promises.unlink(tmpPath).catch(() => {});
  return S3_PREFIX + key;
}

/** 存储内存缓冲（预览图等），返回持久化引用 */
export async function storeBuffer(buf: Buffer, key: string, mime: string): Promise<string> {
  if (!s3Enabled()) return storeLocal(key, buf);
  await putWithBucketRetry(key, buf, mime);
  return S3_PREFIX + key;
}

/** 删除存储对象；本地引用按文件删除，S3 引用按对象删除，不存在则忽略 */
export async function deleteStored(ref: string): Promise<void> {
  if (!isS3Ref(ref)) {
    await fs.promises.unlink(path.resolve(ref)).catch(() => {});
    return;
  }
  if (!s3Enabled()) return;
  await client()
    .send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: ref.slice(S3_PREFIX.length) }))
    .catch(() => {});
}

/** 发送存储对象到响应：本地下载走 res.download/sendFile，S3 走流式转发 */
export async function sendStoredFile(res: Response, ref: string, downloadName?: string): Promise<void> {
  if (!isS3Ref(ref)) {
    const p = path.resolve(ref);
    if (downloadName) res.download(p, downloadName);
    else res.sendFile(p);
    return;
  }
  const obj = await client().send(
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: ref.slice(S3_PREFIX.length) }),
  );
  res.setHeader('Content-Type', obj.ContentType ?? 'application/octet-stream');
  if (obj.ContentLength !== undefined) res.setHeader('Content-Length', String(obj.ContentLength));
  if (downloadName) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    );
  }
  (obj.Body as Readable).pipe(res);
}
