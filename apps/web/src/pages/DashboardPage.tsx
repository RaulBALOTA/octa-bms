import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  FileText,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { BarChart, HBarList } from '../components/charts';
import { SubNav } from '../components/SubNav';
import { Skeleton } from '../components/ui';
import { useAuthStore } from '../stores/auth';

interface Kpis {
  year: number;
  counts: {
    clients: number;
    activeContracts: number;
    openInvoices: number;
    employees: number;
    openLeave: number;
  };
  orderBacklog: number;
  revenueByMonth: { month: number; net: number }[];
  pipelineByStage: { stage: string; count: number; value: number }[];
}

interface ExpiringContract {
  id: string;
  contractNumber: string;
  title: string;
  endDate: string | null;
  partner?: { name: string } | null;
}

function StatCard({
  label,
  value,
  icon: Icon,
  to,
  loading,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  to: string;
  loading?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="rounded-md bg-accent p-1.5 text-primary transition-transform group-hover:scale-110">
          <Icon size={14} />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      )}
    </Link>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.me);

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: () => api.get<Kpis>('/corporate/kpis'),
  });
  const { data: expiring } = useQuery({
    queryKey: ['dash', 'expiring'],
    queryFn: () => api.get<ExpiringContract[]>('/contracts/expiring?withinDays=90'),
  });
  const { data: approvals } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<{ count: number }>('/workflow/tasks/my'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  const moneyCompact = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const monthLabel = (month: number) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(
      new Date(2026, month - 1, 1),
    );

  return (
    <div className="mx-auto max-w-6xl">
      <SubNav
        items={[
          { label: t('dashboard.title'), to: '/' },
          { label: t('approvals.title'), to: '/approvals', badge: approvals?.count },
        ]}
      />
      <h1 className="text-lg font-bold">{t('dashboard.title')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {t('dashboard.welcome')}, {me?.firstName}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label={t('dashboard.clients')}
          value={kpis?.counts.clients ?? 0}
          icon={Users}
          to="/crm/partners"
          loading={isLoading}
        />
        <StatCard
          label={t('dashboard.activeContracts')}
          value={kpis?.counts.activeContracts ?? 0}
          icon={FileText}
          to="/contracts"
          loading={isLoading}
        />
        <StatCard
          label={t('dashboard.orderBacklog')}
          value={kpis ? moneyCompact(kpis.orderBacklog) + ' €' : 0}
          icon={TrendingUp}
          to="/contracts"
          loading={isLoading}
        />
        <StatCard
          label={t('dashboard.openInvoices')}
          value={kpis?.counts.openInvoices ?? 0}
          icon={Wallet}
          to="/finance/invoices"
          loading={isLoading}
        />
        <StatCard
          label={t('dashboard.employees')}
          value={kpis?.counts.employees ?? 0}
          icon={Briefcase}
          to="/hr/employees"
          loading={isLoading}
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold">
            {t('dashboard.revenueByMonth', { year: kpis?.year ?? '' })}
          </h2>
          {isLoading || !kpis ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <BarChart
              data={kpis.revenueByMonth.map((row) => ({
                label: monthLabel(row.month),
                value: row.net,
                hint: money(row.net),
              }))}
              formatValue={moneyCompact}
            />
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">{t('sales.pipeline')}</h2>
            <Link to="/sales/pipeline" className="text-xs text-primary hover:underline">
              {t('dashboard.openBoard')} →
            </Link>
          </div>
          {isLoading || !kpis ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <HBarList
              data={kpis.pipelineByStage.map((row) => ({
                label: t(`sales.stage.${row.stage}`),
                value: row.value,
                detail: `${row.count} · ${moneyCompact(row.value)} €`,
              }))}
            />
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t('dashboard.expiringContracts')}
        </h2>
        {expiring?.length ? (
          <table className="w-full text-sm">
            <tbody>
              {expiring.map((contract) => (
                <tr
                  key={contract.id}
                  className="border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to="/contracts" className="hover:text-primary">
                      {contract.contractNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-medium">{contract.title}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {contract.partner?.name}
                  </td>
                  <td className="px-4 py-2 text-right text-warning">
                    {fmtDate(contract.endDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('common.noResults')}
          </div>
        )}
      </section>
    </div>
  );
}
