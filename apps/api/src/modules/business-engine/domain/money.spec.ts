import { describe, expect, it } from 'vitest';
import { allocate, D } from './money';

describe('allocate', () => {
  it('keeps totals exact for awkward weights and large amounts', () => {
    const weights = [0.1, 0.2, 0.3, 1 / 3, 7, 0, 2.5];
    for (const amount of ['1000000.01', '0.07', '-12345.67', '99999999999.99']) {
      const parts = allocate(new D(amount), weights);
      expect(parts.reduce((s, p) => s.plus(p), new D(0)).toFixed(2)).toBe(new D(amount).toFixed(2));
      expect(parts[5].toFixed(2)).toBe('0.00');
    }
  });
  it('falls back to exact decimals beyond the safe-integer range', () => {
    const parts = allocate(new D('1e18'), [1, 2]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['333333333333333333.33', '666666666666666666.67']);
  });
});
