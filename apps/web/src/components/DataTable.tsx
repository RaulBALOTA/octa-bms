import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Grid3x3,
  Rows3,
  Rows4,
  Search,
  Table2,
} from 'lucide-react';
import {
  isValidElement,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { downloadCsv } from '../lib/csv';
import { useFormat, ValueType } from '../lib/format';
import { useUiStore } from '../stores/ui';
import { CHART_SLOTS } from './charts';
import { EmptyState, ViewSwitch } from './infographics';
import { PivotField, PivotTable } from './PivotTable';
import { Skeleton } from './ui';

export interface DataColumn<T> {
  key: string;
  header: string;
  /** raw value for sorting, CSV and pivoting; defaults to the rendered text */
  value?: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  type?: ValueType;
  align?: 'left' | 'right';
  /** draw an in-cell magnitude bar (numeric columns) */
  bar?: boolean;
  /** footer aggregate */
  total?: 'sum' | 'avg';
  sortable?: boolean;
  /** include in CSV / pivot (default true) */
  export?: boolean;
  /** hidden until enabled in the column menu */
  hidden?: boolean;
  /** cannot be hidden, pinned to the right edge */
  sticky?: boolean;
  className?: string;
}

/** Best-effort plain text of a rendered cell (StatusBadge-style `value` props included). */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) {
    const props = node.props as { value?: unknown; children?: ReactNode; label?: unknown };
    if (typeof props.value === 'string' || typeof props.value === 'number')
      return String(props.value);
    if (props.children !== undefined) return nodeText(props.children);
    if (typeof props.label === 'string') return props.label;
  }
  return '';
}

export function cellValue<T>(column: DataColumn<T>, row: T): unknown {
  if (column.value) return column.value(row);
  return column.render ? nodeText(column.render(row)) : '';
}

function compare(a: unknown, b: unknown, type?: ValueType): number {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (type === 'date') return new Date(String(a)).getTime() - new Date(String(b)).getTime();
  const na = Number(a);
  const nb = Number(b);
  if (type === 'number' || type === 'money' || type === 'percent' || (!isNaN(na) && !isNaN(nb)))
    return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* ------------------------------------------------------------ Pager */

export function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  pageSizes = [25, 50, 100, 200],
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  pageSizes?: number[];
}) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const window: (number | '…')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) window.push(p);
    else if (window[window.length - 1] !== '…') window.push('…');
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span className="tabular-nums">{t('table.range', { from, to, total })}</span>
      <div className="flex items-center gap-3">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            {t('table.perPage')}
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-1.5 py-1 text-xs"
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        {totalPages > 1 && (
          <nav className="flex items-center gap-0.5" aria-label={t('table.pagination')}>
            <button
              type="button"
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              aria-label={t('table.prevPage')}
              className="rounded-md p-1 hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            {window.map((p, i) =>
              p === '…' ? (
                <span key={`gap-${i}`} className="px-1">
                  …
                </span>
              ) : (
                <button
                  type="button"
                  key={p}
                  onClick={() => onPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={clsx(
                    'min-w-7 rounded-md px-2 py-1 tabular-nums',
                    p === page
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'hover:bg-muted hover:text-foreground',
                  )}
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages}
              aria-label={t('table.nextPage')}
              className="rounded-md p-1 hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ Column menu */

function ColumnMenu<T>({
  columns,
  hidden,
  onToggle,
}: {
  columns: DataColumn<T>[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const choosable = columns.filter((c) => !c.sticky && c.header);
  if (choosable.length < 2) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="seg-btn border border-border bg-card"
        aria-expanded={open}
        title={t('table.columns')}
      >
        <Columns3 size={13} />
        <span className="hidden sm:inline">{t('table.columns')}</span>
        {hidden.size > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
            {choosable.length - hidden.size}/{choosable.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-56 rounded-lg border border-border bg-card p-1.5 shadow-xl">
          {choosable.map((column) => (
            <label
              key={column.key}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={!hidden.has(column.key)}
                onChange={() => onToggle(column.key)}
                className="accent-[hsl(var(--primary))]"
              />
              {column.header}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- Table view */

type View = 'table' | 'pivot';

export interface DataTableProps<T> {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** client-side quick filter (default true) */
  search?: boolean;
  /** show the toolbar row (default true) */
  toolbar?: boolean;
  /** client-side paging; 0 disables */
  pageSize?: number;
  exportName?: string;
  emptyText?: string;
  emptyHint?: string;
  /** slots in the toolbar row */
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  /** footer below the table (server pager) */
  footer?: ReactNode;
  /** enable the Table | Pivot switch */
  pivot?: boolean | { row?: string; col?: string; value?: string };
  /** note shown above the pivot (e.g. "based on the 25 loaded rows") */
  pivotNote?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  ariaLabel?: string;
  className?: string;
}

/**
 * Enhanced table: sortable headers, quick filter, column chooser, density,
 * in-cell bars, totals footer, CSV export and an optional pivot view of the
 * same rows. Pure client side — server paging plugs in through `footer`.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  onRowClick,
  rowClassName,
  search = true,
  toolbar = true,
  pageSize = 25,
  exportName,
  emptyText,
  emptyHint,
  toolbarStart,
  toolbarEnd,
  footer,
  pivot,
  pivotNote,
  initialSort,
  ariaLabel,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [view, setView] = useState<View>('table');
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.hidden).map((c) => c.key)),
  );

  const visible = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      columns.some((c) => {
        const v = cellValue(c, row);
        return v !== null && v !== undefined && String(v).toLowerCase().includes(term);
      }),
    );
  }, [rows, columns, filter]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return filtered;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort(
      (a, b) => compare(cellValue(column, a), cellValue(column, b), column.type) * factor,
    );
  }, [filtered, sort, columns]);

  const totalPages = size > 0 ? Math.max(1, Math.ceil(sorted.length / size)) : 1;
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageRows = size > 0 ? sorted.slice((page - 1) * size, page * size) : sorted;

  const barMax = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of columns)
      if (c.bar)
        out[c.key] = Math.max(0, ...sorted.map((r) => Math.abs(Number(cellValue(c, r)) || 0)));
    return out;
  }, [columns, sorted]);

  const hasTotals = visible.some((c) => c.total) && sorted.length > 1;
  const totals = (column: DataColumn<T>) => {
    const nums = sorted.map((r) => Number(cellValue(column, r))).filter(Number.isFinite);
    const sum = nums.reduce((a, b) => a + b, 0);
    return column.total === 'avg' ? (nums.length ? sum / nums.length : 0) : sum;
  };

  const exportable = columns.filter((c) => c.export !== false && c.header);
  const onExport = () =>
    downloadCsv(
      exportName ?? 'export',
      exportable.map((c) => c.header),
      sorted.map((row) => exportable.map((c) => cellValue(c, row))),
    );

  const pivotFields: PivotField[] = exportable.map((c) => ({
    key: c.key,
    label: c.header,
    type: c.type ?? 'text',
  }));
  const pivotRows = useMemo(
    () =>
      view === 'pivot'
        ? filtered.map((row) =>
            Object.fromEntries(exportable.map((c) => [c.key, cellValue(c, row)])),
          )
        : [],
    [view, filtered, columns],
  );

  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null,
    );

  const cellPad = density === 'compact' ? 'px-3 py-1' : 'px-4 py-2.5';
  const onRowKey = (e: KeyboardEvent, row: T) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className={clsx('surface overflow-hidden', className)}>
      {/* toolbar */}
      <div
        className={clsx(
          'flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2',
          toolbar ? 'flex' : 'hidden',
        )}
      >
        {pivot && (
          <ViewSwitch<View>
            value={view}
            onChange={setView}
            label={t('table.view')}
            options={[
              { key: 'table', label: t('table.tableView'), icon: Table2 },
              { key: 'pivot', label: t('table.pivotView'), icon: Grid3x3 },
            ]}
          />
        )}
        {toolbarStart}
        {search && (
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              placeholder={t('table.filter')}
              aria-label={t('table.filter')}
              className="h-7 w-48 rounded-md border border-border bg-card pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        <div className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('table.rowCount', { count: sorted.length })}
        </span>
        {toolbarEnd}
        {view === 'table' && (
          <>
            <ColumnMenu
              columns={columns}
              hidden={hidden}
              onToggle={(key) =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            />
            <button
              type="button"
              className="seg-btn border border-border bg-card"
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
              title={t(density === 'compact' ? 'table.comfortable' : 'table.compact')}
              aria-label={t(density === 'compact' ? 'table.comfortable' : 'table.compact')}
            >
              {density === 'compact' ? <Rows3 size={13} /> : <Rows4 size={13} />}
            </button>
          </>
        )}
        {exportable.length > 0 && view === 'table' && (
          <button
            type="button"
            className="seg-btn border border-border bg-card"
            onClick={onExport}
            disabled={!sorted.length}
            aria-label={t('table.downloadCsv')}
            title={t('table.downloadCsv')}
          >
            <Download size={13} />
            CSV
          </button>
        )}
      </div>

      {view === 'pivot' ? (
        <div className="p-4">
          {pivotNote && <p className="mb-3 text-xs text-muted-foreground">{pivotNote}</p>}
          <PivotTable
            rows={pivotRows}
            fields={pivotFields}
            defaults={typeof pivot === 'object' ? pivot : undefined}
            exportName={exportName ? `${exportName}-pivot` : 'pivot'}
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label={ariaLabel}>
              <thead className="sticky top-0 z-[1] bg-card">
                <tr className="border-b border-border text-left">
                  {visible.map((column) => {
                    const sortable = column.sortable !== false && !!column.header;
                    const active = sort?.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={
                          active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                        className={clsx(
                          'whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                          density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5',
                          column.align === 'right' && 'text-right',
                          column.sticky && 'sticky right-0 bg-card',
                        )}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={clsx(
                              'group inline-flex items-center gap-1 uppercase hover:text-foreground',
                              active && 'text-foreground',
                              column.align === 'right' && 'flex-row-reverse',
                            )}
                          >
                            {column.header}
                            {active ? (
                              sort!.dir === 'asc' ? (
                                <ArrowUp size={11} />
                              ) : (
                                <ArrowDown size={11} />
                              )
                            ) : (
                              <ArrowUpDown
                                size={11}
                                className="opacity-0 transition-opacity group-hover:opacity-60"
                              />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {visible.map((column) => (
                        <td key={column.key} className={cellPad}>
                          <Skeleton className="h-4 w-full max-w-40" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : pageRows.length ? (
                  pageRows.map((row, index) => (
                    <tr
                      key={rowKey(row, index)}
                      onClick={() => onRowClick?.(row)}
                      onKeyDown={(e) => onRowKey(e, row)}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={clsx(
                        'dt-row border-b border-border last:border-0',
                        onRowClick && 'cursor-pointer focus-visible:outline-none',
                        rowClassName?.(row),
                      )}
                    >
                      {visible.map((column) => {
                        const content = column.render
                          ? column.render(row)
                          : fmt.value(cellValue(column, row), column.type);
                        const numeric = column.bar ? Math.abs(Number(cellValue(column, row)) || 0) : 0;
                        return (
                          <td
                            key={column.key}
                            className={clsx(
                              cellPad,
                              column.align === 'right' && 'text-right tabular-nums',
                              column.bar && 'relative',
                              column.sticky && 'sticky right-0',
                              column.className,
                            )}
                          >
                            {content}
                            {column.bar && barMax[column.key] > 0 && (
                              <span
                                aria-hidden
                                className="absolute bottom-1 h-[3px] rounded-full opacity-60"
                                style={{
                                  right: density === 'compact' ? 12 : 16,
                                  width: `calc((100% - ${density === 'compact' ? 24 : 32}px) * ${numeric / barMax[column.key]})`,
                                  backgroundColor: CHART_SLOTS[0],
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={visible.length}>
                      <EmptyState
                        compact
                        title={filter ? t('table.noMatch') : emptyText ?? t('common.noResults')}
                        hint={filter ? t('table.noMatchHint') : emptyHint}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
              {hasTotals && !loading && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    {visible.map((column, i) => (
                      <td
                        key={column.key}
                        className={clsx(
                          cellPad,
                          column.align === 'right' && 'text-right tabular-nums',
                        )}
                      >
                        {column.total
                          ? fmt.value(totals(column), column.type === 'text' ? 'number' : column.type)
                          : i === 0
                            ? t('common.total')
                            : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {footer ??
            (size > 0 && sorted.length > Math.min(25, size) && (
              <Pager
                page={page}
                totalPages={totalPages}
                total={sorted.length}
                pageSize={size}
                onPage={setPage}
                onPageSize={(s) => {
                  setSize(s);
                  setPage(1);
                }}
              />
            ))}
        </>
      )}
    </div>
  );
}
