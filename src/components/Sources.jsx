import { fmt, useApi } from '../lib.js';

const SOURCES = [
  ['Nasdaq', 'מחירים, היסטוריה, המניות הפעילות, אנליסטים, תחזיות רווח, הפתעות בדוחות, בעלי עניין, מוסדיים, שורט, אופציות, דוחות כספיים', 'פעיל'],
  ['Google News', 'כותרות חדשות על החברה, כולל חיפוש ממוקד בהשקות ומוצרים', 'פעיל'],
  ['Bing News', 'כותרות חדשות נוספות', 'פעיל'],
  ['Nasdaq News', 'כתבות על המניה', 'פעיל'],
  ['Stocktwits', 'פוסטים של סוחרים, חלקם מתויגים שורי/דובי', 'פעיל'],
  ['Hacker News', 'פוסטים ותגובות על החברה והמוצרים שלה', 'פעיל'],
  ['Mastodon', 'פוסטים עם תג הסימול', 'פעיל'],
  ['Lemmy', 'פורום קהילתי בסגנון Reddit', 'פעיל'],
  ['ApeWisdom', 'ספירת אזכורים של כל מניה בפורומי משקיעים', 'פעיל'],
  ['SEC', 'דיווחים רשמיים של החברה', 'פעיל'],
  ['Reddit', 'פוסטים מפורומי השקעות', 'תלוי בשרת: חסום בענן, נתמך בהרצה מקומית'],
  ['Yahoo Finance', 'מחירים וחדשות', 'לא מחובר: חוסם את השרת'],
];

const FACTORS = [
  ['חזק', 'מומנטום ומגמת מחיר, עדכוני תחזיות רווח של אנליסטים, הפתעה בדוח האחרון'],
  ['בינוני', 'קונצנזוס ומחירי יעד של אנליסטים, סנטימנט חדשות, מצב השוק הכללי, חוזק יחסי לשוק'],
  ['חלש', 'סנטימנט ברשתות ובפורומים, בעלי עניין, מוסדיים, שורט, אופציות'],
];

export default function Sources() {
  const { loading, data, error } = useApi('/api/track-record');
  return (
    <article>
      <a className="back" href="#/">→ חזרה לרשימה</a>
      <h1>מקורות, שיטה ודיוק</h1>
      <p className="sub">כל מה שהמערכת קוראת, איך היא משקללת את זה, וכמה היא צודקת בפועל.</p>

      <section className="card">
        <h2>דיוק בפועל</h2>
        <p className="small">
          כל תחזית שמוצגת באתר נרשמת, ונבדקת מול המחיר האמיתי אחרי 5 ו־20 ימי מסחר. זו המדידה היחידה שמכסה את המודל
          המלא, כולל חדשות ופורומים.
        </p>
        {loading && <p className="state" role="status">טוען…</p>}
        {error && <p className="state err" role="alert">לא ניתן לטעון את נתוני הדיוק: {error.message}</p>}
        {data && (
          <>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">דיוק התחזיות לפי אופק</caption>
                <thead>
                  <tr><th>אופק</th><th className="n">תחזיות שנבדקו</th><th className="n">פגיעה בכיוון</th><th className="n">מדד Brier</th></tr>
                </thead>
                <tbody>
                  {data.horizons.map((h) => (
                    <tr key={h.days} className="static">
                      <td>{h.days} ימי מסחר</td>
                      <td className="n" dir="ltr">{h.matured}</td>
                      <td className="n" dir="ltr">{fmt.prob(h.hitRate)}</td>
                      <td className="n" dir="ltr">{h.brier != null ? h.brier.toFixed(3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              נרשמו {data.logged} תחזיות על {data.symbols} מניות{data.since ? <> מאז {fmt.date(data.since)}</> : null}.
              {data.horizons.every((h) => !h.matured) && ' עדיין אין תחזיות שהגיע מועד הבדיקה שלהן.'} מדד Brier מודד את טעות
              ההסתברות: 0.25 שקול לניחוש, נמוך יותר עדיף.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>איך בנויה התחזית</h2>
        <ol className="steps">
          <li>כל גורם מקבל ציון בין שלילי לחיובי, לפי הנתונים העדכניים של המניה.</li>
          <li>המשקל של כל גורם נקבע לפי כמה הוא הוכיח את עצמו במחקר. האות הטכני נבדק גם על ההיסטוריה של המניה עצמה, ומשקלו יורד אם לא עבד בה.</li>
          <li>הציון המשוקלל מטה את התשואה הצפויה, והתנודתיות של המניה קובעת את טווח המחירים ואת ההסתברות לעלייה.</li>
          <li>רמת הביטחון יורדת כשהגורמים סותרים זה את זה, כשההיסטוריה קצרה או כשהאות הטכני נכשל בעבר.</li>
        </ol>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">הגורמים לפי חוזק הביסוס המחקרי</caption>
            <thead><tr><th>ביסוס מחקרי</th><th>גורמים</th></tr></thead>
            <tbody>
              {FACTORS.map(([tier, text]) => (
                <tr key={tier} className="static"><td><b>{tier}</b></td><td>{text}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>מקורות המידע</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">רשימת מקורות המידע ומצבם</caption>
            <thead><tr><th>מקור</th><th>מה נלקח ממנו</th><th>מצב</th></tr></thead>
            <tbody>
              {SOURCES.map(([name, what, status]) => (
                <tr key={name} className="static">
                  <td dir="ltr" lang="en"><b>{name}</b></td>
                  <td>{what}</td>
                  <td>{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
