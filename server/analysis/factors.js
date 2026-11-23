// Turns raw datasets into scored forecast factors.
// Weights follow how well each signal has held up in published research:
// earnings revisions, earnings surprises (post-earnings drift) and momentum are the
// best documented; insider selling, short interest and options positioning are weak.
import { clamp } from './indicators.js';
import { technicalScore } from './forecast.js';

const ret = (closes, k) => (closes.length > k ? closes[closes.length - 1] / closes[closes.length - 1 - k] - 1 : null);

export function revisionsFactor(rev) {
  if (!rev) return null;
  const chg = rev.yearChangePct ?? rev.quarterChangePct;
  const total = rev.up + rev.down;
  if (chg == null && !total) return null;
  const level = chg == null ? 0 : Math.tanh(chg / 3);
  const breadth = total ? (rev.up - rev.down) / total : 0;
  return { key: 'revisions', evidence: 'strong', weight: 0.18, score: 0.6 * level + 0.4 * breadth };
}

export function surpriseFactor(surprises, now = Date.now()) {
  if (!surprises?.length) return null;
  const last = surprises[0];
  const avg = surprises.slice(0, 4).reduce((s, r) => s + r.surprisePct, 0) / Math.min(4, surprises.length);
  const days = last.reported ? (now - new Date(last.reported).getTime()) / 86400000 : 45;
  const fresh = Math.exp(-Math.max(0, days) / 60); // drift fades over roughly a quarter
  const score = (0.7 * Math.tanh(last.surprisePct / 10) + 0.3 * Math.tanh(avg / 10)) * (0.4 + 0.6 * fresh);
  return { key: 'surprise', evidence: 'strong', weight: 0.12, score, daysSince: Math.round(days) };
}

export function marketFactor(marketCloses) {
  const t = marketCloses && technicalScore(marketCloses);
  if (!t) return null;
  return { key: 'market', evidence: 'moderate', weight: 0.08, score: t.score };
}

export function relativeStrengthFactor(closes, marketCloses) {
  const a = ret(closes, 60);
  const b = marketCloses && ret(marketCloses, 60);
  if (a == null || b == null) return null;
  return { key: 'relative', evidence: 'moderate', weight: 0.07, score: Math.tanh((a - b) / 0.15), excessPct: (a - b) * 100 };
}

export function insidersFactor(ins) {
  if (!ins || ins.buys3m + ins.sells3m === 0) return null;
  // Open-market buying is informative; routine selling mostly is not.
  let score = 0;
  if (ins.buys3m > 0) score = Math.min(1, ins.buys3m / 3) * (ins.sharesBought3m >= ins.sharesSold3m ? 1 : 0.5);
  else if (ins.sells3m >= 10) score = -0.2;
  return { key: 'insiders', evidence: 'weak', weight: 0.04, score };
}

export function institutionsFactor(inst) {
  if (!inst || !(inst.increasedShares + inst.decreasedShares)) return null;
  const net = (inst.increasedShares - inst.decreasedShares) / (inst.increasedShares + inst.decreasedShares);
  return { key: 'institutions', evidence: 'weak', weight: 0.04, score: Math.tanh(net * 2) };
}

export function shortFactor(si) {
  if (!si || si.changePct == null) return null;
  return { key: 'short', evidence: 'weak', weight: 0.03, score: -Math.tanh(si.changePct / 20) };
}

export function optionsFactor(opt) {
  if (!opt || opt.putCallVolume == null) return null;
  // Around 0.7 puts per call is typical for single stocks.
  return { key: 'options', evidence: 'weak', weight: 0.03, score: clamp(-Math.tanh((opt.putCallVolume - 0.7) / 0.5), -1, 1) };
}

export function buildFactors({ closes, marketCloses, revisions, surprises, insiders, institutions, shortInterest, options }) {
  return [
    revisionsFactor(revisions),
    surpriseFactor(surprises),
    marketFactor(marketCloses),
    relativeStrengthFactor(closes, marketCloses),
    insidersFactor(insiders),
    institutionsFactor(institutions),
    shortFactor(shortInterest),
    optionsFactor(options),
  ].filter(Boolean);
}
