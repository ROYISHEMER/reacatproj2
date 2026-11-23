import { fmt, sign } from '../lib.js';

const CERTAINTY = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
const HYPE = {
  hype: ['ההתלהבות מקדימה את הנתונים', 'מדברים על המניה בחיוב יותר ממה שהנתונים הקשים מצדיקים. מצב כזה נוטה להיות שביר.'],
  quiet: ['הנתונים טובים מהדיבורים', 'הנתונים הקשים חיוביים יותר מהשיח סביב המניה. ייתכן שהשוק עוד לא שם לב.'],
  aligned: ['השיח והנתונים מיושרים', 'מה שאומרים על המניה תואם פחות או יותר את מה שהנתונים מראים.'],
};

function Points({ title, items, cls }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className={cls}>{title}</h3>
      <ul className="points">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

export function AiCard({ ai }) {
  return (
    <section className="card" aria-labelledby="ai-title">
      <h2 id="ai-title">ניתוח AI של החדשות</h2>
      {!ai.enabled && (
        <p className="muted small">
          שכבת ה־AI כבויה. כשמוגדר מפתח API של Claude, המודל קורא את כל הכותרות, מדרג כל אחת, מזהה אירועים ותאריכים,
          וכותב כאן סיכום: מה קורה בחברה, טיעוני בעד ונגד, ומה לעקוב אחריו. עד אז הסנטימנט מחושב לפי מילון מילים.
        </p>
      )}
      {ai.enabled && !ai.used && (
        <p className="muted small" role="status">
          ניתוח ה־AI לא זמין כרגע{ai.error ? <> (<span dir="ltr">{ai.error}</span>)</> : null}. מוצג הניתוח המילוני.
        </p>
      )}
      {ai.used && ai.view && (
        <>
          <p>{ai.view.thesis}</p>
          <div className="grid3">
            <Points title="▲ בעד" items={ai.view.bull} cls="up" />
            <Points title="▼ נגד" items={ai.view.bear} cls="down" />
            <Points title="מה לעקוב אחריו" items={ai.view.watch} />
          </div>
          <p className="muted small">
            המודל קרא {ai.headlinesRead} כותרות · רמת ודאות: {CERTAINTY[ai.view.certainty]} · מודל: <span dir="ltr">{ai.model}</span>.
            המודל מנתח רק את הכותרות שנאספו ואינו חוזה מחיר.
          </p>
        </>
      )}
    </section>
  );
}

export function TwinsCard({ twins }) {
  if (!twins) return null;
  const bt = twins.backtest;
  const works = twins.reliability > 0;
  return (
    <section className="card" aria-labelledby="twins-title">
      <h2 id="twins-title">תאומים היסטוריים</h2>
      <p>
        איתרנו את <b>{twins.count}</b> הימים בעבר של המניה שהכי דומים למצב של היום (מומנטום, RSI, מרחק מהממוצע ותנודתיות).
        ב־<b>{twins.ups}</b> מהם המניה הייתה גבוהה יותר אחרי {twins.horizon} ימי מסחר.
      </p>
      <dl className="kv">
        <div><dt>עלתה לאחר מכן</dt><dd dir="ltr">{fmt.prob(twins.upRate)}</dd></div>
        <div><dt>תשואה חציונית</dt><dd dir="ltr" className={sign(twins.medianReturnPct)}>{fmt.pct(twins.medianReturnPct, 1)}</dd></div>
        <div><dt>טווח אמצעי</dt><dd dir="ltr">{fmt.pct(twins.lowPct, 1)} … {fmt.pct(twins.highPct, 1)}</dd></div>
      </dl>
      <p className="small muted">
        הימים הדומים ביותר:{' '}
        {twins.examples.map((e, i) => (
          <span key={e.date}>{i ? ' · ' : ''}{fmt.date(e.date)} (<span dir="ltr">{fmt.pct(e.returnPct, 1)}</span>)</span>
        ))}
      </p>
      {bt.samples > 0 && (
        <p className="small">
          בבדיקה לאחור השיטה פגעה בכיוון ב־<b dir="ltr">{fmt.prob(bt.hitRate)}</b> מתוך {bt.samples} מקרים, מול{' '}
          <b dir="ltr">{fmt.prob(bt.baseline)}</b> לניחוש הקבוע הטוב ביותר.{' '}
          {works ? 'היא מנצחת את הניחוש במניה הזו, ולכן נכללת בתחזית.' : 'היא לא מנצחת את הניחוש במניה הזו, ולכן מוצגת כמידע בלבד ואינה משפיעה על התחזית.'}
        </p>
      )}
    </section>
  );
}

export function HypeCard({ hype }) {
  if (!hype) return null;
  const [title, text] = HYPE[hype.state];
  const pos = Math.max(2, Math.min(98, 50 + hype.gap * 25));
  return (
    <section className="card" aria-labelledby="hype-title">
      <h2 id="hype-title">פער ההייפ</h2>
      <p><b>{title}.</b> {text}</p>
      <div className="gauge" dir="ltr" role="img" aria-label={`פער ההייפ: ${title}`}>
        <i style={{ left: `${pos}%` }} />
      </div>
      <div className="gauge-labels" dir="ltr"><span>נתונים חזקים מהשיח</span><span>מיושר</span><span>שיח חזק מהנתונים</span></div>
      <dl className="kv">
        <div><dt>ציון השיח</dt><dd dir="ltr" className={sign(hype.talk)}>{hype.talk.toFixed(2)}</dd></div>
        <div><dt>ציון הנתונים הקשים</dt><dd dir="ltr" className={sign(hype.data)}>{hype.data.toFixed(2)}</dd></div>
        <div><dt>אזכורים ב־24 שעות</dt><dd dir="ltr">{hype.attention?.toLocaleString('en-US') ?? '—'}</dd></div>
      </dl>
      <p className="small muted">שיח: חדשות, רשתות ואזכורים. נתונים קשים: עדכוני תחזיות רווח, הפתעות בדוחות, בעלי עניין ומוסדיים.</p>
    </section>
  );
}

export function EarningsMemoryCard({ memory }) {
  if (!memory) return null;
  return (
    <section className="card" aria-labelledby="mem-title">
      <h2 id="mem-title">זיכרון דוחות</h2>
      <p>
        תנועה טיפוסית ביום שאחרי דוח: <b dir="ltr">±{memory.typicalMovePct.toFixed(1)}%</b>. ב־<b>{memory.followedSurprise}</b> מתוך{' '}
        {memory.reports} הדוחות האחרונים המניה זזה בכיוון ההפתעה.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">תגובת המניה לדוחות האחרונים</caption>
          <thead><tr><th>רבעון</th><th className="n">הפתעה ברווח</th><th className="n">יום אחרי</th><th className="n">5 ימים אחרי</th></tr></thead>
          <tbody>
            {memory.rows.map((r) => (
              <tr key={r.quarter} className="static">
                <td dir="ltr">{r.quarter}</td>
                <td className={`n ${sign(r.surprisePct)}`} dir="ltr">{fmt.pct(r.surprisePct, 1)}</td>
                <td className={`n ${sign(r.nextDayPct)}`} dir="ltr">{fmt.pct(r.nextDayPct, 1)}</td>
                <td className={`n ${sign(r.fiveDayPct)}`} dir="ltr">{fmt.pct(r.fiveDayPct, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MacroCard({ macro }) {
  const y = macro.yields;
  if (!y && !macro.predictionMarkets.length && !macro.calendar.length) return null;
  return (
    <section className="card" aria-labelledby="macro-title">
      <h2 id="macro-title">הקשר מאקרו</h2>
      <p className="small muted">רקע כללי לשוק. הנתונים האלה מוצגים כהקשר ואינם משפיעים על התחזית של המניה.</p>
      <div className="grid3">
        <div>
          <h3>ריבית ותשואות אג״ח</h3>
          {y ? (
            <dl className="kv two">
              <div><dt>אג״ח ל־10 שנים</dt><dd dir="ltr">{y.y10.toFixed(2)}%</dd></div>
              <div><dt>שינוי בחודש (נק׳ אחוז)</dt><dd dir="ltr">{fmt.pct(y.y10ChangeMonth, 2).replace('%', '')}</dd></div>
              <div><dt>אג״ח לשנתיים</dt><dd dir="ltr">{y.y2.toFixed(2)}%</dd></div>
              <div><dt>שיפוע העקום</dt><dd dir="ltr">{y.curve10y2y.toFixed(2)}{y.inverted ? ' (הפוך)' : ''}</dd></div>
            </dl>
          ) : <p className="muted small">לא זמין.</p>}
        </div>
        <div>
          <h3>מה שוקי החיזוי מתמחרים</h3>
          {macro.predictionMarkets.length ? (
            <ul className="feed">
              {macro.predictionMarkets.slice(0, 4).map((m) => (
                <li key={m.title}>
                  <a href={m.url} target="_blank" rel="noreferrer" dir="ltr">{m.leading}</a>
                  <span className="meta"><b dir="ltr">{fmt.prob(m.probability)}</b> · עד {fmt.date(m.ends)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">לא זמין.</p>}
        </div>
        <div>
          <h3>פרסומים כלכליים קרובים (ארה״ב)</h3>
          {macro.calendar.length ? (
            <ul className="feed">
              {macro.calendar.slice(0, 6).map((c, i) => (
                <li key={i}>
                  <span dir="ltr" className="post">{c.name}</span>
                  <span className="meta">{fmt.date(c.date)}{c.consensus ? <> · צפי: <span dir="ltr">{c.consensus}</span></> : null}{c.previous ? <> · קודם: <span dir="ltr">{c.previous}</span></> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">אין פרסומים מרכזיים בימים הקרובים.</p>}
        </div>
      </div>
    </section>
  );
}
