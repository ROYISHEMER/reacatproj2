// Original analyses built on data the site already collects:
//  - historical twins: what happened after the past days most similar to today
//  - hype gap: how far the talk has run ahead of (or behind) the hard data
//  - earnings memory: how this stock actually reacted to its recent reports
//  - learned weights: factor weights adjusted by their measured hit rate
import { clamp, logReturns, mean, rsi, sma, stdev } from './indicators.js';

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

const START = 130; // first day with every feature available

/** Market-state fingerprint for each day (null before START). */
export function fingerprints(closes) {
  const rets = logReturns(closes);
  const out = new Array(closes.length).fill(null);
  for (let t = START; t < closes.length; t++) {
    const s20 = stdev(rets.slice(t - 20, t)) || 1e-4;
    const s120 = stdev(rets.slice(t - 120, t)) || 1e-4;
    const s50 = sma(closes, 50, t + 1);
    out[t] = [
      Math.log(closes[t] / closes[t - 20]) / (s120 * Math.sqrt(20)),
      Math.log(closes[t] / closes[t - 60]) / (s120 * Math.sqrt(60)),
      ((rsi(closes.slice(t - 40, t + 1)) ?? 50) - 50) / 20,
      (closes[t] / s50 - 1) / (s120 * 7),
      Math.log(s20 / s120) * 2,
      Math.log(closes[t] / closes[t - 5]) / (s120 * Math.sqrt(5)),
    ];
  }
  return out;
}

const dist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
};

/** The k most similar past days to day `t`, using only days whose outcome was known by then. */
function neighbours(fp, t, horizon, k) {
  const cands = [];
  for (let i = START; i <= t - horizon; i++) if (fp[i]) cands.push({ i, d: dist(fp[i], fp[t]) });
  cands.sort((a, b) => a.d - b.d);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.i - c.i) >= 5)) picked.push(c); // skip near-duplicate days
    if (picked.length >= k) break;
  }
  return picked;
}

/**
 * Historical twins of today. bars: [{date, close}] oldest first.
 * Returns what followed the most similar past situations, plus a walk-forward hit rate.
 */
export function historicalTwins(bars, { horizon = 20, k = 20 } = {}) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  if (n < START + horizon + 60) return null;
  const fp = fingerprints(closes);
  const fwd = (i) => closes[i + horizon] / closes[i] - 1;

  const today = neighbours(fp, n - 1, horizon, k);
  if (today.length < 8) return null;
  const outcomes = today.map((c) => fwd(c.i));
  const ups = outcomes.filter((r) => r > 0).length;

  // Walk-forward check: would the twins have called the direction on past days?
  let samples = 0;
  let hits = 0;
  let upDays = 0;
  for (let t = START + 100; t + horizon < n; t += 2) {
    const nb = neighbours(fp, t, horizon, k);
    if (nb.length < 8) continue;
    const upShare = nb.filter((c) => fwd(c.i) > 0).length / nb.length;
    if (Math.abs(upShare - 0.5) < 0.1) continue; // no call when the twins are split
    samples++;
    if (fwd(t) > 0) upDays++;
    if (upShare > 0.5 === fwd(t) > 0) hits++;
  }
  const hitRate = samples ? hits / samples : null;
  const upRate = ups / today.length;
  // The bar to clear is not a coin flip but the best constant guess ("it always goes up").
  const base = samples ? Math.max(upDays / samples, 1 - upDays / samples) : null;
  const edge = samples ? hitRate - base : null;
  const reliability = samples >= 40 ? clamp(edge / 0.08, 0, 1) : 0;

  return {
    horizon,
    count: today.length,
    ups,
    upRate,
    medianReturnPct: median(outcomes) * 100,
    lowPct: quantile(outcomes, 0.25) * 100,
    highPct: quantile(outcomes, 0.75) * 100,
    examples: today.slice(0, 5).map((c) => ({ date: bars[c.i].date, returnPct: fwd(c.i) * 100 })),
    backtest: { samples, hitRate, baseline: base, edge },
    reliability,
    // Enters the forecast only as far as it has worked on this stock.
    factor:
      reliability > 0
        ? { key: 'twins', evidence: 'tested', weight: 0.1 * reliability, score: clamp((upRate - 0.5) * 2 * (today.length / (today.length + 10)), -1, 1) }
        : null,
  };
}

/** Talk vs hard data. Positive gap = enthusiasm running ahead of the numbers. */
export function hypeGap({ news, social, buzz, factors = [] }) {
  const talkParts = [];
  if (news?.count) talkParts.push(news.score);
  if (social?.count) talkParts.push(social.score);
  if (buzz?.mentions && buzz.mentionsPrev) talkParts.push(Math.tanh(Math.log(buzz.mentions / buzz.mentionsPrev) / 1.5));
  const hard = factors.filter((f) => ['revisions', 'surprise', 'insiders', 'institutions'].includes(f.key));
  if (!talkParts.length || !hard.length) return null;
  const talk = mean(talkParts);
  const wSum = hard.reduce((s, f) => s + f.weight, 0);
  const data = hard.reduce((s, f) => s + f.score * f.weight, 0) / wSum;
  const gap = talk - data;
  return { talk, data, gap, state: gap > 0.4 ? 'hype' : gap < -0.4 ? 'quiet' : 'aligned', attention: buzz?.mentions ?? null };
}

/** How the stock moved after each recent earnings report. surprises newest first. */
export function earningsMemory(bars, surprises) {
  if (!surprises?.length || bars.length < 30) return null;
  const rows = [];
  for (const s of surprises) {
    if (!s.reported) continue;
    let i0 = -1;
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= s.reported) { i0 = i; break; }
    if (i0 < 0 || !bars[i0 + 1]) continue;
    const move = (k) => (bars[i0 + k] ? (bars[i0 + k].close / bars[i0].close - 1) * 100 : null);
    rows.push({ quarter: s.quarter, reported: s.reported, surprisePct: s.surprisePct, nextDayPct: move(1), fiveDayPct: move(5) });
  }
  if (!rows.length) return null;
  const withDay = rows.filter((r) => r.nextDayPct != null);
  return {
    rows,
    typicalMovePct: mean(withDay.map((r) => Math.abs(r.nextDayPct))),
    followedSurprise: withDay.filter((r) => Math.sign(r.nextDayPct) === Math.sign(r.surprisePct)).length,
    reports: withDay.length,
  };
}

/**
 * Per-factor weight multipliers from the live track record.
 * entries: [{symbol, date, price, f: {factorKey: score}}]; barsBySymbol: {symbol: [{date, close}]}.
 */
export function learnWeights(entries, barsBySymbol, { horizon = 20, minSamples = 30 } = {}) {
  const stats = {};
  for (const e of entries) {
    const bars = barsBySymbol[e.symbol];
    if (!bars || !e.f) continue;
    const idx = bars.findIndex((b) => b.date >= e.date);
    const later = idx >= 0 ? bars[idx + horizon] : null;
    if (!later) continue;
    const up = later.close > e.price;
    for (const [key, score] of Object.entries(e.f)) {
      if (Math.abs(score) < 0.1) continue;
      const s = (stats[key] ||= { samples: 0, hits: 0 });
      s.samples++;
      if (score > 0 === up) s.hits++;
    }
  }
  const out = {};
  for (const [key, s] of Object.entries(stats)) {
    // Shrink toward 50% so a small sample cannot swing a weight.
    const p = (s.hits + 10) / (s.samples + 20);
    out[key] = {
      samples: s.samples,
      hitRate: s.hits / s.samples,
      multiplier: s.samples >= minSamples ? clamp(1 + (p - 0.5) * 4, 0.5, 1.5) : 1,
    };
  }
  return out;
}
