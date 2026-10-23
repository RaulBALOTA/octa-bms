import type { CalendarItem } from './types';
export function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function dateInZone(instant: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type)?.value).join('-');
}
export function itemDate(item: CalendarItem) { return item.hardDueDate ?? item.dateOnly ?? (item.hardDueAt || item.startsAt ? dateInZone(item.hardDueAt ?? item.startsAt ?? '', item.timezoneIana) : null) ?? item.internalTargetDate ?? item.forecastDate ?? ''; }
export function occupiesDate(item: CalendarItem, day: string) {
  if (item.dateOnly && item.endDateOnly) return day >= item.dateOnly && day < item.endDateOnly;
  if (item.startsAt && item.endsAt) {
    return day >= dateInZone(item.startsAt, item.timezoneIana) && day <= dateInZone(new Date(new Date(item.endsAt).getTime() - 1).toISOString(), item.timezoneIana);
  }
  return [itemDate(item), item.internalTargetDate, item.forecastDate].includes(day);
}
export function calendarDays(anchor: string, mode: string) {
  const date = new Date(anchor + 'T12:00:00');
  if (mode === 'month') date.setDate(1);
  if (mode !== 'day') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return Array.from({ length: mode === 'day' ? 1 : mode === 'month' ? 42 : mode === 'workweek' ? 5 : 7 }, (_, i) => { const day = new Date(date); day.setDate(day.getDate() + i); return isoDate(day); });
}
