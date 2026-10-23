import { useTranslation } from 'react-i18next';

/** Formatting helpers. Money arrives as decimal strings and is only converted for display. */
export function useFormat(currency = 'EUR') {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const moneyFull = new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const moneyShort = new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(lang, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const toNum = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    money: (v: string | number | null | undefined) => { const n = toNum(v); return n === null ? '—' : moneyFull.format(n); },
    moneyShort: (v: string | number | null | undefined) => { const n = toNum(v); return n === null ? '—' : moneyShort.format(n); },
    compact: (v: string | number | null | undefined) => { const n = toNum(v); return n === null ? '—' : compact.format(n); },
    hours: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${num.format(v)} h`),
    num: (v: number | null | undefined) => (v === null || v === undefined ? '—' : num.format(v)),
    pct: (v: number | null | undefined, fraction = false) => (v === null || v === undefined ? '—' : `${num.format(fraction ? v * 100 : v)} %`),
    date: (iso: string | null | undefined) => (iso ? date.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—'),
    month: (key: string) => month.format(new Date(`${key}-01T00:00:00Z`)),
    dateTime: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang) : '—'),
  };
}
export const today = () => new Date().toISOString().slice(0, 10);
export const addDaysIso = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
