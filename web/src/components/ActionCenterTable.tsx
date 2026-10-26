import { useNavigate } from 'react-router-dom';
import type { ACRow } from '../api/types';
import { REASON_LABEL } from '../lib/labels';
import { Badge, StatusBadge, Table, type StatusKind, type Tone } from './ui';

export function reasonTone(code: string): Tone {
  if (['STAGE_OVERDUE', 'EVC_OVERDUE', 'EVC_NOT_SCHEDULED', 'UNDERTAKING_OVERDUE', 'DOC_EXPIRED', 'ESCALATED', 'BLOCKED', 'URGENT', 'EVIDENCE_PENDING_VERIFICATION'].includes(code)) return 'danger';
  if (['STAGE_AT_RISK', 'WAITING_ON_COLLEGE', 'STALLED', 'UNDERTAKING_DUE_SOON', 'DOC_EXPIRING'].includes(code)) return 'warning';
  return 'neutral';
}

function statusFor(r: ACRow): { kind: StatusKind; level?: number } {
  if (r.escalationLevel > 0) return { kind: 'escalated', level: r.escalationLevel };
  const c = r.primary.reasonCode;
  if (['STAGE_OVERDUE', 'EVC_OVERDUE', 'EVC_NOT_SCHEDULED', 'UNDERTAKING_OVERDUE', 'DOC_EXPIRED', 'EVIDENCE_PENDING_VERIFICATION', 'BLOCKED'].includes(c)) return { kind: 'overdue' };
  if (c === 'WAITING_ON_COLLEGE' || r.primary.ownerRole === 'COLLEGE') return { kind: 'waitingOnCollege' };
  if (['STAGE_AT_RISK', 'STALLED', 'URGENT', 'UNDERTAKING_DUE_SOON', 'DOC_EXPIRING'].includes(c)) return { kind: 'atRisk' };
  return { kind: 'inProgress' };
}

export function ActionCenterTable({ rows, loading, error, onRetry, emptyMessage, toolbar, linkBase = '/cases', showTask = true }: { rows: ACRow[] | undefined; loading?: boolean; error?: string | null; onRetry?: () => void; emptyMessage: string; toolbar?: React.ReactNode; linkBase?: string; showTask?: boolean }) {
  const navigate = useNavigate();
  return (
    <Table
      caption="Action Center"
      rows={rows}
      rowKey={(r) => r.applicationId}
      onRowClick={(r) => navigate(`${linkBase}/${r.applicationId}`)}
      rowLabel={(r) => `Open ${r.applicationNo}, ${r.primary.label}`}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      toolbar={toolbar}
      columns={[
        { key: 'no', header: 'Application no', render: (r) => <span className="id-text">{r.applicationNo}</span> },
        { key: 'inst', header: 'Institution', render: (r) => r.institutionName, title: (r) => r.institutionName },
        ...(showTask
          ? [{ key: 'task', header: 'Task', render: (r: ACRow) => <span title={r.task ? `Assigned because: ${r.task.reasonText}` : undefined}>{r.task?.label ?? r.stageLabel}</span> }]
          : [{ key: 'stage', header: 'Stage', render: (r: ACRow) => r.stageLabel }]),
        { key: 'days', header: 'Days in stage', align: 'right', render: (r) => r.daysInStage, sortValue: (r) => r.daysInStage },
        {
          key: 'status',
          header: 'Status',
          render: (r) => {
            const s = statusFor(r);
            return <StatusBadge kind={s.kind} level={s.level} label={s.kind === 'overdue' || s.kind === 'atRisk' ? REASON_LABEL[r.primary.reasonCode] : undefined} />;
          },
        },
        {
          key: 'reason',
          header: 'Why and what next',
          wrap: true,
          className: 'min-w-reason',
          render: (r) => (
            <div className="flex flex-col gap-1">
              <span className="text-base font-medium text-primary">Next: {r.primary.nextAction}</span>
              <span className="text-sm text-secondary">{r.primary.reasonText}</span>
              <span className="flex flex-wrap gap-1">
                {r.reasons
                  .filter((c) => c !== r.primary.reasonCode)
                  .map((c) => (
                    <Badge key={c} tone={reasonTone(c)}>
                      {REASON_LABEL[c] ?? c}
                    </Badge>
                  ))}
              </span>
            </div>
          ),
          title: (r) => r.primary.reasonText,
        },
      ]}
    />
  );
}
