import test from 'node:test';
import assert from 'node:assert/strict';
import { rsi, sma, normCdf } from '../server/analysis/indicators.js';
import { scoreText, aggregate } from '../server/analysis/sentiment.js';
import { extractDate, extractEvents, classify } from '../server/analysis/events.js';
import { buildForecast, backtest, technicalScore } from '../server/analysis/forecast.js';
import { parseRss } from '../server/sources/news.js';
import { parseListing, redditEnabled } from '../server/sources/reddit.js';
import { parseHackerNews, parseLemmy, parseMastodon } from '../server/sources/forums.js';
import { num } from '../server/sources/nasdaq.js';
import { normalizeSymbol } from '../server/service.js';

// Deterministic pseudo-random walk.
function series(n, drift, vol, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp(drift + vol * rnd()));
  return out;
}

test('indicators', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
  assert.ok(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)) < 1);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
});

test('sentiment', () => {
  assert.ok(scoreText('Nvidia shares surge after earnings beat') > 0);
  assert.ok(scoreText('Tesla stock plunges on recall and lawsuit') < 0);
  assert.ok(scoreText('Company did not beat estimates') < 0);
  assert.equal(scoreText('Apple holds annual meeting'), 0);
  const now = Date.parse('2026-11-20T00:00:00Z');
  const a = aggregate([{ score: 1, at: '2026-11-19T00:00:00Z' }, { score: -1, at: '2026-10-01T00:00:00Z' }], { now });
  assert.ok(a.score > 0, 'recent items dominate');
  assert.equal(aggregate([]).score, 0);
});

test('event extraction', () => {
  const pub = '2026-11-20T12:00:00Z';
  assert.equal(extractDate('Apple to launch new iPad on December 5', pub).date, '2026-12-05');
  assert.equal(extractDate('Launch set for Jan. 14', pub).date, '2027-01-14');
  assert.equal(extractDate('Chip arrives in Q2 2027', pub).date, '2027-04-01');
  assert.equal(extractDate('Robotaxi expected in 2027', pub).date, '2027-01-01');
  assert.equal(extractDate('Nothing dated here', pub), null);
  assert.equal(extractDate('MacBook Neo 2 May Launch Earlier', pub), null);
  assert.equal(extractDate('Event on 2 May 2027', pub).date, '2027-05-02');
  assert.equal(classify('Tesla unveils new Model Y'), 'product');
  assert.equal(classify('FDA approval granted to Pfizer drug'), 'regulatory');
  assert.equal(classify('Markets were quiet'), null);
  const ev = extractEvents(
    [
      { title: 'Apple reports earnings beat', publishedAt: pub },
      { title: 'Apple to launch headset on December 5', publishedAt: pub },
    ],
    new Date(pub),
  );
  assert.equal(ev[0].type, 'product');
  assert.equal(ev[0].upcoming, true);
});

test('forecast shape and sanity', () => {
  assert.equal(buildForecast(series(30, 0, 0.01)), null);
  const f = buildForecast(series(500, 0.001, 0.015));
  assert.equal(f.horizons.length, 3);
  for (const h of f.horizons) {
    assert.ok(h.low < h.target && h.target < h.high);
    assert.ok(h.probUp > 0.2 && h.probUp < 0.8, 'probabilities stay modest');
  }
  assert.ok(f.horizons[2].high - f.horizons[2].low > f.horizons[0].high - f.horizons[0].low, 'range widens with time');
  assert.equal(f.path.length, 60);
});

test('signals move the forecast in the right direction', () => {
  const closes = series(400, 0, 0.012, 7);
  const bull = buildForecast(closes, { news: { score: 0.9, count: 20 }, social: { score: 0.9, count: 20 }, withBacktest: false });
  const bear = buildForecast(closes, { news: { score: -0.9, count: 20 }, social: { score: -0.9, count: 20 }, withBacktest: false });
  assert.ok(bull.horizons[1].probUp > bear.horizons[1].probUp);
  const up = technicalScore(series(300, 0.004, 0.005));
  const down = technicalScore(series(300, -0.004, 0.005));
  assert.ok(up.parts.trend > 0 && down.parts.trend < 0);
});

test('backtest uses only past data and reports a rate', () => {
  const bt = backtest(series(400, 0.002, 0.01, 3), 20);
  assert.ok(bt.samples > 50);
  assert.ok(bt.hitRate >= 0 && bt.hitRate <= 1);
});

test('reddit listing parser', () => {
  const post = { id: 'a', title: 'NVDA to the moon', selftext: 'x', subreddit: 'stocks', score: 5, num_comments: 2, created_utc: 1795000000, permalink: '/r/stocks/a' };
  const sticky = { id: 'b', title: 'Daily thread', stickied: true, created_utc: 1795000000, permalink: '/r/stocks/b' };
  const posts = parseListing({ data: { children: [{ data: post }, { data: sticky }] } });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://www.reddit.com/r/stocks/a');
  assert.equal(redditEnabled(), true);
});

test('forum parsers', () => {
  const hn = parseHackerNews({ hits: [
    { objectID: '1', _tags: ['comment'], comment_text: '<p>Nvidia&#x27;s moat is <i>real</i></p>', story_title: 'Nvidia news', created_at: '2026-11-23T20:00:00Z' },
    { objectID: '2', _tags: ['story'], title: 'Nvidia ships new chip', points: 12, created_at: '2026-11-23T19:00:00Z' },
  ] });
  assert.equal(hn[0].text, "Nvidia's moat is real");
  assert.equal(hn[0].context, 'Nvidia news');
  assert.equal(hn[1].score, 12);
  const m = parseMastodon([{ id: '9', content: '<p>$NVDA up</p>', url: 'https://m/9', created_at: '2026-11-23T20:00:00Z', language: 'en' }, { id: '8', content: '<p>x</p>', language: 'de' }]);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, '$NVDA up');
  const l = parseLemmy({ posts: [{ post: { id: 5, name: 'Nvidia stock talk', ap_id: 'https://l/5', published: '2026-11-23T20:00:00Z' }, community: { name: 'stocks' }, counts: { score: 3 } }] });
  assert.equal(l[0].context, 'c/stocks');
  const rss = '<rss><item><title>Nvidia jumps</title><link>http://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fexample.com%2fa</link><pubDate>Mon, 23 Nov 2026 06:27:00 GMT</pubDate><News:Source>Example</News:Source></item></rss>';
  const [item] = parseRss(rss, 'Bing News');
  assert.equal(item.url, 'https://example.com/a');
  assert.equal(item.source, 'Example');
});

test('parsers', () => {
  const xml = `<rss><channel><item><title>Apple &amp; AI: shares rise - Reuters</title><link>https://x/y</link><pubDate>Fri, 20 Nov 2026 02:40:16 GMT</pubDate><source url="https://r">Reuters</source></item></channel></rss>`;
  const [item] = parseRss(xml);
  assert.equal(item.title, 'Apple & AI: shares rise');
  assert.equal(item.source, 'Reuters');
  assert.equal(num('$1,234.50'), 1234.5);
  assert.equal(num('+2.58%'), 2.58);
  assert.equal(num('N/A'), null);
  assert.equal(normalizeSymbol(' aapl '), 'AAPL');
  assert.equal(normalizeSymbol('../etc'), null);
});
