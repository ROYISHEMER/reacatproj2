import PriceChart from './PriceChart.jsx';
import { CONFIDENCE, DIRECTION, fmt, sign, useApi } from '../lib.js';

const SIGNALS = {
  technical: ['ניתוח טכני', 'מומנטום, מגמה, MACD ו־RSI מתוך היסטוריית המחיר'],
  analysts: ['קונצנזוס אנליסטים', 'מחיר יעד ממוצע ויחס המלצות קנייה/מכירה'],
  news: ['סנטימנט חדשות', 'כותרות מהשבועיים האחרונים, משוקללות לפי עדכניות'],
  social: ['סנטימנט ברשתות', 'פוסטים של סוחרים ב־Stocktwits'],
};
const EVENT_TYPES = { product: 'מוצר / השקה', earnings: 'דוחות ותחזיות', regulatory: 'רגולציה ומשפט', deal: 'עסקאות ושותפויות', capital: 'הון ודיבידנד' };
const SENT = { positive: ['חיובי', 'up'], negative: ['שלילי', 'down'], neutral: ['ניטרלי', 'flat'] };
const HORIZON = { 5: 'שבוע (5 ימי מסחר)', 20: 'חודש (20 ימי מסחר)', 60: 'רבעון (60 ימי מסחר)' };

function ScoreBar({ score }) {
  const pct = Math.min(50, Math.abs(score) * 50);
  return (
    <div className="scorebar" aria-hidden="true" dir="ltr">
      <i className={score >= 0 ? 'pos' : 'neg'} style={score >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />
    </div>
  );
}

const Sent = ({ label }) => <span className={`pill ${SENT[label][1]}`}>{SENT[label][0]}</span>;

export default function Stock({ symbol }) {
  const { loading, data, error } = useApi(`/api/stock/${symbol}`);
  if (loading) return <p className="state">אוסף נתונים על <b dir="ltr">{symbol}</b>: מחירים, חדשות, רשתות, אנליסטים…</p>;
  if (error) return <p className="state err">לא ניתן לטעון את <b dir="ltr">{symbol}</b>: {error.message}</p>;

  const { quote, summary, forecast: f, analysts, news, social, reddit, events, filings, earningsForecast, profile } = data;
  const d = f ? DIRECTION[f.direction] : null;
  const main = f?.horizons.find((h) => h.days === 20);
  const upcoming = events.filter((e) => e.upcoming);
  const otherEvents = events.filter((e) => !e.upcoming).slice(0, 10);
  const totalRatings = analysts ? analysts.buy + analysts.hold + analysts.sell : 0;

  return (
    <article>
      <a className="back" href="#/">→ חזרה לרשימה</a>
      <div className="stock-head">
        <div>
          <h1><span dir="ltr">{quote.symbol}</span> <span className="h-name" dir="ltr">{quote.name}</span></h1>
          <p className="muted small">{[summary?.sector, summary?.industry, quote.exchange].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="quote">
          <span className="price" dir="ltr">{fmt.price(quote.price)}</span>
          <span className={`chg ${sign(quote.change)}`} dir="ltr">{fmt.pct(quote.changePct)}</span>
          <span className="muted small" dir="ltr">{quote.asOf}</span>
        </div>
      </div>

      {!f && <p className="state">אין מספיק היסטוריית מסחר (נדרשים לפחות 60 ימים) כדי לחשב תחזית למניה זו.</p>}

      {f && (
        <section className="card hero">
          <div className="hero-main">
            <span className="eyebrow">תחזית לחודש הקרוב</span>
            <div className={`verdict ${d.cls}`}>{d.icon} {d.text}</div>
            <p>
              סיכוי לעלייה: <b dir="ltr">{fmt.prob(main.probUp)}</b> · תשואה צפויה: <b dir="ltr">{fmt.pct(main.expectedReturnPct, 1)}</b>
            </p>
            <p>
              טווח סביר (80%): <b dir="ltr">{fmt.price(main.low)} – {fmt.price(main.high)}</b>
            </p>
            <p className="muted small">
              רמת ביטחון: <b>{CONFIDENCE[f.confidence]}</b> · תנודתיות שנתית: <span dir="ltr">{f.annualVolatilityPct.toFixed(0)}%</span>
            </p>
          </div>
          <div className="hero-table table-wrap">
            <table>
              <thead>
                <tr><th>אופק</th><th className="n">סיכוי לעלייה</th><th className="n">תשואה צפויה</th><th className="n">מחיר צפוי</th><th className="n">טווח 80%</th></tr>
              </thead>
              <tbody>
                {f.horizons.map((h) => (
                  <tr key={h.days} className="static">
                    <td>{HORIZON[h.days]}</td>
                    <td className="n" dir="ltr">{fmt.prob(h.probUp)}</td>
                    <td className={`n ${sign(h.expectedReturnPct)}`} dir="ltr">{fmt.pct(h.expectedReturnPct, 1)}</td>
                    <td className="n" dir="ltr">{fmt.price(h.target)}</td>
                    <td className="n" dir="ltr">{fmt.price(h.low)} – {fmt.price(h.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.history.length > 1 && (
        <section className="card">
          <h2>מחיר ותחזית</h2>
          <PriceChart history={data.history} path={f?.path} />
        </section>
      )}

      {f && (
        <div className="grid2">
          <section className="card">
            <h2>ממה מורכבת התחזית</h2>
            <ul className="signals">
              {f.signals.map((s) => (
                <li key={s.key}>
                  <div className="sig-top">
                    <b>{SIGNALS[s.key][0]}</b>
                    <span className={`pill ${sign(Math.abs(s.score) < 0.1 ? 0 : s.score)}`}>
                      {s.score > 0.1 ? '▲ חיובי' : s.score < -0.1 ? '▼ שלילי' : '■ ניטרלי'}
                    </span>
                  </div>
                  <ScoreBar score={s.score} />
                  <span className="muted small">
                    {SIGNALS[s.key][1]} · משקל בתחזית: <span dir="ltr">{s.weightPct.toFixed(0)}%</span>
                    {s.count ? <> · {s.count} פריטים</> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>עד כמה אפשר לסמוך על זה</h2>
            <p className="small">
              בדקנו את האות הטכני על ההיסטוריה של המניה עצמה: בכל יום בעבר חישבנו תחזית רק מהמידע שהיה זמין באותו יום,
              והשווינו למה שקרה בפועל. אות שלא הוכיח את עצמו מקבל משקל נמוך יותר.
            </p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>אופק</th><th className="n">פגיעה בכיוון</th><th className="n">ימים שבהם המניה עלתה</th><th className="n">מדגם</th></tr></thead>
                <tbody>
                  {f.backtest.map((b) => (
                    <tr key={b.horizon} className="static">
                      <td>{b.horizon} ימי מסחר</td>
                      <td className="n" dir="ltr">{fmt.prob(b.hitRate)}</td>
                      <td className="n" dir="ltr">{fmt.prob(b.upRate)}</td>
                      <td className="n" dir="ltr">{b.samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              50% שקול להטלת מטבע. חדשות וסנטימנט אינם נבדקים לאחור כי אין להם ארכיון היסטורי. מבוסס על {f.bars} ימי מסחר.
            </p>
            <dl className="kv">
              <div><dt>RSI (14)</dt><dd dir="ltr">{f.technical.rsi?.toFixed(0) ?? '—'}</dd></div>
              <div><dt>ממוצע 50 יום</dt><dd dir="ltr">{fmt.price(f.technical.sma50)}</dd></div>
              <div><dt>ממוצע 200 יום</dt><dd dir="ltr">{fmt.price(f.technical.sma200)}</dd></div>
            </dl>
          </section>
        </div>
      )}

      <div className="grid2">
        <section className="card">
          <h2>אירועים ומוצרים</h2>
          {upcoming.length === 0 && otherEvents.length === 0 && <p className="muted">לא זוהו אירועים בחדשות האחרונות.</p>}
          {upcoming.length > 0 && (
            <>
              <h3>צפויים בהמשך</h3>
              <ul className="events">
                {upcoming.map((e, i) => (
                  <li key={i}>
                    <span className="date">{fmt.date(e.date)}{e.precision !== 'day' ? ' (משוער)' : ''}</span>
                    <span className="tag">{EVENT_TYPES[e.type]}</span>
                    {e.url ? <a href={e.url} target="_blank" rel="noreferrer" dir="ltr">{e.title}</a> : <span dir="ltr">{e.title}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {otherEvents.length > 0 && (
            <>
              <h3>דווחו לאחרונה</h3>
              <ul className="events">
                {otherEvents.map((e, i) => (
                  <li key={i}>
                    <span className="date">{fmt.date(e.date || e.publishedAt)}</span>
                    <span className="tag">{EVENT_TYPES[e.type]}</span>
                    <a href={e.url} target="_blank" rel="noreferrer" dir="ltr">{e.title}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">אירועים ותאריכים מזוהים אוטומטית מכותרות חדשות ועלולים להיות חלקיים או שגויים.</p>
        </section>

        <section className="card">
          <h2>אנליסטים ונתוני חברה</h2>
          {analysts ? (
            <>
              <dl className="kv">
                <div><dt>מחיר יעד ממוצע</dt><dd dir="ltr">{fmt.price(analysts.targetMean)}</dd></div>
                <div><dt>פער מהמחיר</dt><dd dir="ltr" className={sign(analysts.targetMean - quote.price)}>{fmt.pct((analysts.targetMean / quote.price - 1) * 100, 1)}</dd></div>
                <div><dt>טווח יעדים</dt><dd dir="ltr">{fmt.price(analysts.targetLow)} – {fmt.price(analysts.targetHigh)}</dd></div>
              </dl>
              {totalRatings > 0 && (
                <>
                  <div className="ratings" dir="ltr" aria-hidden="true">
                    <i className="r-buy" style={{ flex: analysts.buy }} />
                    <i className="r-hold" style={{ flex: analysts.hold }} />
                    <i className="r-sell" style={{ flex: analysts.sell }} />
                  </div>
                  <p className="small">קנייה: <b>{analysts.buy}</b> · החזקה: <b>{analysts.hold}</b> · מכירה: <b>{analysts.sell}</b></p>
                </>
              )}
            </>
          ) : (
            <p className="muted">אין סיקור אנליסטים זמין.</p>
          )}
          <dl className="kv">
            <div><dt>שווי שוק</dt><dd dir="ltr">{summary?.marketCap ? `$${fmt.big(summary.marketCap)}` : '—'}</dd></div>
            <div><dt>טווח 52 שבועות</dt><dd dir="ltr">{summary?.week52 || '—'}</dd></div>
            <div><dt>תשואת דיבידנד</dt><dd dir="ltr">{summary?.dividendYield != null ? `${summary.dividendYield}%` : '—'}</dd></div>
          </dl>
          {earningsForecast?.quarterly?.length > 0 && (
            <>
              <h3>תחזית רווח למניה (EPS)</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>רבעון</th><th className="n">קונצנזוס</th><th className="n">טווח</th><th className="n">עדכונים ↑/↓</th></tr></thead>
                  <tbody>
                    {earningsForecast.quarterly.map((q) => (
                      <tr key={q.period} className="static">
                        <td dir="ltr">{q.period}</td>
                        <td className="n" dir="ltr">{q.epsConsensus ?? '—'}</td>
                        <td className="n" dir="ltr">{q.epsLow ?? '—'} – {q.epsHigh ?? '—'}</td>
                        <td className="n" dir="ltr">{q.revisionsUp ?? 0} / {q.revisionsDown ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>חדשות</h2>
          <p className="small muted">
            {news.aggregate.count} כותרות · {news.aggregate.positive} חיוביות · {news.aggregate.negative} שליליות · {news.aggregate.neutral} ניטרליות
          </p>
          <ul className="feed">
            {news.items.slice(0, 14).map((n, i) => (
              <li key={i}>
                <a href={n.url} target="_blank" rel="noreferrer" dir="ltr">{n.title}</a>
                <span className="meta"><Sent label={n.sentimentLabel} /> <span dir="ltr">{n.source}</span> · {fmt.ago(n.publishedAt)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>מה אומרים הסוחרים</h2>
          <p className="small muted">
            {social.aggregate.count} פוסטים אחרונים ב־Stocktwits · {social.aggregate.positive} שוריים · {social.aggregate.negative} דוביים
            {social.watchers ? <> · <span dir="ltr">{fmt.big(social.watchers)}</span> עוקבים</> : null}
          </p>
          <ul className="feed">
            {social.items.slice(0, 8).map((p) => (
              <li key={p.id}>
                <span dir="ltr" className="post">{p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body}</span>
                <span className="meta"><Sent label={p.sentimentLabel} /> {fmt.ago(p.createdAt)}</span>
              </li>
            ))}
          </ul>
          <h3>Reddit</h3>
          {data.errors.some((e) => e.source === 'reddit') ? (
            <p className="muted small">Reddit לא זמין מהשרת הזה כרגע.</p>
          ) : (
            reddit.items.length === 0 && <p className="muted small">{reddit.enabled ? 'לא נמצאו פוסטים מהשבוע האחרון.' : 'מקור Reddit כבוי.'}</p>
          )}
          {reddit.items.length > 0 && (
            <ul className="feed">
              {reddit.items.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <a href={r.url} target="_blank" rel="noreferrer" dir="ltr">{r.title}</a>
                  <span className="meta"><Sent label={r.sentimentLabel} /> <span dir="ltr">r/{r.subreddit}</span> · {r.comments} תגובות · {fmt.ago(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {filings.length > 0 && (
            <>
              <h3>דיווחים אחרונים לרשות ני״ע (SEC)</h3>
              <ul className="filings">
                {filings.slice(0, 6).map((x, i) => (
                  <li key={i}><a href={x.url} target="_blank" rel="noreferrer" dir="ltr">{x.form}</a> <span className="muted small">{fmt.date(x.filed)}</span></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {profile?.description && (
        <section className="card">
          <h2>על החברה</h2>
          <p dir="ltr" className="small about">{profile.description}</p>
        </section>
      )}
      {data.errors.length > 0 && (
        <p className="muted small">חלק מהמקורות לא היו זמינים כעת: <span dir="ltr">{data.errors.map((e) => e.source).join(', ')}</span></p>
      )}
    </article>
  );
}
