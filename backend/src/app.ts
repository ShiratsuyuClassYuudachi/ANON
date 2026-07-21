import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { authRequired } from './middleware/auth';
import { publicUser } from './models/User';
import { authRouter } from './routes/auth';

export const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
// 最小化的受保护接口，完整的 GET/PATCH /api/me 由后续任务实现
app.get('/api/me', authRequired, (req, res) => res.json({ user: publicUser(req.user!) }));

app.use(errorHandler);
