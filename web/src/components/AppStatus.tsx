import type { ListRow, Status } from '../api/types';
import { StatusBadge, type StatusKind } from './ui';

export function statusKind(status: Status, daysToDue: number | null, escalationLevel = 0): { kind: StatusKind; label?: string; level?: number } {
  switch (status) {
    case 'RETURNED':
      return { kind: 'waitingOnCollege' };
    case 'APPROVED':
      return { kind: 'done', label: 'Approved' };
    case 'APPROVED_WITH_CONDITIONS':
      return { kind: 'done', label: 'Approved with conditions' };
    case 'REJECTED':
      return { kind: 'closed', label: 'Rejected' };
    case 'CLOSED':
      return { kind: 'closed' };
    default:
      if (escalationLevel > 0) return { kind: 'escalated', level: escalationLevel };
      if (daysToDue !== null && daysToDue < 0) return { kind: 'overdue' };
      return { kind: 'inProgress' };
  }
}

export function AppStatusBadge({ row }: { row: Pick<ListRow, 'status' | 'daysToDue'> & { flags?: { escalationLevel: number }[] } }) {
  const level = Math.max(0, ...(row.flags ?? []).map((f) => f.escalationLevel));
  const s = statusKind(row.status, row.daysToDue, level);
  return <StatusBadge kind={s.kind} label={s.label} level={s.level} />;
}
