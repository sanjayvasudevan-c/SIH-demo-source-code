import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ListRow } from '../api/types';
import { CaseTable } from '../components/CaseTable';
import { Badge, PageHeader } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { REASON_LABEL } from '../lib/labels';

export function EvcQueuePage() {
  useTitle('EVC desk');
  const q = useQuery({ queryKey: ['evc-queue'], queryFn: () => api.get<{ rows: ListRow[] }>('/evc/queue') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="EVC desk" description="Applications waiting for an expert visit to be scheduled. New institutions are listed first." />
      <CaseTable
        caption="EVC queue"
        rows={q.data?.rows}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        onRetry={() => q.refetch()}
        cols={['no', 'institution', 'type', 'waiting', 'due', 'status']}
        emptyMessage="No applications are waiting for a visit to be scheduled."
        toolbar={
          q.data?.rows.some((r) => r.flags?.length) ? (
            <div className="flex flex-wrap gap-2">
              {[...new Set(q.data.rows.flatMap((r) => r.flags?.map((f) => f.reasonCode) ?? []))].map((c) => (
                <Badge key={c} tone="warning">
                  {REASON_LABEL[c] ?? c}
                </Badge>
              ))}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

export function CommitteeQueuePage() {
  useTitle('Committee');
  const q = useQuery({ queryKey: ['committee-queue'], queryFn: () => api.get<{ visits: ListRow[]; sacShc: ListRow[] }>('/committee/queue') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Committee" description="Your scheduled visits, reports due and SAC/SHC cases waiting for a recommendation." />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My visits</h2>
        <CaseTable caption="My visits" rows={q.data?.visits} loading={q.isLoading} error={q.error ? (q.error as Error).message : null} cols={['no', 'institution', 'type', 'visit', 'due', 'status']} emptyMessage="You have no scheduled visits." />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">SAC/SHC cases</h2>
        <CaseTable caption="SAC/SHC cases" rows={q.data?.sacShc} loading={q.isLoading} cols={['no', 'institution', 'type', 'days', 'due', 'status']} emptyMessage="No cases are waiting for a SAC/SHC recommendation." />
      </section>
    </div>
  );
}

export function AuthorityQueuePage() {
  useTitle('Decisions');
  const q = useQuery({ queryKey: ['authority-queue'], queryFn: () => api.get<{ rows: ListRow[] }>('/authority/queue') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Decisions" description="Applications in your region waiting for the decision of the competent authority." />
      <CaseTable caption="Decision queue" rows={q.data?.rows} loading={q.isLoading} error={q.error ? (q.error as Error).message : null} onRetry={() => q.refetch()} cols={['no', 'institution', 'type', 'days', 'due', 'status']} emptyMessage="No applications are waiting for your decision." />
    </div>
  );
}

export function BureauQueuePage() {
  useTitle('Bureau');
  const q = useQuery({ queryKey: ['bureau-queue'], queryFn: () => api.get<{ overflow: ListRow[]; sacShc: ListRow[] }>('/bureau/queue') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bureau" description="Overflow tasks from the regions and SAC/SHC cases to forward." />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Overflow tasks</h2>
        <CaseTable caption="Overflow tasks" rows={q.data?.overflow} loading={q.isLoading} error={q.error ? (q.error as Error).message : null} cols={['no', 'institution', 'task', 'stage', 'days', 'status', 'reason']} emptyMessage="You have no overflow tasks." />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">SAC/SHC forwarding</h2>
        <CaseTable caption="SAC/SHC forwarding" rows={q.data?.sacShc} loading={q.isLoading} cols={['no', 'institution', 'type', 'days', 'due', 'status']} emptyMessage="No SAC/SHC cases are waiting to be forwarded." />
      </section>
    </div>
  );
}
