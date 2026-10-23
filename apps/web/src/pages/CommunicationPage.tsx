import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ClipboardList,
  Lock,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Send,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api, Paged } from '../lib/api';
import { AiSummary } from '../components/ai';
import { StatusBadge } from '../components/ListPage';
import {
  Avatar,
  Button,
  Dialog,
  Drawer,
  Field,
  SelectInput,
  Skeleton,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

/* ------------------------------------------------------------- messages */

interface Conversation {
  user: { id: string; firstName: string; lastName: string };
  lastMessage: string;
  lastAt: string;
  unread: number;
}

interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
}

interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  userId: string | null;
}

function MessagesTab() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/communication/messages'),
    refetchInterval: 30_000,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-for-select'],
    queryFn: () => api.get<Paged<EmployeeRef>>('/hr/employees?pageSize=200'),
  });

  const { data: thread } = useQuery({
    queryKey: ['thread', activeUserId],
    queryFn: () => api.get<DirectMessage[]>(`/communication/messages/${activeUserId}`),
    enabled: activeUserId !== null,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.length]);

  const send = useMutation({
    mutationFn: () =>
      api.post('/communication/messages', { recipientId: activeUserId, body: draft }),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['thread', activeUserId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  // recipients: colleagues with a linked user account, excluding me
  const recipients = (employees?.data ?? []).filter(
    (employee) => employee.userId && employee.userId !== me?.id,
  );
  const conversationUserIds = new Set((conversations ?? []).map((c) => c.user.id));

  return (
    <div className="grid h-[calc(100vh-16rem)] grid-cols-[260px_1fr] gap-4">
      {/* conversation list */}
      <div className="overflow-y-auto rounded-xl border border-border bg-card p-2">
        {(conversations ?? []).map((conversation) => (
          <button
            key={conversation.user.id}
            onClick={() => setActiveUserId(conversation.user.id)}
            className={clsx(
              'mb-1 flex w-full items-center gap-2.5 rounded-lg p-2 text-left',
              activeUserId === conversation.user.id ? 'bg-accent' : 'hover:bg-muted',
            )}
          >
            <Avatar
              name={`${conversation.user.firstName} ${conversation.user.lastName}`}
              size={30}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {conversation.user.firstName} {conversation.user.lastName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {conversation.lastMessage}
              </span>
            </span>
            {conversation.unread > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                {conversation.unread}
              </span>
            )}
          </button>
        ))}

        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('comm.startConversation')}
          </p>
          {recipients
            .filter((employee) => !conversationUserIds.has(employee.userId!))
            .map((employee) => (
              <button
                key={employee.id}
                onClick={() => setActiveUserId(employee.userId!)}
                className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-muted"
              >
                <Avatar name={`${employee.firstName} ${employee.lastName}`} size={26} />
                <span className="truncate text-sm">
                  {employee.firstName} {employee.lastName}
                </span>
              </button>
            ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex flex-col rounded-xl border border-border bg-card">
        {activeUserId === null ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <MessageSquare size={28} className="mb-2" />
            {t('comm.pickConversation')}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {(thread ?? []).map((message) => {
                const mine = message.senderId === me?.id;
                return (
                  <div
                    key={message.id}
                    className={clsx('flex', mine ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={clsx(
                        'max-w-[70%] rounded-2xl px-3.5 py-2 text-sm',
                        mine
                          ? 'rounded-br-sm bg-primary text-primary-foreground'
                          : 'rounded-bl-sm bg-muted',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{message.body}</p>
                      <p
                        className={clsx(
                          'mt-0.5 text-[10px]',
                          mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
                        )}
                      >
                        {fmtTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (draft.trim()) send.mutate();
              }}
            >
              <TextInput
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('comm.messagePlaceholder')}
                className="flex-1"
              />
              <Button type="submit" disabled={send.isPending || !draft.trim()}>
                <Send size={14} />
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- meetings */

interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  location: string | null;
  participants: string[];
  content: string;
  status: string;
}

interface ActionItem {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assignee: { id: string; firstName: string; lastName: string };
}

function MeetingDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [itemTitle, setItemTitle] = useState('');
  const [itemAssignee, setItemAssignee] = useState('');
  const [itemDue, setItemDue] = useState('');

  const { data: meeting } = useQuery({
    queryKey: ['meeting', id],
    queryFn: () => api.get<Meeting & { actionItems: ActionItem[] }>(
      `/communication/meetings/${id}`,
    ),
  });
  const { data: employees } = useQuery({
    queryKey: ['employees-for-select'],
    queryFn: () => api.get<Paged<EmployeeRef>>('/hr/employees?pageSize=200'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['meeting', id] });
    void queryClient.invalidateQueries({ queryKey: ['meetings'] });
  };
  const onError = (err: Error) => toast(err.message, 'error');

  const addItem = useMutation({
    mutationFn: () =>
      api.post(`/communication/meetings/${id}/action-items`, {
        title: itemTitle,
        assigneeId: itemAssignee,
        dueDate: itemDue || undefined,
      }),
    onSuccess: () => {
      setItemTitle('');
      setItemDue('');
      refresh();
    },
    onError,
  });
  const toggleItem = useMutation({
    mutationFn: (taskId: string) =>
      api.patch(`/communication/meetings/action-items/${taskId}/toggle`),
    onSuccess: refresh,
    onError,
  });
  const finalize = useMutation({
    mutationFn: () => api.post(`/communication/meetings/${id}/finalize`),
    onSuccess: () => {
      refresh();
      toast(t('comm.finalized'));
    },
    onError,
  });

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const assignableUsers = (employees?.data ?? []).filter((e) => e.userId);

  return (
    <Drawer open onClose={onClose} width="w-[640px]">
      {!meeting ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <ClipboardList size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-snug">{meeting.title}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {fmtDate(meeting.meetingDate)}
                  {meeting.location && ` · ${meeting.location}`}
                  <StatusBadge value={meeting.status} />
                </div>
              </div>
              {meeting.status === 'DRAFT' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={finalize.isPending}
                  onClick={() => finalize.mutate()}
                >
                  <Lock size={13} />
                  {t('comm.finalize')}
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meeting.participants.map((participant) => (
                <span
                  key={participant}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px]"
                >
                  {participant}
                </span>
              ))}
            </div>
            <AiSummary entityType="meeting" entityId={id} />
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('comm.notes')}
              </h3>
              <div className="whitespace-pre-wrap rounded-lg border border-border p-3 text-sm leading-relaxed">
                {meeting.content}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('comm.actionItems')} (
                {meeting.actionItems.filter((item) => item.status !== 'DONE').length}{' '}
                {t('comm.open')})
              </h3>
              <form
                className="mb-2 grid grid-cols-12 gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (itemTitle && itemAssignee) addItem.mutate();
                }}
              >
                <TextInput
                  className="col-span-5"
                  placeholder={t('comm.actionPlaceholder')}
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  required
                />
                <SelectInput
                  className="col-span-4"
                  value={itemAssignee}
                  onChange={(e) => setItemAssignee(e.target.value)}
                  required
                >
                  <option value="">{t('assets.selectEmployee')}</option>
                  {assignableUsers.map((employee) => (
                    <option key={employee.id} value={employee.userId!}>
                      {employee.lastName}, {employee.firstName}
                    </option>
                  ))}
                </SelectInput>
                <TextInput
                  className="col-span-2"
                  type="date"
                  value={itemDue}
                  onChange={(e) => setItemDue(e.target.value)}
                />
                <Button
                  className="col-span-1"
                  size="sm"
                  type="submit"
                  disabled={addItem.isPending || !itemTitle || !itemAssignee}
                >
                  <Plus size={13} />
                </Button>
              </form>
              <ul className="space-y-1.5">
                {meeting.actionItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={item.status === 'DONE'}
                      onChange={() => toggleItem.mutate(item.id)}
                      className="accent-[hsl(var(--primary))]"
                    />
                    <span
                      className={clsx(
                        'min-w-0 flex-1',
                        item.status === 'DONE' && 'line-through opacity-60',
                      )}
                    >
                      {item.title}
                    </span>
                    <Avatar
                      name={`${item.assignee.firstName} ${item.assignee.lastName}`}
                      size={20}
                    />
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(item.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

function MeetingsTab() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    meetingDate: new Date().toISOString().slice(0, 10),
    location: '',
    participants: '',
    content: '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: () => api.get<Paged<Meeting>>('/communication/meetings?pageSize=50'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Meeting>('/communication/meetings', {
        title: form.title,
        meetingDate: form.meetingDate,
        location: form.location || undefined,
        participants: form.participants
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
        content: form.content,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['meetings'] });
      toast(t('common.created'));
      setCreateOpen(false);
      setSelectedId(created.id);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language).format(new Date(iso));

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          {t('comm.newMeeting')}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : meetings?.data.length ? (
        <ul className="space-y-2">
          {meetings.data.map((meeting) => (
            <li key={meeting.id}>
              <button
                onClick={() => setSelectedId(meeting.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <ClipboardList size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{meeting.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(meeting.meetingDate)}
                    {meeting.location && ` · ${meeting.location}`} ·{' '}
                    {meeting.participants.length} {t('comm.participants')}
                  </span>
                </span>
                <StatusBadge value={meeting.status} />
              </button>
              <RecordActions resource="meetings" id={meeting.id} label={meeting.title} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      {selectedId && <MeetingDrawer id={selectedId} onClose={() => setSelectedId(null)} />}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('comm.newMeeting')}
        width="max-w-2xl"
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('contracts.contractTitle')} required className="col-span-2">
              <TextInput value={form.title} onChange={set('title')} required autoFocus />
            </Field>
            <Field label={t('finance.invoiceDate')} required>
              <TextInput
                type="date"
                value={form.meetingDate}
                onChange={set('meetingDate')}
                required
              />
            </Field>
            <Field label={t('comm.location')} className="col-span-1">
              <TextInput value={form.location} onChange={set('location')} />
            </Field>
            <Field label={t('comm.participantsHint')} className="col-span-2">
              <TextInput
                value={form.participants}
                onChange={set('participants')}
                placeholder="Max Direktor, Maria Kraus, Hr. Weber (Bayer)"
              />
            </Field>
          </div>
          <Field label={t('comm.notes')} required>
            <TextArea value={form.content} onChange={set('content')} rows={8} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
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
    </>
  );
}

/* ------------------------------------------------------------- templates */

interface EmailTemplate {
  id: string;
  code: string;
  name: string;
  subjectDe: string;
  subjectEn: string;
  bodyDe: string;
  bodyEn: string;
}

function TemplateDialog({
  open,
  onClose,
  template,
}: {
  open: boolean;
  onClose: () => void;
  template: EmailTemplate | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: template?.code ?? '',
    name: template?.name ?? '',
    subjectDe: template?.subjectDe ?? '',
    subjectEn: template?.subjectEn ?? '',
    bodyDe: template?.bodyDe ?? '',
    bodyEn: template?.bodyEn ?? '',
  });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      template
        ? api.patch(`/communication/email-templates/${template.id}`, form)
        : api.post('/communication/email-templates', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast(t('common.saved'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={template ? t('communication.editTemplate') : t('communication.newTemplate')}
      width="max-w-2xl"
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required>
            <TextInput value={form.code} onChange={set('code')} required disabled={!!template} />
          </Field>
          <Field label={t('crm.name')} required>
            <TextInput value={form.name} onChange={set('name')} required />
          </Field>
          <Field label={`${t('communication.subject')} (DE)`} required>
            <TextInput value={form.subjectDe} onChange={set('subjectDe')} required />
          </Field>
          <Field label={`${t('communication.subject')} (EN)`} required>
            <TextInput value={form.subjectEn} onChange={set('subjectEn')} required />
          </Field>
        </div>
        <Field label={`${t('communication.body')} (DE)`} required>
          <TextArea value={form.bodyDe} onChange={set('bodyDe')} rows={5} required />
        </Field>
        <Field label={`${t('communication.body')} (EN)`} required>
          <TextArea value={form.bodyEn} onChange={set('bodyEn')} rows={5} required />
        </Field>
        <p className="text-xs text-muted-foreground">{t('communication.placeholderHint')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SendTemplateDialog({
  template,
  onClose,
}: {
  template: EmailTemplate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState({ to: '', partnerId: '', name: '', company: '' });
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const { data: partners } = useQuery({
    queryKey: ['partners-for-mail'],
    queryFn: () =>
      api.get<Paged<{ id: string; name: string }>>('/crm/partners?pageSize=200&sort=name'),
  });

  const send = useMutation({
    mutationFn: () =>
      api.post(`/communication/email-templates/${template.id}/send`, {
        to: form.to,
        partnerId: form.partnerId || undefined,
        variables: { name: form.name, company: form.company },
      }),
    onSuccess: () => {
      toast(t('comm.mailSent'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open onClose={onClose} title={`${t('comm.sendMail')}: ${template.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label={t('comm.recipient')} required>
          <TextInput type="email" value={form.to} onChange={set('to')} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="{name}">
            <TextInput value={form.name} onChange={set('name')} />
          </Field>
          <Field label="{company}">
            <TextInput value={form.company} onChange={set('company')} />
          </Field>
        </div>
        <Field label={t('comm.logToPartner')}>
          <SelectInput value={form.partnerId} onChange={set('partnerId')}>
            <option value="">—</option>
            {partners?.data.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <p className="text-xs text-muted-foreground">{t('comm.sendHint')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={send.isPending || !form.to.includes('@')}>
            <Send size={13} />
            {t('comm.sendMail')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TemplatesTab() {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [sending, setSending] = useState<EmailTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => api.get<EmailTemplate[]>('/communication/email-templates'),
    enabled: hasPermission(me, 'admin.settings.read'),
  });

  if (!hasPermission(me, 'admin.settings.read')) {
    return (
      <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
        {t('comm.templatesAdminOnly')}
      </p>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus size={14} />
          {t('common.new')}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : templates?.length ? (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Mail size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{template.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{template.code}</span> ·{' '}
                  {i18n.language === 'de' ? template.subjectDe : template.subjectEn}
                </div>
              </div>
              <RecordActions resource="templates" id={template.id} label={template.name} actions={['view','delete']} />
              {hasPermission(me, 'communication.mail.create') && (
                <Button size="sm" onClick={() => setSending(template)}>
                  <Send size={13} />
                  {t('comm.sendMail')}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(template);
                  setEditorOpen(true);
                }}
                aria-label={t('data.editNamed', { name: template.name })}
              >
                <Pencil size={13} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      {editorOpen && (
        <TemplateDialog
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          template={editing}
        />
      )}
      {sending && <SendTemplateDialog template={sending} onClose={() => setSending(null)} />}
    </>
  );
}

/* ------------------------------------------------------------- activity */

interface ActivityEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  createdAt: string;
}

function ActivityTab() {
  const { i18n } = useTranslation();
  const { data: activity } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: () => api.get<ActivityEntry[]>('/communication/activity?limit=100'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  const ACTION_TONE: Record<string, string> = {
    CREATE: 'text-success',
    UPDATE: 'text-primary',
    DELETE: 'text-destructive',
  };

  return (
    <ul className="space-y-1">
      {(activity ?? []).map((entry) => (
        <li
          key={entry.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <Avatar name={entry.actor} size={24} />
          <span className="min-w-0 flex-1 truncate">
            <strong>{entry.actor}</strong>{' '}
            <span className={clsx('font-medium', ACTION_TONE[entry.action])}>
              {entry.action.toLowerCase()}
            </span>{' '}
            <span className="text-muted-foreground">{entry.entityType}</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Activity size={11} />
            {fmtDate(entry.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- page */

export function CommunicationPage() {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const [tab, setTab] = useState('messages');

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/communication/messages'),
    refetchInterval: 30_000,
  });
  const unread = (conversations ?? []).reduce((sum, c) => sum + c.unread, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-3 text-lg font-bold">{t('nav.communication')}</h1>
      <Tabs
        tabs={[
          { key: 'messages', label: t('comm.messages'), badge: unread },
          { key: 'meetings', label: t('comm.meetings') },
          { key: 'templates', label: t('communication.templates') },
          ...(hasPermission(me, 'admin.audit.read')
            ? [{ key: 'activity', label: t('communication.activityFeed') }]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === 'messages' && <MessagesTab />}
        {tab === 'meetings' && <MeetingsTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}
