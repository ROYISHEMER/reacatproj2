// Market-wide context: Treasury yields, prediction-market odds, the economic calendar
// and sector ETFs. Shown as context; only the sector trend feeds the forecast.
import { fetchJson, fetchText } from '../http.js';
import { api, getHistory } from './nasdaq.js';

const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export function parseYieldXml(xml) {
  const rows = [];
  for (const m of xml.matchAll(/<m:properties>(.*?)<\/m:properties>/gs)) {
    const get = (tag) => {
      const r = new RegExp(`<d:${tag}[^>]*>([^<]*)</d:${tag}>`).exec(m[1]);
      return r ? r[1] : null;
    };
    const date = (get('NEW_DATE') || '').slice(0, 10);
    const y2 = Number(get('BC_2YEAR'));
    const y10 = Number(get('BC_10YEAR'));
    const m3 = Number(get('BC_3MONTH'));
    if (date && Number.isFinite(y10) && y10 > 0) rows.push({ date, y2, y10, m3 });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Latest US Treasury yields and how they moved over about a month. */
export async function getYields(now = new Date()) {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const url = (d) =>
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${ym(d)}`;
  const pages = await Promise.allSettled([fetchText(url(prev), { ttlMs: 6 * 3600000 }), fetchText(url(now), { ttlMs: 3600000 })]);
  const rows = pages.flatMap((p) => (p.status === 'fulfilled' ? parseYieldXml(p.value) : []));
  if (!rows.length) throw new Error('Treasury yields unavailable');
  const last = rows[rows.length - 1];
  const ref = rows[Math.max(0, rows.length - 21)];
  return {
    date: last.date,
    y2: last.y2,
    y10: last.y10,
    m3: last.m3,
    curve10y2y: last.y10 - last.y2,
    y10ChangeMonth: last.y10 - ref.y10,
    inverted: last.y10 < last.y2,
  };
}

export function parsePolymarket(json, limit = 4) {
  const out = [];
  for (const e of json?.events || []) {
    const open = (e.markets || [])
      .filter((m) => !m.closed)
      .map((m) => {
        let yes = null;
        try {
          yes = Number(JSON.parse(m.outcomePrices || '[]')[0]);
        } catch {
          yes = null;
        }
        return { question: m.question, yes };
      })
      .filter((m) => Number.isFinite(m.yes));
    if (!open.length) continue;
    const top = open.sort((a, b) => b.yes - a.yes)[0];
    out.push({
      title: e.title,
      leading: top.question,
      probability: top.yes,
      volume: Number(e.volume) || 0,
      ends: (e.endDate || '').slice(0, 10) || null,
      url: e.slug ? `https://polymarket.com/event/${e.slug}` : null,
    });
  }
  return out.sort((a, b) => b.volume - a.volume).slice(0, limit);
}

/** What prediction markets price in for rates and recession. */
export async function getPredictionMarkets() {
  const q = (s) =>
    fetchJson(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(s)}&limit_per_type=6&events_status=active`, { ttlMs: 1800000 });
  const res = await Promise.allSettled([q('fed rate'), q('recession')]);
  const items = res.flatMap((r) => (r.status === 'fulfilled' ? parsePolymarket(r.value, 3) : []));
  if (!items.length && res.every((r) => r.status === 'rejected')) throw res[0].reason;
  const seen = new Set();
  return items.filter((i) => !seen.has(i.title) && seen.add(i.title)).slice(0, 5);
}

const clean = (v) => String(v || '').replace(/&nbsp;/g, ' ').trim() || null;
const KEY_EVENTS = /\b(cpi|inflation|pce|fomc|fed |interest rate|nonfarm|payrolls|unemployment|gdp|retail sales|ism |pmi|jobless|consumer confidence|ppi)\b/i;

/** High-impact US economic releases over the next trading days. */
export async function getEconomicCalendar(days = 5, now = new Date()) {
  const dates = [];
  const d = new Date(now);
  while (dates.length < days) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const res = await Promise.allSettled(dates.map((date) => api(`/calendar/economicevents?date=${date}`, { ttlMs: 3 * 3600000 })));
  const out = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const seen = new Set();
    for (const row of r.value.rows || []) {
      if (row.country !== 'United States' || !KEY_EVENTS.test(`${row.eventName} `) || seen.has(row.eventName)) continue;
      seen.add(row.eventName);
      out.push({ date: dates[i], time: row.gmt, name: row.eventName, consensus: clean(row.consensus), previous: clean(row.previous) });
    }
  });
  return out.slice(0, 12);
}

const SECTOR_ETF = {
  technology: 'XLK',
  'health care': 'XLV',
  finance: 'XLF',
  'consumer discretionary': 'XLY',
  'consumer staples': 'XLP',
  energy: 'XLE',
  industrials: 'XLI',
  utilities: 'XLU',
  'real estate': 'XLRE',
  'basic materials': 'XLB',
  telecommunications: 'XLC',
};
export const sectorEtf = (sector) => SECTOR_ETF[String(sector || '').toLowerCase()] || null;

export async function getSectorCloses(sector) {
  const etf = sectorEtf(sector);
  if (!etf) return null;
  return { etf, closes: (await getHistory(etf, 'etf')).map((b) => b.close) };
}
