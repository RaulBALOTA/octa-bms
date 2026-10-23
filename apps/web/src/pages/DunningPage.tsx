import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { printDunning } from '../lib/print-dunning';
import { printInvoice } from '../lib/print-invoice';
import { FinanceNav } from '../components/FinanceNav';
import { Button, Skeleton, useToast } from '../components/ui';

interface DunningItem {
  id: string;
  invoiceNumber: string;
  partner: {
    name: string;
    legalName?: string | null;
    street?: string | null;
    postalCode?: string | null;
    city?: string | null;
  };
  invoiceDate: string;
  dueDate: string;
  open: number;
  overdueDays: number;
  dunningLevel: number;
  lastDunnedAt: string | null;
  currencyCode: string;
}

const LEVEL_TONE = [
  'bg-muted text-muted-foreground',
  'bg-warning/15 text-warning',
  'bg-destructive/15 text-destructive',
  'bg-destructive text-white',
];

export function DunningPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: ['dunning'],
    queryFn: () => api.get<DunningItem[]>('/finance/dunning'),
  });
  const { data: company } = useQuery({
    queryKey: ['company-profile'],
    queryFn: () =>
      api.get<Parameters<typeof printInvoice>[1]>('/master/company-profile'),
    staleTime: 300_000,
  });

  const dun = useMutation({
    mutationFn: (item: DunningItem) => api.post<{ dunningLevel: number }>(`/finance/dunning/${item.id}/dun`),
    onSuccess: (updated, item) => {
      void queryClient.invalidateQueries({ queryKey: ['dunning'] });
      void queryClient.invalidateQueries({ queryKey: ['/finance/invoices'] });
      toast(`${t('finance.dunned')} (${t('finance.level')} ${updated.dunningLevel})`);
      if (company) {
        printDunning(
          { ...item, dunningLevel: updated.dunningLevel },
          company,
          i18n.language,
        );
      }
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
      value,
    );
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const totalOpen = items?.reduce((sum, item) => sum + item.open, 0) ?? 0;

  return (
    <>
      <FinanceNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('finance.dunning')}</h1>
        {items && items.length > 0 && (
          <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
            {items.length} · {money(totalOpen)}
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : items?.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span
                className={clsx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                  LEVEL_TONE[item.dunningLevel],
                )}
                title={`${t('finance.level')} ${item.dunningLevel}`}
              >
                M{item.dunningLevel}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  <span className="font-mono text-xs">{item.invoiceNumber}</span>{' '}
                  {item.partner.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('finance.dueDate')}: {fmtDate(item.dueDate)} ·{' '}
                  <span className="font-medium text-destructive">
                    {item.overdueDays} {t('finance.overdueDays')}
                  </span>
                  {item.lastDunnedAt &&
                    ` · ${t('finance.lastDunned')}: ${fmtDate(item.lastDunnedAt)}`}
                </div>
              </div>
              <span className="font-semibold tabular-nums">{money(item.open)}</span>
              <Button
                size="sm"
                disabled={dun.isPending || item.dunningLevel >= 3 || !company}
                onClick={() => dun.mutate(item)}
              >
                <BellRing size={13} />
                {item.dunningLevel >= 3
                  ? t('finance.handover')
                  : t(`finance.dunAction.${item.dunningLevel}`)}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-border bg-card py-14 text-center">
          <p className="text-sm font-medium">{t('finance.noDunning')}</p>
          <p className="text-xs text-muted-foreground">{t('finance.noDunningHint')}</p>
        </div>
      )}
    </>
  );
}
