import { useState } from 'react';

/**
 * Minimal SVG charts following the dataviz mark specs: thin marks, 4px
 * rounded data-ends anchored to the baseline, recessive grid, hover tooltip,
 * text in text tokens (never the series color). Single-series → single hue,
 * validated against both surfaces (scripts/validate_palette.js: ALL PASS).
 */

const CHART_HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 44 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (value <= magnitude * mult) return magnitude * mult;
  }
  return magnitude * 10;
}

export interface BarDatum {
  label: string;
  value: number;
  hint?: string; // tooltip line, defaults to formatted value
}

export function BarChart({
  data,
  width = 560,
  formatValue = (v) => String(v),
}: {
  data: BarDatum[];
  width?: number;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const slot = innerWidth / data.length;
  const barWidth = Math.min(28, slot * 0.55);
  const y = (v: number) => PAD.top + innerHeight * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        className="w-full"
        role="img"
      >
        {/* recessive grid */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeWidth={tick === 0 ? 1 : 0.5}
              strokeDasharray={tick === 0 ? undefined : '2 3'}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + slot * i + (slot - barWidth) / 2;
          const barHeight = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, barWidth / 2, barHeight); // rounded top, anchored baseline
          return (
            <g key={i}>
              {/* hit target larger than the mark */}
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
                  className="fill-primary"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  pointerEvents="none"
                />
              )}
              <text
                x={x + barWidth / 2}
                y={CHART_HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={9}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${((PAD.left + slot * hover + slot / 2) / width) * 100}%`,
            top: 0,
          }}
        >
          <div className="font-medium">{data[hover].label}</div>
          <div className="text-muted-foreground">
            {data[hover].hint ?? formatValue(data[hover].value)}
          </div>
        </div>
      )}
    </div>
  );
}

export interface HBarDatum {
  label: string;
  value: number;
  detail: string; // right-aligned direct label (e.g. "3 · 1.2M €")
}

export function HBarList({ data }: { data: HBarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium">{d.label}</span>
            <span className="text-muted-foreground">{d.detail}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
