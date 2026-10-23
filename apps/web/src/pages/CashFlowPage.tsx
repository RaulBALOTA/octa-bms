import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { FinanceNav } from '../components/FinanceNav';
import { Skeleton } from '../components/ui';

interface CashFlowResult {
  startingBalance: number;
  totalExpectedIn: number;
  totalExpectedOut: number;
  endBalance: number;
  weeks: {
    weekStart: string;
    expectedIn: number;
    expectedOut: number;
    net: number;
    balance: number;
  }[];
}

export function CashFlowPage() {
  const { t, i18n } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['cashflow'],
    queryFn: () => api.get<CashFlowResult>('/finance/cashflow?weeks=12'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit' }).format(
      new Date(iso),
    );

  const tiles = data
    ? [
        {
          label: t('finance.currentBalance'),
          value: money(data.startingBalance),
          icon: Wallet,
          tone: '',
        },
        {
          label: t('finance.expectedIn'),
          value: money(data.totalExpectedIn),
          icon: TrendingUp,
          tone: 'text-success',
        },
        {
          label: t('finance.expectedOut'),
          value: money(data.totalExpectedOut),
          icon: TrendingDown,
          tone: 'text-destructive',
        },
        {
          label: t('finance.projectedBalance'),
          value: money(data.endBalance),
          icon: Wallet,
          tone: data.endBalance >= data.startingBalance ? 'text-success' : 'text-warning',
        },
      ]
    : [];

  return (
    <>
      <FinanceNav />
      <h1 className="mb-4 text-lg font-bold">
        {t('finance.cashflow')}{' '}
        <span className="text-sm font-normal text-muted-foreground">
          — {t('finance.next12Weeks')}
        </span>
      </h1>

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </span>
                  <tile.icon size={14} className={tile.tone || 'text-muted-foreground'} />
                </div>
                <div className={clsx('mt-1 text-xl font-bold tabular-nums', tile.tone)}>
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t('finance.week')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('finance.expectedIn')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('finance.expectedOut')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('finance.net2')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('finance.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((week, index) => (
                  <tr
                    key={week.weekStart}
                    className="border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-2">
                      KW {fmtDate(week.weekStart)}
                      {index === 0 && (
                        <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {t('finance.thisWeek')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-success">
                      {week.expectedIn ? `+${money(week.expectedIn)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-destructive">
                      {week.expectedOut ? `−${money(week.expectedOut)}` : '—'}
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-2 text-right font-medium tabular-nums',
                        week.net > 0 && 'text-success',
                        week.net < 0 && 'text-destructive',
                      )}
                    >
                      {week.net ? money(week.net) : '—'}
                    </td>
                    <td
                      className={clsx(
                        'px-4 py-2 text-right font-semibold tabular-nums',
                        week.balance < 0 && 'text-destructive',
                      )}
                    >
                      {money(week.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('finance.cashflowHint')}</p>
        </>
      )}
    </>
  );
}
