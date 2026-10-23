import { describe, expect, it } from 'vitest';
import { calendarDays, dateInZone, itemDate, occupiesDate } from './dates';
import type { CalendarItem } from './types';
describe('Company calendar date placement', () => {
  it('uses Monday-first grids and includes leap day', () => {
    expect(calendarDays('2028-02-29', 'month')).toHaveLength(42);
    expect(calendarDays('2028-02-29', 'month')[0]).toBe('2028-01-31');
    expect(calendarDays('2026-10-12', 'workweek')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(calendarDays('2026-10-12', 'day')).toEqual(['2026-10-12']);
  });
  it('places timed events in original timezone and handles DST', () => {
    expect(dateInZone('2026-03-29T22:30:00Z', 'Europe/Berlin')).toBe('2026-03-30');
    expect(dateInZone('2026-10-25T23:30:00Z', 'Europe/Berlin')).toBe('2026-10-26');
  });
  it('prioritizes hard deadlines over internal dates', () => {
    const item = { hardDueDate: '2026-10-14', dateOnly: '2026-10-12', internalTargetDate: '2026-10-10' } as CalendarItem;
    expect(itemDate(item)).toBe('2026-10-14');
  });
  it('keeps all-day and midnight timed ends exclusive', () => {
    const item = { dateOnly: '2026-10-12', endDateOnly: '2026-10-14' } as CalendarItem;
    expect(occupiesDate(item, '2026-10-13')).toBe(true);
    expect(occupiesDate(item, '2026-10-14')).toBe(false);
    const timed = { startsAt: '2026-10-12T22:00:00Z', endsAt: '2026-10-13T22:00:00Z', timezoneIana: 'Europe/Berlin' } as CalendarItem;
    expect(occupiesDate(timed, '2026-10-13')).toBe(true);
    expect(occupiesDate(timed, '2026-10-14')).toBe(false);
  });
});
