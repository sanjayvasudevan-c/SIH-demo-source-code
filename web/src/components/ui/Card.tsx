import type { ReactNode } from 'react';
import { cx, formatNumber } from '../../lib/format';

export function Card({ title, action, children, className, as: As = 'section' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; as?: 'section' | 'div' | 'aside' }) {
  return (
    <As className={cx('rounded-lg border bg-surface', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </As>
  );
}

export function StatTile({ label, value, hint, emphasis }: { label: string; value: number | string; hint?: ReactNode; emphasis?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <p className="text-sm font-medium text-secondary">{label}</p>
      <p className={cx('tnum mt-1 text-2xl font-semibold', emphasis === 'danger' ? 'text-danger' : emphasis === 'warning' ? 'text-warning' : 'text-primary')}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function UtilisationBar({ used, capacity, compact }: { used: number; capacity: number; compact?: boolean }) {
  const util = capacity > 0 ? used / capacity : 0;
  const pct = Math.min(100, Math.round(util * 100));
  const over = util > 1;
  const label = `${formatNumber(Math.round(used * 10) / 10, true)} of ${formatNumber(capacity, true)} points`;
  return (
    <div className={cx('flex items-center gap-3', compact ? 'min-w-0' : '')}>
      <div
        className="h-bar flex-1 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-label="Utilisation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(util * 100)}
        aria-valuetext={`${label}${over ? ', over capacity' : ''}`}
      >
        <div className={cx('h-full rounded-full', over ? 'bg-danger' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
      <span className={cx('tnum whitespace-nowrap text-sm', over ? 'font-medium text-danger' : 'text-secondary')}>{label}</span>
    </div>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .replace(/^(Dr\.|Prof\.)\s*/i, '')
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-subtle font-medium text-secondary',
        size === 'md' ? 'h-control-sm w-control-sm text-sm' : 'h-6 w-6 text-xs',
      )}
    >
      {initials}
    </span>
  );
}
