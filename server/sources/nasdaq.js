// Nasdaq public data API: movers, quotes, daily history, analysts, earnings, filings.
import { fetchJson } from '../http.js';

const BASE = 'https://api.nasdaq.com/api';

export function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (s === '' || /^(n\/?a|--|unch)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function api(path, opts) {
  const json = await fetchJson(`${BASE}${path}`, opts);
  if (!json || json.data == null) {
    const msg = json?.status?.bCodeMessage?.[0]?.errorMessage || 'no data';
    throw new Error(`Nasdaq: ${msg}`);
  }
  return json.data;
}

const iso = (d) => d.toISOString().slice(0, 10);
const mdyToIso = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

const LISTS = {
  MostActiveByShareVolume: 'mostActive',
  MostActiveByDollarVolume: 'mostActiveDollar',
  MostAdvanced: 'gainers',
  MostDeclined: 'losers',
};

export async function getMovers() {
  const data = await api('/marketmovers?assetclass=stocks', { ttlMs: 120000 });
  const stocks = data.STOCKS || {};
  const lists = {};
  let asOf = null;
  for (const [key, name] of Object.entries(LISTS)) {
    const block = stocks[key];
    if (!block) continue;
    asOf ||= block.dataAsOf || null;
    lists[name] = (block.table?.rows || []).map((r) => {
      const price = num(r.lastSalePrice);
      const change = num(r.lastSaleChange);
      const prev = price != null && change != null ? price - change : null;
      const third = num(r.change);
      const isVolume = key.startsWith('MostActive');
      return {
        symbol: r.symbol,
        name: r.name,
        price,
        change,
        changePct: prev ? (change / prev) * 100 : isVolume ? null : third,
        volume: isVolume ? third : null,
      };
    });
  }
  return { asOf, lists };
}

/** Resolve stocks vs ETF and return the live quote. */
export async function getQuote(symbol) {
  let data;
  let assetClass = 'stocks';
  try {
    data = await api(`/quote/${symbol}/info?assetclass=stocks`, { ttlMs: 60000 });
  } catch {
    assetClass = 'etf';
    data = await api(`/quote/${symbol}/info?assetclass=etf`, { ttlMs: 60000 });
  }
  const p = data.primaryData || {};
  return {
    symbol: data.symbol,
    name: (data.companyName || symbol).replace(/\s+(Common Stock|Ordinary Shares|Class [A-Z] Common Stock).*$/i, ''),
    exchange: data.exchange,
    assetClass,
    price: num(p.lastSalePrice),
    change: num(p.netChange),
    changePct: num(p.percentageChange),
    volume: num(p.volume),
    asOf: p.lastTradeTimestamp || null,
    marketStatus: data.marketStatus || null,
  };
}

/** Daily bars, oldest first. */
export async function getHistory(symbol, assetClass = 'stocks', days = 800) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const data = await api(
    `/quote/${symbol}/historical?assetclass=${assetClass}&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999`,
  );
  const rows = data.tradesTable?.rows || [];
  return rows
    .map((r) => ({
      date: mdyToIso(r.date),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      volume: num(r.volume),
    }))
    .filter((b) => b.date && b.close != null && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getSummary(symbol, assetClass = 'stocks') {
  const data = await api(`/quote/${symbol}/summary?assetclass=${assetClass}`);
  const s = data.summaryData || {};
  const v = (k) => s[k]?.value ?? null;
  return {
    sector: v('Sector'),
    industry: v('Industry'),
    marketCap: num(v('MarketCap')),
    oneYearTarget: num(v('OneYrTarget')),
    peRatio: num(v('PERatio')),
    forwardPE: num(v('ForwardPE1Yr')),
    eps: num(v('EarningsPerShare')),
    dividendYield: num(v('Yield')),
    exDividendDate: v('ExDividendDate'),
    week52: v('FiftTwoWeekHighLow'),
    beta: num(v('Beta')),
  };
}

export async function getAnalysts(symbol) {
  const data = await api(`/analyst/${symbol}/targetprice`);
  const c = data.consensusOverview;
  if (!c) return null;
  return {
    targetMean: num(c.priceTarget),
    targetLow: num(c.lowPriceTarget),
    targetHigh: num(c.highPriceTarget),
    buy: c.buy ?? 0,
    hold: c.hold ?? 0,
    sell: c.sell ?? 0,
  };
}

export async function getEarningsForecast(symbol) {
  const data = await api(`/analyst/${symbol}/earnings-forecast`);
  const map = (rows) =>
    (rows || []).slice(0, 4).map((r) => ({
      period: r.fiscalEnd,
      epsConsensus: num(r.consensusEPSForecast),
      epsHigh: num(r.highEPSForecast),
      epsLow: num(r.lowEPSForecast),
      estimates: num(r.noOfEstimates),
      revisionsUp: num(r.up),
      revisionsDown: num(r.down),
    }));
  return { quarterly: map(data.quarterlyForecast?.rows), yearly: map(data.yearlyForecast?.rows) };
}

/** Upcoming earnings date, parsed from Nasdaq's announcement text when present. */
export async function getEarningsDate(symbol) {
  const data = await api(`/analyst/${symbol}/earnings-date`);
  const text = `${data.announcement || ''} ${data.reportText || ''}`;
  const m = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[1].replace('.', '')} UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return { date: iso(d), confirmed: !/estimat|expected|algorithm/i.test(text) };
}

export async function getFilings(symbol) {
  const data = await api(`/company/${symbol}/sec-filings?limit=8&sortColumn=filed&sortOrder=desc`);
  return (data.rows || []).slice(0, 8).map((r) => ({
    form: r.formType,
    filed: mdyToIso(r.filed) || r.filed,
    period: r.period || null,
    url: r.view?.htmlLink || r.view?.docLink || null,
  }));
}

export async function getProfile(symbol) {
  const data = await api(`/company/${symbol}/company-profile`);
  return {
    description: data.CompanyDescription?.value || null,
    sector: data.Sector?.value || null,
    industry: data.Industry?.value || null,
  };
}

export async function search(q) {
  const data = await api(`/autocomplete/slookup/10?search=${encodeURIComponent(q)}`, { ttlMs: 3600000 });
  return (data || [])
    .filter((r) => r.asset === 'STOCKS' || r.asset === 'ETF')
    .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange, asset: r.asset }));
}
