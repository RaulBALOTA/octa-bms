import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Workflow as WorkflowIcon } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Button,
  Dialog,
  Field,
  Skeleton,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

interface WorkflowDefinition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  module: string;
  entityType: string;
  definition: unknown;
  version: number;
  isActive: boolean;
  _count: { instances: number };
}

const EXAMPLE = JSON.stringify(
  {
    steps: [
      {
        code: 'manager-approval',
        type: 'approval',
        assigneeRule: 'manager-of-initiator',
        onApprove: 'finance-approval',
        onReject: 'end',
      },
      {
        code: 'finance-approval',
        type: 'approval',
        assigneeRule: { role: 'FINANCE_MANAGER' },
        escalation: { afterHours: 48, to: 'MANAGING_DIRECTOR' },
      },
    ],
  },
  null,
  2,
);

function DefinitionDialog({
  open,
  onClose,
  definition,
}: {
  open: boolean;
  onClose: () => void;
  definition: WorkflowDefinition | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: definition?.code ?? '',
    name: definition?.name ?? '',
    module: definition?.module ?? '',
    entityType: definition?.entityType ?? '',
    json: definition ? JSON.stringify(definition.definition, null, 2) : EXAMPLE,
  });
  const [jsonError, setJsonError] = useState<string | null>(null);
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: (parsed: Record<string, unknown>) =>
      definition
        ? api.patch(`/workflow/definitions/${definition.id}`, {
            name: form.name,
            definition: parsed,
          })
        : api.post('/workflow/definitions', {
            code: form.code,
            name: form.name,
            module: form.module,
            entityType: form.entityType,
            definition: parsed,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
      toast(t('common.saved'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(form.json) as Record<string, unknown>;
      setJsonError(null);
      save.mutate(parsed);
    } catch {
      setJsonError(t('workflow.invalidJson'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={definition ? t('workflow.editDefinition') : t('workflow.newDefinition')}
      width="max-w-2xl"
    >
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required>
            <TextInput
              value={form.code}
              onChange={set('code')}
              placeholder="invoice-approval"
              required
              disabled={!!definition}
            />
          </Field>
          <Field label={t('crm.name')} required>
            <TextInput value={form.name} onChange={set('name')} required />
          </Field>
          <Field label={t('workflow.module')} required>
            <TextInput
              value={form.module}
              onChange={set('module')}
              placeholder="finance"
              required
              disabled={!!definition}
            />
          </Field>
          <Field label={t('workflow.entityType')} required>
            <TextInput
              value={form.entityType}
              onChange={set('entityType')}
              placeholder="invoice"
              required
              disabled={!!definition}
            />
          </Field>
        </div>
        <Field label={t('workflow.definitionJson')} required>
          <TextArea
            value={form.json}
            onChange={set('json')}
            rows={14}
            className="font-mono !text-xs"
            spellCheck={false}
            required
          />
        </Field>
        {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
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

export function WorkflowPage() {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);

  const { data: definitions, isLoading } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => api.get<WorkflowDefinition[]>('/workflow/definitions'),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('workflow.title')}</h1>
        <div className="flex-1" />
        <Link to="/approvals" className="text-sm text-primary hover:underline">
          {t('approvals.title')} →
        </Link>
        {hasPermission(me, 'workflow.definitions.create') && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={14} />
            {t('common.new')}
          </Button>
        )}
      </div>

      <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t('workflow.hint')}
      </p>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : definitions?.length ? (
        <ul className="space-y-2">
          {definitions.map((definition) => (
            <li
              key={definition.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <WorkflowIcon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {definition.name}
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    v{definition.version}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{definition.code}</span> · {definition.module}/
                  {definition.entityType} · {definition._count.instances}{' '}
                  {t('workflow.instances')}
                </div>
              </div>
              <RecordActions resource="workflows" id={definition.id} label={definition.name} actions={['view','delete']} />
              {hasPermission(me, 'workflow.definitions.update') && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(definition);
                    setDialogOpen(true);
                  }}
                  aria-label={t('data.editNamed', { name: definition.name })}
                >
                  <Pencil size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      {dialogOpen && (
        <DefinitionDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          definition={editing}
        />
      )}
    </div>
  );
}
