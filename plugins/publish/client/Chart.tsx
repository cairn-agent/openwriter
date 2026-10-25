/**
 * A small line chart (plain SVG, no library): one line per series over dated points, the last
 * value of each named in the legend. Sized by its container; hover shows the date's values.
 */
import { useState } from 'react';

export interface Series { key: string; label: string; color: string }

export default function LineChart({ points, series, label }: {
  points: Array<{ date: string } & Record<string, number | string>>;
  series: Series[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 36, r: 8, t: 8, b: 22 };
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)));
  const x = (i: number) => pad.l + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), max];
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const at = hover ?? points.length - 1;
  return (
    <figure className="ows-chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ows-chart-grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="ows-chart-axis">{t.toLocaleString()}</text>
          </g>
        ))}
        {points.length > 0 && (
          <>
            <text x={pad.l} y={H - 4} className="ows-chart-axis">{fmt(points[0].date)}</text>
            <text x={W - pad.r} y={H - 4} textAnchor="end" className="ows-chart-axis">{fmt(points[points.length - 1].date)}</text>
          </>
        )}
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke"
            points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]) || 0)}`).join(' ')} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="ows-chart-grid" />}
      </svg>
      {points.length > 0 && (
        <figcaption className="ows-chart-legend">
          <span>{fmt(points[at].date)}</span>
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label} {(Number(points[at][s.key]) || 0).toLocaleString()}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
