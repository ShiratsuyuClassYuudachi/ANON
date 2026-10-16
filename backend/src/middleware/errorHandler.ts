import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { AppError } from '../utils/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // body-parser 错误携带原始 body，直接记录会把登录密码等内容写入日志。
  if (err && typeof err === 'object' && 'type' in err) {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_request', message: '请求体必须是有效的 JSON' } });
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'payload_too_large', message: '请求内容过大' } });
      return;
    }
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
