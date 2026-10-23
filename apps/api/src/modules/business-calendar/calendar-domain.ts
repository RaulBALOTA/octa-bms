import { BadRequestException } from '@nestjs/common';
import { CalendarDomain, CalendarSensitivity, Prisma } from '@prisma/client';
import type { AuthUser } from '../../core/auth/decorators';

export const DOMAIN_PERMISSIONS: Record<CalendarDomain, string> = {
  CORPORATE: 'corporate.dashboard.read', FINANCE: 'finance.invoices.read',
  SALES: 'sales.opportunities.read', HR: 'hr.reviews.read',
  OPERATIONS: 'calendar.items.read', MEETING: 'calendar.items.read', COMMITMENT: 'calendar.items.read',
};
export function allowedDomains(user: AuthUser): CalendarDomain[] {
  return Object.values(CalendarDomain).filter((d) => user.isSystemAdmin || user.permissions.includes(DOMAIN_PERMISSIONS[d]));
}
export function visibility(companyId: string, user: AuthUser): Prisma.BusinessCalendarItemWhereInput {
  return { companyId, deletedAt: null, domain: { in: allowedDomains(user) }, AND: [{ OR: [
    { sourceKind: { not: 'MS_GRAPH' } }, { ownerUserId: user.id }, { createdById: user.id }, { grants: { some: { userId: user.id } } },
  ] }], OR: [
    { sensitivity: CalendarSensitivity.PUBLIC_INTERNAL }, { ownerUserId: user.id },
    { createdById: user.id }, { grants: { some: { userId: user.id } } },
  ] };
}
export function validDate(value: string): boolean {
  const parsed = new Date(value + 'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900 &&
    Number(value.slice(0, 4)) <= 9999 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Anchor-based monthly/yearly clamping avoids Jan 31 -> Feb 28 -> Mar 28 drift. */
export function recurrenceDate(anchor: string, frequency: string, interval: number, occurrence: number): string {
  if (frequency === 'DAILY' || frequency === 'WEEKLY') return shiftDate(anchor, interval * occurrence * (frequency === 'WEEKLY' ? 7 : 1));
  const original = new Date(anchor + 'T12:00:00Z');
  const months = interval * occurrence * (frequency === 'YEARLY' ? 12 : 1);
  const value = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + months, 1, 12));
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(original.getUTCDate(), last));
  return value.toISOString().slice(0, 10);
}
interface Dates {
  timezoneIana: string; allDay: boolean; dateOnly?: string | null; endDateOnly?: string | null;
  startsAt?: Date | null; endsAt?: Date | null; hardDueAt?: Date | null;
  hardDueDate?: string | null; internalTargetDate?: string | null; forecastDate?: string | null;
  recurrenceFrequency?: string | null; recurrenceUntil?: string | null; kind: string;
}
export function validateDates(item: Dates) {
  try { new Intl.DateTimeFormat('en', { timeZone: item.timezoneIana }); } catch { throw new BadRequestException('Invalid IANA timezone'); }
  for (const value of [item.dateOnly, item.endDateOnly, item.hardDueDate, item.internalTargetDate, item.forecastDate, item.recurrenceUntil]) {
    if (value && !validDate(value)) throw new BadRequestException('Invalid calendar date');
  }
  for (const value of [item.startsAt, item.endsAt, item.hardDueAt]) {
    if (value && !Number.isFinite(value.getTime())) throw new BadRequestException('Invalid timestamp');
  }
  if (!item.dateOnly && !item.startsAt && !item.hardDueDate && !item.hardDueAt && !item.internalTargetDate && !item.forecastDate) throw new BadRequestException('At least one date is required');
  if (item.dateOnly && item.startsAt) throw new BadRequestException('Choose a date-only or timed start');
  if (item.hardDueDate && item.hardDueAt) throw new BadRequestException('Choose a date-only or timed hard deadline');
  if (item.endsAt && (!item.startsAt || item.endsAt <= item.startsAt)) throw new BadRequestException('End must be after start');
  if (item.endDateOnly && (!item.dateOnly || item.endDateOnly <= item.dateOnly)) throw new BadRequestException('All-day end date is exclusive and must follow start');
  if (item.allDay && (!item.dateOnly || item.startsAt || item.endsAt)) throw new BadRequestException('All-day items require date-only dates');
  if (item.kind === 'APPOINTMENT' && (item.allDay ? !item.endDateOnly : !item.startsAt || !item.endsAt)) throw new BadRequestException('Appointments require start and end');
  if (item.recurrenceFrequency && (!item.dateOnly || item.startsAt || item.hardDueAt || item.kind === 'APPOINTMENT')) throw new BadRequestException('Core recurrence supports date-only obligations; timed meetings require provider recurrence');
  if (item.recurrenceUntil && (!item.recurrenceFrequency || !item.dateOnly || item.recurrenceUntil < item.dateOnly)) throw new BadRequestException('Recurrence end precedes start');
}
interface AttentionItem {
  status: string; priority: number; ownerUserId: string | null; timezoneIana: string;
  dateOnly: string | null; hardDueDate: string | null; internalTargetDate: string | null; forecastDate: string | null;
  startsAt: Date | null; hardDueAt: Date | null; completionEvidenceRequired: boolean;
  checklist: { done: boolean }[]; evidence: unknown[];
}
export function attention(item: AttentionItem, now = new Date()) {
  if (['COMPLETED', 'CANCELED', 'DRAFT'].includes(item.status)) return { score: 0, reasons: [] as string[], overdue: false };
  const day = item.hardDueDate ?? item.dateOnly ?? item.internalTargetDate ?? item.forecastDate;
  const instant = item.hardDueAt ?? item.startsAt;
  const remaining = day ? Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(localDate(now, item.timezoneIana) + 'T12:00:00Z')) / 86400000) : instant ? (instant.getTime() - now.getTime()) / 86400000 : null;
  const reasons: string[] = []; let score = 0;
  const add = (reason: string, weight: number) => { reasons.push(reason); score += weight; };
  if (remaining !== null && remaining < 0) add('OVERDUE', 45);
  else if (remaining !== null && remaining <= 7) add('DUE_SOON', 25);
  else if (remaining !== null && remaining <= 30) add('UPCOMING', 10);
  if (item.priority >= 3) add('HIGH_PRIORITY', item.priority === 4 ? 25 : 15);
  if (!item.ownerUserId) add('MISSING_OWNER', 15);
  if (item.status === 'AWAITING') add('AWAITING_RESPONSE', 10);
  if (item.status === 'AT_RISK') add('AT_RISK', 15);
  if (item.checklist.some((c) => !c.done)) add('PREPARATION_INCOMPLETE', 10);
  if (item.completionEvidenceRequired && !item.evidence.length) add('EVIDENCE_MISSING', 10);
  return { score: Math.min(100, score), reasons, overdue: remaining !== null && remaining < 0 };
}
