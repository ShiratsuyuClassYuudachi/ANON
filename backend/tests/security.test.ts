import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { createSuperAdmin } from './helpers';

describe('API 缓存隔离', () => {
  it('登录凭证与个人资料响应禁止浏览器和代理缓存', async () => {
    const { token } = await createSuperAdmin();
    const login = await request(app).post('/api/auth/login').send({
      email: 'admin@example.com', password: 'password123',
    });
    expect(login.status).toBe(200);
    expect(login.headers['cache-control']).toBe('no-store');
    expect(login.headers.vary).toContain('Authorization');

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('刷新后的新凭证也禁止缓存', async () => {
    await createSuperAdmin();
    const login = await request(app).post('/api/auth/login').send({
      email: 'admin@example.com', password: 'password123',
    });
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
  });

  it('鉴权失败和请求解析失败同样禁止缓存', async () => {
    const unauthorized = await request(app).get('/api/me');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['cache-control']).toBe('no-store');
    expect(unauthorized.headers.vary).toContain('Authorization');

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const malformed = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"password":"private-password",');
      expect(malformed.status).toBe(400);
      expect(malformed.headers['cache-control']).toBe('no-store');
      expect(malformed.body.error.code).toBe('bad_request');
      expect(JSON.stringify(malformed.body)).not.toContain('private-password');
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('超限 JSON 返回 413，且不记录或回显请求内容', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const oversized = await request(app).post('/api/auth/login').send({ password: 'x'.repeat(2 * 1024 * 1024) });
      expect(oversized.status).toBe(413);
      expect(oversized.body.error.code).toBe('payload_too_large');
      expect(oversized.headers['cache-control']).toBe('no-store');
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
