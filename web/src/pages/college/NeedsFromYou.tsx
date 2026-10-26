import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ACRow, ListRow } from '../../api/types';
import { reasonTone } from '../../components/ActionCenterTable';
import { Badge, Card, Skeleton } from '../../components/ui';
import { REASON_LABEL } from '../../lib/labels';

function targetFor(r: ACRow): { to: string; label: string } {
  switch (r.primary.reasonCode) {
    case 'WAITING_ON_COLLEGE':
      return { to: `/college/applications/${r.applicationId}`, label: 'Reply to deficiency' };
    case 'UNDERTAKING_DUE_SOON':
    case 'UNDERTAKING_OVERDUE':
      return { to: '/college/compliance', label: 'Upload evidence' };
    case 'DOC_EXPIRING':
    case 'DOC_EXPIRED':
    case 'BLOCKED':
      return { to: '/college/compliance', label: 'Upload renewed document' };
    default:
      return { to: r.primary.reasonText.includes('Undertaking') ? '/college/compliance' : `/college/applications/${r.applicationId}`, label: 'Open' };
  }
}

/** "What we need from you": the college-owned Action Center flags, each with a button to the right form. */
export function NeedsFromYou(_props: { rows?: ListRow[] }) {
  const q = useQuery({ queryKey: ['ac', 'college'], queryFn: () => api.get<{ rows: ACRow[] }>('/action-center') });
  return (
    <Card title="What we need from you">
      {q.isLoading ? (
        <Skeleton lines={2} />
      ) : (q.data?.rows ?? []).length === 0 ? (
        <p className="text-base text-secondary">Nothing is waiting on you right now.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {q.data!.rows.map((r) => {
            const t = targetFor(r);
            return (
              <li key={r.applicationId + r.primary.reasonCode} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-base font-medium">
                    <span className="id-text">{r.applicationNo}</span>
                    <Badge tone={reasonTone(r.primary.reasonCode)}>{REASON_LABEL[r.primary.reasonCode] ?? r.primary.label}</Badge>
                  </p>
                  <p className="mt-1 text-sm text-secondary">{r.primary.reasonText.split('; owner:')[0]}</p>
                </div>
                <Link to={t.to} className="hit inline-flex h-control-sm items-center rounded border border-input bg-surface px-3 text-sm font-medium hover:bg-subtle">
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
