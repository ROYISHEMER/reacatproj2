// Forecast model: combines technical signals (back-tested per stock), news and social
// sentiment and analyst consensus into a probabilistic price outlook.
import { clamp, logReturns, macd, mean, normCdf, rsi, sma, stdev } from './indicators.js';

export const HORIZONS = [5, 20, 60]; // trading days
const MIN_BARS = 60;
const SIGNAL_STRENGTH = 0.08; // a full-strength signal shifts daily drift by this many daily sigmas
const BASE_WEIGHTS = { technical: 0.3, analysts: 0.12, news: 0.14, social: 0.05 };
/** Probability of a rise over `h` days implied by a signal score alone. */
const signalProb = (score, h) => normCdf(SIGNAL_STRENGTH * score * Math.sqrt(h));

/** Technical score in [-1, 1] from price history (oldest first). */
export function technicalScore(closes) {
  const n = closes.length;
  if (n < MIN_BARS) return null;
  const price = closes[n - 1];
  const sigma = stdev(logReturns(closes.slice(-61))) || 1e-4;
  const parts = {};

  const mom = (k) => (n > k ? Math.tanh(Math.log(price / closes[n - 1 - k]) / (sigma * Math.sqrt(k)) / 2) : 0);
  parts.momentum20 = mom(20);
  parts.momentum60 = mom(60);

  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  let trend = 0;
  if (s50) trend += 0.5 * Math.tanh((price / s50 - 1) / (sigma * 5));
  if (s50 && s200) trend += 0.5 * Math.tanh((s50 / s200 - 1) / (sigma * 10));
  else if (s50) trend *= 2;
  parts.trend = clamp(trend, -1, 1);

  const m = macd(closes);
  parts.macd = m ? Math.tanh(m.hist / (price * sigma)) : 0;

  const r = rsi(closes);
  parts.rsi = r == null ? 0 : r > 70 ? -(r - 70) / 30 : r < 30 ? (30 - r) / 30 : 0;

  const score =
    0.25 * parts.momentum20 + 0.2 * parts.momentum60 + 0.25 * parts.trend + 0.15 * parts.macd + 0.15 * parts.rsi;
  return { score: clamp(score, -1, 1), parts, rsi: r, sma50: s50, sma200: s200, macd: m };
}

/**
 * Walk-forward test of the technical signal on this stock's own history:
 * at each past day, score using only data up to that day, compare with what happened next.
 */
export function backtest(closes, horizon) {
  let n = 0;
  let hits = 0;
  let ups = 0;
  let brier = 0;
  for (let t = 200; t + horizon < closes.length; t++) {
    const ts = technicalScore(closes.slice(0, t + 1));
    if (!ts || Math.abs(ts.score) < 0.1) continue;
    const up = closes[t + horizon] > closes[t];
    n++;
    if (up) ups++;
    if (ts.score > 0 === up) hits++;
    brier += (signalProb(ts.score, horizon) - (up ? 1 : 0)) ** 2;
  }
  if (!n) return { horizon, samples: 0, hitRate: null, upRate: null, brier: null, brierSkill: null };
  // Brier score: mean squared error of the probability. A coin flip scores 0.25; skill > 0 beats it.
  return { horizon, samples: n, hitRate: hits / n, upRate: ups / n, brier: brier / n, brierSkill: 1 - brier / n / 0.25 };
}

function analystScore(analysts, price) {
  if (!analysts || !price) return null;
  const total = analysts.buy + analysts.hold + analysts.sell;
  const gap = analysts.targetMean ? Math.tanh((analysts.targetMean / price - 1) / 0.2) : null;
  const balance = total ? (analysts.buy - analysts.sell) / total : null;
  if (gap == null && balance == null) return null;
  if (gap == null) return balance;
  if (balance == null) return gap;
  return 0.6 * gap + 0.4 * balance;
}

/**
 * @param closes   daily closes, oldest first
 * @param inputs   { news: {score,count}, social: {score,count}, analysts, withBacktest }
 */
export function buildForecast(closes, inputs = {}) {
  if (!closes || closes.length < MIN_BARS) return null;
  const price = closes[closes.length - 1];
  const rets = logReturns(closes);
  const recent = rets.slice(-60);
  const long = rets.slice(-250);
  // Blend recent and long-run volatility so one calm month doesn't understate risk.
  const sigma = Math.sqrt(0.6 * stdev(recent) ** 2 + 0.4 * stdev(long) ** 2) || 1e-4;

  const tech = technicalScore(closes);
  const tests = inputs.withBacktest === false ? [] : [backtest(closes, 5), backtest(closes, 20)];
  const bt20 = tests.find((t) => t.horizon === 20);
  // Trust the technical signal only as far as it has actually worked on this stock.
  let reliability = 0.5;
  if (bt20 && bt20.samples >= 60) reliability = clamp((bt20.hitRate - 0.45) / 0.15, 0, 1);

  const signals = [];
  const add = (key, score, weight, detail) => {
    if (score == null || Number.isNaN(score)) return;
    signals.push({ key, score: clamp(score, -1, 1), weight, ...detail });
  };
  add('technical', tech.score, BASE_WEIGHTS.technical * (0.3 + 0.7 * reliability), { reliability, evidence: 'strong' });
  add('analysts', analystScore(inputs.analysts, price), BASE_WEIGHTS.analysts, { evidence: 'moderate' });
  if (inputs.news?.count) add('news', inputs.news.score, BASE_WEIGHTS.news, { count: inputs.news.count, evidence: 'moderate' });
  if (inputs.social?.count) add('social', inputs.social.score, BASE_WEIGHTS.social, { count: inputs.social.count, evidence: 'weak' });
  for (const f of inputs.factors || []) add(f.key, f.score, f.weight, { evidence: f.evidence });

  const wSum = signals.reduce((s, x) => s + x.weight, 0);
  const combined = wSum ? signals.reduce((s, x) => s + x.score * x.weight, 0) / wSum : 0;
  for (const s of signals) s.weightPct = wSum ? (s.weight / wSum) * 100 : 0;
  // Share of the model's weight that points the same way as the final call.
  const active = signals.filter((s) => Math.abs(s.score) >= 0.1);
  const activeW = active.reduce((s, x) => s + x.weight, 0);
  const agreement = activeW ? active.filter((s) => Math.sign(s.score) === Math.sign(combined)).reduce((s, x) => s + x.weight, 0) / activeW : null;

  // Daily drift: heavily shrunk historical mean + signal tilt.
  const histMu = clamp(mean(long) * 0.2, -0.0008, 0.0008);
  const mu = histMu + SIGNAL_STRENGTH * combined * sigma;

  const Z80 = 1.2816;
  const horizons = HORIZONS.map((h) => {
    const m = mu * h;
    const s = sigma * Math.sqrt(h);
    return {
      days: h,
      expectedReturnPct: (Math.exp(m) - 1) * 100,
      probUp: normCdf(m / s),
      target: price * Math.exp(m),
      low: price * Math.exp(m - Z80 * s),
      high: price * Math.exp(m + Z80 * s),
    };
  });

  const path = [];
  for (let d = 1; d <= 60; d++) {
    const m = mu * d;
    const s = sigma * Math.sqrt(d);
    path.push({ day: d, mid: price * Math.exp(m), low: price * Math.exp(m - Z80 * s), high: price * Math.exp(m + Z80 * s) });
  }

  const p20 = horizons[1].probUp;
  const agree = signals.length > 1 && agreement != null && agreement >= 0.7;
  let conf = Math.abs(p20 - 0.5) >= 0.09 ? 2 : Math.abs(p20 - 0.5) >= 0.04 ? 1 : 0;
  if (conf > 0 && !agree) conf--;
  if (conf > 0 && (closes.length < 250 || (bt20?.samples >= 60 && bt20.hitRate < 0.5))) conf--;

  return {
    price,
    direction: p20 > 0.53 ? 'up' : p20 < 0.47 ? 'down' : 'flat',
    confidence: ['low', 'medium', 'high'][conf],
    combinedScore: combined,
    agreement,
    dailyVolatilityPct: sigma * 100,
    annualVolatilityPct: sigma * Math.sqrt(252) * 100,
    horizons,
    path,
    signals,
    technical: { rsi: tech.rsi, sma50: tech.sma50, sma200: tech.sma200, macdHist: tech.macd?.hist ?? null, parts: tech.parts },
    backtest: tests,
    bars: closes.length,
  };
}
