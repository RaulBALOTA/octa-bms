import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Inbox, Palmtree, Wallet, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { SubNav } from '../components/SubNav';
import { Button, Skeleton, useToast } from '../components/ui';

interface ApprovalItem {
  kind: 'LEAVE' | 'INVOICE' | 'CONTRACT';
  id: string;
  title: string;
  subtitle: string;
  amount?: string | null;
  requestedAt: string;
}

const KIND_ICON = { LEAVE: Palmtree, INVOICE: Wallet, CONTRACT: FileText };

export function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<{ items: ApprovalItem[]; count: number }>('/workflow/tasks/my'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    void queryClient.invalidateQueries({ queryKey: ['kpis'] });
  };

  const decide = useMutation({
    mutationFn: ({ item, approve }: { item: ApprovalItem; approve: boolean }) => {
      switch (item.kind) {
        case 'LEAVE':
          return api.post(`/hr/leave-requests/${item.id}/decide`, {
            decision: approve ? 'APPROVED' : 'REJECTED',
          });
        case 'INVOICE':
          return api.post(`/finance/invoices/${item.id}/transition`, {
            status: approve ? 'APPROVED' : 'DRAFT',
          });
        case 'CONTRACT':
          return api.post(`/contracts/${item.id}/transition`, {
            status: approve ? 'ACTIVE' : 'IN_REVIEW',
          });
      }
    },
    onSuccess: () => {
      refresh();
      toast(t('common.saved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(iso),
    );

  return (
    <div className="mx-auto max-w-3xl">
      <SubNav
        items={[
          { label: t('dashboard.title'), to: '/' },
          { label: t('approvals.title'), to: '/approvals', badge: data?.count },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">
        {t('approvals.title')}
        {data && data.count > 0 && (
          <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">
            {data.count}
          </span>
        )}
      </h1>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : data?.items.length ? (
        <ul className="space-y-2">
          {data.items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {item.title}
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {t(`approvals.kind.${item.kind}`)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.subtitle}
                    {item.amount && ` · ${item.amount}`} · {fmtDate(item.requestedAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ item, approve: false })}
                >
                  <X size={13} className="text-destructive" />
                  {t('approvals.reject')}
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ item, approve: true })}
                >
                  <Check size={13} />
                  {t('approvals.approve')}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-border bg-card py-16 text-center">
          <Inbox size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">{t('approvals.empty')}</p>
          <p className="text-xs text-muted-foreground">{t('approvals.emptyHint')}</p>
        </div>
      )}
    </div>
  );
}
