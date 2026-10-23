import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { AiSummary } from '../components/ai';
import { StatusBadge } from '../components/ListPage';
import {
  Button,
  Drawer,
  KeyValue,
  Skeleton,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';

interface GoNoGo {
  clientRelation: number | null;
  strategicFit: number | null;
  capacity: number | null;
  winProbability: number | null;
  riskLevel: number | null;
  totalScore: number | null;
  decision: string | null;
  comments: string | null;
}

interface ProposalSummary {
  id: string;
  proposalNumber: string;
  title: string;
  status: string;
}

interface OpportunityDetail {
  id: string;
  opportunityNumber: string;
  title: string;
  stage: string;
  estimatedValue: string | null;
  currencyCode: string;
  probability: number;
  submissionDeadline: string | null;
  sector: string | null;
  source: string | null;
  lostReason: string | null;
  partner: { id: string; name: string; city: string | null };
  owner?: { firstName: string; lastName: string } | null;
  goNoGo: GoNoGo | null;
  proposals: ProposalSummary[];
}

interface FeeLine {
  id: string;
  discipline: string;
  role: string;
  hours: string;
  hourlyRate: string;
  costRate: string | null;
}

interface ProposalDetail extends ProposalSummary {
  totalFee: string | null;
  estimatedCost: string | null;
  estimatedHours: string | null;
  marginPercent: string | null;
  feeLines: FeeLine[];
}

const PROPOSAL_NEXT: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['SUBMITTED'],
  SUBMITTED: ['SHORTLISTED', 'WON', 'LOST'],
  SHORTLISTED: ['WON', 'LOST'],
};

const CRITERIA = [
  'clientRelation',
  'strategicFit',
  'capacity',
  'winProbability',
  'riskLevel',
] as const;

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            onClick={() => onChange(score)}
            className={clsx(
              'h-7 w-7 rounded-md border text-xs font-semibold transition-colors',
              value === score
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted',
            )}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProposalPanel({ proposalId }: { proposalId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [line, setLine] = useState({
    discipline: '',
    role: '',
    hours: '',
    hourlyRate: '',
    costRate: '',
  });

  const { data: proposal } = useQuery({
    queryKey: ['proposal', proposalId],
    queryFn: () => api.get<ProposalDetail>(`/sales/proposals/${proposalId}`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['proposal', proposalId] });
    void queryClient.invalidateQueries({ queryKey: ['opportunity'] });
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const onError = (err: Error) => toast(err.message, 'error');

  const addLine = useMutation({
    mutationFn: () =>
      api.post(`/sales/proposals/${proposalId}/lines`, {
        discipline: line.discipline,
        role: line.role,
        hours: line.hours,
        hourlyRate: line.hourlyRate,
        costRate: line.costRate || undefined,
      }),
    onSuccess: () => {
      setLine({ discipline: '', role: '', hours: '', hourlyRate: '', costRate: '' });
      refresh();
    },
    onError,
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => api.delete(`/sales/proposals/lines/${lineId}`),
    onSuccess: refresh,
    onError,
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      api.post(`/sales/proposals/${proposalId}/transition`, { status }),
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError,
  });

  const money = (value: string | number | null) =>
    value !== null && value !== undefined
      ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(
          Number(value),
        )
      : '—';

  if (!proposal) return <Skeleton className="h-40" />;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs">{proposal.proposalNumber}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{proposal.title}</span>
        <StatusBadge value={proposal.status} />
        <RecordActions resource="proposals" id={proposal.id} label={proposal.title} />
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {(PROPOSAL_NEXT[proposal.status] ?? []).map((next) => (
          <Button
            key={next}
            size="sm"
            variant={next === 'LOST' ? 'destructive' : 'secondary'}
            disabled={transition.isPending}
            onClick={() => transition.mutate(next)}
          >
            → {t(`sales.proposalStatus.${next}`, next)}
          </Button>
        ))}
      </div>

      {/* fee lines */}
      <table className="mb-2 w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">{t('sales.discipline')}</th>
            <th className="py-1.5 pr-2 font-medium">{t('sales.role')}</th>
            <th className="py-1.5 pr-2 text-right font-medium">h</th>
            <th className="py-1.5 pr-2 text-right font-medium">€/h</th>
            <th className="py-1.5 pr-2 text-right font-medium">Σ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {proposal.feeLines.map((feeLine) => (
            <tr key={feeLine.id} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-2">{feeLine.discipline}</td>
              <td className="py-1.5 pr-2">{feeLine.role}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{Number(feeLine.hours)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {Number(feeLine.hourlyRate)}
              </td>
              <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                {money(Number(feeLine.hours) * Number(feeLine.hourlyRate))}
              </td>
              <td className="py-1.5 text-right">
                <button
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLine.mutate(feeLine.id)}
                  aria-label={t('finance.removeLine')}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="mb-2 grid grid-cols-12 gap-1.5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          addLine.mutate();
        }}
      >
        <TextInput
          className="col-span-3 !py-1 !text-xs"
          placeholder={t('sales.discipline')}
          value={line.discipline}
          onChange={(e) => setLine((l) => ({ ...l, discipline: e.target.value }))}
          required
        />
        <TextInput
          className="col-span-3 !py-1 !text-xs"
          placeholder={t('sales.role')}
          value={line.role}
          onChange={(e) => setLine((l) => ({ ...l, role: e.target.value }))}
          required
        />
        <TextInput
          className="col-span-2 !py-1 !text-xs"
          type="number"
          min="0"
          step="0.5"
          placeholder="h"
          value={line.hours}
          onChange={(e) => setLine((l) => ({ ...l, hours: e.target.value }))}
          required
        />
        <TextInput
          className="col-span-2 !py-1 !text-xs"
          type="number"
          min="0"
          step="0.01"
          placeholder="€/h"
          value={line.hourlyRate}
          onChange={(e) => setLine((l) => ({ ...l, hourlyRate: e.target.value }))}
          required
        />
        <TextInput
          className="col-span-1 !py-1 !text-xs"
          type="number"
          min="0"
          step="0.01"
          placeholder={t('sales.cost')}
          value={line.costRate}
          onChange={(e) => setLine((l) => ({ ...l, costRate: e.target.value }))}
        />
        <Button
          className="col-span-1"
          size="sm"
          type="submit"
          disabled={addLine.isPending || !line.discipline || !line.role || !line.hours || !line.hourlyRate}
        >
          <Plus size={12} />
        </Button>
      </form>

      <div className="flex justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          {Number(proposal.estimatedHours ?? 0)} h
          {proposal.marginPercent && (
            <>
              {' · '}
              {t('sales.margin')}:{' '}
              <strong className="text-foreground">{Number(proposal.marginPercent)}%</strong>
            </>
          )}
        </span>
        <span>
          {t('sales.totalFee')}:{' '}
          <strong className="text-sm text-foreground">{money(proposal.totalFee)}</strong>
        </span>
      </div>
    </div>
  );
}

export function OpportunityDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [newProposalTitle, setNewProposalTitle] = useState('');

  const { data: opportunity } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => api.get<OpportunityDetail>(`/sales/opportunities/${id}`),
  });

  const [scores, setScores] = useState<Record<string, number>>({
    clientRelation: 3,
    strategicFit: 3,
    capacity: 3,
    winProbability: 3,
    riskLevel: 3,
  });
  const [comments, setComments] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['opportunity', id] });
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const onError = (err: Error) => toast(err.message, 'error');

  const decide = useMutation({
    mutationFn: (decision: string) =>
      api.post(`/sales/opportunities/${id}/go-no-go`, {
        ...scores,
        decision,
        comments: comments || undefined,
      }),
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError,
  });

  const createProposal = useMutation({
    mutationFn: () =>
      api.post<ProposalSummary>(`/sales/opportunities/${id}/proposals`, {
        title: newProposalTitle,
      }),
    onSuccess: (created) => {
      setNewProposalTitle('');
      refresh();
      setOpenProposal(created.id);
      toast(`${created.proposalNumber} ${t('common.created')}`);
    },
    onError,
  });

  const money = (value: string | null) =>
    value
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(Number(value))
      : '—';
  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const totalScore = CRITERIA.reduce((sum, key) => sum + scores[key], 0);

  return (
    <Drawer open onClose={onClose} width="w-[640px]">
      {!opportunity ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Briefcase size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-snug">{opportunity.title}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{opportunity.opportunityNumber}</span>
                  <StatusBadge value={opportunity.stage} />
                  <span>{opportunity.partner.name}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                    {opportunity.probability}%
                  </span>
                </div>
              </div>
            </div>
            <AiSummary entityType="opportunity" entityId={id} />
          </div>

          <Tabs
            tabs={[
              { key: 'overview', label: t('crm.overview') },
              {
                key: 'gonogo',
                label: 'Go/No-Go',
                badge: opportunity.goNoGo ? 1 : 0,
              },
              {
                key: 'proposals',
                label: t('sales.proposals'),
                badge: opportunity.proposals.length,
              },
            ]}
            active={tab}
            onChange={setTab}
          />

          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'overview' && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                <KeyValue label={t('nav.clients')}>{opportunity.partner.name}</KeyValue>
                <KeyValue label={t('sales.estimatedValue')}>
                  {money(opportunity.estimatedValue)}
                </KeyValue>
                <KeyValue label={t('sales.deadline')}>
                  {fmtDate(opportunity.submissionDeadline)}
                </KeyValue>
                <KeyValue label={t('contracts.owner')}>
                  {opportunity.owner
                    ? `${opportunity.owner.firstName} ${opportunity.owner.lastName}`
                    : '—'}
                </KeyValue>
                <KeyValue label={t('sales.sector')}>{opportunity.sector}</KeyValue>
                <KeyValue label={t('sales.source')}>{opportunity.source}</KeyValue>
                {opportunity.lostReason && (
                  <KeyValue label={t('sales.lostReason')}>{opportunity.lostReason}</KeyValue>
                )}
              </dl>
            )}

            {tab === 'gonogo' && (
              <div className="space-y-4">
                {opportunity.goNoGo?.decision && (
                  <div
                    className={clsx(
                      'rounded-lg border p-3 text-sm',
                      opportunity.goNoGo.decision === 'GO'
                        ? 'border-success/40 bg-success/10'
                        : opportunity.goNoGo.decision === 'NO_GO'
                          ? 'border-destructive/40 bg-destructive/10'
                          : 'border-warning/40 bg-warning/10',
                    )}
                  >
                    <strong>{t(`sales.decision.${opportunity.goNoGo.decision}`)}</strong>
                    {' · '}
                    {t('sales.score')}: {opportunity.goNoGo.totalScore}/25
                    {opportunity.goNoGo.comments && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {opportunity.goNoGo.comments}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2.5 rounded-lg border border-border p-3">
                  {CRITERIA.map((key) => (
                    <ScoreRow
                      key={key}
                      label={t(`sales.criteria.${key}`)}
                      value={scores[key]}
                      onChange={(value) => setScores((s) => ({ ...s, [key]: value }))}
                    />
                  ))}
                  <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
                    <span className="font-medium">{t('sales.score')}</span>
                    <span
                      className={clsx(
                        'text-lg font-bold tabular-nums',
                        totalScore >= 18
                          ? 'text-success'
                          : totalScore >= 12
                            ? 'text-warning'
                            : 'text-destructive',
                      )}
                    >
                      {totalScore}/25
                    </span>
                  </div>
                </div>

                <TextArea
                  placeholder={t('crm.notes')}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={2}
                />

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate('GO')}
                  >
                    ✓ Go
                  </Button>
                  <Button
                    className="flex-1"
                    variant="secondary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate('CONDITIONAL')}
                  >
                    {t('sales.decision.CONDITIONAL')}
                  </Button>
                  <Button
                    className="flex-1"
                    variant="destructive"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate('NO_GO')}
                  >
                    ✗ No-Go
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('sales.goNoGoHint')}</p>
              </div>
            )}

            {tab === 'proposals' && (
              <div className="space-y-3">
                <form
                  className="flex gap-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    createProposal.mutate();
                  }}
                >
                  <TextInput
                    placeholder={t('sales.proposalTitle')}
                    value={newProposalTitle}
                    onChange={(e) => setNewProposalTitle(e.target.value)}
                    required
                  />
                  <Button
                    size="sm"
                    type="submit"
                    disabled={createProposal.isPending || !newProposalTitle.trim()}
                  >
                    <Plus size={13} />
                    {t('common.new')}
                  </Button>
                </form>

                {opportunity.proposals.map((proposal) =>
                  openProposal === proposal.id ? (
                    <ProposalPanel key={proposal.id} proposalId={proposal.id} />
                  ) : (
                    <div key={proposal.id}><button
                      onClick={() => setOpenProposal(proposal.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary/40"
                    >
                      <span className="font-mono text-xs">{proposal.proposalNumber}</span>
                      <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
                      <StatusBadge value={proposal.status} />
                    </button><RecordActions resource="proposals" id={proposal.id} label={proposal.title} /></div>
                  ),
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
