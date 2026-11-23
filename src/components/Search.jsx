import { useEffect, useState } from 'react';

export default function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setResults(Array.isArray(d) ? d.slice(0, 8) : []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (symbol) => {
    window.location.hash = `#/stock/${symbol}`;
    setQ('');
    setOpen(false);
  };

  return (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        const s = results[0]?.symbol || q.trim().toUpperCase();
        if (s) go(s);
      }}
    >
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
        placeholder="חיפוש מניה או סימול (למשל NVDA)"
        aria-label="חיפוש מניה"
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.symbol}>
              <button type="button" onMouseDown={() => go(r.symbol)}>
                <b dir="ltr">{r.symbol}</b>
                <span dir="ltr">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
