import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { SubNav } from '../components/SubNav';
import {
  Button,
  Dialog,
  Field,
  SelectInput,
  Skeleton,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

interface Goal {
  id: string;
  year: number;
  title: string;
  description: string | null;
  category: string | null;
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  status: string;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: string;
  publishAt: string;
  companyId: string | null;
}

const GOAL_STATUS_TONE: Record<string, string> = {
  ON_TRACK: 'bg-success/15 text-success',
  AT_RISK: 'bg-warning/15 text-warning',
  OFF_TRACK: 'bg-destructive/15 text-destructive',
  ACHIEVED: 'bg-primary/15 text-primary',
};

function GoalDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal?: Goal }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    year: String(goal?.year ?? new Date().getFullYear()),
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    category: goal?.category ?? 'FINANCIAL',
    targetValue: goal?.targetValue ?? '',
    currentValue: goal?.currentValue ?? '',
    unit: goal?.unit ?? '',
    status: goal?.status ?? 'ON_TRACK',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () => {
      const body = {
        year: Number(form.year),
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category || null,
        targetValue: form.targetValue || null,
        currentValue: form.currentValue || null,
        unit: form.unit.trim() || null,
        status: form.status,
      };
      return goal ? api.patch(`/corporate/goals/${goal.id}`, body) : api.post('/corporate/goals', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      toast(t(goal ? 'common.saved' : 'common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={() => { if (!create.isPending) onClose(); }} title={t(goal ? 'corporate.editGoal' : 'corporate.newGoal')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!create.isPending) create.mutate();
        }}
      >
        <Field label={t('corporate.recordTitle')} required>
          <TextInput value={form.title} onChange={set('title')} required maxLength={250} autoFocus />
        </Field>
        <Field label={t('corporate.description')}><TextArea value={form.description} onChange={set('description')} maxLength={5000} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('corporate.year')} required>
            <TextInput type="number" value={form.year} onChange={set('year')} min={1900} max={9999} required />
          </Field>
          <Field label={t('corporate.category')}>
            <SelectInput value={form.category} onChange={set('category')}>
              <option value="">—</option>
              {['FINANCIAL', 'GROWTH', 'PEOPLE', 'QUALITY', 'DIGITALIZATION'].map((c) => (
                <option key={c} value={c}>
                  {t(`corporate.goalCategory.${c}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('corporate.target')}>
            <TextInput type="number" step="0.01" value={form.targetValue} onChange={set('targetValue')} />
          </Field>
          <Field label={t('corporate.current')}>
            <TextInput type="number" step="0.01" value={form.currentValue} onChange={set('currentValue')} />
          </Field>
          <Field label={t('common.status')}>
            <SelectInput value={form.status} onChange={set('status')}>
              {Object.keys(GOAL_STATUS_TONE).map((status) => <option key={status} value={status}>{t(`corporate.goalStatus.${status}`)}</option>)}
            </SelectInput>
          </Field>
          <Field label={t('corporate.unit')}>
            <TextInput value={form.unit} onChange={set('unit')} placeholder="€, %, MA…" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !form.title.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AnnouncementDialog({ open, onClose, announcement }: { open: boolean; onClose: () => void; announcement?: Announcement }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: announcement?.title ?? '', content: announcement?.content ?? '', priority: announcement?.priority ?? 'NORMAL' });

  const create = useMutation({
    mutationFn: () => announcement ? api.patch(`/corporate/announcements/${announcement.id}`, form) : api.post('/corporate/announcements', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast(t(announcement ? 'common.saved' : 'common.created'));
      onClose();
      setForm({ title: '', content: '', priority: 'NORMAL' });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={() => { if (!create.isPending) onClose(); }} title={t(announcement ? 'corporate.editAnnouncement' : 'corporate.newAnnouncement')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!create.isPending) create.mutate();
        }}
      >
        <Field label={t('corporate.recordTitle')} required>
          <TextInput
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            maxLength={250}
            autoFocus
          />
        </Field>
        <Field label={t('corporate.content')} required>
          <TextArea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={4}
            maxLength={20000}
            required
          />
        </Field>
        <Field label={t('corporate.priority')}>
          <SelectInput
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
          >
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
              <option key={p} value={p}>
                {t(`corporate.priorityLevel.${p}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !form.title.trim() || !form.content.trim()}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CorporatePage() {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const companyId = useAuthStore((s) => s.companyId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [goalOpen, setGoalOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | undefined>();
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | undefined>();
  const [viewing, setViewing] = useState<Goal | Announcement | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'goals' | 'announcements'; id: string; title: string } | null>(null);
  const remove = useMutation({
    mutationFn: (record: { kind: 'goals' | 'announcements'; id: string }) => api.delete(`/corporate/${record.kind}/${record.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setDeleting(null);
      toast(t('common.deleted'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const { data: goals, isLoading: goalsLoading, error: goalsError } = useQuery({
    queryKey: ['goals', companyId],
    queryFn: () => api.get<Goal[]>('/corporate/goals'),
    enabled: hasPermission(me, 'corporate.goals.read'),
  });
  const { data: announcements, error: announcementsError } = useQuery({
    queryKey: ['announcements', companyId],
    queryFn: () => api.get<Announcement[]>('/corporate/announcements'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-6xl">
      <SubNav
        items={[
          { label: t('nav.corporate'), to: '/corporate' },
          { label: t('group.title'), to: '/group' },
          { label: t('group.compare'), to: '/group/compare' },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">{t('nav.corporate')}</h1>
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Goals */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Target size={15} className="text-primary" />
              {t('corporate.goals')}
            </h2>
            {hasPermission(me, 'corporate.goals.create') && (
              <Button size="sm" onClick={() => { setEditingGoal(undefined); setGoalOpen(true); }}>
                <Plus size={13} />
                {t('common.new')}
              </Button>
            )}
          </div>
          {goalsError && <p role="alert" className="mb-3 text-sm text-destructive">{goalsError.message}</p>}
          {goalsLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : goals?.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {goals.map((goal) => {
                const target = Number(goal.targetValue ?? 0);
                const current = Number(goal.currentValue ?? 0);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                return (
                  <div
                    key={goal.id}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <button className="text-left text-sm font-medium leading-snug hover:text-primary hover:underline" onClick={() => setViewing(goal)}>{goal.title}</button>
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          GOAL_STATUS_TONE[goal.status],
                        )}
                      >
                        {t(`corporate.goalStatus.${goal.status}`)}
                      </span>
                    </div>
                    {(
                      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {goal.year}{goal.category ? ` · ${t(`corporate.goalCategory.${goal.category}`)}` : ''}
                      </div>
                    )}
                    {goal.description && <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{goal.description}</p>}
                    {target > 0 && (
                      <>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="tabular-nums">
                            {current.toLocaleString(i18n.language)} /{' '}
                            {target.toLocaleString(i18n.language)} {goal.unit}
                          </span>
                          <span className="font-medium tabular-nums">{Math.round(pct)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      {hasPermission(me, 'corporate.goals.update') && <Button size="sm" variant="secondary" onClick={() => { setEditingGoal(goal); setGoalOpen(true); }} aria-label={t('corporate.editNamed', { title: goal.title })}>
                        <Pencil size={12} />{t('common.edit')}
                      </Button>}
                      {hasPermission(me, 'corporate.goals.delete') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting({ kind: 'goals', id: goal.id, title: goal.title })} aria-label={t('corporate.deleteNamed', { title: goal.title })}>
                        <Trash2 size={12} />{t('common.delete')}
                      </Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              {t('common.noResults')}
            </p>
          )}
        </section>

        {/* Announcements */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone size={15} className="text-primary" />
              {t('corporate.announcements')}
            </h2>
            {hasPermission(me, 'corporate.announcements.create') && (
              <Button size="sm" onClick={() => { setEditingAnnouncement(undefined); setAnnouncementOpen(true); }}>
                <Plus size={13} />
                {t('common.new')}
              </Button>
            )}
          </div>
          {announcementsError && <p role="alert" className="mb-3 text-sm text-destructive">{announcementsError.message}</p>}
          <div className="space-y-2">
            {announcements?.length ? (
              announcements.map((a) => (
                <article key={a.id} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="mb-1 flex items-center gap-2">
                    {(a.priority === 'HIGH' || a.priority === 'URGENT') && (
                      <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                        {t(`corporate.priorityLevel.${a.priority}`)}
                      </span>
                    )}
                    <button className="text-left text-sm font-medium hover:text-primary hover:underline" onClick={() => setViewing(a)}>{a.title}</button>
                  </div>
                  {(a.companyId === companyId || me?.isSystemAdmin) && <div className="mt-3 flex justify-end gap-2">
                    {hasPermission(me, 'corporate.announcements.update') && <Button size="sm" variant="secondary" onClick={() => { setEditingAnnouncement(a); setAnnouncementOpen(true); }} aria-label={t('corporate.editNamed', { title: a.title })}>
                      <Pencil size={12} />{t('common.edit')}
                    </Button>}
                    {hasPermission(me, 'corporate.announcements.delete') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting({ kind: 'announcements', id: a.id, title: a.title })} aria-label={t('corporate.deleteNamed', { title: a.title })}>
                      <Trash2 size={12} />{t('common.delete')}
                    </Button>}
                  </div>}
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {a.content}
                  </p>
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    {fmtDate(a.publishAt)}
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                {t('common.noResults')}
              </p>
            )}
          </div>
        </section>
      </div>

      {goalOpen && <GoalDialog key={editingGoal?.id ?? 'new'} goal={editingGoal} open onClose={() => setGoalOpen(false)} />}
      {announcementOpen && <AnnouncementDialog
        key={editingAnnouncement?.id ?? 'new'}
        announcement={editingAnnouncement}
        open={announcementOpen}
        onClose={() => setAnnouncementOpen(false)}
      />}
      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.title ?? ''}>
        {viewing && ('content' in viewing
          ? <p className="whitespace-pre-wrap text-sm">{viewing.content}</p>
          : <div className="space-y-3 text-sm">
            <p>{viewing.year} · {t(`corporate.goalStatus.${viewing.status}`)}</p>
            <p className="whitespace-pre-wrap">{viewing.description}</p>
            <p>{t('corporate.target')}: {viewing.targetValue ?? '—'} {viewing.unit}</p>
            <p>{t('corporate.current')}: {viewing.currentValue ?? '—'} {viewing.unit}</p>
          </div>)}
      </Dialog>
      <Dialog open={deleting !== null} onClose={() => { if (!remove.isPending) setDeleting(null); }} title={t('common.delete')}>
        <p className="mb-4 break-all text-sm">{t('corporate.deleteConfirm', { title: deleting?.title })}</p>
        {remove.error && <p role="alert" className="mb-3 text-sm text-destructive">{remove.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting); }}>{t('common.delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
