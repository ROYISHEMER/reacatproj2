import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsMemory, fingerprints, historicalTwins, hypeGap, learnWeights } from '../server/analysis/insights.js';
import { parsePolymarket, parseYieldXml, sectorEtf } from '../server/sources/macro.js';
import { sectorFactor } from '../server/analysis/factors.js';
import { buildForecast } from '../server/analysis/forecast.js';
import { AiError, aiStatus, completeJson } from '../server/ai/client.js';
import { analyzeNews, normalise, SCHEMA } from '../server/ai/analyst.js';

function bars(n, drift, vol, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out = [];
  let close = 100;
  const d = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < n; i++) {
    close *= Math.exp(drift + vol * rnd());
    d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10), close });
  }
  return out;
}

test('historical twins use only past days and report a baseline', () => {
  assert.equal(historicalTwins(bars(150, 0, 0.01)), null);
  const b = bars(520, 0.0005, 0.015, 11);
  const t = historicalTwins(b);
  assert.equal(t.count, 20);
  assert.equal(t.ups, Math.round(t.upRate * t.count));
  assert.ok(t.lowPct <= t.medianReturnPct && t.medianReturnPct <= t.highPct);
  // Every twin must be old enough for its outcome to be known today.
  const lastKnown = b[b.length - 1 - t.horizon].date;
  for (const e of t.examples) assert.ok(e.date <= lastKnown);
  assert.ok(t.backtest.baseline >= 0.5);
  assert.ok(t.reliability >= 0 && t.reliability <= 1);
  if (t.reliability === 0) assert.equal(t.factor, null);
  const fp = fingerprints(b.map((x) => x.close));
  assert.equal(fp[10], null);
  assert.equal(fp[fp.length - 1].length, 6);
});

test('hype gap separates talk from hard data', () => {
  const hard = (score) => [{ key: 'revisions', weight: 0.18, score }, { key: 'surprise', weight: 0.12, score }];
  const hot = hypeGap({ news: { score: 0.8, count: 30 }, social: { score: 0.9, count: 50 }, buzz: { mentions: 900, mentionsPrev: 100 }, factors: hard(-0.5) });
  assert.equal(hot.state, 'hype');
  const quiet = hypeGap({ news: { score: -0.2, count: 10 }, factors: hard(0.8) });
  assert.equal(quiet.state, 'quiet');
  assert.equal(hypeGap({ news: { score: 0.3, count: 5 }, factors: hard(0.3) }).state, 'aligned');
  assert.equal(hypeGap({ news: { score: 0, count: 0 }, factors: hard(0.3) }), null);
});

test('earnings memory measures the move after each report', () => {
  const b = Array.from({ length: 40 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, close: i < 10 ? 100 : 110 }));
  const m = earningsMemory(b, [{ quarter: 'Q3', reported: '2026-10-10', surprisePct: 5 }, { quarter: 'old', reported: '2020-01-01', surprisePct: 1 }]);
  assert.equal(m.rows.length, 1);
  assert.ok(Math.abs(m.rows[0].nextDayPct - 10) < 1e-9);
  assert.equal(m.followedSurprise, 1);
  assert.equal(earningsMemory(b, []), null);
});

test('learned weights reward factors that were right and ignore small samples', () => {
  const b = Array.from({ length: 80 }, (_, i) => ({ date: `d${String(i).padStart(3, '0')}`, close: 100 + i }));
  const entries = Array.from({ length: 40 }, (_, i) => ({ symbol: 'X', date: `d${String(i).padStart(3, '0')}`, price: 100 + i, f: { good: 0.5, bad: -0.5, flat: 0.01 } }));
  const w = learnWeights(entries, { X: b });
  assert.equal(w.good.hitRate, 1);
  assert.ok(w.good.multiplier > 1 && w.good.multiplier <= 1.5);
  assert.ok(w.bad.multiplier < 1 && w.bad.multiplier >= 0.5);
  assert.equal(w.flat, undefined);
  assert.equal(learnWeights(entries.slice(0, 5), { X: b }).good.multiplier, 1);
  const closes = bars(300, 0.001, 0.01).map((x) => x.close);
  const base = buildForecast(closes, { news: { score: 0.5, count: 9 }, withBacktest: false });
  const scaled = buildForecast(closes, { news: { score: 0.5, count: 9 }, multipliers: { news: 1.5 }, withBacktest: false });
  const share = (f) => f.signals.find((s) => s.key === 'news').weightPct;
  assert.ok(share(scaled) > share(base));
});

test('macro parsers', () => {
  const xml = `<feed><entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-11-20T00:00:00</d:NEW_DATE><d:BC_3MONTH m:type="Edm.Double">4.37</d:BC_3MONTH><d:BC_2YEAR m:type="Edm.Double">4.63</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">4.92</d:BC_10YEAR></m:properties></content></entry></feed>`;
  assert.deepEqual(parseYieldXml(xml), [{ date: '2026-11-20', y2: 4.63, y10: 4.92, m3: 4.37 }]);
  const pm = parsePolymarket({ events: [
    { title: 'Fed cuts?', volume: '50', slug: 'fed', endDate: '2027-01-01T00:00:00Z', markets: [{ question: 'No cuts', outcomePrices: '["0.9","0.1"]', closed: false }, { question: 'One cut', outcomePrices: '["0.05","0.95"]', closed: false }, { question: 'Done', outcomePrices: '["1","0"]', closed: true }] },
    { title: 'All closed', markets: [{ question: 'x', outcomePrices: '["1","0"]', closed: true }] },
  ] });
  assert.equal(pm.length, 1);
  assert.equal(pm[0].leading, 'No cuts');
  assert.equal(pm[0].probability, 0.9);
  assert.equal(sectorEtf('Technology'), 'XLK');
  assert.equal(sectorEtf('Unknown'), null);
  assert.equal(sectorFactor(null), null);
  assert.equal(sectorFactor(bars(300, 0.003, 0.004).map((x) => x.close)).key, 'sector');
});

// --- Claude layer, exercised with a fake client (no API key, no network) ---
const fakeClient = (message, calls = []) => ({
  beta: { messages: { stream: (params) => { calls.push(params); return { finalMessage: async () => (typeof message === 'function' ? message() : message) }; } } },
});
const reply = (obj, extra = {}) => ({ stop_reason: 'end_turn', model: 'claude-fable-5-2', usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }], ...extra });
const GOOD = {
  headlines: [
    { i: 0, sentiment: 0.8, relevance: 1, event_type: 'product', event_date: '2026-12-05', product: 'Widget 2' },
    { i: 1, sentiment: -5, relevance: 0.1, event_type: 'bogus', event_date: 'next week', product: null },
    { i: 9, sentiment: 0, relevance: 0, event_type: 'none', event_date: null, product: null },
  ],
  thesis_he: 'תזה', bull_case_he: ['א'], bear_case_he: [], watch_he: ['ב'], certainty: 'medium',
};
const NEWS = [{ title: 'Acme to launch Widget 2 on December 5', source: 'Wire', publishedAt: '2026-11-20T00:00:00Z' }, { title: 'Markets mixed', source: 'Wire', publishedAt: '2026-11-19T00:00:00Z' }];

test('AI request shape and output validation', async () => {
  const calls = [];
  const res = await analyzeNews({ symbol: 'ACME', company: 'Acme Inc', news: NEWS }, { client: fakeClient(reply(GOOD), calls), noDisk: true });
  const p = calls[0];
  assert.equal(p.model, 'claude-fable-5-2');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.format.schema, SCHEMA);
  assert.equal(p.thinking, undefined, 'thinking is always on for this model and must not be configured');
  assert.match(p.messages[0].content, /0\. \[2026-11-20\] Acme to launch Widget 2/);
  assert.equal(res.cached, false);
  assert.equal(res.covered, 2, 'out-of-range index is dropped');
  assert.deepEqual(res.byIndex.get(0), { sentiment: 0.8, relevance: 1, eventType: 'product', eventDate: '2026-12-05', product: 'Widget 2' });
  assert.deepEqual(res.byIndex.get(1), { sentiment: -1, relevance: 0.1, eventType: 'none', eventDate: null, product: null });
  assert.equal(res.view.certainty, 'medium');

  // Same headlines again: served from cache, no second API call.
  const again = await analyzeNews({ symbol: 'ACME', company: 'Acme Inc', news: NEWS }, { client: fakeClient(reply(GOOD), calls), noDisk: true });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
  assert.ok(aiStatus().cacheHits >= 1);
  assert.equal(normalise({}, 3).covered, 0);
});

test('AI failures surface as typed errors', async () => {
  const req = { system: 's', user: 'u', schema: SCHEMA };
  await assert.rejects(completeJson(req, { client: fakeClient(reply({}, { stop_reason: 'refusal', content: [] })) }), (e) => e instanceof AiError && e.code === 'refusal');
  await assert.rejects(completeJson(req, { client: fakeClient(reply({}, { stop_reason: 'max_tokens' })) }), (e) => e.code === 'truncated');
  await assert.rejects(completeJson(req, { client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }) }), (e) => e.code === 'invalid_json');
  await assert.rejects(completeJson(req, { client: fakeClient(() => { throw new Error('boom'); }) }), (e) => e.code === 'unknown');
  await assert.rejects(completeJson(req), (e) => e.code === 'disabled', 'no key and no injected client');
  const before = process.env.AI_DAILY_CALL_LIMIT;
  process.env.AI_DAILY_CALL_LIMIT = '0';
  await assert.rejects(completeJson(req, { client: fakeClient(reply({})) }), (e) => e.code === 'budget');
  if (before === undefined) delete process.env.AI_DAILY_CALL_LIMIT; else process.env.AI_DAILY_CALL_LIMIT = before;
  assert.ok(aiStatus().errors >= 4);
});
