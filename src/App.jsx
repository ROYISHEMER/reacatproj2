import { useEffect, useState } from 'react';
import Movers from './components/Movers.jsx';
import Stock from './components/Stock.jsx';
import Search from './components/Search.jsx';
import Sources from './components/Sources.jsx';

const parse = () => {
  const hash = window.location.hash;
  if (hash.startsWith('#/sources')) return { page: 'sources' };
  const m = /^#\/stock\/([A-Za-z0-9.\-]+)/.exec(hash);
  return m ? { page: 'stock', symbol: m[1].toUpperCase() } : { page: 'home' };
};

export default function App() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
      // Move keyboard and screen-reader focus to the new page's content.
      document.getElementById('main')?.focus();
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    const titles = { home: 'תחזית מניות', sources: 'מקורות, שיטה ודיוק · תחזית מניות', stock: `${route.symbol} · תחזית מניות` };
    document.title = titles[route.page];
  }, [route]);

  return (
    <>
      <a className="skip" href="#main">דילוג לתוכן הראשי</a>
      <header className="top">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">◢</span> תחזית מניות
        </a>
        <Search />
        <nav aria-label="ניווט ראשי">
          <a href="#/" aria-current={route.page === 'home' ? 'page' : undefined}>מניות פעילות</a>
          <a href="#/sources" aria-current={route.page === 'sources' ? 'page' : undefined}>מקורות ודיוק</a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {route.page === 'stock' && <Stock key={route.symbol} symbol={route.symbol} />}
        {route.page === 'sources' && <Sources />}
        {route.page === 'home' && <Movers />}
      </main>
      <footer className="disclaimer">
        המידע באתר נאסף אוטומטית ממקורות ציבוריים ומוצג לצורכי מידע בלבד. התחזיות הן הערכות סטטיסטיות עם אי־ודאות
        גבוהה, אינן מהוות ייעוץ השקעות ואינן תחליף לשיקול דעת עצמאי.
      </footer>
    </>
  );
}
