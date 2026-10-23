import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * Business Engine charts (dataviz method): fixed categorical slots (--series-1..3), one y-axis,
 * thin marks with 4px rounded data-ends, 2px surface gaps between stacked fills, recessive grid,
 * legend for ≥2 series, hover tooltips. Text always uses text tokens, never series colours.
 */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;

const PAD = { top: 10, right: 10, bottom: 22, left: 56 };
/** Nice axis: step from {1, 2, 2.5, 5}×10ⁿ, bounds are multiples of the step, so zero is always a gridline. */
function niceScale(min: number, max: number): { lo: number; hi: number; step: number } {
  const span = Math.max(max - min, 1e-9);
  const raw = span / 4; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step; const hi = Math.ceil(max / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}

/** Track the rendered width so the viewBox matches it and 9px labels stay 9px. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; line?: boolean }[] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.line ? <svg width="14" height="6" aria-hidden><line x1="0" x2="14" y1="3" y2="3" stroke={i.color} strokeWidth="2" strokeDasharray={i.dashed ? '3 2' : undefined} /></svg>
            : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, children }: { x: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${Math.min(88, Math.max(12, x))}%` }}>
      {children}
    </div>
  );
}
function Grid({ width, lo, hi, step, y, format }: { width: number; lo: number; hi: number; step: number; y: (v: number) => number; format: (v: number) => string }) {
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + step * i);
  return <>{ticks.map((t) => (
    <g key={t}>
      <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={Math.abs(t) < 1e-9 ? 1 : 0.5} strokeDasharray={Math.abs(t) < 1e-9 ? undefined : '2 3'} />
      <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>{format(t)}</text>
    </g>))}</>;
}

export interface ColumnSeries { label: string; color: string; values: number[] }
/** Stacked columns (positive parts) with an optional line on the SAME axis. Negative values stack below zero. */
export function StackedColumns({ labels, series, line, format, height = 200, onSelect }: {
  labels: string[]; series: ColumnSeries[]; line?: { label: string; color: string; values: number[] }; format: (v: number) => string; height?: number; onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth(); const n = labels.length || 1;
  const pos = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
  const neg = labels.map((_, i) => series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0));
  const { lo, hi, step } = niceScale(Math.min(0, ...neg, ...(line?.values ?? [])), Math.max(0, ...pos, ...(line?.values ?? [])));
  const ih = height - PAD.top - PAD.bottom; const y = (v: number) => PAD.top + ih * (1 - (v - lo) / (hi - lo));
  const slot = (width - PAD.left - PAD.right) / n; const bw = Math.max(2, Math.min(26, slot * 0.6));
  const every = Math.ceil(n / Math.max(4, Math.floor(width / 60)));
  return (
    <div className="relative" ref={ref}>
      <Legend items={[...series.map((s) => ({ label: s.label, color: s.color })), ...(line ? [{ label: line.label, color: line.color, line: true }] : [])]} />
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(', ')}>
        <Grid width={width} lo={lo} hi={hi} step={step} y={y} format={format} />
        {labels.map((label, i) => {
          const x = PAD.left + slot * i + (slot - bw) / 2;
          let up = 0; let down = 0;
          const parts = series.map((s, si) => {
            const v = s.values[i] ?? 0; if (Math.abs(v) < 1e-9) return null;
            const from = v >= 0 ? up : down; const to = from + v; if (v >= 0) up = to; else down = to;
            const top = Math.min(y(from), y(to)); const h = Math.max(0, Math.abs(y(to) - y(from)) - (si > 0 ? 2 : 0));
            const isEnd = v >= 0 ? series.slice(si + 1).every((o) => (o.values[i] ?? 0) <= 0) : series.slice(si + 1).every((o) => (o.values[i] ?? 0) >= 0);
            const r = isEnd ? Math.min(4, bw / 2, h) : 0;
            const d = v >= 0
              ? `M${x},${top + h} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`
              : `M${x},${top} v${h - r} q0,${r} ${r},${r} h${bw - 2 * r} q${r},0 ${r},${-r} v${-(h - r)} z`;
            return <path key={si} d={d} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} pointerEvents="none" />;
          });
          return (
            <g key={label + i}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(i)} className={onSelect ? 'cursor-pointer' : undefined} />
              {parts}
              {i % every === 0 && <text x={x + bw / 2} y={height - 7} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{label}</text>}
            </g>
          );
        })}
        {line && <polyline fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" pointerEvents="none"
          points={line.values.map((v, i) => `${PAD.left + slot * i + slot / 2},${y(v)}`).join(' ')} />}
        {line && hover !== null && <circle cx={PAD.left + slot * hover + slot / 2} cy={y(line.values[hover] ?? 0)} r={4} fill={line.color} className="stroke-card" strokeWidth={2} />}
      </svg>
      {hover !== null && (
        <Tooltip x={((PAD.left + slot * hover + slot / 2) / width) * 100}>
          <div className="mb-0.5 font-medium">{labels[hover]}</div>
          {series.map((s) => <div key={s.label} className="flex justify-between gap-3"><span className="text-muted-foreground"><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span><span>{format(s.values[hover] ?? 0)}</span></div>)}
          {line && <div className="flex justify-between gap-3"><span className="text-muted-foreground">{line.label}</span><span>{format(line.values[hover] ?? 0)}</span></div>}
        </Tooltip>
      )}
    </div>
  );
}

export interface LineSeries { label: string; color: string; values: (number | null)[]; dashed?: boolean }
/** Lines on one axis with optional horizontal reference (e.g. cash reserve) and crosshair tooltip. */
export function LineChart({ labels, series, reference, format, height = 200 }: {
  labels: string[]; series: LineSeries[]; reference?: { value: number; label: string }; format: (v: number) => string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth(); const n = Math.max(1, labels.length);
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const { lo, hi, step: tick } = niceScale(Math.min(0, ...values, reference?.value ?? 0), Math.max(0, ...values, reference?.value ?? 0));
  const ih = height - PAD.top - PAD.bottom; const y = (v: number) => PAD.top + ih * (1 - (v - lo) / (hi - lo));
  const step = (width - PAD.left - PAD.right) / Math.max(1, n - 1); const x = (i: number) => PAD.left + (n === 1 ? (width - PAD.left - PAD.right) / 2 : step * i);
  const every = Math.ceil(n / Math.max(4, Math.floor(width / 60)));
  return (
    <div className="relative" ref={ref}>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed, line: true }))} />}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(', ')}
        onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - rect.left) / rect.width) * width;
          setHover(Math.max(0, Math.min(n - 1, Math.round((px - PAD.left) / (n === 1 ? 1 : step)))));
        }}>
        <Grid width={width} lo={lo} hi={hi} step={tick} y={y} format={format} />
        {reference && <g><line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} className="stroke-destructive" strokeWidth={1} strokeDasharray="4 3" />
          <text x={width - PAD.right} y={y(reference.value) - 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>{reference.label}</text></g>}
        {labels.map((l, i) => i % every === 0 && <text key={l + i} x={x(i)} y={height - 7} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{l}</text>)}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
          return <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? '4 3' : undefined} points={pts} />;
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className="stroke-muted-foreground" strokeWidth={0.75} />}
        {hover !== null && series.map((s) => s.values[hover] !== null && <circle key={s.label} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} className="stroke-card" strokeWidth={2} />)}
      </svg>
      {hover !== null && (
        <Tooltip x={(x(hover) / width) * 100}>
          <div className="mb-0.5 font-medium">{labels[hover]}</div>
          {series.map((s) => <div key={s.label} className="flex justify-between gap-3"><span className="text-muted-foreground">{s.label}</span><span>{s.values[hover] === null ? '—' : format(s.values[hover] as number)}</span></div>)}
        </Tooltip>
      )}
    </div>
  );
}

/** Utilization heatmap: one sequential hue for 0–100 %; over-allocation is a state (critical) and carries a "!" marker. */
export function Heatmap({ rows, columns, overLabel, format }: {
  rows: { id: string; label: string; cells: { value: number | null; detail: string }[]; onClick?: () => void }[]; columns: string[]; overLabel: string; format: (v: number) => string;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const shade = (v: number | null) => v === null ? 'transparent' : v > 1.0001 ? 'hsl(var(--destructive))' : v < 0.05 ? 'hsl(var(--muted))'
    : `var(--seq-${v < 0.3 ? 100 : v < 0.5 ? 200 : v < 0.7 ? 300 : v < 0.85 ? 400 : v < 0.95 ? 500 : 600})`;
  const every = Math.ceil(columns.length / 13);
  return (
    <div className="relative overflow-x-auto">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>0 %</span>{[100, 200, 300, 400, 500, 600].map((s) => <span key={s} className="h-2.5 w-4 rounded-sm" style={{ background: `var(--seq-${s})` }} />)}<span>100 %</span>
        <span className="ml-3 inline-flex items-center gap-1"><span className="flex h-2.5 w-4 items-center justify-center rounded-sm bg-destructive text-[8px] font-bold text-white">!</span>{overLabel}</span>
      </div>
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th />{columns.map((c, i) => <th key={i} title={c} className="px-0 text-[9px] font-normal text-muted-foreground">{i % every === 0 ? c.slice(5) : ''}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => (
          <tr key={row.id}>
            <th scope="row" className="max-w-40 truncate pr-2 text-left text-xs font-normal">{row.onClick ? <button className="hover:underline" onClick={row.onClick}>{row.label}</button> : row.label}</th>
            {row.cells.map((cell, c) => (
              <td key={c} className={clsx('h-4 w-4 min-w-4 rounded-sm text-center align-middle text-[8px] font-bold text-white', hover?.r === r && hover?.c === c && 'ring-2 ring-foreground')}
                style={{ background: shade(cell.value) }} onMouseEnter={() => setHover({ r, c })} onMouseLeave={() => setHover(null)} aria-label={`${row.label} ${columns[c]}: ${cell.detail}`}>
                {cell.value !== null && cell.value > 1.0001 ? '!' : ''}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      {hover && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg" style={{ left: 16, bottom: 16 }}>
          <div className="font-medium">{rows[hover.r].label} · {columns[hover.c]}</div>
          <div className="text-muted-foreground">{rows[hover.r].cells[hover.c].detail} ({rows[hover.r].cells[hover.c].value === null ? '—' : format(rows[hover.r].cells[hover.c].value as number)})</div>
        </div>
      )}
    </div>
  );
}
