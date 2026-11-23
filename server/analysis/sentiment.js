// Small finance-specific sentiment lexicon for headlines and short posts.
const POS = `beat beats beating surge surges surged soar soars soared jump jumps jumped rally rallies rallied
gain gains gained rise rises rose climb climbs climbed upgrade upgrades upgraded outperform buy bullish record
strong stronger growth grows profit profits profitable raise raises raised boost boosts boosted approval approved
approves win wins won breakthrough expand expands expansion partnership tops topped exceed exceeds exceeded
optimistic upbeat rebound rebounds recovery momentum breakout moon calls long undervalued opportunity launch
launches unveils dividend buyback accelerate accelerates robust positive higher up`.split(/\s+/);
const NEG = `miss misses missed plunge plunges plunged drop drops dropped fall falls fell slump slumps slumped
sink sinks sank tumble tumbles tumbled slide slides slid decline declines declined downgrade downgrades
downgraded underperform sell bearish weak weaker loss losses cut cuts lawsuit sued sues probe investigation
recall recalls delay delays delayed warning warns warned layoffs layoff bankruptcy fraud crash crashes crashed
risk risks concern concerns fear fears worries worry disappointing disappoints halt halted dilution offering
puts short overvalued bubble dump tariff tariffs ban banned fine fined negative lower down slowdown slowing`.split(/\s+/);
const NEGATORS = new Set(['not', 'no', "n't", 'never', 'without', 'despite', 'fails', 'fail', 'failed']);

const pos = new Set(POS);
const neg = new Set(NEG);

/** Score text in [-1, 1]. 0 = neutral / no signal words. */
export function scoreText(text) {
  const words = (text || '').toLowerCase().replace(/n't/g, " n't").match(/[a-z']+/g) || [];
  let score = 0;
  let hits = 0;
  for (let i = 0; i < words.length; i++) {
    let v = pos.has(words[i]) ? 1 : neg.has(words[i]) ? -1 : 0;
    if (!v) continue;
    if (NEGATORS.has(words[i - 1]) || NEGATORS.has(words[i - 2])) v = -v;
    score += v;
    hits++;
  }
  return hits ? score / hits : 0;
}

export const label = (s) => (s > 0.2 ? 'positive' : s < -0.2 ? 'negative' : 'neutral');

/**
 * Recency-weighted aggregate. items: [{score, at}] (at = ISO date).
 * Returns score in [-1,1] shrunk toward 0 when there are few items.
 */
export function aggregate(items, { halfLifeDays = 3, now = Date.now() } = {}) {
  let wSum = 0;
  let sSum = 0;
  let positive = 0;
  let negative = 0;
  for (const it of items) {
    const ageDays = Math.max(0, (now - new Date(it.at).getTime()) / 86400000);
    const w = 0.5 ** (ageDays / halfLifeDays);
    wSum += w;
    sSum += w * it.score;
    if (it.score > 0.2) positive++;
    else if (it.score < -0.2) negative++;
  }
  const raw = wSum ? sSum / wSum : 0;
  const shrink = wSum / (wSum + 3);
  return { score: raw * shrink, count: items.length, positive, negative, neutral: items.length - positive - negative };
}
