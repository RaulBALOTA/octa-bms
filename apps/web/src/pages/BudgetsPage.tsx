import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check, Copy, Download, Lock, Pencil, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { FinanceNav } from '../components/FinanceNav';
import { RecordActions } from '../components/RecordActions';
import { ArchivedRecordsButton } from '../components/ModuleRecords';
import {
  Button,
  Dialog,
  Drawer,
  Field,
  SelectInput,
  Skeleton,
  Tabs,
  TextInput,
  useToast,
} from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

type BudgetStatus = 'DRAFT' | 'APPROVED' | 'CLOSED';

interface BudgetRow {
  costCenterId: string;
  code: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  revenuePlan: number;
  revenueForecast: number;
  revenueActual: number;
  costPlan: number;
  costForecast: number;
  costActual: number;
}

interface BudgetOverview {
  budgetId?: string | null;
  budgetName?: string | null;
  year: number;
  status: BudgetStatus;
  rows: BudgetRow[];
  totals: {
    revenuePlan: number;
    revenueForecast: number;
    revenueActual: number;
    costPlan: number;
    costForecast: number;
    costActual: number;
  };
}

interface StructureCell {
  /** displayed total: for a parent = own + Σ descendants; for a leaf = own */
  plan: number;
  forecast: number;
  /** this cost center's own value (what an edit writes), before roll-up */
  own: number;
  ownForecast: number;
  phased: boolean;
}

interface StructureCategory {
  code: string;
  type: 'REVENUE' | 'EXPENSE';
  skr04: string;
  nameDe: string;
  nameEn: string;
  cells: Record<string, StructureCell>;
  planTotal: number;
  forecastTotal: number;
  actual: number;
}

interface StructureGroup {
  code: string;
  type: 'REVENUE' | 'EXPENSE';
  nameDe: string;
  nameEn: string;
  categories: StructureCategory[];
}

interface LegacyRow {
  code: string;
  cells: Record<string, StructureCell>;
  planTotal: number;
  forecastTotal: number;
  actual: number;
}

interface BudgetStructure {
  year: number;
  status: BudgetStatus;
  costCenters: {
    id: string;
    code: string;
    name: string;
    depth: number;
    hasChildren: boolean;
  }[];
  groups: StructureGroup[];
  legacy: LegacyRow | null;
  totals: {
    plan: { revenue: number; expense: number; result: number };
    forecast: { revenue: number; expense: number; result: number };
    actual: { revenue: number; expense: number; result: number };
  };
}

interface BudgetDetail {
  year: number;
  status: BudgetStatus;
  category: string;
  hasChildren: boolean;
  costCenter: { id: string; code: string; name: string };
  months: { month: number; plan: number; forecast: number | null; actual: number }[];
}

function PlanCell({
  value,
  onSave,
  placeholder = '0',
  className,
}: {
  value: number | null;
  onSave: (amount: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min="0"
      step="1000"
      value={draft ?? (value || '')}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && Number(draft) !== (value ?? 0)) onSave(draft || '0');
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={clsx(
        'rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none transition-colors hover:border-border focus:border-primary focus:bg-background',
        className ?? 'w-28',
      )}
    />
  );
}

const statusTone: Record<BudgetStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-success/15 text-success',
  CLOSED: 'border border-border text-muted-foreground',
};

interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  inUse: boolean;
}

function CostCenterDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const empty = { code: '', name: '', description: '', parentId: '' };
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: rows } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: () => api.get<CostCenterRow[]>('/master/cost-centers'),
    enabled: open,
  });

  // parent options exclude the edited node and its descendants (rows are DFS-ordered)
  const excluded = new Set<string>();
  if (editId) {
    excluded.add(editId);
    for (const row of rows ?? []) {
      if (row.parentId && excluded.has(row.parentId)) excluded.add(row.id);
    }
  }
  const parentOptions = (rows ?? []).filter((row) => !excluded.has(row.id));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
    onChanged();
  };
  const onError = (err: Error) => toast(err.message, 'error');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        parentId: form.parentId || null,
      };
      return editId
        ? api.patch(`/master/cost-centers/${editId}`, body)
        : api.post('/master/cost-centers', body);
    },
    onSuccess: () => {
      refresh();
      setForm(empty);
      setEditId(null);
      toast(t('common.saved'));
    },
    onError,
  });

  const toggleActive = useMutation({
    mutationFn: (row: CostCenterRow) =>
      api.patch(`/master/cost-centers/${row.id}`, { isActive: !row.isActive }),
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/master/cost-centers/${id}`),
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError,
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('finance.manageCostCenters')} width="max-w-2xl">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">{t('crm.name')}</th>
                <th className="px-3 py-2 font-medium">{t('common.status')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-border last:border-0',
                    row.hasChildren && 'bg-muted/30 font-medium',
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-xs">
                    <span style={{ paddingLeft: row.depth * 16 }}>{row.code}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {row.name}
                    {row.hasChildren && (
                      <span
                        className="ml-1.5 text-xs text-muted-foreground"
                        title={t('finance.ccAggregate')}
                      >
                        Σ
                      </span>
                    )}
                    {row.description && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {row.description}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => toggleActive.mutate(row)}
                      className={clsx(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        row.isActive
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t(row.isActive ? 'admin.active' : 'admin.inactive')}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => {
                        setEditId(row.id);
                        setForm({
                          code: row.code,
                          name: row.name,
                          description: row.description ?? '',
                          parentId: row.parentId ?? '',
                        });
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                      aria-label={t('common.save')}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => remove.mutate(row.id)}
                      disabled={row.inUse || row.hasChildren}
                      title={
                        row.hasChildren
                          ? t('finance.ccHasChildren')
                          : row.inUse
                            ? t('finance.ccInUse')
                            : undefined
                      }
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={t('finance.ccDelete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {t('common.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form
          className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.code.trim() && form.name.trim()) save.mutate();
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {editId ? t('finance.editCostCenter') : t('finance.newCostCenter')}
          </p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Code" required>
              <TextInput
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                required
              />
            </Field>
            <Field label={t('crm.name')} required className="col-span-3">
              <TextInput
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>
            <Field label={t('finance.ccDescription')} className="col-span-2">
              <TextInput
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field label={t('finance.ccParent')} className="col-span-2">
              <SelectInput
                value={form.parentId}
                onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
              >
                <option value="">{t('finance.ccNoParent')}</option>
                {parentOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {'\u00A0'.repeat(row.depth * 3)}
                    {row.code} {row.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            {editId && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditId(null);
                  setForm(empty);
                }}
              >
                {t('common.cancel')}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={save.isPending}>
              <Plus size={13} /> {t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

export function BudgetsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [tab, setTab] = useState('structure');
  // which field the annual grid edits — plan or forecast
  const [gridField, setGridField] = useState<'planned' | 'forecast'>('planned');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailCategory, setDetailCategory] = useState('REVENUE');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyAdjust, setCopyAdjust] = useState('0');
  const [ccOpen, setCcOpen] = useState(false);

  const canEdit = hasPermission(me, 'finance.budgets.update');
  const canApprove = hasPermission(me, 'finance.budgets.approve');
  const canExport = hasPermission(me, 'finance.budgets.export');
  const isGerman = i18n.language.startsWith('de');
  const catName = (c: { nameDe: string; nameEn: string }) =>
    isGerman ? c.nameDe : c.nameEn;

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', year],
    queryFn: () => api.get<BudgetOverview>(`/finance/budgets/overview?year=${year}`),
  });

  const structure = useQuery({
    queryKey: ['budget-structure', year],
    queryFn: () => api.get<BudgetStructure>(`/finance/budgets/structure?year=${year}`),
  });

  const detail = useQuery({
    queryKey: ['budget-detail', year, detailId, detailCategory],
    enabled: !!detailId,
    queryFn: () =>
      api.get<BudgetDetail>(
        `/finance/budgets/detail?year=${year}&costCenterId=${detailId}&category=${detailCategory}`,
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['budgets', year] });
    void queryClient.invalidateQueries({ queryKey: ['budget-structure', year] });
    void queryClient.invalidateQueries({ queryKey: ['budget-detail', year] });
  };

  const plan = useMutation({
    mutationFn: (payload: {
      costCenterId: string;
      category: string;
      amount: string;
      month?: number;
      field?: 'planned' | 'forecast';
    }) => api.put('/finance/budgets/plan', { year: Number(year), ...payload }),
    onSuccess: () => {
      invalidate();
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      api.post('/finance/budgets/status', { year: Number(year), status }),
    onSuccess: () => {
      invalidate();
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const copy = useMutation({
    mutationFn: () =>
      api.post('/finance/budgets/copy', {
        year: Number(year),
        factor: 1 + (Number(copyAdjust) || 0) / 100,
      }),
    onSuccess: () => {
      invalidate();
      setCopyOpen(false);
      toast(t('finance.copied'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);

  const monthName = (month: number) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(
      new Date(Date.UTC(2000, month - 1, 1)),
    );

  // reference point for plan-vs-actual coloring: elapsed share of the year
  const yearNum = Number(year);
  const elapsed =
    yearNum < currentYear
      ? 1
      : yearNum > currentYear
        ? 0
        : (Date.now() - Date.UTC(yearNum, 0, 1)) /
          (Date.UTC(yearNum + 1, 0, 1) - Date.UTC(yearNum, 0, 1));
  const refPct = Math.round(elapsed * 100);

  const deltaCell = (actual: number, planValue: number, higherIsBetter: boolean) => {
    if (!planValue) return <span className="text-muted-foreground">—</span>;
    const pct = Math.round((actual / planValue) * 100);
    const good = higherIsBetter ? pct >= refPct : pct <= refPct;
    return (
      <span
        className={clsx(
          'tabular-nums',
          good
            ? 'text-success'
            : Math.abs(pct - refPct) <= 15
              ? 'text-warning'
              : 'text-destructive',
        )}
      >
        {pct}%
      </span>
    );
  };

  const status = structure.data?.status ?? data?.status ?? 'DRAFT';
  // CLOSED is an informational marker, not a lock — any status stays editable
  const planEditable = canEdit;
  const forecastEditable = canEdit;
  const emptyPlan =
    !!data && data.totals.revenuePlan === 0 && data.totals.costPlan === 0;

  const exportCsv = () => {
    let csv: string;
    if (tab === 'structure' && structure.data) {
      const s = structure.data;
      const header = [
        t('finance.kostenart'),
        'SKR04',
        ...s.costCenters.map((cc) => (cc.hasChildren ? `Σ ${cc.code}` : cc.code)),
        `Σ ${t('finance.plan')}`,
        t('finance.forecast'),
        t('finance.actual'),
      ];
      const catLine = (
        label: string,
        skr: string,
        c: { cells: Record<string, StructureCell>; planTotal: number; forecastTotal: number; actual: number },
      ) =>
        [
          label,
          skr,
          ...s.costCenters.map((cc) => c.cells[cc.id]?.plan ?? 0),
          c.planTotal,
          c.forecastTotal,
          c.actual,
        ].join(';');
      csv = [
        header.join(';'),
        ...s.groups.flatMap((g) => [
          [catName(g), '', ...s.costCenters.map(() => ''), '', '', ''].join(';'),
          ...g.categories.map((c) => catLine(catName(c), c.skr04, c)),
        ]),
        ...(s.legacy ? [catLine(t('finance.unassigned'), '', s.legacy)] : []),
        [t('finance.result'), '', ...s.costCenters.map(() => ''), s.totals.plan.result, s.totals.forecast.result, s.totals.actual.result].join(';'),
      ].join('\r\n');
    } else if (data) {
      const header = [
        t('finance.costCenter'),
        t('finance.revenuePlan'),
        t('finance.forecast'),
        t('finance.revenueActual'),
        t('finance.costPlan'),
        t('finance.forecast'),
        t('finance.costActual'),
      ];
      const line = (
        label: string,
        r: Omit<BudgetRow, 'costCenterId' | 'code' | 'name' | 'depth' | 'hasChildren'>,
      ) =>
        [
          label,
          r.revenuePlan,
          r.revenueForecast,
          r.revenueActual,
          r.costPlan,
          r.costForecast,
          r.costActual,
        ].join(';');
      csv = [
        header.join(';'),
        ...data.rows.map((r) =>
          line(`${'  '.repeat(r.depth)}${r.code} ${r.name}${r.hasChildren ? ' Σ' : ''}`, r),
        ),
        line('Σ', data.totals),
      ].join('\r\n');
    } else return;
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `budget-${year}${tab === 'structure' ? '-kostenarten' : ''}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const groupSums = (g: StructureGroup, ccIds: string[]) => ({
    perCc: ccIds.map((id) =>
      g.categories.reduce((s, c) => s + (c.cells[id]?.plan ?? 0), 0),
    ),
    planTotal: g.categories.reduce((s, c) => s + c.planTotal, 0),
    forecastTotal: g.categories.reduce((s, c) => s + c.forecastTotal, 0),
    actual: g.categories.reduce((s, c) => s + c.actual, 0),
  });

  const structureTable = () => {
    const s = structure.data;
    if (!s) return <Skeleton className="h-64" />;
    const ccIds = s.costCenters.map((cc) => cc.id);
    // one editable cell for any cost center: the input edits its OWN value
    // (plan or forecast per the grid toggle); parents also show the rolled-up
    // total (own + Σ children) beneath as a muted hint
    const gridCell = (
      ccId: string,
      hasChildren: boolean,
      category: string,
      cell: StructureCell | undefined,
    ) => {
      const rolled = gridField === 'planned' ? (cell?.plan ?? 0) : (cell?.forecast ?? 0);
      const own = gridField === 'planned' ? (cell?.own ?? 0) : (cell?.ownForecast ?? 0);
      if (!planEditable) {
        return <span className="tabular-nums">{rolled ? money(rolled) : '—'}</span>;
      }
      return (
        <div className="flex flex-col items-end">
          <PlanCell
            value={own}
            className={clsx(
              'w-24',
              gridField === 'forecast' && 'text-muted-foreground focus:text-foreground',
            )}
            placeholder={
              gridField === 'forecast' && cell?.plan ? String(cell.own || cell.plan) : '0'
            }
            onSave={(amount) =>
              plan.mutate({
                costCenterId: ccId,
                category,
                amount,
                ...(gridField === 'forecast' ? { field: 'forecast' as const } : {}),
              })
            }
          />
          {hasChildren && rolled !== own && (
            <span
              className="pr-2 text-[10px] tabular-nums text-muted-foreground"
              title={t('finance.ccAggregateHint') ?? ''}
            >
              Σ {money(rolled)}
            </span>
          )}
        </div>
      );
    };
    return (
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t('finance.kostenart')}</th>
              {s.costCenters.map((cc) => (
                <th
                  key={cc.id}
                  className={clsx(
                    'px-2 py-2.5 text-right font-medium',
                    cc.hasChildren && 'text-muted-foreground/70',
                  )}
                  title={cc.hasChildren ? `${cc.name} — ${t('finance.ccAggregate')}` : cc.name}
                >
                  {cc.hasChildren ? `Σ ${cc.code}` : cc.code}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right font-medium">Σ {t('finance.plan')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.forecast')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.actual')}</th>
              <th className="px-4 py-2.5 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {s.groups.map((g) => {
              const sums = groupSums(g, ccIds);
              return (
                <Fragment key={g.code}>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold">
                    <td className="px-4 py-1.5">{catName(g)}</td>
                    {sums.perCc.map((v, i) => (
                      <td key={ccIds[i]} className="px-2 py-1.5 text-right tabular-nums">
                        {v ? money(v) : ''}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {money(sums.planTotal)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                      {money(sums.forecastTotal)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {money(sums.actual)}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {deltaCell(sums.actual, sums.planTotal, g.type === 'REVENUE')}
                    </td>
                  </tr>
                  {g.categories.map((c) => (
                    <tr key={c.code} className="border-b border-border/60 last:border-0">
                      <td className="py-1 pl-8 pr-4">
                        {catName(c)}{' '}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c.skr04}
                        </span>
                      </td>
                      {s.costCenters.map((cc) => (
                        <td key={cc.id} className="px-1 py-0.5 text-right">
                          {gridCell(cc.id, cc.hasChildren, c.code, c.cells[cc.id])}
                        </td>
                      ))}
                      <td className="px-4 py-1 text-right tabular-nums">
                        {c.planTotal ? money(c.planTotal) : '—'}
                      </td>
                      <td className="px-4 py-1 text-right tabular-nums text-muted-foreground">
                        {c.forecastTotal ? money(c.forecastTotal) : '—'}
                      </td>
                      <td className="px-4 py-1 text-right tabular-nums">
                        {c.actual ? money(c.actual) : '—'}
                      </td>
                      <td className="px-4 py-1 text-right">
                        {deltaCell(c.actual, c.planTotal, c.type === 'REVENUE')}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {s.legacy && (
              <tr className="border-b border-border/60 italic text-muted-foreground">
                <td className="py-1 pl-8 pr-4">{t('finance.unassigned')}</td>
                {s.costCenters.map((cc) => (
                  <td key={cc.id} className="px-1 py-0.5 text-right">
                    {gridCell(cc.id, cc.hasChildren, s.legacy!.code, s.legacy!.cells[cc.id])}
                  </td>
                ))}
                <td className="px-4 py-1 text-right tabular-nums">
                  {s.legacy.planTotal ? money(s.legacy.planTotal) : '—'}
                </td>
                <td className="px-4 py-1 text-right tabular-nums">
                  {s.legacy.forecastTotal ? money(s.legacy.forecastTotal) : '—'}
                </td>
                <td className="px-4 py-1 text-right tabular-nums">
                  {s.legacy.actual ? money(s.legacy.actual) : '—'}
                </td>
                <td className="px-4 py-1 text-right">
                  {deltaCell(s.legacy.actual, s.legacy.planTotal, false)}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-4 py-2" colSpan={1 + s.costCenters.length}>
                {t('finance.result')}
              </td>
              <td
                className={clsx(
                  'px-4 py-2 text-right tabular-nums',
                  s.totals.plan.result < 0 && 'text-destructive',
                )}
              >
                {money(s.totals.plan.result)}
              </td>
              <td
                className={clsx(
                  'px-4 py-2 text-right tabular-nums text-muted-foreground',
                  s.totals.forecast.result < 0 && 'text-destructive',
                )}
              >
                {money(s.totals.forecast.result)}
              </td>
              <td
                className={clsx(
                  'px-4 py-2 text-right tabular-nums',
                  s.totals.actual.result < 0 && 'text-destructive',
                )}
              >
                {money(s.totals.actual.result)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const centersTable = () => {
    if (!data) return <Skeleton className="h-64" />;
    return (
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t('finance.costCenter')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.revenuePlan')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.forecast')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.revenueActual')}</th>
              <th className="px-4 py-2.5 text-right font-medium">%</th>
              <th className="w-6" />
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.costPlan')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.forecast')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('finance.costActual')}</th>
              <th className="px-4 py-2.5 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.costCenterId}
                onClick={() => setDetailId(row.costCenterId)}
                className={clsx(
                  'cursor-pointer border-b border-border last:border-0 hover:bg-muted/40',
                  row.hasChildren && 'bg-muted/20 font-medium',
                )}
              >
                <td className="px-4 py-2">
                  <span style={{ paddingLeft: row.depth * 16 }}>
                    <span className="font-mono text-xs">{row.code}</span>{' '}
                    <span className="font-medium">{row.name}</span>
                    {row.hasChildren && (
                      <span
                        className="ml-1.5 text-xs text-muted-foreground"
                        title={t('finance.ccAggregate')}
                      >
                        Σ
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {row.revenuePlan ? money(row.revenuePlan) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {row.revenueForecast ? money(row.revenueForecast) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {money(row.revenueActual)}
                </td>
                <td className="px-4 py-2 text-right">
                  {deltaCell(row.revenueActual, row.revenuePlan, true)}
                </td>
                <td className="border-l border-border" />
                <td className="px-4 py-2 text-right tabular-nums">
                  {row.costPlan ? money(row.costPlan) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {row.costForecast ? money(row.costForecast) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{money(row.costActual)}</td>
                <td className="px-4 py-2 text-right">
                  {deltaCell(row.costActual, row.costPlan, false)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-4 py-2.5">Σ</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {money(data.totals.revenuePlan)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {money(data.totals.revenueForecast)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {money(data.totals.revenueActual)}
              </td>
              <td />
              <td className="border-l border-border" />
              <td className="px-4 py-2.5 text-right tabular-nums">
                {money(data.totals.costPlan)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {money(data.totals.costForecast)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {money(data.totals.costActual)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  const detailData = detail.data;
  const allCategories = structure.data
    ? [
        ...structure.data.groups.flatMap((g) => g.categories),
        ...(structure.data.legacy
          ? [
              {
                code: structure.data.legacy.code,
                nameDe: t('finance.unassigned'),
                nameEn: t('finance.unassigned'),
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <FinanceNav />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{t('finance.budgets')}</h1>
        {data?.budgetId && <RecordActions resource="budgets" id={data.budgetId} label={data.budgetName ?? String(year)} />}
        <ArchivedRecordsButton resource="budgets" />
        {(structure.data || data) && (
          <span
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-xs font-medium',
              statusTone[status],
            )}
          >
            {t(`finance.budgetStatus.${status}`)}
          </span>
        )}
        {yearNum === currentYear && (
          <span className="text-xs text-muted-foreground">
            {t('finance.yearProgress')}: {refPct}%
          </span>
        )}
        <div className="flex-1" />
        {canApprove && data && status === 'DRAFT' && !emptyPlan && (
          <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('APPROVED')}>
            <Check size={13} /> {t('finance.approveBudget')}
          </Button>
        )}
        {canApprove && data && status === 'APPROVED' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus.mutate('DRAFT')}>
              <RotateCcw size={13} /> {t('finance.reopenBudget')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('CLOSED')}>
              <Lock size={13} /> {t('finance.closeBudget')}
            </Button>
          </>
        )}
        {canApprove && data && status === 'CLOSED' && (
          <Button size="sm" variant="ghost" onClick={() => setStatus.mutate('APPROVED')}>
            <RotateCcw size={13} /> {t('finance.reopenBudget')}
          </Button>
        )}
        {planEditable && emptyPlan && (
          <Button size="sm" variant="secondary" onClick={() => setCopyOpen(true)}>
            <Copy size={13} /> {t('finance.copyFromPrevious', { year: yearNum - 1 })}
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setCcOpen(true)}>
            <Settings2 size={13} /> {t('finance.manageCostCenters')}
          </Button>
        )}
        {canExport && (
          <Button size="sm" variant="ghost" onClick={exportCsv}>
            <Download size={13} /> CSV
          </Button>
        )}
        <SelectInput value={year} onChange={(e) => setYear(e.target.value)} className="!w-auto">
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectInput>
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'structure', label: t('finance.kostenarten') },
            { key: 'centers', label: t('finance.byCostCenter') },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'structure' && planEditable && (
        <div className="mb-3 flex items-center gap-1 text-xs">
          <span className="mr-1 text-muted-foreground">{t('finance.editing')}:</span>
          {(['planned', 'forecast'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setGridField(f)}
              className={clsx(
                'rounded-md px-2.5 py-1 font-medium transition-colors',
                gridField === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(f === 'planned' ? 'finance.plan' : 'finance.forecast')}
            </button>
          ))}
        </div>
      )}

      {isLoading || structure.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {tab === 'structure' ? structureTable() : centersTable()}
          <p className="mt-2 text-xs text-muted-foreground">
            {t(tab === 'structure' ? 'finance.structureHint' : 'finance.budgetHint')}
          </p>
        </>
      )}

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} width="w-[560px]">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              {detailData
                ? `${detailData.costCenter.code} ${detailData.costCenter.name}`
                : '…'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t('finance.monthlyPhasing')} · {year}
            </p>
          </div>
          <button
            onClick={() => setDetailId(null)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label={t('finance.kostenart')}>
            <SelectInput
              value={detailCategory}
              onChange={(e) => setDetailCategory(e.target.value)}
            >
              {allCategories.map((c) => (
                <option key={c.code} value={c.code}>
                  {catName(c)}
                </option>
              ))}
            </SelectInput>
          </Field>
          {!detailData || detail.isFetching ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              {detailData.hasChildren && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  Σ {t('finance.ccAggregate')} — {t('finance.ccOwnValuesHint')}
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 font-medium">{t('finance.month')}</th>
                    <th className="py-1.5 text-right font-medium">{t('finance.plan')}</th>
                    <th className="py-1.5 text-right font-medium">{t('finance.forecast')}</th>
                    <th className="py-1.5 text-right font-medium">{t('finance.actual')}</th>
                    <th className="py-1.5 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {detailData.months.map((m) => (
                    <tr key={m.month} className="border-b border-border/60 last:border-0">
                      <td className="py-0.5 text-muted-foreground">{monthName(m.month)}</td>
                      <td className="py-0.5 text-right">
                        {planEditable ? (
                          <PlanCell
                            value={m.plan}
                            className="w-24"
                            onSave={(amount) =>
                              plan.mutate({
                                costCenterId: detailData.costCenter.id,
                                category: detailData.category,
                                amount,
                                month: m.month,
                              })
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{m.plan ? money(m.plan) : '—'}</span>
                        )}
                      </td>
                      <td className="py-0.5 text-right">
                        {forecastEditable ? (
                          <PlanCell
                            value={m.forecast}
                            placeholder={m.plan ? String(m.plan) : '0'}
                            className="w-24 text-muted-foreground focus:text-foreground"
                            onSave={(amount) =>
                              plan.mutate({
                                costCenterId: detailData.costCenter.id,
                                category: detailData.category,
                                amount,
                                month: m.month,
                                field: 'forecast',
                              })
                            }
                          />
                        ) : (
                          <span className="tabular-nums text-muted-foreground">
                            {m.forecast != null ? money(m.forecast) : '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-0.5 text-right tabular-nums">
                        {m.actual ? money(m.actual) : '—'}
                      </td>
                      <td className="py-0.5 text-right text-xs tabular-nums text-muted-foreground">
                        {m.plan ? `${Math.round((m.actual / m.plan) * 100)}%` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1.5">Σ</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {money(detailData.months.reduce((s, m) => s + m.plan, 0))}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {money(
                        detailData.months.reduce((s, m) => s + (m.forecast ?? m.plan), 0),
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {money(detailData.months.reduce((s, m) => s + m.actual, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              <p className="text-xs text-muted-foreground">{t('finance.monthlyHint')}</p>
            </>
          )}
        </div>
      </Drawer>

      <CostCenterDialog
        open={ccOpen}
        onClose={() => setCcOpen(false)}
        onChanged={invalidate}
      />

      <Dialog
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={t('finance.copyFromPrevious', { year: yearNum - 1 })}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('finance.copyHint', { year: yearNum - 1 })}
          </p>
          <Field label={t('finance.copyAdjust')}>
            <TextInput
              type="number"
              step="1"
              value={copyAdjust}
              onChange={(e) => setCopyAdjust(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCopyOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => copy.mutate()} disabled={copy.isPending}>
              {t('finance.copyAction')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
