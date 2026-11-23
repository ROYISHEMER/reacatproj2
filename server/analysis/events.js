// Extract dated company events (product launches, earnings, regulatory, deals) from headlines.
const TYPES = [
  ['product', /\b(launch(es|ed|ing)?|unveil(s|ed|ing)?|debut(s|ed)?|roll(s|ed|ing)? out|rollout|introduc(es|ed|ing)|release(s|d)? (date|its|new|the)|new (product|model|chip|iphone|device|drug|platform|service)|ships?|pre-?orders?)\b/i],
  ['earnings', /\b(earnings|quarterly results|q[1-4] results|guidance|revenue forecast|outlook)\b/i],
  ['regulatory', /\b(fda|approval|approved|clearance|antitrust|lawsuit|sued|probe|investigation|ruling|recall|ban)\b/i],
  ['deal', /\b(acqui(re|res|red|sition)|merger|buyout|takeover|partnership|partners with|contract|deal with|stake in)\b/i],
  ['capital', /\b(stock split|buyback|repurchase|dividend|offering|ipo|spin-?off)\b/i],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Find a date mentioned in text, relative to when it was published. */
export function extractDate(text, publishedAt) {
  const pub = new Date(publishedAt);
  const py = pub.getUTCFullYear();
  let m;

  // "December 5, 2026" / "Dec. 5" / "5 December"
  m = new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (20\\d{2}))?\\b`, 'i').exec(text);
  if (!m) {
    const r = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE}\\.?(?: (20\\d{2}))?\\b`, 'i').exec(text);
    // "Neo 2 May Launch" is the verb, not the month: day-first 'may' needs a year.
    if (r && !(r[2].toLowerCase() === 'may' && !r[3])) m = [r[0], r[2], r[1], r[3]];
  }
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const day = Number(m[2]);
    if (day >= 1 && day <= 31) {
      let year = m[3] ? Number(m[3]) : py;
      // No year given: pick the occurrence closest to publication (may be next year).
      if (!m[3] && month < pub.getUTCMonth() - 6) year++;
      return { text: m[0], date: iso(year, month, day), precision: 'day' };
    }
  }
  // "Q1 2027"
  m = /\bq([1-4])(?: of)? (20\d{2})\b/i.exec(text);
  if (m) return { text: m[0], date: iso(Number(m[2]), (Number(m[1]) - 1) * 3, 1), precision: 'quarter' };
  // "in March" / "by March 2027"
  m = new RegExp(`\\b(?:in|by|this|next|early|late|mid-?) ?${MONTH_RE}(?: (20\\d{2}))?\\b`, 'i').exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    let year = m[2] ? Number(m[2]) : py;
    if (!m[2] && month < pub.getUTCMonth()) year++;
    return { text: m[0], date: iso(year, month, 1), precision: 'month' };
  }
  // "in 2027" / "by 2028"
  m = /\b(?:in|by|for|early|late|mid-?) ?(20\d{2})\b/i.exec(text);
  if (m && Number(m[1]) >= py) return { text: m[0], date: iso(Number(m[1]), 0, 1), precision: 'year' };
  // relative
  const rel = [
    [/\btomorrow\b/i, 1],
    [/\bnext week\b/i, 7],
    [/\bthis week\b/i, 3],
    [/\bnext month\b/i, 30],
  ];
  for (const [re, days] of rel) {
    m = re.exec(text);
    if (m) {
      const d = new Date(pub.getTime() + days * 86400000);
      return { text: m[0], date: d.toISOString().slice(0, 10), precision: 'approx' };
    }
  }
  return null;
}

export function classify(title) {
  for (const [type, re] of TYPES) if (re.test(title)) return type;
  return null;
}

/** news: [{title,url,source,publishedAt}] -> events, upcoming first. */
export function extractEvents(news, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const out = [];
  for (const n of news) {
    const type = classify(n.title);
    if (!type) continue;
    const when = extractDate(n.title, n.publishedAt);
    out.push({
      type,
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.publishedAt,
      date: when?.date || null,
      dateText: when?.text || null,
      precision: when?.precision || null,
      upcoming: when ? when.date >= today : false,
    });
  }
  const rank = (e) => (e.upcoming ? 0 : e.date ? 1 : 2);
  return out
    .sort((a, b) => rank(a) - rank(b) || (a.upcoming ? (a.date < b.date ? -1 : 1) : a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, 25);
}
