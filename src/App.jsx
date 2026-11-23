import { useEffect, useState } from 'react';
import Movers from './components/Movers.jsx';
import Stock from './components/Stock.jsx';
import Search from './components/Search.jsx';

const parse = () => {
  const m = /^#\/stock\/([A-Za-z0-9.\-]+)/.exec(window.location.hash);
  return m ? m[1].toUpperCase() : null;
};

export default function App() {
  const [symbol, setSymbol] = useState(parse);
  useEffect(() => {
    const on = () => {
      setSymbol(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">◢</span> תחזית מניות
        </a>
        <Search />
      </header>
      <main>{symbol ? <Stock key={symbol} symbol={symbol} /> : <Movers />}</main>
      <footer className="disclaimer">
        המידע באתר נאסף אוטומטית ממקורות ציבוריים ומוצג לצורכי מידע בלבד. התחזיות הן הערכות סטטיסטיות עם אי־ודאות
        גבוהה, אינן מהוות ייעוץ השקעות ואינן תחליף לשיקול דעת עצמאי.
      </footer>
    </>
  );
}
