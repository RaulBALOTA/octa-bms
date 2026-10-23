/**
 * Pure pivot engine: groups rows by a row field and an optional column field
 * and aggregates a value field. Kept framework-free so it is unit-testable.
 */

export type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type PivotRow = Record<string, unknown>;

export interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  /** cells[rowKey][colKey] */
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  /** min/max across body cells, for heat shading */
  min: number;
  max: number;
}

const EMPTY = '—';

export function pivotKey(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  return String(value);
}

interface Acc {
  count: number;
  /** rows carrying a numeric value */
  n: number;
  sum: number;
  min: number;
  max: number;
}

const newAcc = (): Acc => ({ count: 0, n: 0, sum: 0, min: Infinity, max: -Infinity });

function push(acc: Acc, value: number | null) {
  acc.count += 1;
  if (value === null) return;
  acc.n += 1;
  acc.sum += value;
  acc.min = Math.min(acc.min, value);
  acc.max = Math.max(acc.max, value);
}

function finish(acc: Acc | undefined, agg: Aggregation): number {
  if (!acc || acc.count === 0) return 0;
  switch (agg) {
    case 'count':
      return acc.count;
    case 'sum':
      return acc.sum;
    case 'avg':
      return acc.n ? acc.sum / acc.n : 0;
    case 'min':
      return Number.isFinite(acc.min) ? acc.min : 0;
    case 'max':
      return Number.isFinite(acc.max) ? acc.max : 0;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildPivot(
  rows: PivotRow[],
  rowField: string,
  colField: string | null,
  valueField: string | null,
  agg: Aggregation,
  sort: 'label' | 'total' = 'total',
): PivotResult {
  const effectiveAgg: Aggregation = valueField ? agg : 'count';
  const body = new Map<string, Map<string, Acc>>();
  const rowAcc = new Map<string, Acc>();
  const colAcc = new Map<string, Acc>();
  const grand = newAcc();

  for (const row of rows) {
    const r = pivotKey(row[rowField]);
    const c = colField ? pivotKey(row[colField]) : '';
    const v = valueField ? toNumber(row[valueField]) : null;
    if (!body.has(r)) body.set(r, new Map());
    const line = body.get(r)!;
    if (!line.has(c)) line.set(c, newAcc());
    push(line.get(c)!, v);
    if (!rowAcc.has(r)) rowAcc.set(r, newAcc());
    push(rowAcc.get(r)!, v);
    if (!colAcc.has(c)) colAcc.set(c, newAcc());
    push(colAcc.get(c)!, v);
    push(grand, v);
  }

  const rowTotals: Record<string, number> = {};
  for (const [k, acc] of rowAcc) rowTotals[k] = finish(acc, effectiveAgg);
  const colTotals: Record<string, number> = {};
  for (const [k, acc] of colAcc) colTotals[k] = finish(acc, effectiveAgg);

  const cells: Record<string, Record<string, number>> = {};
  let min = Infinity;
  let max = -Infinity;
  for (const [r, line] of body) {
    cells[r] = {};
    for (const [c, acc] of line) {
      const value = finish(acc, effectiveAgg);
      cells[r][c] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  const byLabel = (a: string, b: string) =>
    a === EMPTY ? 1 : b === EMPTY ? -1 : a.localeCompare(b, undefined, { numeric: true });
  const rowKeys = [...rowAcc.keys()].sort(
    sort === 'total' ? (a, b) => rowTotals[b] - rowTotals[a] || byLabel(a, b) : byLabel,
  );
  const colKeys = [...colAcc.keys()].sort(byLabel);

  return {
    rowKeys,
    colKeys,
    cells,
    rowTotals,
    colTotals,
    grandTotal: finish(grand, effectiveAgg),
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}
