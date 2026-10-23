import { useQuery } from '@tanstack/react-query';
import { Trophy, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { StatusBadge } from '../components/ListPage';
import { SubNav } from '../components/SubNav';
import { Skeleton } from '../components/ui';
import { OpportunityDrawer } from './OpportunityDrawer';

interface WinLossResult {
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  winRate: number;
  items: {
    id: string;
    opportunityNumber: string;
    title: string;
    partner: string;
    stage: string;
    value: number;
    lostReason: string | null;
    closedAt: string;
    owner: string | null;
  }[];
}

export function WinLossPage() {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['win-loss'],
    queryFn: () => api.get<WinLossResult>('/sales/win-loss'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  return (
    <>
      <SubNav
        items={[
          { label: t('sales.pipeline'), to: '/sales/pipeline' },
          { label: t('sales.winLoss'), to: '/sales/win-loss' },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">{t('sales.winLoss')}</h1>

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.won')} <Trophy size={14} className="text-success" />
              </div>
              <div className="mt-1 text-2xl font-bold text-success">{data.wonCount}</div>
              <div className="text-xs text-muted-foreground">{money(data.wonValue)}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.lost')} <XCircle size={14} className="text-destructive" />
              </div>
              <div className="mt-1 text-2xl font-bold text-destructive">{data.lostCount}</div>
              <div className="text-xs text-muted-foreground">{money(data.lostValue)}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.winRate')}
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-2xl font-bold tabular-nums">{data.winRate}%</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-success"
                    style={{ width: `${data.winRate}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t('crm.number')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('contracts.contractTitle')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('nav.clients')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('contracts.value')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('sales.lostReason')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('sales.closedAt')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length ? (
                  data.items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{item.opportunityNumber}</td>
                      <td className="px-4 py-2 font-medium">{item.title}</td>
                      <td className="px-4 py-2">{item.partner}</td>
                      <td
                        className={clsx(
                          'px-4 py-2 text-right tabular-nums',
                          item.stage === 'WON' ? 'text-success' : 'text-muted-foreground',
                        )}
                      >
                        {money(item.value)}
                      </td>
                      <td className="max-w-48 truncate px-4 py-2 text-xs text-muted-foreground">
                        {item.lostReason ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {fmtDate(item.closedAt)}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge value={item.stage} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      {t('common.noResults')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedId && (
        <OpportunityDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
