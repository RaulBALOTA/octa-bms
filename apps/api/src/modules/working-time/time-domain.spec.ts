import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkDay,
  dayActuals,
  fromZoned,
  isoWeek,
  patternFromWeeklyHours,
  patternOn,
  planDay,
  requiredBreak,
  summarizePeriod,
  toZoned,
  weekStartOf,
  type WorkBlock,
} from './time-domain';

const TZ = 'Europe/Berlin';
const block = (day: string, start: string, end: string | null, breakMinutes = 0): WorkBlock => ({
  day, startAt: fromZoned(day, start, TZ), endAt: end ? fromZoned(day, end, TZ) : null, breakMinutes,
});

describe('calendar helpers', () => {
  it('derives ISO weeks with Monday start (German KW)', () => {
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19'); // Sunday → Monday
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(isoWeek('2026-10-23')).toEqual({ year: 2026, week: 43 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('converts wall-clock times across daylight-saving changes', () => {
    expect(fromZoned('2026-07-01', '08:00', TZ).toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(fromZoned('2026-12-01', '08:00', TZ).toISOString()).toBe('2026-12-01T07:00:00.000Z');
    // 25 Oct 2026: clocks go back 03:00 → 02:00, the day has 25 hours
    const minutes = (fromZoned('2026-10-25', '23:00', TZ).getTime() - fromZoned('2026-10-25', '00:00', TZ).getTime()) / 60_000;
    expect(minutes).toBe(24 * 60);
    expect(toZoned(new Date('2026-10-22T22:30:00Z'), TZ)).toEqual({ day: '2026-10-23', time: '00:30' });
  });
});

describe('ArbZG checks', () => {
  it('requires 30 min after 6 h and 45 min after 9 h', () => {
    expect(requiredBreak(360)).toBe(0);
    expect(requiredBreak(361)).toBe(30);
    expect(requiredBreak(541)).toBe(45);
  });

  it('counts gaps of at least 15 minutes between blocks as breaks', () => {
    const actuals = dayActuals([block('2026-10-20', '08:00', '12:00'), block('2026-10-20', '12:30', '17:00')]);
    expect(actuals.workedMinutes).toBe(510);
    expect(actuals.breakMinutes).toBe(30);
    expect(checkDay('2026-10-20', actuals, null, false, '2026-10-23')).toEqual([]);
    const short = dayActuals([block('2026-10-20', '08:00', '12:00'), block('2026-10-20', '12:10', '17:00')]);
    expect(short.breakMinutes).toBe(0);
    expect(checkDay('2026-10-20', short, null, false, '2026-10-23').map((v) => v.code)).toEqual(['BREAK_TOO_SHORT']);
  });

  it('flags more than 10 hours, short rest periods, Sunday work and missing clock-outs', () => {
    const long = dayActuals([block('2026-10-20', '06:00', '17:30', 45)]);
    expect(long.workedMinutes).toBe(645);
    const previousEnd = fromZoned('2026-10-19', '22:00', TZ);
    const codes = checkDay('2026-10-20', long, previousEnd, false, '2026-10-23').map((v) => v.code);
    expect(codes).toEqual(['MAX_DAILY_EXCEEDED', 'REST_PERIOD_TOO_SHORT']);
    expect(checkDay('2026-10-25', dayActuals([block('2026-10-25', '10:00', '12:00')]), null, false, '2026-10-26').map((v) => v.code)).toEqual(['SUNDAY_HOLIDAY_WORK']);
    expect(checkDay('2026-10-21', dayActuals([block('2026-10-21', '08:00', null)]), null, false, '2026-10-23').map((v) => v.code)).toEqual(['MISSING_CLOCK_OUT']);
    expect(checkDay('2026-10-23', dayActuals([block('2026-10-23', '08:00', null)]), null, false, '2026-10-23')).toEqual([]);
  });
});

describe('targets', () => {
  it('uses the assignment valid on the day and falls back to contractual hours', () => {
    const assignments = [
      { validFrom: '2026-01-01', validTo: '2026-06-30', dailyMinutes: [480, 480, 480, 480, 480, 0, 0] },
      { validFrom: '2026-07-01', validTo: null, dailyMinutes: [360, 360, 360, 360, 0, 0, 0] },
    ];
    expect(patternOn('2026-03-02', assignments, [])[0]).toBe(480);
    expect(patternOn('2026-10-23', assignments, [])[4]).toBe(0);
    expect(patternOn('2025-12-31', assignments, [1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(patternFromWeeklyHours(30)).toEqual([360, 360, 360, 360, 360, 0, 0]);
  });

  it('credits holidays and leave, but not overtime compensation or home office', () => {
    const pattern = [480, 480, 480, 480, 480, 0, 0];
    const holidays = new Map([['2026-10-26', 'Holiday']]);
    const absences = new Map([
      ['2026-10-27', 'VACATION' as const], ['2026-10-28', 'OVERTIME_COMPENSATION' as const], ['2026-10-29', 'HOME_OFFICE' as const],
    ]);
    expect(planDay('2026-10-26', pattern, holidays, absences).targetMinutes).toBe(0);
    expect(planDay('2026-10-27', pattern, holidays, absences).targetMinutes).toBe(0);
    expect(planDay('2026-10-28', pattern, holidays, absences).targetMinutes).toBe(480);
    expect(planDay('2026-10-29', pattern, holidays, absences).targetMinutes).toBe(480);
    expect(planDay('2026-10-30', pattern, holidays, absences, { from: '2026-11-01', to: null }).scheduledMinutes).toBe(0);
  });
});

describe('period summary', () => {
  it('reconciles attendance, project hours and the flexitime delta', () => {
    const days = ['2026-10-19', '2026-10-20'];
    const plans = new Map(days.map((day) => [day, planDay(day, [480, 480, 480, 480, 480, 0, 0], new Map(), new Map())]));
    const summary = summarizePeriod({
      days,
      plans,
      blocks: [block('2026-10-19', '08:00', '17:00', 30), block('2026-10-20', '08:00', '15:00', 30)],
      projectMinutes: new Map([['2026-10-19', 420], ['2026-10-20', 390]]),
      today: '2026-10-23',
    });
    expect(summary.days.map((d) => [d.workedMinutes, d.deltaMinutes, d.unallocatedMinutes])).toEqual([[510, 30, 90], [390, -90, 0]]);
    expect(summary.totals).toMatchObject({ targetMinutes: 960, workedMinutes: 900, projectMinutes: 810, deltaMinutes: -60 });
    expect(summary.violations).toEqual([]);
  });

  it('does not count target time of days that are still ahead', () => {
    const days = ['2026-10-22', '2026-10-23', '2026-10-24'];
    const plans = new Map(days.map((day) => [day, planDay(day, [480, 480, 480, 480, 480, 480, 0], new Map(), new Map())]));
    const summary = summarizePeriod({ days, plans, blocks: [], projectMinutes: new Map(), today: '2026-10-23' });
    expect(summary.days.map((d) => d.deltaMinutes)).toEqual([-480, -480, 0]);
    expect(summary.totals.targetMinutes).toBe(1440);
  });
});
