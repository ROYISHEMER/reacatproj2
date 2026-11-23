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

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
    const tag = (t) => {
      const r = new RegExp(`<${t}[^>]*>(.*?)</${t}>`, 's').exec(m[1]);
      return r ? decode(r[1]).trim() : null;
    };
    const source = tag('source');
    let title = tag('title') || '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    const date = new Date(tag('pubDate') || '');
    if (!title || Number.isNaN(date.getTime())) continue;
    items.push({ title, url: tag('link'), source, publishedAt: date.toISOString() });
  }
  return items;
}

async function query(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  return parseRss(await fetchText(url));
}

// Pages that are quote/landing pages rather than news.
const NOISE = /stock price, news, quote|price today|overview -|stock quote|historical prices|options chain/i;

/** Headlines for a symbol: general coverage plus a product/launch-focused query. */
export async function getNews(symbol, companyName) {
  const short = (companyName || symbol)
    .replace(/,?\s+(Inc|Corp|Corporation|Ltd|Limited|PLC|Holdings|Group|Co|Company|N\.V\.|S\.A\.)\.?.*$/i, '')
    .trim();
  const results = await Promise.allSettled([
    query(`${symbol} stock when:14d`),
    query(`"${short}" (launch OR unveil OR release OR announces OR approval OR guidance) when:30d`),
  ]);
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
      if (seen.has(key) || NOISE.test(item.title)) continue;
      // Must actually mention the company or ticker.
      const t = item.title.toLowerCase();
      if (!t.includes(short.toLowerCase()) && !new RegExp(`\\b${symbol}\\b`).test(item.title)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, 60);
}
