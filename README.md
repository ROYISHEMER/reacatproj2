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
| Nasdaq data API (`api.nasdaq.com`) | most-active lists, quotes, daily history, analyst targets, EPS forecasts, earnings date, filings, profile |
| Google News RSS (`news.google.com`) | headlines per company (general + launch/product query) |
| Bing News RSS (`www.bing.com`), Nasdaq news RSS (`www.nasdaq.com`) | additional headlines per ticker |
| Stocktwits (`api.stocktwits.com`) | trader posts and bullish/bearish tags |
| Hacker News (`hn.algolia.com`), Mastodon (`mastodon.social`), Lemmy (`lemmy.world`) | forum posts and comments about the company from the last week |
| ApeWisdom (`apewisdom.io`) | how often each ticker is mentioned in retail-investor forums (dashboard tab + stock page) |
| Reddit (`www.reddit.com` public JSON, no account; official API if keys are set) | posts mentioning the ticker in investing subreddits |

Each source fails independently: the stock page still renders and lists what was unavailable.

## How the forecast works (`server/analysis/`)

1. **Technical score** – momentum (20/60 days), trend (price vs. 50/200-day averages), MACD, RSI extremes.
2. **Walk-forward backtest** – the technical score is replayed over the stock's own history using only
   data available on each past day. Its hit rate sets how much weight the technical signal gets.
3. **News and social sentiment** – finance lexicon over headlines/posts, weighted by recency and
   shrunk toward neutral when there are few items.
4. **Analyst consensus** – gap to the mean price target and buy/sell balance.
5. The weighted signals tilt the daily drift; volatility (recent + long-run) gives the 80% range and
   the probability of a rise over 5, 20 and 60 trading days.
6. **Events** – product launches, earnings, regulatory items and deals are detected in headlines,
   with dates parsed from the text when present.

## Layout

- `server/` – Express API (`/api/movers`, `/api/stock/:symbol`, `/api/search`), sources and analysis
- `src/` – React (Vite) client
- `test/` – unit tests for indicators, sentiment, event parsing and the forecast model
