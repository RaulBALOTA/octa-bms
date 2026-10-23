import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sparkline } from './charts';
import { Skeleton } from './ui';

export type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral';

export const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  neutral: 'text-muted-foreground',
};

const TONE_CHIP: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
};

const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

/* ------------------------------------------------------- PageHeader */

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-3">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
            <Icon size={18} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex-1" />
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ Panel */

export function Panel({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  'aria-label'?: string;
}) {
  return (
    <section className={clsx('surface animate-fade-up flex flex-col', className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-start gap-2 px-4 pb-1 pt-3.5">
          {Icon && <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={clsx('min-h-0 flex-1 p-4 pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------- KpiTile */

export function KpiTile({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  to,
  onClick,
  active,
  loading,
  sub,
  delta,
  deltaLabel,
  spark,
  progress,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  loading?: boolean;
  sub?: ReactNode;
  /** relative change in %, signed */
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  /** 0–100 meter under the value */
  progress?: number;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {Icon && (
          <span
            className={clsx(
              'rounded-lg p-1.5 transition-transform group-hover:scale-110',
              TONE_CHIP[tone],
            )}
          >
            <Icon size={15} />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className="mt-1 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-2xl font-bold tracking-tight tabular-nums">{value}</div>
            {(delta !== undefined && delta !== null) || sub ? (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                {delta !== undefined && delta !== null && (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-0.5 font-semibold',
                      delta >= 0 ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {Math.abs(Math.round(delta))}%
                  </span>
                )}
                {deltaLabel && <span>{deltaLabel}</span>}
                {sub && <span className="truncate">{sub}</span>}
              </div>
            ) : null}
          </div>
          {spark && spark.some((v) => v !== 0) && <Sparkline values={spark} width={84} height={30} />}
        </div>
      )}
      {progress !== undefined && !loading && <Meter value={progress} tone={tone} className="mt-3" />}
    </>
  );
  const className = clsx(
    'group surface block p-4 text-left',
    (to || onClick) && 'surface-hover',
    active && 'border-primary ring-1 ring-primary',
  );
  if (to)
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={className} aria-pressed={active}>
        {body}
      </button>
    );
  return <div className={className}>{body}</div>;
}

/* ------------------------------------------------------------ Meter */

export function Meter({
  value,
  tone = 'primary',
  className,
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(v)}%</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={clsx('h-full rounded-full transition-[width] duration-700', TONE_BAR[tone])}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
  compact,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6' : 'py-12',
      )}
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={22} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------- Segmented view */

export function ViewSwitch<K extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: K;
  onChange: (key: K) => void;
  options: { key: K; label: string; icon?: LucideIcon }[];
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((option) => (
        <button
          type="button"
          key={option.key}
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={clsx('seg-btn', value === option.key && 'seg-btn-active')}
        >
          {option.icon && <option.icon size={13} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------- Status / pill */

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        TONE_CHIP[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Countdown chip for deadlines: red when past, amber when close. */
export function DaysLeft({ days, label }: { days: number | null; label: (d: number) => string }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  const tone: Tone = days < 0 ? 'destructive' : days <= 30 ? 'warning' : 'neutral';
  return <Pill tone={tone}>{label(days)}</Pill>;
}
