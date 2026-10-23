import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { allowedDomains, attention, localDate, recurrenceDate, validDate, validateDates, visibility } from './calendar-domain';
import { CreateCalendarItemDto, UpdateCalendarItemDto } from './calendar.dto';
import type { AuthUser } from '../../core/auth/decorators';

const user: AuthUser = { id: 'employee', email: 'test@example.com', companyId: 'a', isSystemAdmin: false, permissions: ['calendar.items.read', 'hr.employees.read'] };
const dates = { kind: 'OBLIGATION', allDay: false, dateOnly: '2026-03-29', timezoneIana: 'Europe/Berlin' };
describe('Calendar dates and recurrence', () => {
  it.each(['2026-02-29', '2026-13-01', '2026-00-00', '2026-04-31', 'bad'])('rejects invalid date %s', (date) => expect(validDate(date)).toBe(false));
  it('accepts leap day', () => expect(validDate('2028-02-29')).toBe(true));
  it('keeps local date across Berlin DST boundary', () => {
    expect(localDate(new Date('2026-03-28T23:30:00Z'), 'Europe/Berlin')).toBe('2026-03-29');
    expect(localDate(new Date('2026-03-29T22:30:00Z'), 'Europe/Berlin')).toBe('2026-03-30');
    expect(localDate(new Date('2026-10-25T22:30:00Z'), 'Europe/Berlin')).toBe('2026-10-25');
    expect(() => validateDates(dates)).not.toThrow();
  });
  it('clamps from the original monthly anchor without drifting', () => {
    expect(recurrenceDate('2026-01-31', 'MONTHLY', 1, 1)).toBe('2026-02-28');
    expect(recurrenceDate('2026-01-31', 'MONTHLY', 1, 2)).toBe('2026-03-31');
    expect(recurrenceDate('2028-02-29', 'YEARLY', 1, 4)).toBe('2032-02-29');
    expect(recurrenceDate('2026-03-29', 'WEEKLY', 2, 1)).toBe('2026-04-12');
  });
  it('requires exclusive all-day ends and valid timed intervals', () => {
    expect(() => validateDates({ ...dates, allDay: true, kind: 'APPOINTMENT', endDateOnly: '2026-03-30' })).not.toThrow();
    expect(() => validateDates({ ...dates, endDateOnly: dates.dateOnly })).toThrow(BadRequestException);
    expect(() => validateDates({ ...dates, dateOnly: null, startsAt: new Date('2026-03-29T08:00Z'), endsAt: new Date('2026-03-29T07:00Z') })).toThrow(BadRequestException);
  });
  it('rejects mixed date-only/timed dates, invalid timezones and timed recurrence', () => {
    expect(() => validateDates({ ...dates, startsAt: new Date() })).toThrow();
    expect(() => validateDates({ ...dates, timezoneIana: 'unknown' })).toThrow();
    expect(() => validateDates({ ...dates, recurrenceFrequency: 'WEEKLY', hardDueAt: new Date() })).toThrow();
  });
});
describe('Calendar privacy and attention', () => {
  it('does not grant HR confidential access from employee directory permission', () => {
    expect(allowedDomains(user)).not.toContain('HR');
    expect(allowedDomains(user)).not.toContain('FINANCE');
  });
  it('keeps private access explicit even for system administrators', () => {
    const where = visibility('a', { ...user, isSystemAdmin: true });
    expect(where).toMatchObject({ companyId: 'a', deletedAt: null });
    expect(where.OR).toEqual([{ sensitivity: 'PUBLIC_INTERNAL' }, { ownerUserId: 'employee' }, { createdById: 'employee' }, { grants: { some: { userId: 'employee' } } }]);
  });
  it('uses local end-of-day semantics and explains evidence/owner readiness', () => {
    const item = { ...dates, status: 'OPEN', priority: 4, ownerUserId: null, hardDueDate: dates.dateOnly, internalTargetDate: null, forecastDate: null, startsAt: null, hardDueAt: null, completionEvidenceRequired: true, checklist: [{ done: false }], evidence: [] };
    expect(attention(item, new Date('2026-03-29T21:59Z'))).toMatchObject({ overdue: false });
    expect(attention(item, new Date('2026-03-29T22:01Z'))).toEqual({ score: 100, overdue: true, reasons: ['OVERDUE', 'HIGH_PRIORITY', 'MISSING_OWNER', 'PREPARATION_INCOMPLETE', 'EVIDENCE_MISSING'] });
    expect(attention({ ...item, status: 'COMPLETED' })).toEqual({ score: 0, overdue: false, reasons: [] });
  });
});
describe('Calendar DTO boundaries', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it('rejects unknown fields, missing version and offsetless timestamps', async () => {
    for (const body of [{ version: 1, companyId: 'other' }, { title: 'edit' }, { version: 1, startsAt: '2026-10-12T09:00' }, { version: 1, status: 'COMPLETED' }, { version: 1, title: null }]) {
      await expect(pipe.transform(body, { type: 'body', metatype: UpdateCalendarItemDto })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it('rejects incomplete creation and blank titles', async () => {
    await expect(pipe.transform({ domain: 'HR', kind: 'OBLIGATION' }, { type: 'body', metatype: CreateCalendarItemDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: '  ', domain: 'HR', kind: 'OBLIGATION' }, { type: 'body', metatype: CreateCalendarItemDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
