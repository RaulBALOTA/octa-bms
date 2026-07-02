import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Plus, RotateCcw, UserCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
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
  TextInput,
  useToast,
} from '../components/ui';

interface Asset {
  id: string;
  assetNumber: string;
  name: string;
  status: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  location: string | null;
  category?: { id: string; name: string } | null;
  assignments?: {
    id: string;
    assignedAt?: string;
    returnedAt?: string | null;
    employee: { id: string; firstName: string; lastName: string };
  }[];
}

const STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED'] as const;

function AssetDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState('');

  const { data: asset } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => api.get<Asset>(`/assets/${id}`),
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-for-select'],
    queryFn: () =>
      api.get<Paged<{ id: string; firstName: string; lastName: string }>>(
        '/hr/employees?pageSize=200',
      ),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['asset', id] });
    void queryClient.invalidateQueries({ queryKey: ['/assets'] });
  };

  const assign = useMutation({
    mutationFn: () => api.post(`/assets/${id}/assign`, { employeeId: assignee }),
    onSuccess: () => {
      refresh();
      setAssignee('');
      toast(t('assets.assigned'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const returnAsset = useMutation({
    mutationFn: () => api.post(`/assets/${id}/return`),
    onSuccess: () => {
      refresh();
      toast(t('assets.returned'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat(i18n.language).format(new Date(iso)) : '—';

  const currentHolder = asset?.assignments?.find((a) => !a.returnedAt);

  return (
    <Drawer open onClose={onClose}>
      {!asset ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Monitor size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">{asset.name}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{asset.assetNumber}</span>
                  <StatusBadge value={asset.status} />
                </div>
              </div>
            </div>
            <div className="mt-3">
              {asset.status === 'ASSIGNED' ? (
                <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
                  <span className="flex items-center gap-2 text-sm">
                    <Avatar
                      name={`${currentHolder?.employee.firstName} ${currentHolder?.employee.lastName}`}
                      size={24}
                    />
                    {currentHolder?.employee.firstName} {currentHolder?.employee.lastName}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={returnAsset.isPending}
                    onClick={() => returnAsset.mutate()}
                  >
                    <RotateCcw size={13} />
                    {t('assets.return')}
                  </Button>
                </div>
              ) : asset.status === 'IN_STOCK' ? (
                <div className="flex gap-2">
                  <SelectInput
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">{t('assets.selectEmployee')}</option>
                    {employees?.data.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.lastName}, {emp.firstName}
                      </option>
                    ))}
                  </SelectInput>
                  <Button
                    size="sm"
                    disabled={!assignee || assign.isPending}
                    onClick={() => assign.mutate()}
                  >
                    <UserCheck size={13} />
                    {t('assets.assign')}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <KeyValue label={t('assets.category')}>{asset.category?.name}</KeyValue>
              <KeyValue label={t('assets.serial')}>{asset.serialNumber}</KeyValue>
              <KeyValue label={t('assets.manufacturer')}>
                {asset.manufacturer}
              </KeyValue>
              <KeyValue label={t('assets.model')}>{asset.model}</KeyValue>
              <KeyValue label={t('assets.purchased')}>
                {fmtDate(asset.purchaseDate)}
              </KeyValue>
              <KeyValue label={t('assets.warranty')}>
                {fmtDate(asset.warrantyUntil)}
              </KeyValue>
            </dl>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('assets.history')}
              </h3>
              {asset.assignments?.length ? (
                <ul className="space-y-1.5">
                  {asset.assignments.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span>
                        {assignment.employee.firstName} {assignment.employee.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(assignment.assignedAt)} →{' '}
                        {assignment.returnedAt
                          ? fmtDate(assignment.returnedAt)
                          : t('assets.current')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

function NewAssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    serialNumber: '',
    manufacturer: '',
    purchaseDate: '',
  });

  const { data: categories } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/master/asset-categories'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/assets', {
        name: form.name,
        categoryId: form.categoryId,
        serialNumber: form.serialNumber || undefined,
        manufacturer: form.manufacturer || undefined,
        purchaseDate: form.purchaseDate || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/assets'] });
      toast(t('common.created'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('assets.newAsset')}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('crm.name')} required>
          <TextInput
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('assets.category')} required>
            <SelectInput
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="">—</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t('assets.serial')}>
            <TextInput
              value={form.serialNumber}
              onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
            />
          </Field>
          <Field label={t('assets.manufacturer')}>
            <TextInput
              value={form.manufacturer}
              onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
            />
          </Field>
          <Field label={t('assets.purchased')}>
            <TextInput
              type="date"
              value={form.purchaseDate}
              onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !form.name.trim() || !form.categoryId}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AssetsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns: Column<Asset>[] = [
    {
      header: t('crm.number'),
      render: (a) => <span className="font-mono text-xs">{a.assetNumber}</span>,
    },
    { header: t('crm.name'), render: (a) => <span className="font-medium">{a.name}</span> },
    { header: t('assets.category'), render: (a) => a.category?.name ?? '—' },
    { header: t('assets.serial'), render: (a) => a.serialNumber ?? '—' },
    {
      header: t('assets.holder'),
      render: (a) => {
        const holder = a.assignments?.[0]?.employee;
        return holder ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={`${holder.firstName} ${holder.lastName}`} size={20} />
            {holder.firstName} {holder.lastName}
          </span>
        ) : (
          '—'
        );
      },
    },
    { header: t('common.status'), render: (a) => <StatusBadge value={a.status} /> },
  ];

  return (
    <>
      <ListPage<Asset>
        title={t('assets.title')}
        endpoint="/assets"
        columns={columns}
        extraQuery={status ? `status=${status}` : ''}
        onRowClick={(a) => setSelectedId(a.id)}
        filters={
          <SelectInput
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="!w-auto"
          >
            <option value="">{t('common.status')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`assets.status.${s}`)}
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
      {selectedId && <AssetDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
      <NewAssetDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
