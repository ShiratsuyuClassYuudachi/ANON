import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';
import { accountsRouter } from './routes/accounts';
import { activitiesRouter } from './routes/activities';
import { adminRouter } from './routes/admin';
import { announcementsRouter } from './routes/announcements';
import { authRouter } from './routes/auth';
import { cronRouter } from './routes/cron';
import { customToolsRouter } from './routes/customTools';
import { dashboardRouter } from './routes/dashboard';
import { filesRouter, projectFilesRouter } from './routes/files';
import { financeRouter } from './routes/finance';
import { invitesRouter } from './routes/invites';
import { lostFoundRouter, publicLostFoundRouter } from './routes/lostFound';
import { materialsRouter } from './routes/materials';
import { meRouter } from './routes/me';
import { milestonesRouter } from './routes/milestones';
import { onsiteRouter } from './routes/onsite';
import { openRouter } from './routes/open';
import { projectsRouter } from './routes/projects';
import { pushRouter } from './routes/push';
import { physicalRouter } from './routes/physical';
import { risksRouter } from './routes/risks';
import { stagesRouter } from './routes/stages';
import { stageRundownsRouter, publicRundownScreenRouter } from './routes/stageRundowns';
import { stageSignupsRouter } from './routes/stageSignups';
import { todosRouter } from './routes/todos';
import { workModulesRouter } from './routes/workModules';
import { workSheetRouter } from './routes/workSheet';

export const app = express();
app.set('trust proxy', 1); // nginx 单跳代理，取真实客户端 IP 供限流
app.use(helmet({ contentSecurityPolicy: false })); // CSP 由 nginx 对静态页下发；API 不需要
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 认证端点限流：登录/注册/试用登录/refresh/logout，50 次/15 分钟/IP
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // 测试单进程同 IP 大量登录，跳过
  message: { error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试' } },
});
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);
app.use('/api/open', openRouter);
app.use('/api/push', pushRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/projects/:id/files', projectFilesRouter);
app.use('/api/projects/:id/todos', todosRouter);
app.use('/api/projects/:id/work-modules', workModulesRouter);
app.use('/api/projects/:id/work-sheet', workSheetRouter);
app.use('/api/projects/:id/finance', financeRouter);
app.use('/api/projects/:id/materials', materialsRouter);
app.use('/api/projects/:id/physical', physicalRouter);
app.use('/api/projects/:id/accounts', accountsRouter);
app.use('/api/projects/:id/dashboard', dashboardRouter);
app.use('/api/projects/:id/onsite', onsiteRouter);
app.use('/api/projects/:id/risks', risksRouter);
app.use('/api/projects/:id/announcements', announcementsRouter);
app.use('/api/projects/:id/activities', activitiesRouter);
app.use('/api/projects/:id/stages', stagesRouter);
app.use('/api/projects/:id/stage-rundowns', stageRundownsRouter);
app.use('/api/projects/:id/stage-signups', stageSignupsRouter);
app.use('/api/projects/:id/custom-tools', customToolsRouter);
app.use('/api/projects/:id/lostfound', lostFoundRouter);
app.use('/api/projects/:id/milestones', milestonesRouter);
// 公开免登录端点限流：300 次/分钟/IP（观众同 NAT 出口 + 列表带图，过紧会误伤）
const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试' } },
});
app.use('/api/public/lostfound', publicLimiter, publicLostFoundRouter);
app.use('/api/public/rundown-screen', publicLimiter, publicRundownScreenRouter);
app.use('/api/files', filesRouter);
app.use('/api/cron', cronRouter);

app.use(errorHandler);
