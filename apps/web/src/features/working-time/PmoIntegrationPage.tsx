import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, CircleSlash, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { hasPermission, useAuthStore } from '../../stores/auth';
import { StatPill, TimeNav, useInvalidateTime, useTimeKey } from './shared';
import type { PmoStatus } from './types';

interface SyncResult { created: number; updated: number; removed: number; truncated?: boolean }

export function PmoIntegrationPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const me = useAuthStore((s) => s.me);
  const key = useTimeKey();
  const invalidate = useInvalidateTime();
  const status = useQuery({ queryKey: key('pmo'), queryFn: () => api.get<PmoStatus>('/time/integration/pmo') });
  const sync = useMutation({
    mutationFn: () => api.post<SyncResult>('/time/integration/pmo/sync'),
    onSuccess: (result) => {
      void invalidate();
      toast(t('time.pmo.syncDone', { created: result.created, updated: result.updated, removed: result.removed }));
      if (result.truncated) toast(t('time.pmo.truncated'), 'error');
    },
    onError: (err: Error) => { void invalidate(); toast(err.message, 'error'); },
  });
  const fmt = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  const data = status.data;
  const lastUnmatched = data?.runs.find((r) => r.status === 'SUCCEEDED' && r.trigger !== 'PUSH')?.unmatched ?? [];

  return (
    <div>
      <TimeNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('time.pmo.title')}</h1>
        {hasPermission(me, 'time.integration.create') && (
          <Button onClick={() => sync.mutate()} disabled={!data?.configured || sync.isPending}>
            <RefreshCw size={14} className={clsx(sync.isPending && 'animate-spin')} />{t('time.pmo.syncNow')}
          </Button>
        )}
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t('time.pmo.intro')}</p>
      {status.isLoading && <Skeleton className="h-40" />}
      {data && (
        <div className="space-y-5">
          <div className={clsx('flex items-start gap-3 rounded-lg border p-4 text-sm', data.configured ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/10')}>
            {data.configured ? <CheckCircle2 size={18} className="text-success" /> : <CircleSlash size={18} className="text-warning" />}
            <div>
              <div className="font-medium">{data.configured ? t('time.pmo.configured', { url: data.baseUrl }) : t('time.pmo.notConfigured')}</div>
              {data.configured && (
                <div className="mt-0.5 text-muted-foreground">
                  {t('time.pmo.window', { days: data.windowDays })} · {data.scheduled ? t('time.pmo.scheduled') : t('time.pmo.manualOnly')}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill label={t('time.pmo.mirrored')} value={String(data.mirroredEntries)} />
            <StatPill label={t('time.pmo.projects')} value={String(data.projects)} />
            <StatPill label={t('time.pmo.unmatched')} value={String(lastUnmatched.length)} tone={lastUnmatched.length ? 'bad' : 'default'} />
          </div>

          {lastUnmatched.length > 0 && (
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold">{t('time.pmo.unmatched')}</h2>
                <p className="text-xs text-muted-foreground">{t('time.pmo.unmatchedHint')}</p>
              </header>
              <ul className="divide-y divide-border/60 text-sm">
                {lastUnmatched.map((u) => (
                  <li key={`${u.email}-${u.resourceName}`} className="flex justify-between px-4 py-2">
                    <span>{u.resourceName ?? '—'} <span className="text-muted-foreground">{u.email ?? ''}</span></span>
                    <span className="tabular-nums text-muted-foreground">{u.entries} × · {u.hours} h</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t('time.pmo.runs')}</header>
            {data.runs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('time.pmo.noRuns')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('time.pmo.started')}</th>
                      <th className="px-4 py-2 font-medium">{t('time.pmo.trigger')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.status')}</th>
                      {(['fetched', 'created', 'updated', 'removed', 'skipped'] as const).map((k) => <th key={k} className="px-3 py-2 text-right font-medium">{t(`time.pmo.${k}`)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id} className="border-t border-border/60 align-top">
                        <td className="whitespace-nowrap px-4 py-2">{fmt(r.startedAt)}</td>
                        <td className="px-4 py-2">{r.trigger}</td>
                        <td className="px-4 py-2">
                          <span className={clsx('font-medium', r.status === 'FAILED' ? 'text-destructive' : r.status === 'SUCCEEDED' ? 'text-success' : 'text-warning')}>{r.status}</span>
                          {r.error && <div className="max-w-md text-xs text-destructive">{r.error}</div>}
                        </td>
                        {[r.fetched, r.created, r.updated, r.removed, r.skipped].map((n, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{n}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="mb-2 font-semibold">{t('time.pmo.api')}</h2>
            <dl className="space-y-2">
              <div><dt className="font-mono text-xs">GET /api/v1/time/integration/capacity?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</dt><dd className="text-muted-foreground">{t('time.pmo.apiCapacity')}</dd></div>
              <div><dt className="font-mono text-xs">POST /api/v1/time/integration/pmo/entries</dt><dd className="text-muted-foreground">{t('time.pmo.apiPush')}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
