import { useState } from 'react';
import { DIRECTION, fmt, sign, useApi } from '../lib.js';

const TABS = [
  ['mostActive', 'הנסחרות ביותר (כמות)'],
  ['mostActiveDollar', 'הנסחרות ביותר (מחזור $)'],
  ['buzz', 'המדוברות בפורומים'],
  ['gainers', 'העולות'],
  ['losers', 'היורדות'],
];

export default function Movers() {
  const { loading, data, error } = useApi('/api/movers');
  const [tab, setTab] = useState('mostActive');

  return (
    <section>
      <h1>המניות הפעילות היום</h1>
      <p className="sub">
        רשימת המניות האקטיביות בשוק האמריקאי, עם תחזית טכנית ל־20 ימי מסחר. לחצו על מניה לניתוח מלא: חדשות, סנטימנט,
        אנליסטים, אירועים ותחזית משולבת.
      </p>
      <div className="tabs" role="tablist">
        {TABS.map(([key, text]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {text}
          </button>
        ))}
      </div>
      {loading && <p className="state" role="status">טוען נתוני שוק ומחשב תחזיות…</p>}
      {error && <p className="state err" role="alert">טעינת הנתונים נכשלה: {error.message}</p>}
      {data && (
        <>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>מניה</th>
                  <th className="n">מחיר</th>
                  <th className="n">שינוי יומי</th>
                  <th className="n">מחזור</th>
                  <th>תחזית 20 יום</th>
                  <th className="n">סיכוי לעלייה</th>
                  <th className="n">תשואה צפויה</th>
                </tr>
              </thead>
              <tbody>
                {(data.lists[tab] || []).map((r) => {
                  const d = r.forecast ? DIRECTION[r.forecast.direction] : null;
                  return (
                    <tr key={r.symbol} onClick={() => (window.location.hash = `#/stock/${r.symbol}`)}>
                      <td>
                        <a href={`#/stock/${r.symbol}`} dir="ltr" className="sym">{r.symbol}</a>
                        <span className="name" dir="ltr">{r.name}</span>
                        {r.mentions != null && (
                          <span className="name">{r.mentions.toLocaleString('en-US')} אזכורים ב־24 שעות (אתמול: {r.mentionsPrev.toLocaleString('en-US')})</span>
                        )}
                      </td>
                      <td className="n" dir="ltr">{fmt.price(r.price)}</td>
                      <td className={`n ${sign(r.changePct)}`} dir="ltr">{fmt.pct(r.changePct)}</td>
                      <td className="n" dir="ltr">{fmt.big(r.volume)}</td>
                      <td>{d ? <span className={`pill ${d.cls}`}>{d.icon} {d.text}</span> : <span className="muted">אין מספיק היסטוריה</span>}</td>
                      <td className="n" dir="ltr">{fmt.prob(r.forecast?.probUp)}</td>
                      <td className={`n ${sign(r.forecast?.expectedReturnPct)}`} dir="ltr">{fmt.pct(r.forecast?.expectedReturnPct, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">{data.asOf} · מקורות: Nasdaq, ApeWisdom ·התחזית בטבלה מבוססת על מחיר בלבד; הניתוח המלא בעמוד המניה.</p>
        </>
      )}
    </section>
  );
}
