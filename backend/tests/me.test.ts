import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { createSuperAdmin } from './helpers';

describe('me', () => {
  it('GET /api/me 返回当前用户', async () => {
    const { token } = await createSuperAdmin();
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('PATCH /api/me 更新姓名与联系方式', async () => {
    const { token } = await createSuperAdmin();
    const res = await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '新名字', contacts: [{ platform: 'QQ', value: '12345' }] });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('新名字');
    expect(res.body.user.contacts).toEqual([{ platform: 'QQ', value: '12345' }]);
  });
});
