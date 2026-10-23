/** Calendar-day helpers on YYYY-MM-DD strings (UTC arithmetic, no time zone drift). */
const DAY_MS = 86_400_000;

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekStartOf(day: string): string {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/** 450 → "7:30"; negative values keep their sign. */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

export function formatSigned(minutes: number): string {
  return minutes > 0 ? `+${formatMinutes(minutes)}` : formatMinutes(minutes);
}

export function formatHours(minutes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(minutes / 60);
}

export function weekdayLabel(day: string, locale: string, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function shortDate(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** "7:30" or "7,5" or "7.5" → minutes; null when unparseable. */
export function parseDuration(input: string): number | null {
  const text = input.trim();
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const decimal = Number(text.replace(',', '.'));
  return text && Number.isFinite(decimal) && decimal >= 0 ? Math.round(decimal * 60) : null;
}

/** Utilization tone for the capacity board. */
export function utilizationTone(utilization: number | null): 'none' | 'low' | 'ok' | 'high' | 'over' {
  if (utilization == null) return 'none';
  if (utilization > 100) return 'over';
  if (utilization >= 90) return 'high';
  if (utilization >= 50) return 'ok';
  return 'low';
}
