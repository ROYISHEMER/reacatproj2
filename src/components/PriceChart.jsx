import { useMemo, useRef, useState } from 'react';
import { fmt } from '../lib.js';

const W = 860;
const H = 320;
const PAD = { l: 12, r: 64, t: 16, b: 28 };

// Next n weekdays after an ISO date.
function tradingDays(fromIso, n) {
  const out = [];
  const d = new Date(`${fromIso}T00:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function PriceChart({ history, path }) {
  const [hover, setHover] = useState(null);
  const svg = useRef(null);

  const model = useMemo(() => {
    const hist = history.slice(-130);
    const future = path ? tradingDays(hist[hist.length - 1].date, path.length) : [];
    const points = [
      ...hist.map((h) => ({ date: h.date, close: h.close })),
      ...future.map((date, i) => ({ date, mid: path[i].mid, low: path[i].low, high: path[i].high })),
    ];
    const vals = points.flatMap((p) => (p.close != null ? [p.close] : [p.low, p.high]));
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = (max - min) * 0.06 || 1;
    min -= pad;
    max += pad;
    const x = (i) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    const line = (arr, key, offset = 0) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(i + offset).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    const nH = hist.length;
    const last = hist[nH - 1];
    const fut = points.slice(nH);
    const midPath = `M${x(nH - 1).toFixed(1)},${y(last.close).toFixed(1)}` + fut.map((p, i) => `L${x(nH + i).toFixed(1)},${y(p.mid).toFixed(1)}`).join('');
    const band =
      `M${x(nH - 1).toFixed(1)},${y(last.close).toFixed(1)}` +
      fut.map((p, i) => `L${x(nH + i).toFixed(1)},${y(p.high).toFixed(1)}`).join('') +
      fut.slice().reverse().map((p, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(p.low).toFixed(1)}`).join('') +
      'Z';
    const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * (i + 0.5)) / 5);
    const months = [];
    points.forEach((p, i) => {
      if (i && p.date.slice(0, 7) !== points[i - 1].date.slice(0, 7)) months.push({ i, label: new Date(`${p.date}T00:00:00Z`).toLocaleDateString('he-IL', { month: 'short', timeZone: 'UTC' }) });
    });
    return { points, x, y, nH, last, histPath: line(hist, 'close'), midPath, band, ticks, months, hasFuture: fut.length > 0 };
  }, [history, path]);

  const { points, x, y, nH } = model;
  const onMove = (e) => {
    const rect = svg.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover != null ? points[hover] : null;
  const hv = hp ? hp.close ?? hp.mid : null;
  const end = points[points.length - 1];

  return (
    <div className="chart" dir="ltr">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="גרף מחיר היסטורי ותחזית" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {model.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={W - PAD.r + 8} y={y(t) + 4} className="axis">{fmt.price(t)}</text>
          </g>
        ))}
        {model.months.map((m) => (
          <text key={m.i} x={x(m.i)} y={H - 8} className="axis" textAnchor="middle">{m.label}</text>
        ))}
        {model.hasFuture && (
          <>
            <line x1={x(nH - 1)} x2={x(nH - 1)} y1={PAD.t} y2={H - PAD.b} className="today" />
            <path d={model.band} className="band" />
            <path d={model.midPath} className="mid" />
            <circle cx={x(points.length - 1)} cy={y(end.mid)} r="4" className="dot" />
          </>
        )}
        <path d={model.histPath} className="hist" />
        <circle cx={x(nH - 1)} cy={y(model.last.close)} r="4" className="dot" />
        {hp && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="cross" />
            <circle cx={x(hover)} cy={y(hv)} r="5" className="dot" />
          </>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }} dir="rtl">
          <b>{fmt.date(hp.date)}</b>
          {hp.close != null ? (
            <span>מחיר סגירה: <span dir="ltr">{fmt.price(hp.close)}</span></span>
          ) : (
            <>
              <span>תחזית: <span dir="ltr">{fmt.price(hp.mid)}</span></span>
              <span>טווח 80%: <span dir="ltr">{fmt.price(hp.low)} – {fmt.price(hp.high)}</span></span>
            </>
          )}
        </div>
      )}
      <div className="legend" dir="rtl">
        <span><i className="k k-hist" /> מחיר בפועל</span>
        <span><i className="k k-mid" /> מסלול תחזית</span>
        <span><i className="k k-band" /> טווח סבירות 80%</span>
      </div>
    </div>
  );
}
