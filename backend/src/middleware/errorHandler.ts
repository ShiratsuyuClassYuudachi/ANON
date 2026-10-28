import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { MulterError } from 'multer';
import { AppError } from '../utils/errors';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof MulterError) {
    const limit = req.path.includes('/materials/uploads/') ? '8 MB' : req.path.includes('/materials') ? '1 GB（1024 MB）' : '20 MB';
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: { code: err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'bad_request', message: err.code === 'LIMIT_FILE_SIZE' ? `文件超过允许的大小（${limit}）` : '上传文件格式或数量不正确' },
    });
    return;
  }
  if ((err as NodeJS.ErrnoException)?.code === 'ENOSPC') {
    res.status(507).json({ error: { code: 'storage_full', message: '服务器存储空间不足，无法上传文件' } });
    return;
  }
  if (err instanceof MongooseError.CastError) {
    res.status(400).json({ error: { code: 'bad_request', message: '无效的资源 ID' } });
    return;
  }
  if (err instanceof MongooseError.ValidationError) {
    res.status(400).json({ error: { code: 'bad_request', message: '请求数据无效' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: '服务器内部错误' } });
}
