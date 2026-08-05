import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { AppError } from '../utils/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
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
