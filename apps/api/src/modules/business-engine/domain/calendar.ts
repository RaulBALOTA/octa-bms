import type { IsoDate, Period } from '../../../../../../packages/shared/src/business-engine';

/**
 * Single time model of the engine. Dates are UTC calendar days (integers since epoch).
 * Amounts are distributed over working days; weeks, months, quarters and years are exact unions
 * of "segments" (week ∩ month), so weekly and monthly summaries can never contradict each other.
 */
export const DAY_MS = 86_400_000;

export class EngineInputError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function toDay(iso: IsoDate): number {
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) {
    throw new EngineInputError('INVALID_DATE', `Invalid date: ${iso}`);
  }
  return Math.round(time / DAY_MS);
}
export const fromDay = (day: number): IsoDate => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso: IsoDate, days: number) => fromDay(toDay(iso) + days);
export const weekday = (day: number) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7; // 0 = Monday
export const monthStart = (day: number) => { const d = new Date(day * DAY_MS); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS); };
export const nextMonthStart = (day: number) => { const d = new Date(day * DAY_MS); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS); };
export const monthEnd = (day: number) => nextMonthStart(day) - 1;
export function addMonths(day: number, months: number): number {
  const d = new Date(day * DAY_MS);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
  return Math.round(target / DAY_MS) + Math.min(d.getUTCDate(), lastDay) - 1;
}
export const monthKey = (day: number) => fromDay(day).slice(0, 7);
export function isoWeekKey(day: number): string {
  const thursday = day - weekday(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(year, 0, 4) / DAY_MS);
  const week1Monday = jan4 - weekday(jan4);
  return `${year}-W${String(Math.floor((thursday - week1Monday) / 7) + 1).padStart(2, '0')}`;
}
export const quarterKey = (month: string) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;

/** Easter Sunday (Anonymous Gregorian algorithm). */
export function easter(year: number): number {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return Math.round(Date.UTC(year, month - 1, dayOfMonth) / DAY_MS);
}
/** Nationwide German public holidays (state holidays are configured as extra dates). */
export function germanNationalHolidays(year: number): number[] {
  const e = easter(year);
  const fixed = [[0, 1], [4, 1], [9, 3], [11, 25], [11, 26]].map(([m, d]) => Math.round(Date.UTC(year, m, d) / DAY_MS));
  return [...fixed, e - 2, e + 1, e + 39, e + 50].sort((a, b) => a - b);
}

export class WorkCalendar {
  private readonly holidays: Set<number>;
  private readonly cum: Int32Array; // cum[i] = working days in [start, start + i)
  constructor(readonly start: number, readonly end: number, region: 'DE_NATIONAL' | 'NONE', extra: IsoDate[] = []) {
    const holidays = new Set<number>(extra.map(toDay));
    if (region === 'DE_NATIONAL') {
      for (let y = new Date(start * DAY_MS).getUTCFullYear(); y <= new Date(end * DAY_MS).getUTCFullYear(); y++) germanNationalHolidays(y).forEach((h) => holidays.add(h));
    }
    this.holidays = holidays;
    this.cum = new Int32Array(end - start + 2);
    for (let day = start; day <= end; day++) this.cum[day - start + 1] = this.cum[day - start] + (this.isWorkday(day) ? 1 : 0);
  }
  isWorkday(day: number) { return weekday(day) < 5 && !this.holidays.has(day); }
  /** Working days in the inclusive range [a, b]. */
  workdays(a: number, b: number): number {
    if (b < a) return 0;
    if (a >= this.start && b <= this.end) return this.cum[b - this.start + 1] - this.cum[a - this.start];
    let count = 0;
    for (let day = a; day <= b; day++) if (this.isWorkday(day)) count++;
    return count;
  }
}

export interface Segment { start: number; end: number; week: number; month: number }
export interface Timeline { start: number; end: number; weeks: Period[]; months: Period[]; segments: Segment[]; weekRanges: [number, number][]; monthRanges: [number, number][] }

/** Weeks start Monday; the first week and month are clipped to the timeline start. */
export function buildTimeline(startDay: number, endDay: number): Timeline {
  const weeks: Period[] = []; const months: Period[] = []; const weekRanges: [number, number][] = []; const monthRanges: [number, number][] = [];
  for (let day = startDay; day <= endDay;) {
    const end = Math.min(endDay, day + (6 - weekday(day)));
    weeks.push({ key: isoWeekKey(day), start: fromDay(day), end: fromDay(end) }); weekRanges.push([day, end]); day = end + 1;
  }
  for (let day = startDay; day <= endDay;) {
    const end = Math.min(endDay, monthEnd(day));
    months.push({ key: monthKey(day), start: fromDay(day), end: fromDay(end) }); monthRanges.push([day, end]); day = end + 1;
  }
  const segments: Segment[] = [];
  let m = 0;
  weekRanges.forEach(([ws, we], w) => {
    for (let day = ws; day <= we;) {
      while (monthRanges[m][1] < day) m++;
      const end = Math.min(we, monthRanges[m][1]);
      segments.push({ start: day, end, week: w, month: m }); day = end + 1;
    }
  });
  return { start: startDay, end: endDay, weeks, months, segments, weekRanges, monthRanges };
}

/**
 * Workday weights of the range [a, b] over the given buckets. If the range has no working days
 * (e.g. a weekend-only range) calendar days are used; a range entirely outside yields zeros.
 */
export function rangeWeights(calendar: WorkCalendar, a: number, b: number, buckets: { start: number; end: number }[]): number[] {
  const overlap = buckets.map((bucket) => [Math.max(a, bucket.start), Math.min(b, bucket.end)] as const);
  const work = overlap.map(([s, e]) => calendar.workdays(s, e));
  if (calendar.workdays(a, b) > 0) return work;
  return overlap.map(([s, e]) => Math.max(0, e - s + 1));
}

/** Share of the range [a, b] falling into each bucket (relative to the WHOLE range, so parts outside the buckets are excluded). */
export function rangeFractions(calendar: WorkCalendar, a: number, b: number, buckets: { start: number; end: number }[]): number[] {
  if (b < a) return buckets.map(() => 0);
  const total = calendar.workdays(a, b);
  const weights = rangeWeights(calendar, a, b, buckets);
  const denominator = total > 0 ? total : b - a + 1;
  return weights.map((weight) => weight / denominator);
}
