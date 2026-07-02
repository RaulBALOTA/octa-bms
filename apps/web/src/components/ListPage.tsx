import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

/**
 * Generic server-paginated list page: quick search, filter slot, table,
 * pagination. Every module list view composes this (mini-EntityPage — the
 * full version adds kanban/calendar/map/saved views per doc 14).
 */
export function ListPage<T extends { id: string }>({
  title,
  endpoint,
  columns,
  filters,
  extraQuery = '',
  onRowClick,
  toolbar,
}: {
  title: string;
  endpoint: string;
  columns: Column<T>[];
  filters?: ReactNode;
  extraQuery?: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [endpoint, q, page, extraQuery],
    queryFn: () =>
      api.get<Paged<T>>(
        `${endpoint}?page=${page}&pageSize=25&q=${encodeURIComponent(q)}${
          extraQuery ? `&${extraQuery}` : ''
        }`,
      ),
  });

  const meta = query.data?.meta;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="flex-1" />
        {filters}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t('common.searchShort')}
            className="w-56 rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {toolbar}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`px-4 py-2.5 font-medium ${
                    col.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {t('common.loading')}
                </td>
              </tr>
            ) : query.data?.data.length ? (
              query.data.data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-border last:border-0 hover:bg-muted/50 ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col, i) => (
                    <td
                      key={i}
                      className={`px-4 py-2 ${
                        col.align === 'right' ? 'text-right' : ''
                      }`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t('common.total')}: {meta.total}
          </span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(meta.totalPages, 10) }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className={`rounded px-2.5 py-1 ${
                  page === i + 1
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const tone =
    {
      ACTIVE: 'bg-success/15 text-success',
      DRAFT: 'bg-muted text-muted-foreground',
      SENT: 'bg-primary/15 text-primary',
      PAID: 'bg-success/15 text-success',
      OVERDUE: 'bg-destructive/15 text-destructive',
      EXPIRED: 'bg-destructive/15 text-destructive',
      TERMINATED: 'bg-destructive/15 text-destructive',
      IN_APPROVAL: 'bg-warning/15 text-warning',
      IN_REVIEW: 'bg-warning/15 text-warning',
      IN_REPAIR: 'bg-warning/15 text-warning',
      REQUESTED: 'bg-warning/15 text-warning',
      APPROVED: 'bg-success/15 text-success',
      REJECTED: 'bg-destructive/15 text-destructive',
      CANCELLED: 'bg-muted text-muted-foreground',
      IN_STOCK: 'bg-primary/15 text-primary',
      ASSIGNED: 'bg-success/15 text-success',
      RETIRED: 'bg-muted text-muted-foreground',
      WON: 'bg-success/15 text-success',
      LOST: 'bg-destructive/15 text-destructive',
    }[value] ?? 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {value}
    </span>
  );
}
