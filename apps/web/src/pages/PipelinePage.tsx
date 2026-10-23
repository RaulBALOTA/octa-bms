import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, CalendarClock, Filter, Percent, Plus, Scale, Trophy, XCircle } from 'lucide-react';
import { DragEvent, FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api, Paged } from '../lib/api';
import { SubNav } from '../components/SubNav';
import { Funnel } from '../components/charts';
import { KpiTile, PageHeader, Panel } from '../components/infographics';
import {
  Avatar,
  Button,
  Dialog,
  Field,
  SelectInput,
  Skeleton,
  TextInput,
  useToast,
} from '../components/ui';
import { OpportunityDrawer } from './OpportunityDrawer';

interface OpportunityCard {
  id: string;
  opportunityNumber: string;
  title: string;
  stage: string;
  estimatedValue: string | null;
  currencyCode: string;
  probability: number;
  submissionDeadline: string | null;
  partner: { id: string; name: string };
  owner?: { firstName: string; lastName: string } | null;
}

interface PipelineColumn {
  stage: string;
  count: number;
  totalValue: number;
  weightedValue: number;
  items: OpportunityCard[];
}

const STAGE_TONE: Record<string, string> = {
  LEAD: 'border-t-muted-foreground/40',
  QUALIFIED: 'border-t-primary/60',
  GO_NO_GO: 'border-t-warning',
  PROPOSAL: 'border-t-primary',
  NEGOTIATION: 'border-t-success',
};

function NewOpportunityDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    partnerId: '',
    estimatedValue: '',
    submissionDeadline: '',
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-for-select'],
    queryFn: () =>
      api.get<Paged<{ id: string; name: string }>>(
        '/crm/partners?type=CLIENT&pageSize=200&sort=name',
      ),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/sales/opportunities', {
        title: form.title,
        partnerId: form.partnerId,
        estimatedValue: form.estimatedValue || undefined,
        submissionDeadline: form.submissionDeadline || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      toast(t('common.created'));
      onClose();
      setForm({ title: '', partnerId: '', estimatedValue: '', submissionDeadline: '' });
    },
    onError: () => toast(t('common.error'), 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('sales.newOpportunity')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('contracts.contractTitle')} required>
          <TextInput
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />
        </Field>
        <Field label={t('nav.clients')} required>
          <SelectInput
            value={form.partnerId}
            onChange={(e) => setForm((f) => ({ ...f, partnerId: e.target.value }))}
            required
          >
            <option value="">—</option>
            {clients?.data.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('sales.estimatedValue')} (€)`}>
            <TextInput
              type="number"
              min="0"
              step="1000"
              value={form.estimatedValue}
              onChange={(e) =>
                setForm((f) => ({ ...f, estimatedValue: e.target.value }))
              }
            />
          </Field>
          <Field label={t('sales.deadline')}>
            <TextInput
              type="date"
              value={form.submissionDeadline}
              onChange={(e) =>
                setForm((f) => ({ ...f, submissionDeadline: e.target.value }))
              }
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !form.title.trim() || !form.partnerId}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PipelinePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: columns, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get<PipelineColumn[]>('/sales/opportunities/pipeline'),
  });

  const transition = useMutation({
    mutationFn: ({ id, stage, lostReason }: { id: string; stage: string; lostReason?: string }) =>
      api.post(`/sales/opportunities/${id}/transition`, { stage, lostReason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: () => toast(t('common.error'), 'error'),
  });

  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);

  const totalWeighted = columns?.reduce((sum, c) => sum + c.weightedValue, 0) ?? 0;
  const totalValue = columns?.reduce((sum, c) => sum + c.totalValue, 0) ?? 0;
  const totalCount = columns?.reduce((sum, c) => sum + c.count, 0) ?? 0;
  const nextDeadline = (columns ?? [])
    .flatMap((c) => c.items)
    .filter((card) => card.submissionDeadline && new Date(card.submissionDeadline) >= new Date(new Date().toDateString()))
    .sort((a, b) => a.submissionDeadline!.localeCompare(b.submissionDeadline!))[0];

  const onDrop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = e.dataTransfer.getData('text/opportunity-id');
    const from = e.dataTransfer.getData('text/opportunity-stage');
    if (id && from !== stage) transition.mutate({ id, stage });
  };

  const closeAs = (card: OpportunityCard, stage: 'WON' | 'LOST') => {
    if (stage === 'LOST') {
      const reason = window.prompt(t('sales.lostReasonPrompt'));
      if (!reason) return;
      transition.mutate({ id: card.id, stage, lostReason: reason });
    } else {
      transition.mutate({ id: card.id, stage });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <SubNav
        items={[
          { label: t('sales.pipeline'), to: '/sales/pipeline' },
          { label: t('sales.winLoss'), to: '/sales/win-loss' },
        ]}
      />
      <PageHeader
        title={t('sales.pipeline')}
        icon={Briefcase}
        subtitle={
          <>
            Σ {t('sales.weighted')}: <strong className="text-foreground">{money(totalWeighted)}</strong>
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />

      {columns && columns.length > 0 && (
        <div className="mb-4 grid shrink-0 gap-3 xl:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
          <KpiTile
            label={t('insights.pipelineValue')}
            value={money(totalValue)}
            icon={Briefcase}
            sub={t('insights.pipelineDeals', { count: totalCount })}
          />
          <KpiTile
            label={t('sales.weighted')}
            value={money(totalWeighted)}
            icon={Scale}
            tone="success"
            progress={totalValue ? (totalWeighted / totalValue) * 100 : 0}
            sub={`${totalValue ? Math.round((totalWeighted / totalValue) * 100) : 0}% ${t('insights.weightedShare')}`}
          />
          <KpiTile
            label={t('insights.avgDeal')}
            value={money(totalCount ? totalValue / totalCount : 0)}
            icon={Percent}
            tone="neutral"
          />
          <KpiTile
            label={t('insights.nextDeadline')}
            value={
              nextDeadline
                ? new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: 'short' }).format(
                    new Date(nextDeadline.submissionDeadline!),
                  )
                : '—'
            }
            icon={CalendarClock}
            tone="warning"
            sub={nextDeadline ? nextDeadline.title : t('insights.noDeadline')}
            onClick={nextDeadline ? () => setSelectedId(nextDeadline.id) : undefined}
          />
          </div>
          <Panel title={t('insights.funnel')} subtitle={t('insights.funnelHint')} icon={Filter} bodyClassName="pt-1">
            <Funnel
              formatValue={(v) => money(v)}
              data={columns.map((column) => ({
                label: t(`sales.stage.${column.stage}`),
                value: column.totalValue,
                count: column.count,
                detail: `${column.count} · ${money(column.totalValue)}`,
              }))}
            />
          </Panel>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <div className="grid min-h-[420px] flex-1 grid-cols-5 gap-3 overflow-x-auto">
          {columns?.map((column) => (
            <div
              key={column.stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(column.stage);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => onDrop(e, column.stage)}
              className={clsx(
                'flex min-w-52 flex-col rounded-xl border border-t-2 border-border bg-muted/40 transition-colors',
                STAGE_TONE[column.stage],
                dragOverStage === column.stage && 'bg-accent/60 ring-2 ring-primary/40',
              )}
            >
              <div className="px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {t(`sales.stage.${column.stage}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{column.count}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {money(column.totalValue)}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {column.items.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onClick={() => setSelectedId(card.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/opportunity-id', card.id);
                      e.dataTransfer.setData('text/opportunity-stage', card.stage);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    className="group cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="text-sm font-medium leading-snug">{card.title}</div>
                    <RecordActions resource="opportunities" id={card.id} label={card.title} />
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {card.partner.name}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {card.estimatedValue ? money(Number(card.estimatedValue)) : '—'}
                      </span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                        {card.probability}%
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      {card.submissionDeadline ? (
                        <span className="flex items-center gap-1 text-[11px] text-warning">
                          <CalendarClock size={11} />
                          {new Intl.DateTimeFormat(i18n.language, {
                            day: '2-digit',
                            month: '2-digit',
                          }).format(new Date(card.submissionDeadline))}
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-1">
                        {card.owner && (
                          <Avatar
                            name={`${card.owner.firstName} ${card.owner.lastName}`}
                            size={18}
                          />
                        )}
                        <button
                          onClick={() => closeAs(card, 'WON')}
                          className="rounded p-0.5 text-success opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                          title={t('sales.markWon')}
                        >
                          <Trophy size={13} />
                        </button>
                        <button
                          onClick={() => closeAs(card, 'LOST')}
                          className="rounded p-0.5 text-destructive opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                          title={t('sales.markLost')}
                        >
                          <XCircle size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <NewOpportunityDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {selectedId && (
        <OpportunityDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
