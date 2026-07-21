import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { filesRouter, projectFilesRouter } from './routes/files';
import { invitesRouter } from './routes/invites';
import { meRouter } from './routes/me';
import { projectsRouter } from './routes/projects';

export const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/projects/:id/files', projectFilesRouter);
app.use('/api/files', filesRouter);

app.use(errorHandler);
