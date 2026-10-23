import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  FileText,
  Hourglass,
  LineChart,
  PieChart,
  Plus,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';
import { daysUntil, useFormat } from '../lib/format';
import { AreaChart, BarChart, DonutChart } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { DaysLeft, EmptyState, KpiTile, Panel, ViewSwitch } from '../components/infographics';
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

const HORIZON = 90;

function greetingKey(hour: number) {
  if (hour < 12) return 'insights.goodMorning';
  if (hour < 18) return 'insights.goodAfternoon';
  return 'insights.goodEvening';
}

/** 0–90 day track with one marker per expiring contract. */
function ExpiryTrack({ items }: { items: (ExpiringContract & { days: number })[] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="relative mb-5 mt-2 px-1">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-destructive/25 via-warning/25 to-muted">
        {[30, 60].map((d) => (
          <span
            key={d}
            className="absolute top-0 h-2 w-px bg-card"
            style={{ left: `${(d / HORIZON) * 100}%` }}
          />
        ))}
        {items.map((item) => {
          const left = (Math.max(0, Math.min(HORIZON, item.days)) / HORIZON) * 100;
          return (
            <button
              type="button"
              key={item.id}
              className={clsx(
                'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow transition-transform hover:scale-125',
                item.days <= 30 ? 'bg-destructive' : item.days <= 60 ? 'bg-warning' : 'bg-primary',
              )}
              style={{ left: `${left}%` }}
              onMouseEnter={() => setHover(item.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(item.id)}
              onBlur={() => setHover(null)}
              aria-label={`${item.contractNumber} · ${t('insights.daysLeft', { count: item.days })}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>0</span>
        <span>30</span>
        <span>60</span>
        <span>{HORIZON} d</span>
      </div>
      {items.map(
        (item) =>
          hover === item.id && (
            <div
              key={item.id}
              className="pointer-events-none absolute -top-12 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${(Math.max(0, Math.min(HORIZON, item.days)) / HORIZON) * 100}%` }}
            >
              <div className="font-medium">{item.title}</div>
              <div className="text-muted-foreground">
                {item.partner?.name} · {t('insights.daysLeft', { count: item.days })}
              </div>
            </div>
          ),
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const [revenueMode, setRevenueMode] = useState<'monthly' | 'cumulative'>('monthly');

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: () => api.get<Kpis>('/corporate/kpis'),
  });
  const { data: expiring, isLoading: expiringLoading } = useQuery({
    queryKey: ['dash', 'expiring'],
    queryFn: () => api.get<ExpiringContract[]>('/contracts/expiring?withinDays=90'),
  });
  const { data: approvals } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<{ count: number }>('/workflow/tasks/my'),
  });

  const now = new Date();
  const monthLabel = (month: number) =>
    new Intl.DateTimeFormat(fmt.lang, { month: 'short' }).format(new Date(2026, month - 1, 1));

  // revenue: only months that have happened in the KPI year
  const currentYear = kpis?.year === now.getFullYear();
  const months = (kpis?.revenueByMonth ?? []).filter(
    (row) => !currentYear || row.month <= now.getMonth() + 1,
  );
  const ytd = months.reduce((sum, row) => sum + row.net, 0);
  const lastFull = currentYear ? months[months.length - 2] : months[months.length - 1];
  const beforeLast = currentYear ? months[months.length - 3] : months[months.length - 2];
  const delta =
    lastFull && beforeLast && beforeLast.net > 0
      ? ((lastFull.net - beforeLast.net) / beforeLast.net) * 100
      : null;
  const best = months.reduce<{ month: number; net: number } | null>(
    (top, row) => (!top || row.net > top.net ? row : top),
    null,
  );
  let running = 0;
  const cumulative = months.map((row) => ({
    label: monthLabel(row.month),
    value: (running += row.net),
  }));

  const pipeline = kpis?.pipelineByStage ?? [];
  const pipelineValue = pipeline.reduce((sum, row) => sum + row.value, 0);
  const pipelineCount = pipeline.reduce((sum, row) => sum + row.count, 0);

  const expiringItems = (expiring ?? [])
    .map((c) => ({ ...c, days: daysUntil(c.endDate) ?? HORIZON }))
    .sort((a, b) => a.days - b.days);

  const workload = [
    {
      label: t('insights.pendingApprovals'),
      value: approvals?.count ?? 0,
      icon: CheckCircle2,
      to: '/approvals',
    },
    {
      label: t('insights.openLeave'),
      value: kpis?.counts.openLeave ?? 0,
      icon: CalendarDays,
      to: '/hr/leave',
    },
    {
      label: t('dashboard.openInvoices'),
      value: kpis?.counts.openInvoices ?? 0,
      icon: Wallet,
      to: '/finance/open-items',
    },
    {
      label: t('insights.expiringSoon'),
      value: expiringItems.length,
      icon: Hourglass,
      to: '/contracts/expiry',
    },
  ];
  const workloadMax = Math.max(1, ...workload.map((w) => w.value));

  return (
    <div className="mx-auto max-w-7xl">
      <SubNav
        items={[
          { label: t('dashboard.title'), to: '/' },
          { label: t('approvals.title'), to: '/approvals', badge: approvals?.count },
        ]}
      />

      {/* hero */}
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#184f95] via-[#2a78d6] to-[#6250d6] p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-end gap-6">
          <div className="min-w-[16rem] flex-1">
            <p className="text-sm text-white/75">
              {t('insights.today', {
                date: new Intl.DateTimeFormat(fmt.lang, { dateStyle: 'full' }).format(now),
              })}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {t(greetingKey(now.getHours()))}, {me?.firstName}
            </h1>
            <p className="mt-1 text-sm text-white/80">{t('dashboard.welcome')} · {t('dashboard.title')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: t('finance.title'), to: '/finance/invoices', icon: Plus },
              { label: t('sales.pipeline'), to: '/sales/pipeline', icon: Briefcase },
              { label: t('nav.companyCalendar'), to: '/company-calendar', icon: CalendarDays },
              { label: t('nav.bi'), to: '/bi', icon: LineChart },
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium backdrop-blur transition-colors hover:bg-white/25"
              >
                <action.icon size={14} />
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* headline KPIs */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={t('insights.ytdRevenue')}
          value={fmt.money(ytd)}
          icon={TrendingUp}
          loading={isLoading}
          delta={delta}
          deltaLabel={lastFull ? `${monthLabel(lastFull.month)} ${t('insights.vsLastMonth')}` : undefined}
          spark={months.map((m) => m.net)}
          to="/finance/invoices"
        />
        <KpiTile
          label={t('dashboard.orderBacklog')}
          value={fmt.compactMoney(kpis?.orderBacklog ?? 0)}
          icon={FileText}
          tone="success"
          loading={isLoading}
          sub={`${kpis?.counts.activeContracts ?? 0} ${t('dashboard.activeContracts')}`}
          to="/contracts"
        />
        <KpiTile
          label={t('insights.pipelineValue')}
          value={fmt.compactMoney(pipelineValue)}
          icon={Briefcase}
          tone="warning"
          loading={isLoading}
          sub={t('insights.pipelineDeals', { count: pipelineCount })}
          to="/sales/pipeline"
        />
        <KpiTile
          label={t('dashboard.clients')}
          value={kpis?.counts.clients ?? 0}
          icon={Users}
          tone="neutral"
          loading={isLoading}
          sub={`${kpis?.counts.employees ?? 0} ${t('dashboard.employees')}`}
          to="/crm/partners"
        />
      </div>

      {/* charts */}
      <div className="mb-5 grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title={t('insights.revenueTrend')}
          subtitle={
            best && best.net > 0
              ? `${t('insights.revenueTrendHint')} · ${t('insights.bestMonth', { month: monthLabel(best.month) })} · ${t('insights.monthlyAvg', { value: fmt.compactMoney(months.length ? ytd / months.length : 0) })}`
              : t('insights.revenueTrendHint')
          }
          icon={LineChart}
          actions={
            <ViewSwitch
              value={revenueMode}
              onChange={setRevenueMode}
              options={[
                { key: 'monthly', label: t('insights.monthly') },
                { key: 'cumulative', label: t('insights.cumulative') },
              ]}
            />
          }
        >
          {isLoading || !kpis ? (
            <Skeleton className="h-52 w-full" />
          ) : revenueMode === 'monthly' ? (
            <BarChart
              height={220}
              highlight={lastFull ? months.indexOf(lastFull) : undefined}
              data={months.map((row) => ({
                label: monthLabel(row.month),
                value: row.net,
                hint: fmt.money(row.net),
              }))}
              formatValue={fmt.compact}
            />
          ) : (
            <AreaChart
              height={220}
              name={t('insights.cumulative')}
              data={cumulative.map((p) => ({ ...p, hint: fmt.money(p.value) }))}
              formatValue={fmt.compact}
            />
          )}
        </Panel>

        <Panel
          className="xl:col-span-2"
          title={t('insights.pipelineMix')}
          subtitle={t('insights.pipelineMixHint')}
          icon={PieChart}
          actions={
            <Link to="/sales/pipeline" className="text-xs font-medium text-primary hover:underline">
              {t('dashboard.openBoard')} →
            </Link>
          }
        >
          {isLoading || !kpis ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <DonutChart
              data={pipeline.map((row) => ({
                label: t(`sales.stage.${row.stage}`),
                value: row.value,
              }))}
              centerValue={fmt.compactMoney(pipelineValue)}
              centerLabel={t('insights.pipelineDeals', { count: pipelineCount })}
              formatValue={fmt.compactMoney}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title={t('insights.timeline')}
          subtitle={t('dashboard.expiringContracts')}
          icon={Hourglass}
          bodyClassName="p-0 pt-0"
        >
          {expiringLoading ? (
            <Skeleton className="m-4 h-32" />
          ) : expiringItems.length ? (
            <>
              <div className="px-4">
                <ExpiryTrack items={expiringItems} />
              </div>
              <DataTable
                className="rounded-none border-x-0 border-b-0 shadow-none"
                rows={expiringItems}
                rowKey={(c) => c.id}
                search={false}
                toolbar={false}
                pageSize={0}
                exportName="expiring-contracts"
                onRowClick={() => navigate('/contracts/expiry')}
                initialSort={{ key: 'days', dir: 'asc' }}
                columns={[
                  {
                    key: 'number',
                    header: t('contracts.number'),
                    value: (c) => c.contractNumber,
                    render: (c) => <span className="font-mono text-xs">{c.contractNumber}</span>,
                  },
                  { key: 'title', header: t('contracts.contractTitle'), value: (c) => c.title, className: 'font-medium' },
                  { key: 'partner', header: t('contracts.partner'), value: (c) => c.partner?.name },
                  { key: 'end', header: t('contracts.endDate'), value: (c) => c.endDate, type: 'date' },
                  {
                    key: 'days',
                    header: t('insights.expiringSoon'),
                    value: (c) => c.days,
                    type: 'number',
                    align: 'right',
                    render: (c) => (
                      <DaysLeft
                        days={c.days}
                        label={(d) =>
                          d < 0 ? t('insights.overdueBy', { count: -d }) : t('insights.daysLeft', { count: d })
                        }
                      />
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title={t('insights.noExpiring')}
              hint={t('insights.noExpiringHint')}
            />
          )}
        </Panel>

        <Panel className="xl:col-span-2" title={t('insights.workload')} icon={CheckCircle2}>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {[
              { label: t('dashboard.employees'), value: kpis?.counts.employees, icon: Users, to: '/hr/employees' },
              { label: t('dashboard.activeContracts'), value: kpis?.counts.activeContracts, icon: FileText, to: '/contracts' },
            ].map((stat) => (
              <Link key={stat.to} to={stat.to} className="rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <stat.icon size={12} />
                  {stat.label}
                </div>
                <div className="mt-0.5 text-xl font-bold tabular-nums">{stat.value ?? '—'}</div>
              </Link>
            ))}
          </div>
          <ul className="space-y-1">
            {workload.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                >
                  <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                    <item.icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="truncate font-medium">{item.label}</span>
                      <span className="text-sm font-bold tabular-nums">{item.value}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${(item.value / workloadMax) * 100}%` }}
                      />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
