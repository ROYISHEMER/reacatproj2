export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

/** Simple moving average of the last n values (null if not enough data). */
export function sma(closes, n, end = closes.length) {
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += closes[i];
  return s / n;
}

/** Full EMA series. */
export function emaSeries(values, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/** Wilder RSI over the last n periods. */
export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(closes) {
  if (closes.length < 35) return null;
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const signal = emaSeries(line, 9);
  const i = closes.length - 1;
  return { macd: line[i], signal: signal[i], hist: line[i] - signal[i] };
}

/** Standard normal CDF (Abramowitz-Stegun approximation). */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
