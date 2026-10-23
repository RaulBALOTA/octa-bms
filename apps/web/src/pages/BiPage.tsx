import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Button, Skeleton } from '../components/ui';

interface ReportMeta {
  code: string;
  name: string;
  nameDe: string;
}

interface ReportResult {
  code: string;
  columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' }[];
  rows: Record<string, unknown>[];
}

function toCsv(result: ReportResult): string {
  const escape = (value: unknown) => {
    const s = String(value ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = result.columns.map((c) => escape(c.label)).join(';');
  const lines = result.rows.map((row) =>
    result.columns.map((c) => escape(row[c.key])).join(';'),
  );
  // Semicolon separator + BOM so German Excel opens it correctly
  return '﻿' + [header, ...lines].join('\r\n');
}

export function BiPage() {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState('revenue-by-client');

  const { data: catalog } = useQuery({
    queryKey: ['bi-catalog'],
    queryFn: () => api.get<ReportMeta[]>('/bi/reports'),
  });

  const { data: report, isLoading } = useQuery({
    queryKey: ['bi-report', active],
    queryFn: () => api.get<ReportResult>(`/bi/reports/${active}`),
  });

  const fmtCell = (value: unknown, type: string) => {
    if (value === null || value === undefined || value === '') return '—';
    switch (type) {
      case 'money':
        return new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: 'EUR',
        }).format(Number(value));
      case 'number':
        return new Intl.NumberFormat(i18n.language).format(Number(value));
      case 'date':
        return new Intl.DateTimeFormat(i18n.language).format(new Date(String(value)));
      default:
        return String(value);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.code}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full gap-4">
      {/* report catalog */}
      <aside className="w-60 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('bi.reports')}
        </h2>
        <nav className="space-y-0.5">
          {catalog?.map((meta) => (
            <button
              key={meta.code}
              onClick={() => setActive(meta.code)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                active === meta.code
                  ? 'bg-accent font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <BarChart3 size={14} className="shrink-0" />
              {i18n.language === 'de' ? meta.nameDe : meta.name}
            </button>
          ))}
        </nav>
      </aside>

      {/* result */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-lg font-bold">
            {catalog
              ? i18n.language === 'de'
                ? catalog.find((m) => m.code === active)?.nameDe
                : catalog.find((m) => m.code === active)?.name
              : t('bi.reports')}
          </h1>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {report ? `${report.rows.length} ${t('bi.rows')}` : ''}
          </span>
          <Button variant="secondary" onClick={exportCsv} disabled={!report?.rows.length}>
            <Download size={14} />
            CSV
          </Button>
        </div>

        {isLoading || !report ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      className={clsx(
                        'px-4 py-2.5 font-medium',
                        column.type !== 'text' && 'text-right',
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.length ? (
                  report.rows.map((row, index) => (
                    <tr
                      key={index}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      {report.columns.map((column) => (
                        <td
                          key={column.key}
                          className={clsx(
                            'px-4 py-2',
                            column.type !== 'text' && 'text-right tabular-nums',
                          )}
                        >
                          {fmtCell(row[column.key], column.type)}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={report.columns.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      {t('common.noResults')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
