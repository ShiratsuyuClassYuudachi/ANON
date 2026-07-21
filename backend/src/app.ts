import express from 'express';
import { errorHandler } from './middleware/errorHandler';

export const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(errorHandler);
