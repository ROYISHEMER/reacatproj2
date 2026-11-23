// Reddit official API (OAuth, app-only). Enabled only when REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET are set (create a "script" app at reddit.com/prefs/apps).
const SUBREDDITS = process.env.REDDIT_SUBREDDITS || 'stocks+wallstreetbets+investing+StockMarket+options';
const UA = 'stock-forecast-app/0.1';
let token = { value: null, expires: 0 };

export const redditEnabled = () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);

async function getToken() {
  if (token.value && token.expires > Date.now()) return token.value;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit auth failed: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Reddit auth failed: no token');
  token = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return token.value;
}

/** Map a Reddit listing response to plain posts. */
export function parseListing(json) {
  return (json?.data?.children || [])
    .map((c) => c.data)
    .filter((d) => d && d.title && !d.stickied)
    .map((d) => ({
      id: d.id,
      title: d.title,
      body: (d.selftext || '').slice(0, 500),
      subreddit: d.subreddit,
      score: d.score ?? 0,
      comments: d.num_comments ?? 0,
      createdAt: new Date(d.created_utc * 1000).toISOString(),
      url: `https://www.reddit.com${d.permalink}`,
    }));
}

/** Posts from the last week mentioning the ticker in investing subreddits. */
export async function getReddit(symbol) {
  const t = await getToken();
  const q = encodeURIComponent(`${symbol} OR $${symbol}`);
  const res = await fetch(
    `https://oauth.reddit.com/r/${SUBREDDITS}/search?q=${q}&restrict_sr=1&sort=new&t=week&limit=50&raw_json=1`,
    { headers: { Authorization: `Bearer ${t}`, 'User-Agent': UA }, signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} from oauth.reddit.com`);
  const safe = symbol.replace(/[.-]/g, (ch) => `\\${ch}`);
  const re = new RegExp(`(^|[^A-Za-z])\\$?${safe}([^A-Za-z]|$)`);
  return parseListing(await res.json()).filter((p) => re.test(p.title) || re.test(p.body));
}
