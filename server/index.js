import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { getMoversWithForecast, getStock, getTrackRecord, normalizeSymbol, search } from './service.js';

const app = express();
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    const notFound = /not exists|no data/i.test(e.message);
    res.status(e.status || (notFound ? 404 : 502)).json({ error: e.message });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/movers', wrap(() => getMoversWithForecast()));
app.get('/api/track-record', wrap(() => getTrackRecord()));
app.get(
  '/api/search',
  wrap((req) => {
    const q = String(req.query.q || '').trim().slice(0, 40);
    return q ? search(q) : [];
  }),
);
app.get(
  '/api/stock/:symbol',
  wrap((req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw Object.assign(new Error('Invalid symbol'), { status: 400 });
    return getStock(symbol);
  }),
);

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Stock forecast server on http://localhost:${port}`));
