/**
 * Pure working-time rules — no I/O. Calendar days are ISO strings
 * (YYYY-MM-DD) interpreted in the company time zone; instants are Date.
 *
 * Statutory checks follow the German Working Hours Act (ArbZG):
 *   §3  max. 10 h work per day (8 h regular, extension needs averaging)
 *   §4  breaks: > 6 h → 30 min, > 9 h → 45 min; only blocks ≥ 15 min count
 *   §5  11 h uninterrupted rest between two working days
 *   §9  Sunday / public-holiday work needs an exemption
 */

export const DEFAULT_TIME_ZONE = process.env.TIME_ZONE ?? 'Europe/Berlin';
export const DAY_MS = 86_400_000;

// ------------------------------------------------------------- calendar days

export function parseDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid day: ${day}`);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error(`Invalid day: ${day}`);
  return date;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return formatDay(new Date(parseDay(day).getTime() + days * DAY_MS));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (parseDay(day).getUTCDay() + 6) % 7;
}

export function weekStartOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

export function isoWeek(day: string): { year: number; week: number } {
  const thursday = parseDay(addDays(weekStartOf(day), 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  return { year, week: Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1 };
}

// ---------------------------------------------------------------- time zones

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, second: Number(get('second')) };
}

/** Calendar day and HH:mm of an instant in the given zone. */
export function toZoned(instant: Date, timeZone = DEFAULT_TIME_ZONE): { day: string; time: string } {
  const { day, time } = zonedParts(instant, timeZone);
  return { day, time };
}

/** Instant for a wall-clock time on a calendar day in the given zone (DST-safe). */
export function fromZoned(day: string, time: string, timeZone = DEFAULT_TIME_ZONE): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid time: ${time}`);
  const wanted = Date.parse(`${day}T${time}:00.000Z`);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const seen = Date.parse(`${parts.day}T${parts.time}:${String(parts.second).padStart(2, '0')}.000Z`);
    if (seen === wanted) break;
    guess += wanted - seen;
  }
  return new Date(guess);
}

// ------------------------------------------------------------------- records

export interface WorkBlock {
  day: string;
  startAt: Date;
  endAt: Date | null;
  breakMinutes: number;
}

export function blockMinutes(block: WorkBlock): number {
  if (!block.endAt) return 0;
  const gross = Math.round((block.endAt.getTime() - block.startAt.getTime()) / 60_000);
  return Math.max(0, gross - block.breakMinutes);
}

export interface DayActuals {
  workedMinutes: number;
  breakMinutes: number;
  firstStart: Date | null;
  lastEnd: Date | null;
  open: boolean;
}

/** Recorded breaks plus gaps of ≥ 15 min between blocks of the same day. */
export function dayActuals(blocks: WorkBlock[]): DayActuals {
  const sorted = [...blocks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  let workedMinutes = 0;
  let breakMinutes = 0;
  let previousEnd: Date | null = null;
  for (const block of sorted) {
    workedMinutes += blockMinutes(block);
    breakMinutes += block.breakMinutes;
    if (previousEnd) {
      const gap = Math.round((block.startAt.getTime() - previousEnd.getTime()) / 60_000);
      if (gap >= 15) breakMinutes += gap;
    }
    if (block.endAt) previousEnd = block.endAt;
  }
  const ends = sorted.filter((b) => b.endAt).map((b) => b.endAt as Date);
  return {
    workedMinutes,
    breakMinutes,
    firstStart: sorted[0]?.startAt ?? null,
    lastEnd: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    open: sorted.some((b) => !b.endAt),
  };
}

export type ViolationCode =
  | 'MAX_DAILY_EXCEEDED'
  | 'BREAK_TOO_SHORT'
  | 'REST_PERIOD_TOO_SHORT'
  | 'SUNDAY_HOLIDAY_WORK'
  | 'MISSING_CLOCK_OUT'
  | 'WEEKLY_OVER_48';

export interface Violation {
  day: string;
  code: ViolationCode;
  severity: 'error' | 'warning';
  /** Measured value in minutes (worked, break or rest). */
  value?: number;
  /** Statutory limit in minutes. */
  limit?: number;
}

export function requiredBreak(workedMinutes: number): number {
  if (workedMinutes > 9 * 60) return 45;
  if (workedMinutes > 6 * 60) return 30;
  return 0;
}

export function checkDay(
  day: string,
  actuals: DayActuals,
  previousLastEnd: Date | null,
  isHoliday: boolean,
  today: string,
): Violation[] {
  const violations: Violation[] = [];
  if (actuals.open && day < today) violations.push({ day, code: 'MISSING_CLOCK_OUT', severity: 'error' });
  if (actuals.workedMinutes > 600) {
    violations.push({ day, code: 'MAX_DAILY_EXCEEDED', severity: 'error', value: actuals.workedMinutes, limit: 600 });
  }
  const needed = requiredBreak(actuals.workedMinutes);
  if (actuals.breakMinutes < needed) {
    violations.push({ day, code: 'BREAK_TOO_SHORT', severity: 'error', value: actuals.breakMinutes, limit: needed });
  }
  if (previousLastEnd && actuals.firstStart) {
    const rest = Math.round((actuals.firstStart.getTime() - previousLastEnd.getTime()) / 60_000);
    if (rest < 660) violations.push({ day, code: 'REST_PERIOD_TOO_SHORT', severity: 'error', value: Math.max(rest, 0), limit: 660 });
  }
  if (actuals.workedMinutes > 0 && (weekdayIndex(day) === 6 || isHoliday)) {
    violations.push({ day, code: 'SUNDAY_HOLIDAY_WORK', severity: 'warning' });
  }
  return violations;
}

// ------------------------------------------------------------------- targets

export interface ScheduleAssignment {
  validFrom: string;
  validTo: string | null;
  dailyMinutes: number[];
}

export const STANDARD_WEEK = [480, 480, 480, 480, 480, 0, 0];

/** Week pattern from contractual weekly hours spread over Mon–Fri. */
export function patternFromWeeklyHours(weeklyHours: number | null | undefined): number[] {
  if (!weeklyHours || weeklyHours <= 0) return STANDARD_WEEK;
  const perDay = Math.round((weeklyHours * 60) / 5);
  return [perDay, perDay, perDay, perDay, perDay, 0, 0];
}

export function patternOn(day: string, assignments: ScheduleAssignment[], fallback: number[]): number[] {
  const match = assignments
    .filter((a) => a.validFrom <= day && (!a.validTo || a.validTo >= day))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return match?.dailyMinutes ?? fallback;
}

export type AbsenceKind = 'VACATION' | 'SICK' | 'SPECIAL' | 'UNPAID' | 'PARENTAL' | 'OVERTIME_COMPENSATION' | 'HOME_OFFICE';

/**
 * Absences that are credited as fulfilled target time. Overtime compensation
 * is deliberately absent: it is paid from the flexitime balance, and home
 * office is a place of work, not an absence.
 */
export const CREDITED_ABSENCES: ReadonlySet<AbsenceKind> = new Set(['VACATION', 'SICK', 'SPECIAL', 'UNPAID', 'PARENTAL']);

export interface DayPlan {
  day: string;
  scheduledMinutes: number;
  targetMinutes: number;
  holiday: string | null;
  absence: AbsenceKind | null;
}

export function planDay(
  day: string,
  pattern: number[],
  holidays: Map<string, string>,
  absences: Map<string, AbsenceKind>,
  employment: { from: string | null; to: string | null } = { from: null, to: null },
): DayPlan {
  const employed = (!employment.from || day >= employment.from) && (!employment.to || day <= employment.to);
  const scheduledMinutes = employed ? (pattern[weekdayIndex(day)] ?? 0) : 0;
  const holiday = holidays.get(day) ?? null;
  const absence = absences.get(day) ?? null;
  const credited = holiday !== null || (absence !== null && CREDITED_ABSENCES.has(absence));
  return { day, scheduledMinutes, targetMinutes: credited ? 0 : scheduledMinutes, holiday, absence };
}

// --------------------------------------------------------------- summaries

export interface DaySummary extends DayPlan {
  workedMinutes: number;
  breakMinutes: number;
  projectMinutes: number;
  /** worked − target; 0 for days after today (not yet due) */
  deltaMinutes: number;
  /** worked − project hours booked (attendance not allocated to projects) */
  unallocatedMinutes: number;
  open: boolean;
  violations: Violation[];
}

export interface PeriodSummary {
  days: DaySummary[];
  totals: { targetMinutes: number; workedMinutes: number; projectMinutes: number; deltaMinutes: number; billableMinutes: number };
  violations: Violation[];
}

export function summarizePeriod(input: {
  days: string[];
  plans: Map<string, DayPlan>;
  blocks: WorkBlock[];
  projectMinutes: Map<string, number>;
  billableMinutes?: number;
  /** last end of work before the first day (for the rest-period check) */
  previousLastEnd?: Date | null;
  today: string;
}): PeriodSummary {
  const byDay = new Map<string, WorkBlock[]>();
  for (const block of input.blocks) byDay.set(block.day, [...(byDay.get(block.day) ?? []), block]);
  let previousLastEnd = input.previousLastEnd ?? null;
  const days: DaySummary[] = input.days.map((day) => {
    const plan = input.plans.get(day) ?? { day, scheduledMinutes: 0, targetMinutes: 0, holiday: null, absence: null };
    const actuals = dayActuals(byDay.get(day) ?? []);
    const violations = checkDay(day, actuals, actuals.firstStart ? previousLastEnd : null, plan.holiday !== null, input.today);
    if (actuals.lastEnd) previousLastEnd = actuals.lastEnd;
    const projectMinutes = input.projectMinutes.get(day) ?? 0;
    return {
      ...plan,
      workedMinutes: actuals.workedMinutes,
      breakMinutes: actuals.breakMinutes,
      projectMinutes,
      deltaMinutes: day > input.today ? actuals.workedMinutes : actuals.workedMinutes - plan.targetMinutes,
      unallocatedMinutes: actuals.workedMinutes - projectMinutes,
      open: actuals.open,
      violations,
    };
  });
  const sum = (pick: (d: DaySummary) => number) => days.reduce((total, d) => total + pick(d), 0);
  const totals = {
    targetMinutes: sum((d) => d.targetMinutes),
    workedMinutes: sum((d) => d.workedMinutes),
    projectMinutes: sum((d) => d.projectMinutes),
    deltaMinutes: sum((d) => d.deltaMinutes),
    billableMinutes: input.billableMinutes ?? 0,
  };
  const violations = days.flatMap((d) => d.violations);
  // §3/§7 ArbZG: 48 h per six-day week on average — flag a single week above it.
  if (days.length === 7 && totals.workedMinutes > 48 * 60) {
    violations.push({ day: days[0].day, code: 'WEEKLY_OVER_48', severity: 'warning', value: totals.workedMinutes, limit: 48 * 60 });
  }
  return { days, totals, violations };
}

/** Blocking violations prevent submitting a timesheet. */
export function hasBlockingViolation(violations: Violation[]): boolean {
  return violations.some((v) => v.code === 'MISSING_CLOCK_OUT');
}

// ------------------------------------------------------------------ helpers

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export function overlaps(a: { startAt: Date; endAt: Date | null }, b: { startAt: Date; endAt: Date | null }): boolean {
  const aEnd = a.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.startAt.getTime() < bEnd && b.startAt.getTime() < aEnd;
}
