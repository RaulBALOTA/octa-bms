import clsx from 'clsx';
import { ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * Dependency-free SVG charts following the dataviz mark specs: thin marks,
 * 4px rounded data-ends anchored to the baseline, 2px lines, 2px surface gaps
 * between fills, recessive grid, hover tooltip on every mark, text in text
 * tokens (never the series color). Categorical colors come from the fixed
 * --chart-N slots (validated light + dark), assigned in order, never cycled.
 */

export const CHART_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--chart-${n})`);
/** Slot for an entity index; past 8 folds into a neutral "other" color. */
export const slotColor = (index: number) =>
  index < CHART_SLOTS.length ? CHART_SLOTS[index] : 'hsl(var(--muted-foreground))';

/** Ordinal single-hue ramp (5 steps) for ordered categories such as aging buckets. */
export const ORDINAL_SLOTS = [1, 2, 3, 4, 5].map((n) => `var(--ord-${n})`);

const PAD = { top: 14, right: 12, bottom: 26, left: 52 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const mult of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= magnitude * mult) return magnitude * mult;
  }
  return magnitude * 10;
}

/** Track the rendered width of a container so SVG text stays at true size. */
function useWidth<T extends HTMLElement>(fallback = 560) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tooltip({
  left,
  top = 0,
  children,
}: {
  left: number;
  top?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-28 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left, top }}
    >
      {children}
    </div>
  );
}

function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function Legend({
  items,
  className,
}: {
  items: { label: string; color: string; value?: string }[];
  className?: string;
}) {
  return (
    <ul className={clsx('flex flex-wrap gap-x-4 gap-y-1 text-xs', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value && <span className="font-medium tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** y-axis grid shared by the cartesian charts */
function Grid({
  ticks,
  y,
  width,
  format,
}: {
  ticks: number[];
  y: (v: number) => number;
  width: number;
  format: (v: number) => string;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeWidth={tick === 0 ? 1 : 0.6}
            strokeDasharray={tick === 0 ? undefined : '3 4'}
          />
          <text
            x={PAD.left - 8}
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {format(tick)}
          </text>
        </g>
      ))}
    </>
  );
}

/** Thin out x labels so they never collide (~1 per 56px). */
function labelStep(count: number, width: number) {
  const fit = Math.max(1, Math.floor((width - PAD.left - PAD.right) / 56));
  return Math.max(1, Math.ceil(count / fit));
}

/* ------------------------------------------------------------- Bar */

export interface BarDatum {
  label: string;
  value: number;
  hint?: string; // tooltip line, defaults to formatted value
}

export function BarChart({
  data,
  height = 200,
  formatValue = (v) => String(v),
  highlight,
}: {
  data: BarDatum[];
  /** @deprecated width now follows the container */
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
  /** index drawn at full strength while the rest recede (e.g. current month) */
  highlight?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const slot = innerWidth / Math.max(1, data.length);
  const barWidth = Math.max(2, Math.min(32, slot - 2, slot * 0.62));
  const y = (v: number) => PAD.top + innerHeight * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const step = labelStep(data.length, width);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" className="block overflow-visible">
        <Grid ticks={ticks} y={y} width={width} format={formatValue} />
        {data.map((d, i) => {
          const x = PAD.left + slot * i + (slot - barWidth) / 2;
          const barHeight = Math.max(0, y(0) - y(Math.max(0, d.value)));
          const r = Math.min(4, barWidth / 2, barHeight);
          const dim =
            hover !== null ? hover !== i : highlight !== undefined && highlight !== i;
          return (
            <g key={i}>
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={innerHeight}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {barHeight > 0 && (
                <path
                  d={`M${x},${y(0)} v${-(barHeight - r)} q0,${-r} ${r},${-r} h${barWidth - 2 * r} q${r},0 ${r},${r} v${barHeight - r} z`}
                  fill={CHART_SLOTS[0]}
                  opacity={dim ? 0.55 : 1}
                  pointerEvents="none"
                  className="transition-opacity"
                />
              )}
              {i % step === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip left={PAD.left + slot * hover + slot / 2}>
          <div className="font-medium">{data[hover].label}</div>
          <div className="text-muted-foreground">
            {data[hover].hint ?? formatValue(data[hover].value)}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Area */

export interface SeriesPoint {
  label: string;
  value: number;
  hint?: string;
}

/** Single-series line + soft area with a crosshair tooltip. Handles negatives. */
export function AreaChart({
  data,
  height = 200,
  formatValue = (v) => String(v),
  color = CHART_SLOTS[0],
  name,
}: {
  data: SeriesPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  color?: string;
  name?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = `area-${useId().replace(/:/g, '')}`;

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const values = data.map((d) => d.value);
  const hi = niceMax(Math.max(0, ...values));
  const rawLo = Math.min(0, ...values);
  const lo = rawLo < 0 ? -niceMax(-rawLo) : 0;
  const span = hi - lo || 1;
  const x = (i: number) =>
    PAD.left + (data.length <= 1 ? innerWidth / 2 : (innerWidth * i) / (data.length - 1));
  const y = (v: number) => PAD.top + innerHeight * (1 - (v - lo) / span);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (span * i) / 4);
  const step = labelStep(data.length, width);

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const area = data.length
    ? `${line} L${x(data.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`
    : '';

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1)))));
  };

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" className="block overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Grid ticks={ticks} y={y} width={width} format={formatValue} />
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map(
          (d, i) =>
            i % step === 0 && (
              <text
                key={i}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {d.label}
              </text>
            ),
        )}
        {hover !== null && data[hover] && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerHeight}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(data[hover].value)}
              r={5}
              fill={color}
              className="stroke-card"
              strokeWidth={2}
            />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip left={x(hover)}>
          <div className="font-medium">{data[hover].label}</div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Swatch color={color} />
            {name && <span>{name}</span>}
            <span className="font-medium text-foreground">
              {data[hover].hint ?? formatValue(data[hover].value)}
            </span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/* --------------------------------------------------- Diverging bars */

export interface DivergingDatum {
  label: string;
  up: number;
  down: number;
}

/** Inflow above / outflow below a shared zero baseline — one axis, two series. */
export function DivergingBarChart({
  data,
  upLabel,
  downLabel,
  height = 220,
  formatValue = (v) => String(v),
}: {
  data: DivergingDatum[];
  upLabel: string;
  downLabel: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.up, d.down))));
  const slot = innerWidth / Math.max(1, data.length);
  const barWidth = Math.max(2, Math.min(26, slot * 0.6));
  const y = (v: number) => PAD.top + innerHeight * (1 - (v + max) / (2 * max));
  const ticks = [-max, -max / 2, 0, max / 2, max];
  const step = labelStep(data.length, width);
  const fmtAbs = (v: number) => formatValue(Math.abs(v));

  const bar = (x: number, from: number, to: number) => {
    const h = Math.abs(y(to) - y(from));
    if (h <= 0.5) return '';
    const r = Math.min(4, barWidth / 2, h);
    if (to > from)
      return `M${x},${y(from) - 1} v${-(h - 1 - r)} q0,${-r} ${r},${-r} h${barWidth - 2 * r} q${r},0 ${r},${r} v${h - 1 - r} z`;
    return `M${x},${y(from) + 1} v${h - 1 - r} q0,${r} ${r},${r} h${barWidth - 2 * r} q${r},0 ${r},${-r} v${-(h - 1 - r)} z`;
  };

  return (
    <div>
      <Legend
        className="mb-2"
        items={[
          { label: upLabel, color: CHART_SLOTS[0] },
          { label: downLabel, color: CHART_SLOTS[1] },
        ]}
      />
      <div ref={ref} className="relative">
        <svg width={width} height={height} role="img" className="block overflow-visible">
          <Grid ticks={ticks} y={y} width={width} format={fmtAbs} />
          {data.map((d, i) => {
            const x = PAD.left + slot * i + (slot - barWidth) / 2;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.4 : 1} className="transition-opacity">
                <path d={bar(x, 0, d.up)} fill={CHART_SLOTS[0]} />
                <path d={bar(x, 0, -d.down)} fill={CHART_SLOTS[1]} />
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {i % step === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={height - 8}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={10}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <Tooltip left={PAD.left + slot * hover + slot / 2}>
            <div className="mb-0.5 font-medium">{data[hover].label}</div>
            <div className="flex items-center gap-1.5">
              <Swatch color={CHART_SLOTS[0]} />
              <span className="text-muted-foreground">{upLabel}</span>
              <span className="ml-auto font-medium tabular-nums">
                {formatValue(data[hover].up)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Swatch color={CHART_SLOTS[1]} />
              <span className="text-muted-foreground">{downLabel}</span>
              <span className="ml-auto font-medium tabular-nums">
                {formatValue(data[hover].down)}
              </span>
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Donut */

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  return `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

/** Part-to-whole for ≤ 6 parts, with a center headline and a value legend. */
export function DonutChart({
  data,
  size = 168,
  centerLabel,
  centerValue,
  formatValue = (v) => String(v),
  legend = 'right',
}: {
  data: DonutDatum[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
  formatValue?: (v: number) => string;
  legend?: 'right' | 'bottom' | 'none';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const cx = size / 2;
  const r1 = size / 2 - 2;
  const r0 = r1 * 0.66;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 0.025 : 0;

  let angle = 0;
  const arcs = data.map((d, i) => {
    const sweep = total > 0 ? (Math.max(0, d.value) / total) * Math.PI * 2 : 0;
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    angle += sweep;
    return { ...d, color: d.color ?? slotColor(i), a0, a1, sweep };
  });
  const focus = hover !== null ? arcs[hover] : null;

  return (
    <div
      className={clsx(
        'flex gap-5',
        legend === 'bottom' ? 'flex-col items-center' : 'flex-wrap items-center',
      )}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img">
          {total === 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={(r0 + r1) / 2}
              fill="none"
              className="stroke-muted"
              strokeWidth={r1 - r0}
            />
          ) : (
            arcs.map(
              (arc, i) =>
                arc.sweep > 0 && (
                  <path
                    key={arc.label}
                    d={
                      arc.sweep >= Math.PI * 2 - 1e-6
                        ? arcPath(cx, cx, r0, r1, 0, Math.PI * 2 - 1e-4)
                        : arcPath(cx, cx, r0, r1, arc.a0, Math.max(arc.a0 + 0.002, arc.a1))
                    }
                    fill={arc.color}
                    opacity={hover === null || hover === i ? 1 : 0.35}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                ),
            )
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="text-lg font-bold leading-tight tabular-nums">
            {focus ? formatValue(focus.value) : centerValue ?? formatValue(total)}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
            {focus
              ? `${focus.label} · ${total ? Math.round((focus.value / total) * 100) : 0}%`
              : centerLabel}
          </div>
        </div>
      </div>
      {legend !== 'none' && (
        <ul className="min-w-36 flex-1 space-y-1.5 text-xs">
          {arcs.map((arc, i) => (
            <li
              key={arc.label}
              className={clsx(
                'flex items-center gap-2 rounded px-1 py-0.5 transition-colors',
                hover === i && 'bg-muted',
              )}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <Swatch color={arc.color} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{arc.label}</span>
              <span className="font-medium tabular-nums">{formatValue(arc.value)}</span>
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {total ? Math.round((arc.value / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Gauge */

/** Radial progress for a single ratio (0–100). Status tone, always labeled. */
export function RingGauge({
  value,
  size = 96,
  stroke = 9,
  label,
  tone = 'primary',
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  tone?: 'primary' | 'success' | 'warning' | 'destructive';
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const toneClass = {
    primary: 'stroke-primary',
    success: 'stroke-success',
    warning: 'stroke-warning',
    destructive: 'stroke-destructive',
  }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${clamped}%`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-muted"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={clsx(toneClass, 'transition-[stroke-dashoffset] duration-700')}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums">{Math.round(clamped)}%</span>
        {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ Segment bar */

/** One 100% stacked bar with a legend underneath — composition at a glance. */
export function SegmentBar({
  data,
  formatValue = (v) => String(v),
  height = 14,
  onSelect,
  selected,
}: {
  data: DonutDatum[];
  formatValue?: (v: number) => string;
  height?: number;
  onSelect?: (label: string) => void;
  selected?: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  return (
    <div>
      <div className="flex gap-[2px] overflow-hidden rounded-full bg-muted" style={{ height }}>
        {total > 0 &&
          data.map(
            (d, i) =>
              d.value > 0 && (
                <button
                  type="button"
                  key={d.label}
                  aria-label={`${d.label}: ${formatValue(d.value)}`}
                  className={clsx(
                    'h-full transition-opacity first:rounded-l-full last:rounded-r-full',
                    !onSelect && 'cursor-default',
                  )}
                  style={{
                    width: `${(d.value / total) * 100}%`,
                    backgroundColor: d.color ?? slotColor(i),
                    opacity:
                      (hover !== null && hover !== i) || (selected && selected !== d.label)
                        ? 0.35
                        : 1,
                  }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect?.(d.label)}
                  title={`${d.label}: ${formatValue(d.value)} (${Math.round((d.value / total) * 100)}%)`}
                />
              ),
          )}
      </div>
      <Legend
        className="mt-2.5"
        items={data.map((d, i) => ({
          label: d.label,
          color: d.color ?? slotColor(i),
          value: `${formatValue(d.value)}${total ? ` · ${Math.round((d.value / total) * 100)}%` : ''}`,
        }))}
      />
    </div>
  );
}

/* ----------------------------------------------------------- Funnel */

export interface FunnelDatum {
  label: string;
  value: number;
  count?: number;
  detail?: string;
}

/** Centered stage bars, widest first, with conversion between stages. */
export function Funnel({
  data,
  formatValue = (v) => String(v),
}: {
  data: FunnelDatum[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ol className="space-y-1.5">
      {data.map((d) => {
        const pct = Math.max(3, (d.value / max) * 100);
        return (
          <li key={d.label} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-3 text-xs">
            <span className="truncate font-medium">{d.label}</span>
            <div className="flex h-7 items-center justify-center">
              <div
                className="flex h-full items-center justify-center rounded-md text-[11px] font-semibold text-white transition-[width] duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: CHART_SLOTS[0],
                }}
                title={d.detail}
              >
                {d.count !== undefined && pct > 12 ? d.count : ''}
              </div>
            </div>
            <span className="text-right tabular-nums text-muted-foreground">
              {formatValue(d.value)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------- Sparkline */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = CHART_SLOTS[0],
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => 2 + ((width - 4) * i) / (values.length - 1);
  const y = (v: number) => 3 + (height - 6) * (1 - (v - lo) / span);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path
        d={`${d} L${x(last)},${height} L${x(0)},${height} Z`}
        fill={color}
        opacity={0.1}
      />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={2.5} fill={color} />
    </svg>
  );
}

/* --------------------------------------------------------- HBar list */

export interface HBarDatum {
  label: string;
  value: number;
  detail: string; // right-aligned direct label (e.g. "3 · 1.2M €")
}

export function HBarList({ data }: { data: HBarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${d.detail}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{d.detail}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                backgroundColor: CHART_SLOTS[0],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ Heat */

/** Sequential single-hue fill for a 0–1 intensity (pivot / heatmap cells). */
export function heatStyle(intensity: number): React.CSSProperties {
  if (!(intensity > 0)) return {};
  const pct = Math.round(8 + Math.min(1, intensity) * 80);
  return {
    backgroundColor: `color-mix(in oklab, rgb(var(--seq-hi)) ${pct}%, rgb(var(--seq-lo)))`,
    color: pct > 58 ? 'rgb(var(--seq-ink-hi))' : undefined,
  };
}
