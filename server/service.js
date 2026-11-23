// Assembles data from all sources into API responses.
import { mapLimit } from './http.js';
import * as nasdaq from './sources/nasdaq.js';
import { getNews, shortName } from './sources/news.js';
import { getBuzz, getBuzzRanking, getForums } from './sources/forums.js';
import { getSocial } from './sources/stocktwits.js';
import { getReddit, redditEnabled } from './sources/reddit.js';
import { aggregate, label, scoreText } from './analysis/sentiment.js';
import { extractEvents } from './analysis/events.js';
import { buildForecast } from './analysis/forecast.js';

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
    let bars;
    try {
      bars = await nasdaq.getHistory(symbol, 'stocks');
    } catch {
      bars = await nasdaq.getHistory(symbol, 'etf');
    }
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

  const [bars, summary, analysts, earningsForecast, earningsDate, filings, profile, news, social, reddit, forums, buzz] = await Promise.all([
    attempt('history', nasdaq.getHistory(symbol, ac), errors),
    attempt('summary', nasdaq.getSummary(symbol, ac), errors),
    isStock ? attempt('analysts', nasdaq.getAnalysts(symbol), errors) : null,
    isStock ? attempt('earningsForecast', nasdaq.getEarningsForecast(symbol), errors) : null,
    isStock ? attempt('earningsDate', nasdaq.getEarningsDate(symbol), errors) : null,
    isStock ? attempt('filings', nasdaq.getFilings(symbol), errors) : null,
    isStock ? attempt('profile', nasdaq.getProfile(symbol), errors) : null,
    attempt('news', getNews(symbol, quote.name), errors),
    attempt('social', getSocial(symbol), errors),
    redditEnabled() ? attempt('reddit', getReddit(symbol), errors) : null,
    attempt('forums', getForums(symbol, shortName(symbol, quote.name)), errors),
    attempt('buzz', getBuzz(symbol), errors),
  ]);

  const newsItems = (news || []).map((n) => {
    const score = scoreText(n.title);
    return { ...n, sentiment: score, sentimentLabel: label(score) };
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

  const events = extractEvents(newsItems);
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

  const forecast = buildForecast(closes, { news: newsAgg, social: socialAgg, analysts });

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

export const search = (q) => nasdaq.search(q);
