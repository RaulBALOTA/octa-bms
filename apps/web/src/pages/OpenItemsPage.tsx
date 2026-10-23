import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { FinanceNav } from '../components/FinanceNav';
import { StatusBadge } from '../components/ListPage';
import { SelectInput, Skeleton } from '../components/ui';

interface OpenItemsResult {
  direction: string;
  totalOpen: number;
  buckets: { key: string; total: number; count: number }[];
  items: {
    id: string;
    invoiceNumber: string;
    partner: { name: string };
    dueDate: string;
    status: string;
    gross: number;
    paid: number;
    open: number;
    overdueDays: number;
    bucket: string;
  }[];
}

const BUCKET_TONE: Record<string, string> = {
  current: 'text-success',
  d1_30: 'text-warning',
  d31_60: 'text-warning',
  d61_90: 'text-destructive',
  d90plus: 'text-destructive',
};

export function OpenItemsPage() {
  const { t, i18n } = useTranslation();
  const [direction, setDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING');
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['open-items-page', direction],
    queryFn: () => api.get<OpenItemsResult>(`/finance/open-items?direction=${direction}`),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      value,
    );
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  const visibleItems =
    data?.items.filter((item) => !bucketFilter || item.bucket === bucketFilter) ?? [];

  return (
    <>
      <FinanceNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('finance.openItems')}</h1>
        <span className="text-sm text-muted-foreground">
          Σ <strong className="text-foreground">{money(data?.totalOpen ?? 0)}</strong>
        </span>
        <div className="flex-1" />
        <SelectInput
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value as 'OUTGOING' | 'INCOMING');
            setBucketFilter(null);
          }}
          className="!w-auto"
        >
          <option value="OUTGOING">{t('finance.receivables')}</option>
          <option value="INCOMING">{t('finance.payables')}</option>
        </SelectInput>
      </div>

      {/* aging buckets */}
      {isLoading || !data ? (
        <Skeleton className="mb-4 h-20" />
      ) : (
        <div className="mb-4 grid grid-cols-5 gap-3">
          {data.buckets.map((bucket) => (
            <button
              key={bucket.key}
              onClick={() =>
                setBucketFilter((current) => (current === bucket.key ? null : bucket.key))
              }
              className={clsx(
                'rounded-xl border bg-card p-3 text-left transition-colors',
                bucketFilter === bucket.key
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border hover:border-primary/40',
              )}
            >
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(`finance.bucket.${bucket.key}`)}
              </div>
              <div className={clsx('mt-0.5 text-lg font-bold tabular-nums', BUCKET_TONE[bucket.key])}>
                {money(bucket.total)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {bucket.count} {t('finance.title')}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t('finance.invoiceNumber')}</th>
              <th className="px-4 py-2.5 font-medium">{t('contracts.partner')}</th>
              <th className="px-4 py-2.5 font-medium">{t('finance.dueDate')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.overdueDays')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.gross')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.paid')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.open2')}</th>
              <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2 font-mono text-xs">{item.invoiceNumber}</td>
                  <td className="px-4 py-2">{item.partner.name}</td>
                  <td className="px-4 py-2">{fmtDate(item.dueDate)}</td>
                  <td
                    className={clsx(
                      'px-4 py-2 text-right tabular-nums',
                      item.overdueDays > 0 && 'font-medium text-destructive',
                    )}
                  >
                    {item.overdueDays || '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(item.gross)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {money(item.paid)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {money(item.open)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge value={item.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
