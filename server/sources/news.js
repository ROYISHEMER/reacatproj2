// Google News RSS: recent headlines about a ticker / company.
import { fetchText } from '../http.js';

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function parseRss(xml, fallbackSource = null) {
  const items = [];
  for (const m of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
    const tag = (t) => {
      const r = new RegExp(`<${t}[^>]*>(.*?)</${t}>`, 's').exec(m[1]);
      return r ? decode(r[1]).trim() : null;
    };
    const source = tag('source') || tag('News:Source') || fallbackSource;
    let title = tag('title') || '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    const date = new Date(tag('pubDate') || '');
    if (!title || Number.isNaN(date.getTime())) continue;
    items.push({ title, url: unwrapLink(tag('link')), source, publishedAt: date.toISOString() });
  }
  return items;
}

// Bing wraps article links in a redirect; use the real article URL.
function unwrapLink(link) {
  if (!link || !link.includes('bing.com/news/apiclick')) return link;
  try {
    return new URL(link).searchParams.get('url') || link;
  } catch {
    return link;
  }
}

const bing = async (q) =>
  parseRss(await fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`), 'Bing News');
const nasdaqNews = async (symbol) =>
  parseRss(await fetchText(`https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(symbol)}`), 'Nasdaq');

async function query(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  return parseRss(await fetchText(url));
}

// Pages that are quote/landing pages rather than news.
const NOISE = /stock price, news, quote|price today|overview -|stock quote|historical prices|options chain/i;

/** Headlines for a symbol: general coverage plus a product/launch-focused query. */
export const shortName = (symbol, companyName) =>
  (companyName || symbol)
    .replace(/,?\s+(Inc|Corp|Corporation|Ltd|Limited|PLC|Holdings|Group|Co|Company|N\.V\.|S\.A\.)\.?.*$/i, '')
    .trim();

export async function getNews(symbol, companyName) {
  const short = shortName(symbol, companyName);
  const results = await Promise.allSettled([
    query(`${symbol} stock when:14d`),
    query(`"${short}" (launch OR unveil OR release OR announces OR approval OR guidance) when:30d`),
    bing(`${symbol} stock`),
    nasdaqNews(symbol),
  ]);
  const cutoff = Date.now() - 30 * 86400000;
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
      if (seen.has(key) || NOISE.test(item.title) || new Date(item.publishedAt).getTime() < cutoff) continue;
      // Must actually mention the company or ticker.
      const t = item.title.toLowerCase();
      if (!t.includes(short.toLowerCase()) && !new RegExp(`\\b${symbol}\\b`).test(item.title)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, 80);
}
