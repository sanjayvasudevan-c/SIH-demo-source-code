import type { ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Check, AlertCircle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx, formatDate } from '../../lib/format';
import { useT } from '../../lib/prefs';
import { Button } from './Button';
import { Badge } from './Badge';

export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={cx('h-4 animate-pulse rounded bg-subtle', className)} />
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6">
      <p className="text-base text-secondary">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const en = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6">
      <p className="flex items-center gap-2 text-base font-medium text-danger">
        <AlertCircle size={16} strokeWidth={1.75} aria-hidden />
        {en.app.errorTitle}
      </p>
      {message ? <p className="text-base text-secondary">{message}</p> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {en.app.retry}
        </Button>
      ) : null}
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-secondary">
        {items.map((c, i) => (
          <li key={c.label + i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="text-muted" /> : null}
            {c.to ? (
              <Link to={c.to} className="text-accent hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: Crumb[] }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-base text-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

export type StepState = 'done' | 'current' | 'upcoming' | 'returned' | 'overdue';
export interface TrackerStep {
  label: string;
  state: StepState;
  date?: string | null;
  note?: string;
}

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: 'done',
  current: 'current stage',
  upcoming: 'upcoming',
  returned: 'returned to college',
  overdue: 'overdue',
};

/** Horizontal steps with label and date: done = check, current = semibold accent, returned = warning, overdue = danger. */
export function Tracker({ steps, compact }: { steps: TrackerStep[]; compact?: boolean }) {
  return (
    <ol className={cx('flex items-start', compact ? 'gap-2' : 'gap-4')} aria-label="Application progress">
      {steps.map((s, i) => {
        const marker =
          s.state === 'done' ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-on-solid">
              <Check size={12} strokeWidth={2.5} aria-hidden />
            </span>
          ) : s.state === 'returned' ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-warning text-on-solid">
              <AlertTriangle size={12} strokeWidth={2.5} aria-hidden />
            </span>
          ) : s.state === 'overdue' ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-danger text-on-solid">
              <AlertTriangle size={12} strokeWidth={2.5} aria-hidden />
            </span>
          ) : s.state === 'current' ? (
            <span className="h-4 w-4 rounded-full border-2 border-accent bg-accent-soft" />
          ) : (
            <span className="h-4 w-4 rounded-full border-2 border-line bg-surface" />
          );
        const text =
          s.state === 'current'
            ? 'font-semibold text-accent'
            : s.state === 'returned'
              ? 'font-medium text-warning'
              : s.state === 'overdue'
                ? 'font-medium text-danger'
                : s.state === 'done'
                  ? 'text-primary'
                  : 'text-muted';
        return (
          <li key={s.label + i} className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              {marker}
              {i < steps.length - 1 ? <span aria-hidden className={cx('h-px flex-1', s.state === 'done' ? 'bg-success' : 'bg-line')} /> : null}
            </div>
            <span className={cx(compact ? 'text-xs' : 'text-sm', text, 'truncate')}>
              {s.label}
              <span className="sr-only">, {STEP_STATE_LABEL[s.state]}</span>
            </span>
            {!compact && (s.date || s.note) ? <span className="tnum text-xs text-muted">{s.note ?? formatDate(s.date)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface FormWarning {
  source: 'rule' | 'model';
  field: string;
  value?: number | string | null;
  typical?: number | string | null;
  message: string;
  severity?: 'HIGH' | 'MEDIUM';
}

export function WarningList({ warnings, renderExtra }: { warnings: FormWarning[]; renderExtra?: (w: FormWarning, i: number) => ReactNode }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {warnings.map((w, i) => {
        const high = (w.severity ?? (w.source === 'rule' ? 'HIGH' : 'MEDIUM')) === 'HIGH';
        return (
          <li key={i} className={cx('rounded-lg border p-3', high ? 'border-danger bg-danger-soft' : 'border-warning bg-warning-soft')}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={high ? 'danger' : 'warning'} icon={high ? <AlertTriangle size={12} strokeWidth={2} aria-hidden /> : <Info size={12} strokeWidth={2} aria-hidden />}>
                {high ? 'High' : 'Medium'}
              </Badge>
              <span className="text-sm font-medium text-primary">{w.field}</span>
              {w.value !== undefined && w.value !== null ? <span className="tnum text-sm text-secondary">You entered {String(w.value)}</span> : null}
              {w.typical !== undefined && w.typical !== null ? <span className="tnum text-sm text-secondary">· typical {String(w.typical)}</span> : null}
            </div>
            <p className="mt-1 text-base text-primary">{w.message}</p>
            {renderExtra ? renderExtra(w, i) : null}
          </li>
        );
      })}
    </ul>
  );
}
