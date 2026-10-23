import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, Info } from 'lucide-react';
import { SubNav } from '../../components/SubNav';
import { SelectInput, Skeleton } from '../../components/ui';
import { hasPermission, useAuthStore } from '../../stores/auth';
import type { DataBasis } from '../../../../../packages/shared/src/business-engine';
import { useEngineFilters, useEngineQuery, type KpiDefinition, type PortfolioMode } from './queries';

export function useCan() {
  const me = useAuthStore((s) => s.me);
  return (code: string) => hasPermission(me, code);
}

export function EngineNav() {
  const { t } = useTranslation();
  const can = useCan();
  const items = [
    { label: t('engine.nav.overview'), to: '/engine', perm: 'engine.economics.read' },
    { label: t('engine.nav.services'), to: '/engine/services', perm: 'engine.services.read' },
    { label: t('engine.nav.portfolio'), to: '/engine/portfolio', perm: 'engine.portfolio.read' },
    { label: t('engine.nav.resources'), to: '/engine/resources', perm: 'engine.resources.read' },
    { label: t('engine.nav.financials'), to: '/engine/financials', perm: 'engine.economics.read' },
    { label: t('engine.nav.scenarios'), to: '/engine/scenarios', perm: 'engine.scenarios.read' },
    { label: t('engine.nav.optimization'), to: '/engine/optimization', perm: 'engine.optimization.read' },
    { label: t('engine.nav.intelligence'), to: '/engine/intelligence', perm: 'engine.intelligence.read' },
    { label: t('engine.nav.settings'), to: '/engine/settings', perm: 'engine.settings.read' },
  ];
  return <SubNav items={items.filter((i) => can(i.perm))} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div><h1 className="text-lg font-bold">{title}</h1>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-border bg-card p-3', className)}>
      {(title || actions) && <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2>{actions && <div className="shrink-0 whitespace-nowrap">{actions}</div>}</div>}
      {children}
    </section>
  );
}

const BASIS_STYLE: Record<DataBasis, string> = {
  ACTUAL: 'border-foreground/30 text-foreground', CONTRACTED: 'border-primary/40 text-primary', FORECAST: 'border-border text-muted-foreground border-dashed',
  WEIGHTED: 'border-warning/50 text-warning border-dashed', SIMULATED: 'border-[var(--series-2)] text-foreground border-dotted', MISSING: 'border-destructive/50 text-destructive',
};
/** Visual distinction between actual, contracted, forecast, weighted, simulated and missing values. */
export function BasisBadge({ basis }: { basis: DataBasis }) {
  const { t } = useTranslation();
  return <span className={clsx('inline-flex rounded border px-1 text-[10px] font-medium uppercase tracking-wide', BASIS_STYLE[basis])}>{t(`engine.basis.${basis}`)}</span>;
}

export function KpiTile({ label, value, basis, definition, calculatedAt, hint, tone, onClick }: {
  label: string; value: string; basis: DataBasis; definition?: KpiDefinition; calculatedAt?: string; hint?: ReactNode; tone?: 'bad' | 'good'; onClick?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {definition && <button className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t('engine.common.definition')} onClick={() => setOpen((o) => !o)}><Info size={12} /></button>}
      </div>
      <button type="button" disabled={!onClick} onClick={onClick} className={clsx('mt-1 block text-left text-lg font-semibold tabular-nums', onClick && 'hover:underline', tone === 'bad' && 'text-destructive')}>{value}</button>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"><BasisBadge basis={basis} />{hint}</div>
      {open && definition && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-md border border-border bg-card p-3 text-xs shadow-xl" role="dialog">
          <p className="mb-1 font-medium">{definition.definition}</p>
          <dl className="space-y-0.5 text-muted-foreground">
            <div><dt className="inline font-medium">{t('engine.common.source')}: </dt><dd className="inline">{definition.source}</dd></div>
            <div><dt className="inline font-medium">{t('engine.common.included')}: </dt><dd className="inline">{definition.included}</dd></div>
            <div><dt className="inline font-medium">{t('engine.common.excluded')}: </dt><dd className="inline">{definition.excluded}</dd></div>
            {calculatedAt && <div><dt className="inline font-medium">{t('engine.common.calculatedAt')}: </dt><dd className="inline">{new Date(calculatedAt).toLocaleString()}</dd></div>}
          </dl>
        </div>
      )}
    </div>
  );
}

export function IllustrativeBanner({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs" role="status"><AlertTriangle size={14} className="text-warning" />{t('engine.common.illustrative')}</div>;
}

export function QueryState({ query, empty, children }: { query: { isLoading: boolean; error: Error | null }; empty?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  if (query.isLoading) return <Skeleton className="h-40" />;
  if (query.error) return <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{query.error.message}</p>;
  if (empty) return <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t('engine.common.empty')}</p>;
  return <>{children}</>;
}

export function NoAccess({ permission }: { permission: string }) {
  const { t } = useTranslation();
  return <p role="alert" className="rounded-md border border-border p-4 text-sm text-muted-foreground">{t('engine.common.noAccess', { permission })}</p>;
}

interface References { clients: { id: string; name: string }[]; departments: { id: string; name: string }[] }
/** Global filter row (mode, client, service, organisational unit, scenario) — shared by the cockpit pages. */
export function FilterBar({ showScenario = true }: { showScenario?: boolean }) {
  const { t } = useTranslation();
  const can = useCan();
  const f = useEngineFilters();
  const refs = useEngineQuery<References>(['references'], can('engine.portfolio.read') ? '/assignments/references' : null);
  const services = useEngineQuery<{ id: string; code: string; name: string }[]>(['services'], '/services');
  const scenarios = useEngineQuery<{ id: string; name: string }[]>(['scenarios'], showScenario && can('engine.scenarios.read') ? '/scenarios' : null);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <label className="flex items-center gap-1.5 text-xs">{t('engine.filters.mode')}
        <SelectInput className="h-7 w-44 py-0 text-xs" value={f.mode} onChange={(e) => f.set({ mode: e.target.value as PortfolioMode })}>
          {(['CONTRACTED', 'EXPECTED', 'ALL_WIN'] as const).map((m) => <option key={m} value={m}>{t(`engine.mode.${m}`)}</option>)}
        </SelectInput>
      </label>
      <label className="flex items-center gap-1.5 text-xs">{t('engine.filters.client')}
        <SelectInput className="h-7 w-44 py-0 text-xs" value={f.clientId} onChange={(e) => f.set({ clientId: e.target.value })}>
          <option value="">{t('engine.filters.all')}</option>{refs.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectInput>
      </label>
      <label className="flex items-center gap-1.5 text-xs">{t('engine.filters.service')}
        <SelectInput className="h-7 w-48 py-0 text-xs" value={f.serviceId} onChange={(e) => f.set({ serviceId: e.target.value })}>
          <option value="">{t('engine.filters.all')}</option>{services.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </SelectInput>
      </label>
      <label className="flex items-center gap-1.5 text-xs">{t('engine.filters.unit')}
        <SelectInput className="h-7 w-40 py-0 text-xs" value={f.departmentId} onChange={(e) => f.set({ departmentId: e.target.value })}>
          <option value="">{t('engine.filters.all')}</option>{refs.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectInput>
      </label>
      {showScenario && (
        <label className="flex items-center gap-1.5 text-xs">{t('engine.filters.scenario')}
          <SelectInput className="h-7 w-44 py-0 text-xs" value={f.scenarioId} onChange={(e) => f.set({ scenarioId: e.target.value })}>
            <option value="">{t('engine.filters.liveData')}</option>{scenarios.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </label>
      )}
      {f.scenarioId && <BasisBadge basis="SIMULATED" />}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">{head.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
export const td = 'whitespace-nowrap px-2 py-1.5';
export const tdNum = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums';

export function WarningsList({ warnings }: { warnings: { code: string; message: string }[] }) {
  const { t } = useTranslation();
  if (!warnings.length) return null;
  const grouped = new Map<string, number>(); for (const w of warnings) grouped.set(w.code, (grouped.get(w.code) ?? 0) + 1);
  return (
    <details className="mb-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
      <summary className="cursor-pointer text-muted-foreground">{t('engine.common.dataWarnings', { count: warnings.length })}</summary>
      <ul className="mt-1 space-y-0.5">{[...grouped.entries()].map(([code, count]) => <li key={code}><span className="font-mono">{code}</span> × {count} — {t(`engine.warnings.${code}`, { defaultValue: '' })}</li>)}</ul>
    </details>
  );
}
