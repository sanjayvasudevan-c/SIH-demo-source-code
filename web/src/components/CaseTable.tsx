import { useNavigate } from 'react-router-dom';
import type { ListRow } from '../api/types';
import { formatDate, relativeDays } from '../lib/format';
import { AppStatusBadge } from './AppStatus';
import { Table, Tracker, type Column } from './ui';

export type CaseColumn = 'no' | 'institution' | 'type' | 'tracker' | 'stage' | 'task' | 'days' | 'status' | 'holder' | 'submitted' | 'due' | 'reason' | 'waiting' | 'visit';

export function caseColumns(cols: CaseColumn[]): Column<ListRow>[] {
  const all: Record<CaseColumn, Column<ListRow>> = {
    no: { key: 'no', header: 'Application no', render: (r) => <span className="id-text">{r.applicationNo}</span>, sortValue: (r) => r.applicationNo },
    institution: { key: 'institution', header: 'Institution', render: (r) => r.institutionName, title: (r) => r.institutionName, sortValue: (r) => r.institutionName },
    type: { key: 'type', header: 'Type', render: (r) => r.typeLabel, sortValue: (r) => r.typeLabel },
    tracker: { key: 'tracker', header: 'Progress', render: (r) => <Tracker compact steps={r.routeSteps.slice(1).map((s) => ({ label: s.label, state: s.state }))} />, className: 'min-w-content' },
    stage: { key: 'stage', header: 'Stage', render: (r) => r.stageLabel, sortValue: (r) => r.stageLabel },
    task: { key: 'task', header: 'Task', render: (r) => r.currentTask?.label ?? '—' },
    days: { key: 'days', header: 'Days in stage', align: 'right', render: (r) => r.daysInStage, sortValue: (r) => r.daysInStage },
    status: { key: 'status', header: 'Status', render: (r) => <AppStatusBadge row={r} /> },
    holder: { key: 'holder', header: 'With', render: (r) => r.holderLabel, title: (r) => r.holderLabel },
    submitted: { key: 'submitted', header: 'Submitted', align: 'right', render: (r) => formatDate(r.submittedAt), sortValue: (r) => r.submittedAt },
    due: { key: 'due', header: 'Due', align: 'right', render: (r) => (r.dueDate ? <span title={relativeDays(r.daysToDue)}>{formatDate(r.dueDate)}</span> : '—'), sortValue: (r) => r.dueDate },
    reason: {
      key: 'reason',
      header: 'Assigned because',
      render: (r) => r.currentTask?.reasonText ?? '—',
      title: (r) => r.currentTask?.reasonText ?? '',
    },
    waiting: { key: 'waiting', header: 'Days waiting', align: 'right', render: (r) => r.daysWaiting ?? r.daysInStage, sortValue: (r) => r.daysWaiting ?? r.daysInStage },
    visit: { key: 'visit', header: 'Visit', align: 'right', render: (r) => (r.visitDate ? formatDate(r.visitDate) : '—'), sortValue: (r) => r.visitDate ?? '' },
  };
  return cols.map((c) => all[c]);
}

export function CaseTable({ rows, cols, caption, loading, error, onRetry, emptyMessage, toolbar, linkBase = '/cases' }: { rows: ListRow[] | undefined; cols: CaseColumn[]; caption: string; loading?: boolean; error?: string | null; onRetry?: () => void; emptyMessage: string; toolbar?: React.ReactNode; linkBase?: string }) {
  const navigate = useNavigate();
  return (
    <Table
      caption={caption}
      columns={caseColumns(cols)}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`${linkBase}/${r.id}`)}
      rowLabel={(r) => `Open ${r.applicationNo}, ${r.institutionName}`}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      toolbar={toolbar}
    />
  );
}
