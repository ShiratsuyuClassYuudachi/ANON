import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { accountsRouter } from './routes/accounts';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { cronRouter } from './routes/cron';
import { filesRouter, projectFilesRouter } from './routes/files';
import { financeRouter } from './routes/finance';
import { invitesRouter } from './routes/invites';
import { materialsRouter } from './routes/materials';
import { meRouter } from './routes/me';
import { projectsRouter } from './routes/projects';
import { todosRouter } from './routes/todos';

export const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/projects/:id/files', projectFilesRouter);
app.use('/api/projects/:id/todos', todosRouter);
app.use('/api/projects/:id/finance', financeRouter);
app.use('/api/projects/:id/materials', materialsRouter);
app.use('/api/projects/:id/accounts', accountsRouter);
app.use('/api/files', filesRouter);
app.use('/api/cron', cronRouter);

app.use(errorHandler);
