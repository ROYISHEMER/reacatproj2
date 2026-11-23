// Live track record: every forecast served is logged once per symbol per day, and scored
// against the real price once its horizon has passed. This is the honest accuracy measure,
// because it covers the full model (news and forum signals included), not only the back-test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { learnWeights } from './analysis/insights.js';

const DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DIR, 'predictions.jsonl');
const HORIZONS = [5, 20];
let seen = null;

function load() {
  try {
    return fs
      .readFileSync(FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function record(symbol, forecast, date = new Date().toISOString().slice(0, 10)) {
  if (!forecast) return;
  if (!seen) seen = new Set(load().map((e) => `${e.symbol}|${e.date}`));
  const key = `${symbol}|${date}`;
  if (seen.has(key)) return;
  seen.add(key);
  const p = (d) => forecast.horizons.find((h) => h.days === d)?.probUp ?? null;
  // Factor scores are kept so the system can later measure which factors actually worked.
  const f = Object.fromEntries(forecast.signals.map((s) => [s.key, Math.round(s.score * 100) / 100]));
  const entry = { date, symbol, price: forecast.price, p5: p(5), p20: p(20), f };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Read-only disk: tracking is best-effort.
  }
}

/** Score logged forecasts. bars: [{date, close}] oldest first. Pure, for testing. */
export function score(entries, barsBySymbol) {
  const stats = HORIZONS.map((days) => ({ days, matured: 0, hits: 0, brier: 0 }));
  for (const e of entries) {
    const bars = barsBySymbol[e.symbol];
    if (!bars) continue;
    const idx = bars.findIndex((b) => b.date >= e.date);
    if (idx < 0) continue;
    for (const s of stats) {
      const prob = e[`p${s.days}`];
      const later = bars[idx + s.days];
      if (prob == null || !later) continue;
      const up = later.close > e.price;
      s.matured++;
      if (prob >= 0.5 === up) s.hits++;
      s.brier += (prob - (up ? 1 : 0)) ** 2;
    }
  }
  return stats.map((s) => ({
    days: s.days,
    matured: s.matured,
    hitRate: s.matured ? s.hits / s.matured : null,
    brier: s.matured ? s.brier / s.matured : null,
    brierSkill: s.matured ? 1 - s.brier / s.matured / 0.25 : null,
  }));
}

export async function trackRecord(getBars) {
  const entries = load();
  const symbols = [...new Set(entries.map((e) => e.symbol))].slice(0, 40);
  const barsBySymbol = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        barsBySymbol[s] = await getBars(s);
      } catch {
        // skip symbols whose history is unavailable
      }
    }),
  );
  return {
    logged: entries.length,
    symbols: symbols.length,
    since: entries.length ? entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date) : null,
    horizons: score(entries, barsBySymbol),
    learned: learnWeights(entries, barsBySymbol),
  };
}
