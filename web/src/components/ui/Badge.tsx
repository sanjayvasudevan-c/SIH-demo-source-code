import type { ReactNode } from 'react';
import { Check, AlertTriangle, Clock, Circle, ArrowUpCircle, CircleDot } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/prefs';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-neutral',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-neutral',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {icon ?? <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export type StatusKind = 'done' | 'inProgress' | 'waitingOnCollege' | 'atRisk' | 'overdue' | 'escalated' | 'upcoming' | 'closed';

const STATUS: Record<StatusKind, { tone: Tone; label: string; Icon: typeof Check }> = {
  done: { tone: 'success', label: 'Done', Icon: Check },
  inProgress: { tone: 'accent', label: 'In progress', Icon: CircleDot },
  waitingOnCollege: { tone: 'warning', label: 'Waiting on college', Icon: Clock },
  atRisk: { tone: 'warning', label: 'At risk', Icon: AlertTriangle },
  overdue: { tone: 'danger', label: 'Overdue', Icon: AlertTriangle },
  escalated: { tone: 'danger', label: 'Escalated', Icon: ArrowUpCircle },
  upcoming: { tone: 'neutral', label: 'Upcoming', Icon: Circle },
  closed: { tone: 'neutral', label: 'Closed', Icon: Check },
};

/** Status is never colour alone: every badge has an icon and a text label. */
export function StatusBadge({ kind, label, level }: { kind: StatusKind; label?: string; level?: number }) {
  const t = useT();
  const s = STATUS[kind];
  const base = t.status[kind] ?? s.label;
  const text = label ?? (kind === 'escalated' && level ? `${base} · Level ${level}` : base);
  return (
    <Badge tone={s.tone} icon={<s.Icon size={12} strokeWidth={2} aria-hidden />}>
      {text}
    </Badge>
  );
}
