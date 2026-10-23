import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Calendar,
  Globe,
  Mail,
  MapPin,
  Phone,
  Plus,
  Star,
  User,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { AiSummary } from '../components/ai';
import { RecordActions, RecordCreateButton } from '../components/RecordActions';
import { Column, ListPage, StatusBadge } from '../components/ListPage';
import {
  Avatar,
  Button,
  Dialog,
  Drawer,
  Field,
  KeyValue,
  SelectInput,
  Skeleton,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';

interface Partner {
  id: string;
  partnerNumber: string;
  name: string;
  type: string;
  status: string;
  city: string | null;
  street: string | null;
  postalCode: string | null;
  segment: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  vatId: string | null;
  notes: string | null;
  accountManager?: { firstName: string; lastName: string } | null;
  _count?: { contacts: number; opportunities: number };
}

interface Contact {
  id: string;
  salutation: string | null;
  firstName: string;
  lastName: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
}

interface Activity {
  id: string;
  type: string;
  subject: string;
  description: string | null;
  activityDate: string;
  owner?: { firstName: string; lastName: string } | null;
}

interface PartnerDetail extends Partner {
  contacts: Contact[];
  crmActivities: Activity[];
}

const TYPES = ['CLIENT', 'SUPPLIER', 'PARTNER', 'AUTHORITY'] as const;
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'VISIT', 'NOTE'] as const;

const ACTIVITY_ICON: Record<string, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Calendar,
  VISIT: MapPin,
  NOTE: User,
  TASK: User,
};

/* ------------------------------------------------------ detail drawer */

function PartnerDrawer({
  partnerId,
  onClose,
}: {
  partnerId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');

  const { data: partner } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => api.get<PartnerDetail>(`/crm/partners/${partnerId}`),
  });

  const [activityType, setActivityType] = useState('CALL');
  const [activitySubject, setActivitySubject] = useState('');
  const [activityNote, setActivityNote] = useState('');

  const logActivity = useMutation({
    mutationFn: () =>
      api.post(`/crm/partners/${partnerId}/activities`, {
        type: activityType,
        subject: activitySubject,
        description: activityNote || undefined,
      }),
    onSuccess: () => {
      setActivitySubject('');
      setActivityNote('');
      void queryClient.invalidateQueries({ queryKey: ['partner', partnerId] });
      toast(t('crm.activityLogged'));
    },
    onError: () => toast(t('common.error'), 'error'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
    }).format(new Date(iso));

  return (
    <Drawer open onClose={onClose}>
      {!partner ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Building2 size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold">{partner.name}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{partner.partnerNumber}</span>
                  <StatusBadge value={partner.status} />
                  {partner.segment && (
                    <span className="flex items-center gap-0.5">
                      <Star size={11} className="text-warning" />
                      {t('crm.segment')} {partner.segment}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <AiSummary entityType="partner" entityId={partnerId} />
          </div>

          <Tabs
            tabs={[
              { key: 'overview', label: t('crm.overview') },
              {
                key: 'contacts',
                label: t('crm.contacts'),
                badge: partner.contacts.length,
              },
              {
                key: 'activities',
                label: t('crm.activities'),
                badge: partner.crmActivities.length,
              },
            ]}
            active={tab}
            onChange={setTab}
          />

          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'overview' && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                <KeyValue label={t('crm.type')}>{partner.type}</KeyValue>
                <KeyValue label="USt-IdNr.">{partner.vatId}</KeyValue>
                <KeyValue label={t('crm.address')}>
                  {[partner.street, `${partner.postalCode ?? ''} ${partner.city ?? ''}`.trim()]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </KeyValue>
                <KeyValue label={t('crm.accountManager')}>
                  {partner.accountManager
                    ? `${partner.accountManager.firstName} ${partner.accountManager.lastName}`
                    : '—'}
                </KeyValue>
                <KeyValue label={t('auth.email')}>
                  {partner.email ? (
                    <a href={`mailto:${partner.email}`} className="text-primary hover:underline">
                      {partner.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </KeyValue>
                <KeyValue label={t('crm.phone')}>{partner.phone}</KeyValue>
                <KeyValue label="Website">
                  {partner.website ? (
                    <a
                      href={partner.website}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      <Globe size={12} />
                      {partner.website.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    '—'
                  )}
                </KeyValue>
                <KeyValue label={t('crm.notes')}>{partner.notes}</KeyValue>
              </dl>
            )}

            {tab === 'contacts' && <div className="mb-3 flex justify-end"><RecordCreateButton resource="contacts" defaults={{ partnerId }} /></div>}
            {tab === 'contacts' &&
              (partner.contacts.length ? (
                <ul className="space-y-2">
                  {partner.contacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <Avatar
                        name={`${contact.firstName} ${contact.lastName}`}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {contact.salutation} {contact.firstName} {contact.lastName}
                          {contact.isPrimary && (
                            <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              {t('crm.primary')}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[contact.position, contact.email, contact.phone ?? contact.mobile]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <RecordActions resource="contacts" id={contact.id} label={`${contact.firstName} ${contact.lastName}`} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('common.noResults')}
                </p>
              ))}

            {tab === 'activities' && (
              <div className="space-y-4">
                <form
                  className="rounded-lg border border-border p-3"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    if (activitySubject.trim()) logActivity.mutate();
                  }}
                >
                  <div className="mb-2 flex gap-2">
                    <SelectInput
                      value={activityType}
                      onChange={(e) => setActivityType(e.target.value)}
                      className="!w-32"
                    >
                      {ACTIVITY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`crm.activityType.${type}`)}
                        </option>
                      ))}
                    </SelectInput>
                    <TextInput
                      value={activitySubject}
                      onChange={(e) => setActivitySubject(e.target.value)}
                      placeholder={t('crm.activitySubject')}
                      required
                    />
                  </div>
                  <TextArea
                    value={activityNote}
                    onChange={(e) => setActivityNote(e.target.value)}
                    placeholder={t('crm.notes')}
                    rows={2}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" type="submit" disabled={logActivity.isPending}>
                      <Plus size={13} />
                      {t('crm.logActivity')}
                    </Button>
                  </div>
                </form>

                <ol className="relative space-y-4 border-l border-border pl-5">
                  {partner.crmActivities.map((activity) => {
                    const Icon = ACTIVITY_ICON[activity.type] ?? User;
                    return (
                      <li key={activity.id} className="relative">
                        <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-accent text-primary ring-4 ring-card">
                          <Icon size={9} />
                        </span>
                        <div className="text-sm font-medium">{activity.subject}</div>
                        <RecordActions resource="activities" id={activity.id} label={activity.subject} />
                        <div className="text-xs text-muted-foreground">
                          {t(`crm.activityType.${activity.type}`)} ·{' '}
                          {fmtDate(activity.activityDate)}
                          {activity.owner &&
                            ` · ${activity.owner.firstName} ${activity.owner.lastName}`}
                        </div>
                        {activity.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {activity.description}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------ create dialog */

function NewPartnerDialog({
  open,
  onClose,
  defaultType,
}: {
  open: boolean;
  onClose: () => void;
  defaultType: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    type: defaultType || 'CLIENT',
    name: '',
    city: '',
    email: '',
    phone: '',
    segment: '',
    vatId: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post<Partner>('/crm/partners', {
        type: form.type,
        name: form.name,
        city: form.city || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        segment: form.segment || undefined,
        vatId: form.vatId || undefined,
        countryCode: 'DE',
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['/crm/partners'] });
      toast(`${created.partnerNumber} · ${created.name} ${t('common.created')}`);
      onClose();
    },
    onError: () => toast(t('common.error'), 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('crm.newPartner')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.type')} required>
            <SelectInput value={form.type} onChange={set('type')}>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`crm.partnerType.${type}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('crm.segment')}>
            <SelectInput value={form.segment} onChange={set('segment')}>
              <option value="">—</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </SelectInput>
          </Field>
        </div>
        <Field label={t('crm.name')} required>
          <TextInput value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.city')}>
            <TextInput value={form.city} onChange={set('city')} />
          </Field>
          <Field label="USt-IdNr.">
            <TextInput value={form.vatId} onChange={set('vatId')} placeholder="DE…" />
          </Field>
          <Field label={t('auth.email')}>
            <TextInput type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label={t('crm.phone')}>
            <TextInput value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !form.name.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* --------------------------------------------------------------- page */

export function PartnersPage() {
  const { t } = useTranslation();
  const [type, setType] = useState('CLIENT');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns: Column<Partner>[] = [
    {
      header: t('crm.number'),
      render: (p) => <span className="font-mono text-xs">{p.partnerNumber}</span>,
    },
    {
      header: t('crm.name'),
      render: (p) => (
        <span className="flex items-center gap-2 font-medium">
          <Avatar name={p.name} size={22} />
          {p.name}
        </span>
      ),
    },
    { header: t('crm.city'), render: (p) => p.city ?? '—' },
    { header: t('crm.segment'), render: (p) => p.segment ?? '—' },
    {
      header: t('crm.contacts'),
      render: (p) => p._count?.contacts ?? 0,
      align: 'right',
    },
    { header: t('common.status'), render: (p) => <StatusBadge value={p.status} /> },
  ];

  return (
    <>
      <ListPage<Partner>
        title={t('crm.title')}
        endpoint="/crm/partners"
        columns={columns}
        extraQuery={type ? `type=${type}` : ''}
        onRowClick={(p) => setSelectedId(p.id)}
        filters={
          <SelectInput
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="!w-auto"
          >
            <option value="">{t('crm.allTypes')}</option>
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`crm.partnerType.${v}`)}
              </option>
            ))}
          </SelectInput>
        }
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            {t('common.new')}
          </Button>
        }
      />
      {selectedId && (
        <PartnerDrawer partnerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <NewPartnerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultType={type}
      />
    </>
  );
}
