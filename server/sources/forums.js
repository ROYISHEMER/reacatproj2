// Public discussion sources that need no account:
// Hacker News (stories + comments), Mastodon (hashtag timeline), Lemmy (post search),
// and ApeWisdom (how often a ticker is mentioned across retail-investor forums).
import { fetchJson } from '../http.js';

const WEEK_MS = 7 * 86400000;
const strip = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function parseHackerNews(json) {
  return (json?.hits || [])
    .map((h) => {
      const isComment = (h._tags || []).includes('comment');
      const text = isComment ? strip(h.comment_text) : h.title;
      if (!text) return null;
      return {
        id: `hn-${h.objectID}`,
        source: 'Hacker News',
        text: text.slice(0, 400),
        context: isComment ? h.story_title || null : null,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        createdAt: h.created_at,
        score: h.points ?? 0,
      };
    })
    .filter(Boolean);
}

export function parseMastodon(json) {
  return (Array.isArray(json) ? json : [])
    .filter((s) => !s.language || s.language === 'en')
    .map((s) => ({
      id: `masto-${s.id}`,
      source: 'Mastodon',
      text: strip(s.content).slice(0, 400),
      context: null,
      url: s.url,
      createdAt: s.created_at,
      score: (s.favourites_count ?? 0) + (s.reblogs_count ?? 0),
    }))
    .filter((p) => p.text);
}

export function parseLemmy(json) {
  return (json?.posts || []).map((v) => ({
    id: `lemmy-${v.post.id}`,
    source: 'Lemmy',
    text: v.post.name.slice(0, 400),
    context: v.community?.name ? `c/${v.community.name}` : null,
    url: v.post.ap_id,
    createdAt: v.post.published,
    score: v.counts?.score ?? 0,
  }));
}

const recent = (posts) => posts.filter((p) => Date.now() - new Date(p.createdAt).getTime() < WEEK_MS);

/** Forum posts from the last week about a company. Each source fails on its own. */
export async function getForums(symbol, shortName) {
  const since = Math.floor((Date.now() - WEEK_MS) / 1000);
  const name = encodeURIComponent(shortName);
  const ttl = { ttlMs: 300000 };
  const jobs = [
    fetchJson(
      `https://hn.algolia.com/api/v1/search_by_date?query=${name}&tags=(story,comment)&numericFilters=created_at_i%3E${since}&hitsPerPage=40`,
      ttl,
    ).then(parseHackerNews),
    fetchJson(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(symbol.replace(/[^A-Za-z0-9]/g, ''))}?limit=30`, ttl).then(parseMastodon),
    fetchJson(`https://lemmy.world/api/v3/search?q=${name}%20stock&type_=Posts&sort=New&limit=20`, ttl).then(parseLemmy),
  ];
  const names = ['Hacker News', 'Mastodon', 'Lemmy'];
  const settled = await Promise.allSettled(jobs);
  const posts = [];
  const failed = [];
  const counts = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const items = recent(r.value);
      counts[names[i]] = items.length;
      posts.push(...items);
    } else failed.push(names[i]);
  });
  posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { posts, counts, failed };
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

/** Top tickers by forum mentions in the last 24h. */
export async function getBuzzRanking() {
  const pages = await Promise.all(
    [1, 2].map((p) => fetchJson(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${p}`, { ttlMs: 900000 }).catch(() => null)),
  );
  if (!pages[0]) throw new Error('ApeWisdom unavailable');
  return pages
    .filter(Boolean)
    .flatMap((p) => p.results || [])
    .map((r) => ({
      symbol: r.ticker,
      name: decode(r.name),
      rank: r.rank,
      mentions: Number(r.mentions) || 0,
      mentionsPrev: Number(r.mentions_24h_ago) || 0,
      upvotes: Number(r.upvotes) || 0,
      rankPrev: r.rank_24h_ago ?? null,
    }));
}

export async function getBuzz(symbol) {
  const all = await getBuzzRanking();
  return all.find((r) => r.symbol === symbol) || null;
}
