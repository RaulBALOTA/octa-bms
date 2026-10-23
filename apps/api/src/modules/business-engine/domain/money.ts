import { Prisma } from '@prisma/client';

/** Decimal arithmetic for all money (decimal.js via Prisma). Never use JS floats for amounts. */
export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const ZERO = new D(0);

export function dec(value: string | number | Dec | null | undefined): Dec {
  if (value === null || value === undefined || value === '') return ZERO;
  return new D(value);
}
export const toCents = (value: Dec) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
/** Fixed two-decimal string — the wire format for money. */
export const money = (value: Dec) => toCents(value).toFixed(2);
export const sum = (values: Dec[]) => values.reduce((total, value) => total.plus(value), ZERO);
export const pct = (value: number) => new D(value).div(100);

/** Ratio as number, or null when the denominator is (near) zero — never divide by zero silently. */
export function ratio(numerator: Dec, denominator: Dec, epsilon = 0.005): number | null {
  if (denominator.abs().lt(epsilon)) return null;
  return numerator.div(denominator).toNumber();
}
export const round = (value: number, places = 2) => { const f = 10 ** places; return Math.round(value * f) / f; };

/**
 * Split an amount into cent-exact parts proportional to weights (largest remainder method),
 * so the parts always sum to the rounded total. Negative amounts are supported.
 * When all weights are zero the full amount goes to the last part (callers avoid this case).
 */
export function allocate(amount: Dec, weights: number[]): Dec[] {
  if (!weights.length) return [];
  const totalCents = toCents(amount).times(100);
  const sign = totalCents.isNegative() ? -1 : 1;
  const absolute = totalCents.abs();
  const weightSum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weightSum <= 0) return weights.map((_, index) => (index === weights.length - 1 ? toCents(amount) : ZERO));
  const raw = weights.map((weight) => absolute.times(Math.max(0, weight)).div(weightSum));
  const floors = raw.map((value) => value.floor());
  let remainder = absolute.minus(sum(floors)).toNumber();
  const order = raw.map((value, index) => ({ index, fraction: value.minus(floors[index]).toNumber() }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] = floors[index].plus(1); remainder -= 1;
  }
  return floors.map((value) => value.times(sign).div(100));
}
