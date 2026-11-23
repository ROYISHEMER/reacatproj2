// Reddit posts about a ticker. Works without any account: reads Reddit's public JSON.
// If REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set, uses the official OAuth API instead.
// Set REDDIT_DISABLED=1 to switch the source off.
const SUBREDDITS = process.env.REDDIT_SUBREDDITS || 'stocks+wallstreetbets+investing+StockMarket+options';
const UA = 'stock-forecast-app/0.1';
let token = { value: null, expires: 0 };

const hasKeys = () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
export const redditEnabled = () => process.env.REDDIT_DISABLED !== '1';

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
  const q = encodeURIComponent(`${symbol} OR $${symbol}`);
  const query = `q=${q}&restrict_sr=1&sort=new&t=week&limit=50&raw_json=1`;
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  let url = `https://www.reddit.com/r/${SUBREDDITS}/search.json?${query}`;
  if (hasKeys()) {
    headers.Authorization = `Bearer ${await getToken()}`;
    url = `https://oauth.reddit.com/r/${SUBREDDITS}/search?${query}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const safe = symbol.replace(/[.-]/g, (ch) => `\\${ch}`);
  const re = new RegExp(`(^|[^A-Za-z])\\$?${safe}([^A-Za-z]|$)`);
  return parseListing(await res.json()).filter((p) => re.test(p.title) || re.test(p.body));
}
