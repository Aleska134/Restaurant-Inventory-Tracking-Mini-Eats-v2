import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Load .env from the backend root explicitly (not process.cwd()), so the key
// loads no matter how the process is launched (dev, detached, Railway).
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });
import express from 'express';
import cors from 'cors';
import { api } from './routes/api.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
app.use(cors({ origin: origins }));

app.use('/api', api);
app.get('/', (_req, res) => res.json({ service: 'barmade-backend', ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[barmade] API listening on http://localhost:${port}`);
});
