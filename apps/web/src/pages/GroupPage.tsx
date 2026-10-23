import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Building2, Crown, MapPin, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';
import { SubNav } from '../components/SubNav';
import { Skeleton } from '../components/ui';
import { useAuthStore } from '../stores/auth';
import { GroupManagement } from '../components/GroupManagement';

interface GroupCompany {
  id: string;
  code: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  currency: string;
  isParent: boolean;
  fxRateToEUR: number;
  offices: { name: string; city: string | null }[];
  headcount: number;
  activeClients: number;
  revenueYtd: number;
  revenueYtdEUR: number;
  openItems: number;
  openItemsEUR: number;
  backlog: number;
  backlogEUR: number;
  pipelineWeightedEUR: number;
}

interface GroupOverview {
  year: number;
  companies: GroupCompany[];
  totals: {
    companies: number;
    offices: number;
    headcount: number;
    activeClients: number;
    revenueYtdEUR: number;
    openItemsEUR: number;
    backlogEUR: number;
    pipelineWeightedEUR: number;
  };
}

const FLAG: Record<string, string> = {
  DE: '🇩🇪', AT: '🇦🇹', CH: '🇨🇭', AE: '🇦🇪', FR: '🇫🇷', NL: '🇳🇱',
};

export function GroupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setCompany = useAuthStore((s) => s.setCompany);
  const me = useAuthStore((s) => s.me);

  const { data, isLoading, error } = useQuery({
    queryKey: ['group-overview'],
    queryFn: () => api.get<GroupOverview>('/group/overview'),
  });

  const eur = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  const local = (value: number, currency: string) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  const enterCompany = (companyId: string) => {
    // switch the active BMS scope to the selected legal entity
    if (me?.memberships.some((m) => m.company.id === companyId)) {
      setCompany(companyId);
      void queryClient.invalidateQueries();
      navigate('/');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <SubNav
        items={[
          { label: t('nav.corporate'), to: '/corporate' },
          { label: t('group.title'), to: '/group' },
          { label: t('group.compare'), to: '/group/compare' },
        ]}
      />
      <h1 className="text-lg font-bold">{t('group.title')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('group.subtitle')}</p>
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error.message}</p>}

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : data ? (
        <>
          {/* group totals */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                [t('group.revenue'), eur(data.totals.revenueYtdEUR)],
                [t('group.backlog'), eur(data.totals.backlogEUR)],
                [t('group.pipeline'), eur(data.totals.pipelineWeightedEUR)],
                [t('group.openItems'), eur(data.totals.openItemsEUR)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Building2 size={14} />
              {data.totals.companies} {t('group.companies')} · {data.totals.offices}{' '}
              {t('group.offices')}
            </span>
            <span className="flex items-center gap-1.5">
              <Users size={14} />
              {data.totals.headcount} {t('dashboard.employees')} ·{' '}
              {data.totals.activeClients} {t('dashboard.clients')}
            </span>
          </div>

          {/* per-company cards */}
          <div className="grid gap-4 lg:grid-cols-3">
            {data.companies.map((company) => {
              const member = me?.memberships.some((m) => m.company.id === company.id);
              return (
                <button
                  key={company.id}
                  onClick={() => enterCompany(company.id)}
                  disabled={!member}
                  className={clsx(
                    'rounded-xl border bg-card p-4 text-left transition-colors',
                    company.isParent ? 'border-primary/50' : 'border-border',
                    member && 'hover:border-primary',
                  )}
                >
                  <div className="mb-2 flex items-start gap-2">
                    <span className="text-xl">
                      {FLAG[company.countryCode ?? ''] ?? '🏳️'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{company.name}</span>
                        {company.isParent && (
                          <Crown size={12} className="shrink-0 text-warning" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {company.code} · {company.currency}
                        {company.currency !== 'EUR' &&
                          ` (1 ${company.currency} = ${company.fxRateToEUR} €)`}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {company.offices.map((office) => (
                      <span
                        key={office.name}
                        className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                      >
                        <MapPin size={9} />
                        {office.city ?? office.name}
                      </span>
                    ))}
                  </div>

                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('group.revenue')}</dt>
                      <dd className="tabular-nums">
                        {local(company.revenueYtd, company.currency)}
                        {company.currency !== 'EUR' && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ≈ {eur(company.revenueYtdEUR)}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('group.backlog')}</dt>
                      <dd className="tabular-nums">{local(company.backlog, company.currency)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('group.openItems')}</dt>
                      <dd className={clsx('tabular-nums', company.openItems > 0 && 'text-warning')}>
                        {local(company.openItems, company.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">{t('dashboard.employees')}</dt>
                      <dd className="tabular-nums">{company.headcount}</dd>
                    </div>
                  </dl>

                  {member && (
                    <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                      <ArrowRightLeft size={11} />
                      {t('group.enter')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">{t('group.fxHint')}</p>
        </>
      ) : null}
      <GroupManagement />
    </div>
  );
}
