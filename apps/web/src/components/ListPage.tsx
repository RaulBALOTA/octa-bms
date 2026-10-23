import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { navItemFor } from '../app/nav';
import { api, Paged } from '../lib/api';
import type { ValueType } from '../lib/format';
import { ENDPOINT_RESOURCES, recordLabel } from '../lib/records';
import { useAuthStore } from '../stores/auth';
import { DataColumn, DataTable, Pager } from './DataTable';
import { PageHeader } from './infographics';
import { RecordActions } from './RecordActions';
import { ArchivedRecordsButton } from './ModuleRecords';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** raw value for sorting / CSV / pivot (defaults to the rendered text) */
  value?: (row: T) => unknown;
  type?: ValueType;
  /** in-cell magnitude bar */
  bar?: boolean;
  total?: 'sum' | 'avg';
  hidden?: boolean;
}

/**
 * Generic server-paginated list page: quick search, filter slot, enhanced
 * table (sort, columns, density, CSV) with a pivot view over the loaded
 * page, and pagination with a page-size choice. Every module list view
 * composes this (mini-EntityPage — the full version adds kanban/calendar/
 * map/saved views per doc 14).
 */
export function ListPage<T extends { id: string }>({
  title,
  subtitle,
  endpoint,
  columns,
  filters,
  extraQuery = '',
  onRowClick,
  toolbar,
  summary,
}: {
  title: string;
  subtitle?: ReactNode;
  endpoint: string;
  columns: Column<T>[];
  filters?: ReactNode;
  extraQuery?: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  /** infographic strip rendered between header and table */
  summary?: ReactNode;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const companyId = useAuthStore((state) => state.companyId); const admin = useAuthStore((state) => state.me?.isSystemAdmin);
  const resource = ENDPOINT_RESOURCES[endpoint]; const showActions = !!admin && !!resource;
  useEffect(() => { setPage(1); setQ(''); }, [companyId, endpoint]);

  const query = useQuery({
    queryKey: [endpoint, companyId, q, page, pageSize, extraQuery],
    queryFn: () =>
      api.get<Paged<T>>(
        `${endpoint}?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}${
          extraQuery ? `&${extraQuery}` : ''
        }`,
      ),
  });

  const meta = query.data?.meta;
  useEffect(() => { if (meta && page > Math.max(1, meta.totalPages)) setPage(Math.max(1, meta.totalPages)); }, [meta, page]);

  const tableColumns = useMemo<DataColumn<T>[]>(() => {
    const cols: DataColumn<T>[] = columns.map((col, i) => ({
      key: `c${i}`,
      header: col.header,
      render: col.render,
      value: col.value,
      type: col.type,
      align: col.align,
      bar: col.bar,
      total: col.total,
      hidden: col.hidden,
    }));
    if (showActions)
      cols.push({
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        sticky: true,
        sortable: false,
        export: false,
        render: (row) => <RecordActions resource={resource} id={row.id} label={recordLabel(row)} />,
      });
    return cols;
  }, [columns, showActions, resource, t]);

  const rows = query.data?.data ?? [];
  const total = meta?.total ?? rows.length;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={navItemFor(location.pathname)?.icon}
        actions={
          <>
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
            {showActions && <ArchivedRecordsButton resource={resource} />}
          </>
        }
      />
      {query.error && <p role="alert" className="mb-3 text-sm text-destructive">{query.error.message}</p>}
      {summary && <div className="mb-4">{summary}</div>}

      <DataTable<T>
        rows={rows}
        columns={tableColumns}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        onRowClick={onRowClick}
        search={false}
        pageSize={0}
        exportName={endpoint.replace(/^\//, '').replace(/\//g, '-')}
        pivot
        pivotNote={
          total > rows.length
            ? t('table.pivotLoaded', { count: rows.length, total })
            : t('table.pivotAll', { count: rows.length })
        }
        footer={
          meta && meta.total > 0 ? (
            <Pager
              page={page}
              totalPages={Math.max(1, meta.totalPages)}
              total={meta.total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null
        }
      />
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {value}
    </span>
  );
}
