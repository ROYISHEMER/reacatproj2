// More Nasdaq datasets used as forecast factors: estimate revisions, earnings surprises,
// insider and institutional activity, short interest, options positioning, margins.
import { api, num } from './nasdaq.js';

const mdy = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
const rowsOf = (t) => t?.rows || [];
const find = (rows, key, re) => rows.find((r) => re.test(r[key] || ''));

/** Change in consensus EPS over the last month and how many analysts revised up/down. */
export async function getRevisions(symbol) {
  const d = await api(`/analyst/${symbol}/estimate-momentum`);
  const c = d.changeInConsensus || {};
  const e = d.estimatesChanged || {};
  const pct = (cur, old) => (cur != null && old ? ((cur - old) / Math.abs(old)) * 100 : null);
  const out = {
    quarterNow: num(c.currentData?.qtrMean),
    quarterMonthAgo: num(c.monthData?.qtrMean),
    yearNow: num(c.currentData?.yrMean),
    yearMonthAgo: num(c.monthData?.yrMean),
    up: (num(e.quarterDataUp?.changeValue) || 0) + (num(e.yearDataUp?.changeValue) || 0),
    down: (num(e.quarterDataDown?.changeValue) || 0) + (num(e.yearDataDown?.changeValue) || 0),
  };
  out.quarterChangePct = pct(out.quarterNow, out.quarterMonthAgo);
  out.yearChangePct = pct(out.yearNow, out.yearMonthAgo);
  return out.quarterNow == null && out.yearNow == null ? null : out;
}

/** Last reported quarters: actual EPS vs consensus. Newest first. */
export async function getSurprises(symbol) {
  const d = await api(`/company/${symbol}/earnings-surprise`);
  return rowsOf(d.earningsSurpriseTable)
    .map((r) => ({
      quarter: r.fiscalQtrEnd,
      reported: mdy(r.dateReported),
      eps: num(r.eps),
      consensus: num(r.consensusForecast),
      surprisePct: num(r.percentageSurprise),
    }))
    .filter((r) => r.surprisePct != null);
}

export async function getInsiders(symbol) {
  const d = await api(`/company/${symbol}/insider-trades?limit=5&type=ALL&sortColumn=lastDate&sortOrder=DESC`);
  const trades = rowsOf(d.numberOfTrades);
  const shares = rowsOf(d.numberOfSharesTraded);
  return {
    buys3m: num(find(trades, 'insiderTrade', /buys/i)?.months3) || 0,
    sells3m: num(find(trades, 'insiderTrade', /sells/i)?.months3) || 0,
    sharesBought3m: num(find(shares, 'insiderTrade', /bought/i)?.months3) || 0,
    sharesSold3m: num(find(shares, 'insiderTrade', /sold/i)?.months3) || 0,
    recent: rowsOf(d.transactionTable?.table)
      .slice(0, 5)
      .map((r) => ({ name: r.insider, role: r.relation, date: mdy(r.lastDate), type: r.transactionType, shares: num(r.sharesTraded) })),
  };
}

export async function getInstitutions(symbol) {
  const d = await api(`/company/${symbol}/institutional-holdings?limit=1&type=TOTAL`);
  const act = rowsOf(d.activePositions);
  const inc = find(act, 'positions', /increased/i);
  const dec = find(act, 'positions', /decreased/i);
  if (!inc || !dec) return null;
  return {
    ownershipPct: num(d.ownershipSummary?.SharesOutstandingPCT?.value),
    increasedHolders: num(inc.holders),
    decreasedHolders: num(dec.holders),
    increasedShares: num(inc.shares),
    decreasedShares: num(dec.shares),
  };
}

export async function getShortInterest(symbol) {
  const d = await api(`/quote/${symbol}/short-interest?assetClass=stocks`);
  const rows = rowsOf(d.shortInterestTable).map((r) => ({
    date: mdy(r.settlementDate),
    shares: num(r.interest),
    daysToCover: num(r.daysToCover),
  }));
  if (!rows.length || rows[0].shares == null) return null;
  const prev = rows[1]?.shares;
  return { ...rows[0], changePct: prev ? (rows[0].shares / prev - 1) * 100 : null };
}

/** Put/call ratios over the nearest expirations. */
export async function getOptions(symbol, assetClass = 'stocks') {
  const d = await api(
    `/quote/${symbol}/option-chain?assetclass=${assetClass}&limit=400&fromdate=all&todate=undefined&excode=oprac&callput=callput&money=all&type=all`,
  );
  let callVol = 0;
  let putVol = 0;
  let callOi = 0;
  let putOi = 0;
  for (const r of rowsOf(d.table)) {
    if (!r.strike) continue;
    callVol += num(r.c_Volume) || 0;
    putVol += num(r.p_Volume) || 0;
    callOi += num(r.c_Openinterest) || 0;
    putOi += num(r.p_Openinterest) || 0;
  }
  if (callVol + putVol < 100) return null;
  return {
    callVolume: callVol,
    putVolume: putVol,
    putCallVolume: callVol ? putVol / callVol : null,
    putCallOpenInterest: callOi ? putOi / callOi : null,
  };
}

export async function getMargins(symbol) {
  const d = await api(`/company/${symbol}/financials?frequency=2`);
  const ratios = rowsOf(d.financialRatiosTable);
  const income = rowsOf(d.incomeStatementTable);
  const rev = find(income, 'value1', /^total revenue/i);
  const r0 = num(rev?.value2);
  const r1 = num(rev?.value3);
  return {
    quarterEnd: d.incomeStatementTable?.headers?.value2 || null,
    grossMarginPct: num(find(ratios, 'value1', /^gross margin/i)?.value2),
    operatingMarginPct: num(find(ratios, 'value1', /^operating margin/i)?.value2),
    profitMarginPct: num(find(ratios, 'value1', /^profit margin/i)?.value2),
    revenueQoQPct: r0 != null && r1 ? (r0 / r1 - 1) * 100 : null,
  };
}
