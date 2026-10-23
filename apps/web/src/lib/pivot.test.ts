import { describe, expect, it } from 'vitest';
import { buildPivot } from './pivot';

const rows = [
  { partner: 'A', status: 'PAID', amount: 100 },
  { partner: 'A', status: 'OPEN', amount: 50 },
  { partner: 'B', status: 'PAID', amount: 300 },
  { partner: 'B', status: 'PAID', amount: '200' },
  { partner: null, status: 'OPEN', amount: null },
];

describe('buildPivot', () => {
  it('sums values by row and column with totals', () => {
    const p = buildPivot(rows, 'partner', 'status', 'amount', 'sum');
    expect(p.rowKeys).toEqual(['B', 'A', '—']);
    expect(p.colKeys).toEqual(['OPEN', 'PAID']);
    expect(p.cells.B.PAID).toBe(500);
    expect(p.cells.A.OPEN).toBe(50);
    expect(p.rowTotals.A).toBe(150);
    expect(p.colTotals.PAID).toBe(600);
    expect(p.grandTotal).toBe(650);
    expect(p.max).toBe(500);
  });

  it('counts rows when no value field is chosen', () => {
    const p = buildPivot(rows, 'status', null, null, 'sum');
    expect(p.rowTotals).toEqual({ PAID: 3, OPEN: 2 });
    expect(p.grandTotal).toBe(5);
  });

  it('averages only over rows that carry a value', () => {
    const p = buildPivot(rows, 'status', null, 'amount', 'avg');
    expect(p.rowTotals.PAID).toBe(200);
    expect(p.rowTotals.OPEN).toBe(50);
  });

  it('sorts rows alphabetically on request, empty last', () => {
    const p = buildPivot(rows, 'partner', null, 'amount', 'max', 'label');
    expect(p.rowKeys).toEqual(['A', 'B', '—']);
    expect(p.rowTotals.B).toBe(300);
  });
});
