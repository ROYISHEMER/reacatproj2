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
  ['משרד האוצר האמריקאי', 'תשואות אג״ח יומיות ושיפוע העקום', 'פעיל'],
  ['Polymarket', 'הסתברויות של שוקי חיזוי לריבית ולמיתון', 'פעיל'],
  ['Claude (Anthropic)', 'קריאת הכותרות, דירוג סנטימנט, זיהוי אירועים וסיכום אנליסט', 'מופעל עם מפתח API'],
  ['Yahoo Finance', 'מחירים וחדשות', 'לא מחובר: חוסם את השרת'],
];

const FACTORS = [
  ['חזק', 'מומנטום ומגמת מחיר, עדכוני תחזיות רווח של אנליסטים, הפתעה בדוח האחרון'],
  ['בינוני', 'קונצנזוס ומחירי יעד של אנליסטים, סנטימנט חדשות, מצב השוק הכללי, חוזק יחסי לשוק, מגמת הסקטור'],
  ['נבדק על המניה', 'תאומים היסטוריים: נכנס לתחזית רק אם ניצח את הניחוש הקבוע בבדיקה לאחור על אותה מניה'],
  ['חלש', 'סנטימנט ברשתות ובפורומים, בעלי עניין, מוסדיים, שורט, אופציות'],
];

export default function Sources() {
  const { loading, data, error } = useApi('/api/track-record');
  const ai = useApi('/api/ai/status').data;
  const learned = data ? Object.entries(data.learned || {}) : [];
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
        <h2>מה המערכת למדה</h2>
        <p className="small">
          עם כל תחזית נשמר גם הציון של כל גורם. כשמצטברות לפחות 30 תחזיות שהגיע מועד הבדיקה שלהן, המשקל של כל גורם
          מותאם לפי שיעור הפגיעה האמיתי שלו (בין חצי לפי אחד וחצי מהמשקל המקורי).
        </p>
        {learned.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">שיעור הפגיעה והמשקל הנלמד של כל גורם</caption>
              <thead><tr><th>גורם</th><th className="n">תחזיות שנבדקו</th><th className="n">פגיעה בכיוון</th><th className="n">מכפיל משקל</th></tr></thead>
              <tbody>
                {learned.map(([key, v]) => (
                  <tr key={key} className="static">
                    <td dir="ltr" lang="en">{key}</td>
                    <td className="n" dir="ltr">{v.samples}</td>
                    <td className="n" dir="ltr">{fmt.prob(v.hitRate)}</td>
                    <td className="n" dir="ltr">×{v.multiplier.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">עדיין אין מספיק תחזיות שהבשילו כדי ללמוד מהן. המשקלים הם אלה שנקבעו לפי המחקר.</p>
        )}
      </section>

      <section className="card">
        <h2>שכבת ה־AI</h2>
        {ai ? (
          <>
            <p>
              מצב: <b>{ai.enabled ? 'פעילה' : 'כבויה (לא הוגדר מפתח API)'}</b> · מודל: <span dir="ltr">{ai.model}</span> · עומק חשיבה:{' '}
              <span dir="ltr">{ai.effort}</span>
            </p>
            <dl className="kv">
              <div><dt>קריאות היום</dt><dd dir="ltr">{ai.calls} / {ai.dailyLimit}</dd></div>
              <div><dt>נענו מהמטמון</dt><dd dir="ltr">{ai.cacheHits}</dd></div>
              <div><dt>טוקנים (קלט / פלט)</dt><dd dir="ltr">{ai.inputTokens.toLocaleString('en-US')} / {ai.outputTokens.toLocaleString('en-US')}</dd></div>
            </dl>
            <p className="muted small">
              המודל קורא רק את הכותרות שנאספו, מדרג אותן ומסכם. הוא לא מקבל מחירים ולא מתבקש לחזות מחיר, כדי שידע מוקדם
              שלו לא יזלוג לתחזית. התוצאה נשמרת 6 שעות לכל מניה כדי לחסוך בעלות.
            </p>
          </>
        ) : <p className="muted small">טוען…</p>}
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
