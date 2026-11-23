// Assembles data from all sources into API responses.
import { mapLimit } from './http.js';
import * as nasdaq from './sources/nasdaq.js';
import * as fund from './sources/fundamentals.js';
import { getNews, shortName } from './sources/news.js';
import { getBuzz, getBuzzRanking, getForums } from './sources/forums.js';
import { getSocial } from './sources/stocktwits.js';
import { getReddit, redditEnabled } from './sources/reddit.js';
import { aggregate, label, scoreText } from './analysis/sentiment.js';
import { extractEvents } from './analysis/events.js';
import { buildForecast } from './analysis/forecast.js';
import { buildFactors } from './analysis/factors.js';
import { record, trackRecord } from './tracker.js';
import { getEconomicCalendar, getPredictionMarkets, getSectorCloses, getYields } from './sources/macro.js';
import { earningsMemory, historicalTwins, hypeGap } from './analysis/insights.js';
import { analyzeNews } from './ai/analyst.js';
import { aiConfig, aiStatus } from './ai/client.js';

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;
export const normalizeSymbol = (s) => {
  const sym = String(s || '').trim().toUpperCase();
  return SYMBOL_RE.test(sym) ? sym : null;
};

/** Settle a source call; record failures instead of failing the whole page. */
async function attempt(name, promise, errors) {
  try {
    return await promise;
  } catch (e) {
    errors.push({ source: name, message: e.message });
    return null;
  }
}

const barsAnyClass = async (symbol) => {
  try {
    return await nasdaq.getHistory(symbol, 'stocks');
  } catch {
    return nasdaq.getHistory(symbol, 'etf');
  }
};
const marketCloses = async () => (await nasdaq.getHistory('SPY', 'etf')).map((b) => b.close);

const moversCache = { at: 0, value: null };

export async function getMoversWithForecast() {
  if (moversCache.value && Date.now() - moversCache.at < 5 * 60000) return moversCache.value;
  const movers = await nasdaq.getMovers();
  // Most-discussed tickers in retail forums, priced from Nasdaq.
  try {
    const top = (await getBuzzRanking()).filter((r) => normalizeSymbol(r.symbol)).slice(0, 12);
    const quotes = await mapLimit(top, 4, (r) => nasdaq.getQuote(r.symbol));
    movers.lists.buzz = top
      .map((r, i) =>
        quotes[i]
          ? { symbol: r.symbol, name: quotes[i].name, price: quotes[i].price, change: quotes[i].change, changePct: quotes[i].changePct, volume: quotes[i].volume, mentions: r.mentions, mentionsPrev: r.mentionsPrev }
          : null,
      )
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    movers.lists.buzz = [];
  }
  const symbols = [...new Set(Object.values(movers.lists).flat().map((r) => r.symbol))];
  const quick = new Map();
  await mapLimit(symbols, 4, async (symbol) => {
    const bars = await barsAnyClass(symbol);
    const f = buildForecast(bars.map((b) => b.close), { withBacktest: false });
    if (f) {
      const h = f.horizons.find((x) => x.days === 20);
      quick.set(symbol, { direction: f.direction, probUp: h.probUp, expectedReturnPct: h.expectedReturnPct, volatilityPct: f.annualVolatilityPct });
    }
  });
  for (const list of Object.values(movers.lists)) for (const r of list) r.forecast = quick.get(r.symbol) || null;
  moversCache.at = Date.now();
  moversCache.value = movers;
  return movers;
}

export async function getStock(symbol) {
  const errors = [];
  const quote = await nasdaq.getQuote(symbol); // throws if the symbol is unknown
  const ac = quote.assetClass;
  const isStock = ac === 'stocks';
  const stockOnly = (name, fn) => (isStock ? attempt(name, fn(), errors) : null);

  const [
    bars, summary, analysts, earningsForecast, earningsDate, filings, profile, news, social, reddit, forums, buzz,
    market, revisions, surprises, insiders, institutions, shortInterest, options, margins, yields, markets, calendar,
  ] = await Promise.all([
    attempt('history', nasdaq.getHistory(symbol, ac), errors),
    attempt('summary', nasdaq.getSummary(symbol, ac), errors),
    stockOnly('analysts', () => nasdaq.getAnalysts(symbol)),
    stockOnly('earningsForecast', () => nasdaq.getEarningsForecast(symbol)),
    stockOnly('earningsDate', () => nasdaq.getEarningsDate(symbol)),
    stockOnly('filings', () => nasdaq.getFilings(symbol)),
    stockOnly('profile', () => nasdaq.getProfile(symbol)),
    attempt('news', getNews(symbol, quote.name), errors),
    attempt('social', getSocial(symbol), errors),
    redditEnabled() ? attempt('reddit', getReddit(symbol), errors) : null,
    attempt('forums', getForums(symbol, shortName(symbol, quote.name)), errors),
    attempt('buzz', getBuzz(symbol), errors),
    attempt('market', marketCloses(), errors),
    stockOnly('revisions', () => fund.getRevisions(symbol)),
    stockOnly('surprises', () => fund.getSurprises(symbol)),
    stockOnly('insiders', () => fund.getInsiders(symbol)),
    stockOnly('institutions', () => fund.getInstitutions(symbol)),
    stockOnly('shortInterest', () => fund.getShortInterest(symbol)),
    attempt('options', fund.getOptions(symbol, ac), errors),
    stockOnly('margins', () => fund.getMargins(symbol)),
    attempt('yields', getYields(), errors),
    attempt('predictionMarkets', getPredictionMarkets(), errors),
    attempt('calendar', getEconomicCalendar(), errors),
  ]);

  // Second wave: needs the sector name and the collected headlines.
  const aiOn = aiConfig().enabled;
  const [sector, ai] = await Promise.all([
    summary?.sector ? attempt('sector', getSectorCloses(summary.sector), errors) : null,
    aiOn && news?.length ? attempt('ai', analyzeNews({ symbol, company: quote.name, news }), errors) : null,
  ]);

  // With Claude available its reading replaces the word-list score; irrelevant headlines count for less.
  const newsItems = (news || []).map((n, i) => {
    const read = ai?.byIndex.get(i);
    const score = read ? read.sentiment * read.relevance : scoreText(n.title);
    return { ...n, sentiment: score, sentimentLabel: label(score), ai: read ? { eventType: read.eventType, eventDate: read.eventDate, product: read.product, relevance: read.relevance } : null };
  });
  const newsAgg = aggregate(newsItems.map((n) => ({ score: n.sentiment, at: n.publishedAt })), { halfLifeDays: 4 });

  const posts = (social?.messages || []).map((m) => {
    const score = m.tag === 'Bullish' ? 1 : m.tag === 'Bearish' ? -1 : scoreText(m.body);
    return { ...m, sentiment: score, sentimentLabel: label(score) };
  });
  const redditPosts = (reddit || []).map((r) => {
    const score = scoreText(`${r.title}. ${r.body}`);
    return { ...r, sentiment: score, sentimentLabel: label(score) };
  });
  const forumPosts = (forums?.posts || []).map((p) => {
    const score = scoreText(p.text);
    return { ...p, sentiment: score, sentimentLabel: label(score) };
  });
  for (const name of forums?.failed || []) errors.push({ source: name, message: 'unavailable' });
  const socialAgg = aggregate(
    [...posts, ...redditPosts, ...forumPosts].map((p) => ({ score: p.sentiment, at: p.createdAt })),
    { halfLifeDays: 1.5 },
  );

  const events = ai ? aiEvents(newsItems) : extractEvents(newsItems);
  if (earningsDate) {
    events.unshift({
      type: 'earnings',
      title: earningsDate.confirmed ? 'Earnings report' : 'Earnings report (estimated date)',
      url: null,
      source: 'Nasdaq',
      publishedAt: null,
      date: earningsDate.date,
      dateText: null,
      precision: 'day',
      upcoming: earningsDate.date >= new Date().toISOString().slice(0, 10),
    });
  }

  // Use the live price as the latest point if the market has moved since the last daily bar.
  const closes = (bars || []).map((b) => b.close);
  const today = new Date().toISOString().slice(0, 10);
  const series = (bars || []).map((b) => ({ date: b.date, close: b.close, volume: b.volume }));
  if (quote.price && series.length && series[series.length - 1].date < today && quote.marketStatus !== 'Closed') {
    closes.push(quote.price);
    series.push({ date: today, close: quote.price, volume: quote.volume });
  }

  const factors = buildFactors({ closes, marketCloses: market, sectorCloses: sector?.closes, revisions, surprises, insiders, institutions, shortInterest, options });
  const twins = series.length ? historicalTwins(series) : null;
  if (twins?.factor) factors.push(twins.factor);
  const forecast = buildForecast(closes, { news: newsAgg, social: socialAgg, analysts, factors, multipliers: await learnedMultipliers() });
  const hype = hypeGap({ news: newsAgg, social: socialAgg, buzz, factors });
  const memory = earningsMemory(series, surprises);
  record(symbol, forecast);

  // How much evidence stands behind this page.
  const sources = [
    ['Nasdaq · מחירים', series.length],
    ['Nasdaq · אנליסטים ותחזיות', (analysts ? analysts.buy + analysts.hold + analysts.sell : 0) + (earningsForecast?.quarterly?.length || 0)],
    ['Nasdaq · דוחות, בעלי עניין, מוסדיים, שורט, אופציות', [revisions, surprises?.length, insiders, institutions, shortInterest, options, margins].filter(Boolean).length],
    ['חדשות (Google, Bing, Nasdaq)', newsItems.length],
    ['Stocktwits', posts.length],
    ['Hacker News', forums?.counts?.['Hacker News'] || 0],
    ['Mastodon', forums?.counts?.Mastodon || 0],
    ['Lemmy', forums?.counts?.Lemmy || 0],
    ['ApeWisdom', buzz ? 1 : 0],
    ['Reddit', redditPosts.length],
    ['SEC (דיווחים)', filings?.length || 0],
    ['משרד האוצר האמריקאי (תשואות)', yields ? 1 : 0],
    ['Polymarket (שוקי חיזוי)', markets?.length || 0],
    ['לוח אירועים כלכליים', calendar?.length || 0],
  ].map(([name, items]) => ({ name, items, ok: items > 0 }));
  const coverage = {
    sources,
    active: sources.filter((s) => s.ok).length,
    total: sources.length,
    dataPoints: sources.reduce((s, x) => s + x.items, 0),
    factors: forecast?.signals.length || 0,
  };

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    quote,
    summary,
    profile,
    analysts,
    earningsForecast,
    history: series.slice(-260),
    forecast,
    coverage,
    ai: {
      enabled: aiOn,
      used: Boolean(ai),
      model: ai?.model || null,
      headlinesRead: ai?.covered || 0,
      view: ai?.view || null,
      error: errors.find((e) => e.source === 'ai')?.message || null,
    },
    insights: { twins: twins && { ...twins, factor: undefined }, hype, earningsMemory: memory },
    macro: { yields, predictionMarkets: markets || [], calendar: calendar || [], sectorEtf: sector?.etf || null },
    details: { revisions, surprises: (surprises || []).slice(0, 4), insiders, institutions, shortInterest, options, margins },
    news: { aggregate: newsAgg, items: newsItems.slice(0, 30) },
    social: { aggregate: socialAgg, watchers: social?.watchers ?? null, items: posts.slice(0, 15) },
    reddit: { enabled: redditEnabled(), items: redditPosts.slice(0, 12) },
    forums: { counts: forums?.counts || {}, items: forumPosts.slice(0, 20) },
    buzz,
    events,
    filings: filings || [],
    errors,
  };
}

/** Events as read by Claude: typed, dated and tied to the headline they came from. */
function aiEvents(newsItems, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const out = newsItems
    .filter((n) => n.ai && n.ai.eventType !== 'none' && n.ai.relevance >= 0.5)
    .map((n) => ({
      type: n.ai.eventType,
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.publishedAt,
      date: n.ai.eventDate,
      dateText: null,
      precision: n.ai.eventDate ? 'day' : null,
      product: n.ai.product,
      upcoming: n.ai.eventDate ? n.ai.eventDate >= today : false,
    }));
  const rank = (e) => (e.upcoming ? 0 : e.date ? 1 : 2);
  return out
    .sort((a, b) => rank(a) - rank(b) || (a.upcoming ? (a.date < b.date ? -1 : 1) : a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, 25);
}

// Factor weight multipliers learned from the live track record, refreshed hourly.
const learnedCache = { at: 0, value: {} };
async function learnedMultipliers() {
  if (Date.now() - learnedCache.at < 3600000) return learnedCache.value;
  learnedCache.at = Date.now();
  try {
    const { learned } = await trackRecord(barsAnyClass);
    learnedCache.value = Object.fromEntries(Object.entries(learned).map(([k, v]) => [k, v.multiplier]));
  } catch {
    learnedCache.value = {};
  }
  return learnedCache.value;
}

export const getTrackRecord = () => trackRecord(barsAnyClass);
export const getAiStatus = () => aiStatus();
export const search = (q) => nasdaq.search(q);
