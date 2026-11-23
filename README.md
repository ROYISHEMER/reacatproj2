# תחזית מניות · Stock Forecast

A web app that tracks the most active US stocks and builds a probabilistic outlook for each
one from live public data: prices, news headlines, trader posts, analyst consensus,
earnings estimates and SEC filings. The UI is in Hebrew (RTL).

> Forecasts are statistical estimates with high uncertainty. This is not investment advice.

## Run

```bash
npm install
npm run build && npm start     # http://localhost:3001
npm run dev                    # API on :3001 + Vite dev server on :5173
npm test
```

Optional settings are listed in `.env.example`. No API keys are required.

## Data sources

| Source | Used for |
| --- | --- |
| Nasdaq data API (`api.nasdaq.com`) | most-active lists, quotes, daily history, analyst targets, EPS forecasts and revisions, earnings surprises, insider and institutional activity, short interest, option chain, financial ratios, filings, profile |
| Google News RSS (`news.google.com`) | headlines per company (general + launch/product query) |
| Bing News RSS (`www.bing.com`), Nasdaq news RSS (`www.nasdaq.com`) | additional headlines per ticker |
| Stocktwits (`api.stocktwits.com`) | trader posts and bullish/bearish tags |
| Hacker News (`hn.algolia.com`), Mastodon (`mastodon.social`), Lemmy (`lemmy.world`) | forum posts and comments about the company from the last week |
| ApeWisdom (`apewisdom.io`) | how often each ticker is mentioned in retail-investor forums (dashboard tab + stock page) |
| Reddit (`www.reddit.com` public JSON, no account; official API if keys are set) | posts mentioning the ticker in investing subreddits |

Each source fails independently: the stock page still renders and lists what was unavailable.

## How the forecast works (`server/analysis/`)

Twelve factors are scored from -1 to +1 and weighted by how well each has held up in published
research:

| Evidence | Factors |
| --- | --- |
| Strong | price momentum and trend (technical score), analyst earnings-estimate revisions, latest earnings surprise (post-earnings drift) |
| Moderate | analyst consensus and price targets, news sentiment, overall market trend (S&P 500), strength relative to the market |
| Weak | forum and social sentiment, insider trades, institutional holdings, short interest, options put/call ratio |

1. The technical score is replayed over the stock's own history (walk-forward, only data available
   on each past day). Its hit rate and Brier score set how much weight it gets for that stock.
2. The weighted signals tilt the daily drift; volatility (recent + long-run) gives the 80% range and
   the probability of a rise over 5, 20 and 60 trading days.
3. Confidence drops when factors disagree, history is short, or the technical signal failed in the past.
4. **Events** - launches, earnings, regulatory items and deals are detected in headlines, with dates
   parsed from the text when present.
5. **Live track record** (`server/tracker.js`) - every forecast served is logged once per symbol per day
   to `data/predictions.jsonl` and scored against the real price after 5 and 20 trading days
   (`/api/track-record`, shown on the "sources and accuracy" page). Set `DATA_DIR` to a persistent
   path in production; the log is lost when an ephemeral container is recycled.

## Layout

- `server/` – Express API (`/api/movers`, `/api/stock/:symbol`, `/api/search`, `/api/track-record`), sources and analysis
- `src/` – React (Vite) client
- `test/` – unit tests for indicators, sentiment, event parsing and the forecast model
