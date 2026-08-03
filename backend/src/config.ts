import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? '';
if (isProd && !jwtSecret) throw new Error('生产环境必须配置 JWT_SECRET');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/anon',
  jwtSecret: jwtSecret || 'dev-only-insecure-secret',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  // S3 对象存储：endpoint 为空时回退到本地磁盘（uploadDir）
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? 'anon-files',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
  },
  cronSecret: process.env.CRON_SECRET ?? '',
  superAdminEmail: (process.env.SUPER_ADMIN_EMAIL ?? '').toLowerCase(),
  // 试用模式账号邮箱：该邮箱 + 任意 ≥8 位密码登录进入独立演示环境；置空禁用
  trialEmail: (process.env.TRIAL_EMAIL ?? 'admin@test.com').toLowerCase(),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  // Web Push（VAPID）：公/私钥未配置时推送渠道静默禁用，不影响其他渠道
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:anon@localhost',
  },
};
