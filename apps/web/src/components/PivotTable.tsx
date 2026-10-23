import clsx from 'clsx';
import { ArrowLeftRight, BarChart3, Download, Flame, Percent, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadCsv } from '../lib/csv';
import { useFormat, ValueType } from '../lib/format';
import { Aggregation, buildPivot, PivotRow } from '../lib/pivot';
import { heatStyle, Legend, slotColor } from './charts';
import { EmptyState, ViewSwitch } from './infographics';

export interface PivotField {
  key: string;
  label: string;
  type: ValueType;
}

const MEASURE_TYPES: ValueType[] = ['number', 'money', 'percent'];
const MONTH_SUFFIX = '__month';
const MAX_CHART_SERIES = 8;

function monthKey(value: unknown): unknown {
  if (!value) return value;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function Picker({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-36 rounded-md border border-border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  pressed,
  onClick,
  icon: Icon,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: typeof Flame;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
        pressed
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

/**
 * Interactive pivot over in-memory rows: choose row / column dimensions,
 * a measure and an aggregation; heat shading, share-of-total, totals,
 * stacked-bar chart view and CSV export of the pivoted grid.
 */
export function PivotTable({
  rows,
  fields,
  defaults,
  exportName = 'pivot',
}: {
  rows: PivotRow[];
  fields: PivotField[];
  defaults?: { row?: string; col?: string; value?: string; agg?: Aggregation };
  exportName?: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();

  const dimensions = useMemo(() => {
    const out: PivotField[] = [];
    for (const f of fields) {
      if (f.type === 'date') {
        out.push({ key: f.key + MONTH_SUFFIX, label: `${f.label} (${t('pivot.month')})`, type: 'text' });
        out.push(f);
      } else if (!MEASURE_TYPES.includes(f.type)) out.push(f);
    }
    return out;
  }, [fields, t]);
  const measures = fields.filter((f) => MEASURE_TYPES.includes(f.type));

  /**
   * Best default grouping: the first dimension that actually groups the data
   * (more than one value, but not unique per row like an ID column).
   */
  const suggestRow = () => {
    if (defaults?.row && dimensions.some((d) => d.key === defaults.row)) return defaults.row;
    const limit = Math.max(2, Math.ceil(rows.length * 0.6));
    const grouping = dimensions.find((d) => {
      const distinct = new Set(
        rows.map((r) =>
          d.key.endsWith(MONTH_SUFFIX) ? monthKey(r[d.key.slice(0, -MONTH_SUFFIX.length)]) : r[d.key],
        ),
      ).size;
      return distinct > 1 && distinct < limit;
    });
    return grouping?.key ?? dimensions[0]?.key ?? '';
  };
  const [rowField, setRowField] = useState(suggestRow);
  const [colField, setColField] = useState(defaults?.col ?? '');
  const [valueField, setValueField] = useState(defaults?.value ?? measures[0]?.key ?? '');
  const [agg, setAgg] = useState<Aggregation>(defaults?.agg ?? 'sum');
  const [heat, setHeat] = useState(true);
  const [share, setShare] = useState(false);
  const [mode, setMode] = useState<'grid' | 'chart'>('grid');

  // fields can change when the source report changes
  useEffect(() => {
    if (!dimensions.some((d) => d.key === rowField)) setRowField(suggestRow());
    if (colField && !dimensions.some((d) => d.key === colField)) setColField('');
    if (valueField && !measures.some((m) => m.key === valueField))
      setValueField(measures[0]?.key ?? '');
  }, [fields]);

  const prepared = useMemo(() => {
    const monthFields = fields.filter((f) => f.type === 'date');
    if (!monthFields.length) return rows;
    return rows.map((row) => {
      const copy: PivotRow = { ...row };
      for (const f of monthFields) copy[f.key + MONTH_SUFFIX] = monthKey(row[f.key]);
      return copy;
    });
  }, [rows, fields]);

  const result = useMemo(
    () =>
      rowField
        ? buildPivot(prepared, rowField, colField || null, valueField || null, agg)
        : null,
    [prepared, rowField, colField, valueField, agg],
  );

  const measure = measures.find((m) => m.key === valueField);
  const effectiveAgg: Aggregation = valueField ? agg : 'count';
  const valueType: ValueType =
    effectiveAgg === 'count' ? 'number' : (measure?.type ?? 'number');
  const formatCell = (v: number) => {
    if (share) return fmt.percent(result && result.grandTotal ? (v / result.grandTotal) * 100 : 0);
    return fmt.value(v, valueType);
  };
  const canShare = effectiveAgg === 'count' || effectiveAgg === 'sum';

  const label = (key: string) => (key === '' ? t('common.total') : key);
  const rowLabel = dimensions.find((d) => d.key === rowField)?.label ?? '';

  if (!dimensions.length)
    return <EmptyState compact title={t('pivot.noDimensions')} />;

  const exportGrid = () => {
    if (!result) return;
    const cols = colField ? result.colKeys : [];
    downloadCsv(
      exportName,
      [rowLabel, ...cols, t('common.total')],
      [
        ...result.rowKeys.map((r) => [
          r,
          ...cols.map((c) => result.cells[r]?.[c] ?? 0),
          result.rowTotals[r],
        ]),
        [t('common.total'), ...cols.map((c) => result.colTotals[c]), result.grandTotal],
      ],
    );
  };

  // shade relative to the spread of body cells; uniform grids stay unshaded
  const lo = result ? Math.min(0, result.min) : 0;
  const range = result ? result.max - lo : 0;
  const intensity = (v: number) =>
    heat && result && range > 0 && result.max !== result.min ? (v - lo) / range : 0;

  const chartCols = result && colField ? result.colKeys.slice(0, MAX_CHART_SERIES) : [];
  const folded = result && colField ? result.colKeys.slice(MAX_CHART_SERIES) : [];
  const rowMax = result ? Math.max(1e-9, ...result.rowKeys.map((r) => Math.abs(result.rowTotals[r]))) : 1;

  return (
    <div>
      {/* field well */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
        <Picker
          label={t('pivot.rows')}
          value={rowField}
          onChange={setRowField}
          options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
        />
        <button
          type="button"
          className="mb-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          disabled={!colField}
          onClick={() => {
            setRowField(colField);
            setColField(rowField);
          }}
          title={t('pivot.swap')}
          aria-label={t('pivot.swap')}
        >
          <ArrowLeftRight size={14} />
        </button>
        <Picker
          label={t('pivot.columns')}
          value={colField}
          onChange={setColField}
          options={[
            { value: '', label: t('pivot.none') },
            ...dimensions.filter((d) => d.key !== rowField).map((d) => ({ value: d.key, label: d.label })),
          ]}
        />
        <Picker
          label={t('pivot.values')}
          value={valueField}
          onChange={setValueField}
          options={[
            { value: '', label: t('pivot.countRows') },
            ...measures.map((m) => ({ value: m.key, label: m.label })),
          ]}
        />
        <Picker
          label={t('pivot.aggregation')}
          value={effectiveAgg}
          disabled={!valueField}
          onChange={(v) => {
            setAgg(v as Aggregation);
            if (v !== 'sum' && v !== 'count') setShare(false);
          }}
          options={(['sum', 'avg', 'min', 'max', 'count'] as Aggregation[]).map((a) => ({
            value: a,
            label: t(`pivot.agg.${a}`),
          }))}
        />
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <Toggle pressed={heat} onClick={() => setHeat((h) => !h)} icon={Flame} label={t('pivot.heatmap')} />
          {canShare && (
            <Toggle pressed={share} onClick={() => setShare((s) => !s)} icon={Percent} label={t('pivot.share')} />
          )}
          <ViewSwitch
            value={mode}
            onChange={setMode}
            label={t('table.view')}
            options={[
              { key: 'grid', label: t('pivot.grid'), icon: Table2 },
              { key: 'chart', label: t('pivot.chart'), icon: BarChart3 },
            ]}
          />
          <button
            type="button"
            onClick={exportGrid}
            disabled={!result?.rowKeys.length}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={t('pivot.downloadCsv')}
          >
            <Download size={13} />
            CSV
          </button>
        </div>
      </div>

      {!result || !result.rowKeys.length ? (
        <EmptyState compact title={t('common.noResults')} />
      ) : mode === 'chart' ? (
        <div>
          {colField && (
            <Legend
              className="mb-3"
              items={[
                ...chartCols.map((c, i) => ({ label: label(c), color: slotColor(i) })),
                ...(folded.length ? [{ label: t('pivot.other'), color: slotColor(99) }] : []),
              ]}
            />
          )}
          <ul className="space-y-2">
            {result.rowKeys.slice(0, 30).map((r) => {
              const total = result.rowTotals[r];
              const width = (Math.abs(total) / rowMax) * 100;
              const segments = colField
                ? [
                    ...chartCols.map((c, i) => ({ key: c, value: result.cells[r]?.[c] ?? 0, color: slotColor(i) })),
                    {
                      key: t('pivot.other'),
                      value: folded.reduce((s, c) => s + (result.cells[r]?.[c] ?? 0), 0),
                      color: slotColor(99),
                    },
                  ].filter((s) => s.value > 0)
                : [{ key: r, value: total, color: slotColor(0) }];
              const segSum = segments.reduce((s, x) => s + x.value, 0) || 1;
              return (
                <li key={r} className="grid grid-cols-[minmax(6rem,12rem)_1fr_7rem] items-center gap-3 text-xs">
                  <span className="truncate font-medium" title={r}>
                    {r}
                  </span>
                  <div className="h-5 rounded bg-muted/50">
                    <div className="flex h-full gap-[2px]" style={{ width: `${Math.max(1, width)}%` }}>
                      {segments.map((s) => (
                        <div
                          key={s.key}
                          className="h-full first:rounded-l last:rounded-r"
                          style={{ width: `${(s.value / segSum) * 100}%`, backgroundColor: s.color }}
                          title={`${r} · ${label(s.key)}: ${formatCell(s.value)}`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="text-right font-semibold tabular-nums">{formatCell(total)}</span>
                </li>
              );
            })}
          </ul>
          {result.rowKeys.length > 30 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('pivot.topN', { n: 30, total: result.rowKeys.length })}
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs" aria-label={t('pivot.title')}>
            <thead className="sticky top-0 z-[2] bg-card">
              <tr className="border-b border-border">
                <th className="sticky left-0 z-[3] bg-card px-3 py-2 text-left font-semibold">
                  {rowLabel}
                  {colField && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      / {dimensions.find((d) => d.key === colField)?.label}
                    </span>
                  )}
                </th>
                {colField &&
                  result.colKeys.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                      {c}
                    </th>
                  ))}
                <th className="whitespace-nowrap bg-muted/60 px-3 py-2 text-right font-semibold">
                  {t('common.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rowKeys.map((r) => (
                <tr key={r} className="border-b border-border/70 hover:bg-accent/30">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] max-w-64 truncate bg-card px-3 py-1.5 text-left font-medium"
                    title={r}
                  >
                    {r}
                  </th>
                  {colField &&
                    result.colKeys.map((c) => {
                      const v = result.cells[r]?.[c];
                      return (
                        <td
                          key={c}
                          className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"
                          style={v !== undefined ? heatStyle(intensity(v)) : undefined}
                          title={v !== undefined ? `${r} · ${c}: ${formatCell(v)}` : undefined}
                        >
                          {v !== undefined ? formatCell(v) : <span className="text-muted-foreground/50">·</span>}
                        </td>
                      );
                    })}
                  <td className="relative whitespace-nowrap bg-muted/40 px-3 py-1.5 text-right font-semibold tabular-nums">
                    {!colField && heat && (
                      <span
                        aria-hidden
                        className="absolute inset-y-1 right-1 rounded-sm opacity-25"
                        style={{
                          width: `calc((100% - 8px) * ${Math.abs(result.rowTotals[r]) / rowMax})`,
                          backgroundColor: slotColor(0),
                        }}
                      />
                    )}
                    <span className="relative">{formatCell(result.rowTotals[r])}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-[2] bg-card">
              <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                <th scope="row" className="sticky left-0 z-[3] bg-muted px-3 py-2 text-left">
                  {t('common.total')}
                </th>
                {colField &&
                  result.colKeys.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatCell(result.colTotals[c])}
                    </td>
                  ))}
                <td className="whitespace-nowrap bg-muted px-3 py-2 text-right tabular-nums">
                  {formatCell(result.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t('pivot.summary', {
          rows: rows.length,
          groups: result?.rowKeys.length ?? 0,
        })}
      </p>
    </div>
  );
}
