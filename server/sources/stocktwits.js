// Stocktwits public stream: retail-trader posts, some self-tagged Bullish/Bearish.
import { fetchJson } from '../http.js';

const decode = (t) =>
  t.replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export async function getSocial(symbol) {
  const data = await fetchJson(
    `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`,
    { ttlMs: 300000 },
  );
  return {
    watchers: data.symbol?.watchlist_count ?? null,
    messages: (data.messages || []).map((m) => ({
      id: m.id,
      body: decode(m.body || ''),
      createdAt: m.created_at,
      tag: m.entities?.sentiment?.basic || null, // "Bullish" | "Bearish" | null
      likes: m.likes?.total ?? 0,
      user: m.user?.username || null,
    })),
  };
}
