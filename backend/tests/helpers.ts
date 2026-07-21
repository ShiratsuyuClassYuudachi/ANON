import request from 'supertest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';

export async function createSuperAdmin(email = 'admin@example.com') {
  process.env.SUPER_ADMIN_EMAIL = email;
  // 重新加载 config 的 superAdminEmail
  const { config } = await import('../src/config');
  config.superAdminEmail = email;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, name: 'Admin', password: 'password123' });
  if (res.status !== 201) throw new Error(`seed admin failed: ${JSON.stringify(res.body)}`);
  return res.body as { token: string; user: { id: string } };
}

export async function createInviteCode(adminToken: string, code = 'CODE-1') {
  await InviteCode.create({ code, createdBy: (await User.findOne())!._id });
  return code;
}

export async function registerUser(code: string, email: string, name = 'User') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ inviteCode: code, email, name, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return res.body as { token: string; user: { id: string; email: string } };
}
