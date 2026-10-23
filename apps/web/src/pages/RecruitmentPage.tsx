import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Check, Plus, UserPlus, X } from 'lucide-react';
import { DragEvent, FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { HrNav } from '../components/HrNav';
import { StatusBadge } from '../components/ListPage';
import { hasPermission, useAuthStore } from '../stores/auth';
import type { OrgPosition } from './org-chart';
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

interface Opening {
  id: string;
  title: string;
  departmentName: string | null;
  officeName: string | null;
  department?: { id: string; name: string } | null;
  office?: { id: string; name: string } | null;
  status: string;
  _count: { applicants: number };
}

interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  source: string | null;
  stage: string;
  jobOpening: { id: string; title: string };
}

interface BoardColumn {
  stage: string;
  items: Applicant[];
}

const PIPELINE_STAGES = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER'];

function NewApplicantDialog({
  open,
  onClose,
  openings,
}: {
  open: boolean;
  onClose: () => void;
  openings: Opening[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    jobOpeningId: '',
    firstName: '',
    lastName: '',
    email: '',
    source: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post(`/hr/job-openings/${form.jobOpeningId}/applicants`, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        source: form.source || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('hr.newApplicant')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('hr.opening')} required>
          <SelectInput value={form.jobOpeningId} onChange={set('jobOpeningId')} required>
            <option value="">—</option>
            {openings
              .filter((opening) => opening.status === 'OPEN')
              .map((opening) => (
                <option key={opening.id} value={opening.id}>
                  {opening.title}
                </option>
              ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.firstName')} required>
            <TextInput value={form.firstName} onChange={set('firstName')} required autoFocus />
          </Field>
          <Field label={t('hr.lastName')} required>
            <TextInput value={form.lastName} onChange={set('lastName')} required />
          </Field>
          <Field label={t('auth.email')} required>
            <TextInput type="email" value={form.email} onChange={set('email')} required />
          </Field>
          <Field label={t('sales.source')}>
            <TextInput value={form.source} onChange={set('source')} placeholder="LinkedIn…" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              create.isPending ||
              !form.jobOpeningId ||
              !form.firstName ||
              !form.lastName ||
              !form.email
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface OpeningDraft { title: string; departmentId: string; officeId: string }

function NewOpeningDialog({ open, onClose, initialValues }: { open: boolean; onClose: () => void; initialValues: OpeningDraft }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.companyId);
  const [form, setForm] = useState(initialValues);
  const departments = useQuery({ queryKey: ['departments', companyId], enabled: open,
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/master/departments') });
  const offices = useQuery({ queryKey: ['offices', companyId], enabled: open,
    queryFn: () => api.get<{ id: string; name: string; code: string; city: string | null }[]>('/master/offices') });
  useEffect(() => {
    if (departments.data && form.departmentId && !departments.data.some((row) => row.id === form.departmentId)) setForm((previous) => ({ ...previous, departmentId: '' }));
  }, [departments.data, form.departmentId]);
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post('/hr/job-openings', {
        title: form.title,
        departmentId: form.departmentId || undefined,
        officeId: form.officeId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('hr.newOpening')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('contracts.contractTitle')} required>
          <TextInput value={form.title} onChange={set('title')} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.department')}>
            <SelectInput value={form.departmentId} onChange={set('departmentId')} disabled={departments.isLoading || !!departments.error}>
              <option value="">—</option>
              {departments.data?.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}
            </SelectInput>
          </Field>
          <Field label={t('hr.office')}>
            <SelectInput value={form.officeId} onChange={set('officeId')} disabled={offices.isLoading || !!offices.error}>
              <option value="">—</option>
              {offices.data?.map((office) => <option key={office.id} value={office.id}>{office.code} · {office.name}{office.city ? ` · ${office.city}` : ''}</option>)}
            </SelectInput>
          </Field>
        </div>
        {(departments.error || offices.error) && <p role="alert" className="text-sm text-destructive">{departments.error?.message ?? offices.error?.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !form.title.trim() || departments.isLoading || offices.isLoading || !!departments.error || !!offices.error}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RecruitmentPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.companyId);
  const me = useAuthStore((state) => state.me);
  const canRecruit = hasPermission(me, 'hr.recruitment.create');
  const [applicantOpen, setApplicantOpen] = useState(false);
  const [openingDraft, setOpeningDraft] = useState<OpeningDraft | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  useEffect(() => { setApplicantOpen(false); setOpeningDraft(null); setDragOver(null); }, [companyId]);

  const openPositions = useQuery({
    queryKey: ['recruitment', companyId, 'open-positions'],
    queryFn: () => api.get<OrgPosition[]>('/hr/recruitment/open-positions'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const { data: openings } = useQuery({
    queryKey: ['recruitment', companyId, 'openings'],
    queryFn: () => api.get<Opening[]>('/hr/job-openings'),
  });
  const { data: board, isLoading } = useQuery({
    queryKey: ['recruitment', companyId, 'board'],
    queryFn: () => api.get<BoardColumn[]>('/hr/applicants/board'),
  });

  const setStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api.post(`/hr/applicants/${id}/stage`, { stage }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const onDrop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/applicant-id');
    const from = e.dataTransfer.getData('text/applicant-stage');
    if (id && from !== stage) setStage.mutate({ id, stage });
  };

  const pipelineColumns =
    board?.filter((column) => PIPELINE_STAGES.includes(column.stage)) ?? [];
  const closed = board?.filter((column) => ['HIRED', 'REJECTED'].includes(column.stage)) ?? [];

  return (
    <>
      <HrNav />
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('hr.recruitment')}</h1>
        <div className="flex-1" />
        {canRecruit && <Button variant="secondary" onClick={() => setOpeningDraft({ title: '', departmentId: '', officeId: '' })}>
          <Plus size={14} />
          {t('hr.newOpening')}
        </Button>}
        {canRecruit && <Button onClick={() => setApplicantOpen(true)}>
          <UserPlus size={14} />
          {t('hr.newApplicant')}
        </Button>}
      </div>

      <section aria-label={t('hr.openPositions')} className="mb-5 space-y-3">
        <h2 className="text-sm font-semibold">{t('hr.openPositions')}</h2>
        <p className="text-xs text-muted-foreground">{t('hr.openPositionsHint')}</p>
        {openPositions.isLoading ? <Skeleton className="h-20" />
          : openPositions.error ? <p role="alert" className="text-sm text-destructive">{openPositions.error.message}</p>
            : !openPositions.data?.length ? <p className="text-sm text-muted-foreground">{t('hr.noOpenPositions')}</p>
              : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {openPositions.data.map((position) => <div key={position.id} data-open-position-id={position.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <BriefcaseBusiness size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{position.name}</div>
                    <div className="text-xs text-muted-foreground">{[position.code, position.department?.name].filter(Boolean).join(' · ') || t('hr.noDepartment')}</div>
                    <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{t('hr.positionStatus.OPEN')}</span>
                    {canRecruit && <div className="mt-2"><Button size="sm" variant="secondary" aria-label={t('hr.recruitPositionNamed', { name: position.name })}
                      onClick={() => setOpeningDraft({ title: position.name, departmentId: position.department?.id ?? '', officeId: '' })}>
                      <Plus size={12} />{t('hr.newOpening')}
                    </Button></div>}
                  </div>
                </div>)}
              </div>}
      </section>

      {/* openings strip */}
      <div className="mb-4 flex flex-wrap gap-2">
        {openings?.map((opening) => (
          <div
            key={opening.id}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs"
          >
            <strong>{opening.title}</strong>
            {(opening.department?.name || opening.departmentName || opening.office?.name || opening.officeName) && <span className="text-muted-foreground">
              {[opening.department?.name ?? opening.departmentName, opening.office?.name ?? opening.officeName].filter(Boolean).join(' · ')}
            </span>}
            <span className="text-muted-foreground">
              {opening._count.applicants} {t('hr.applicants')}
            </span>
            <StatusBadge value={opening.status} />
            <RecordActions resource="openings" id={opening.id} label={opening.title} />
          </div>
        ))}
      </div>

      {/* applicant kanban */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {pipelineColumns.map((column) => (
            <div
              key={column.stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(column.stage);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, column.stage)}
              className={clsx(
                'flex min-h-56 flex-col rounded-xl border border-border bg-muted/40',
                dragOver === column.stage && 'bg-accent/60 ring-2 ring-primary/40',
              )}
            >
              <div className="flex items-baseline justify-between px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {t(`hr.stage.${column.stage}`)}
                </span>
                <span className="text-xs text-muted-foreground">{column.items.length}</span>
              </div>
              <div className="flex-1 space-y-2 px-2 pb-2">
                {column.items.map((applicant) => (
                  <div
                    key={applicant.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/applicant-id', applicant.id);
                      e.dataTransfer.setData('text/applicant-stage', applicant.stage);
                    }}
                    className="group cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={`${applicant.firstName} ${applicant.lastName}`}
                        size={24}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {applicant.firstName} {applicant.lastName}
                      </span>
                    </div>
                    <RecordActions resource="applicants" id={applicant.id} label={`${applicant.firstName} ${applicant.lastName}`} />
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {applicant.jobOpening.title}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {applicant.source ?? '—'}
                      </span>
                      <span className="flex gap-1">
                        <button
                          onClick={() =>
                            setStage.mutate({ id: applicant.id, stage: 'HIRED' })
                          }
                          className="rounded p-0.5 text-success opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                          title={t('hr.hire')}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() =>
                            setStage.mutate({ id: applicant.id, stage: 'REJECTED' })
                          }
                          className="rounded p-0.5 text-destructive opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                          title={t('hr.reject')}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* closed */}
      {closed.some((column) => column.items.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {closed.flatMap((column) =>
            column.items.map((applicant) => (
              <div
                key={applicant.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"
              >
                {applicant.firstName} {applicant.lastName}
                <StatusBadge value={applicant.stage} />
                <RecordActions resource="applicants" id={applicant.id} label={`${applicant.firstName} ${applicant.lastName}`} />
              </div>
            )),
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('hr.gdprHint')}</p>

      <NewApplicantDialog
        key={companyId}
        open={applicantOpen}
        onClose={() => setApplicantOpen(false)}
        openings={openings ?? []}
      />
      {openingDraft && <NewOpeningDialog key={companyId} open onClose={() => setOpeningDraft(null)} initialValues={openingDraft} />}
    </>
  );
}
