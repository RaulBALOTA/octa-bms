import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type ValueType = 'text' | 'number' | 'money' | 'date' | 'percent';

/** Locale-aware formatters shared by tables, pivots and charts. */
export function useFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return useMemo(() => {
    const moneyFmt = new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    });
    const moneyExact = new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' });
    const numberFmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
    const compactFmt = new Intl.NumberFormat(lang, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const dateFmt = new Intl.DateTimeFormat(lang);
    const money = (v: number) => moneyFmt.format(v);
    const compact = (v: number) => compactFmt.format(v);
    const compactMoney = (v: number) => `${compactFmt.format(v)} €`;
    const number = (v: number) => numberFmt.format(v);
    const percent = (v: number) => `${numberFmt.format(Math.round(v * 10) / 10)}%`;
    const date = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? String(iso) : dateFmt.format(d);
    };
    const value = (v: unknown, type: ValueType = 'text', exact = false): string => {
      if (v === null || v === undefined || v === '') return '—';
      switch (type) {
        case 'money':
          return exact ? moneyExact.format(Number(v)) : money(Number(v));
        case 'number':
          return number(Number(v));
        case 'percent':
          return percent(Number(v));
        case 'date':
          return date(String(v));
        default:
          return String(v);
      }
    };
    return { lang, money, compact, compactMoney, number, percent, date, value };
  }, [lang]);
}

/** Days between today and an ISO date (negative = past). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}
