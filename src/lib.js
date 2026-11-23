import { useEffect, useState } from 'react';

export function useApi(url) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    setState({ loading: true, data: null, error: null });
    fetch(url)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      })
      .then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => live && setState({ loading: false, data: null, error }));
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

export const fmt = {
  price: (v) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`),
  pct: (v, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`),
  prob: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`),
  big: (v) => {
    if (v == null) return '—';
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [n, u] of units) if (Math.abs(v) >= n) return `${(v / n).toFixed(v / n >= 100 ? 0 : 1)}${u}`;
    return String(Math.round(v));
  },
  date: (iso) => (iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'),
  ago: (iso) => {
    const h = (Date.now() - new Date(iso).getTime()) / 3600000;
    if (h < 1) return 'לפני פחות משעה';
    if (h < 24) return `לפני ${Math.round(h)} שע׳`;
    return `לפני ${Math.round(h / 24)} ימים`;
  },
};

export const DIRECTION = {
  up: { text: 'עלייה', icon: '▲', cls: 'up' },
  down: { text: 'ירידה', icon: '▼', cls: 'down' },
  flat: { text: 'ניטרלי', icon: '■', cls: 'flat' },
};
export const CONFIDENCE = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
export const sign = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
