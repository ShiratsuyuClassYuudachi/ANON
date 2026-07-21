import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? '';
if (isProd && !jwtSecret) throw new Error('生产环境必须配置 JWT_SECRET');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/anon',
  jwtSecret: jwtSecret || 'dev-only-insecure-secret',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  cronSecret: process.env.CRON_SECRET ?? '',
  superAdminEmail: (process.env.SUPER_ADMIN_EMAIL ?? '').toLowerCase(),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
};
