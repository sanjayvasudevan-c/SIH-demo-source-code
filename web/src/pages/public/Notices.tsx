// /notices: "What changed this cycle". Public (no login) and linked from the college dashboard banner.
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, ErrorState, IconButton, PageHeader, Skeleton, Table } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';
import { useT } from '../../lib/prefs';
import { KIND_LABEL, cycleLabel, type PublicNotice, type PublicScheduleRow } from '../rules/types';

export function usePublicNotices() {
  return useQuery({ queryKey: ['public', 'notices'], queryFn: () => api.get<{ notices: PublicNotice[]; schedule: PublicScheduleRow[] }>('/rules/public/notices') });
}

const WINDOW_LABEL: Record<string, string> = { APPLICATION_WINDOW: 'Applications', LATE_FEE_WINDOW: 'With late fee', PAYMENT_DEADLINE: 'Payment', DECISION_LAST_DATE: 'Last date for decisions' };

export function NoticesView() {
  const t = useT();
  const q = usePublicNotices();
  if (q.isLoading) return <Skeleton lines={6} />;
  if (!q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="changes" className="flex flex-col gap-3">
        <h2 id="changes" className="text-xl font-semibold">
          {t.notices.changes}
        </h2>
        {q.data.notices.map((n) => (
          <Card key={n.versionId} as="div">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{KIND_LABEL[n.kind] ?? n.kind}</Badge>
              <Badge tone={n.current ? 'success' : 'neutral'}>{`${cycleLabel(n.cycle)} · v${n.version}${n.current ? ` · ${t.notices.inForce}` : ''}`}</Badge>
            </div>
            <h3 className="mt-2 text-lg font-semibold">{n.title}</h3>
            <p className="mt-1 text-sm text-secondary">
              {n.refNo} · {t.notices.issued} {formatDate(n.issuedOn)} · {t.notices.effective} {formatDate(n.effectiveFrom)}
            </p>
            <p className="mt-2 text-base">{n.summary}</p>
            <p className="mt-2 text-sm text-secondary">
              {t.notices.affects}: {n.affectedTypes.join(', ')}
            </p>
          </Card>
        ))}
      </section>
      <Table
        caption={t.notices.schedule}
        rows={q.data.schedule}
        rowKey={(s) => `${s.cycle}-${s.id}`}
        emptyMessage="No windows are published."
        columns={[
          { key: 'cycle', header: 'Cycle', render: (s) => cycleLabel(s.cycle) },
          { key: 'label', header: 'Window', wrap: true, render: (s) => s.label },
          { key: 'kind', header: 'Kind', render: (s) => WINDOW_LABEL[s.kind] ?? s.kind },
          { key: 'from', header: 'From', render: (s) => formatDate(s.from), sortValue: (s) => s.from },
          { key: 'to', header: 'To', render: (s) => formatDate(s.to), sortValue: (s) => s.to },
          { key: 'scope', header: 'Who', wrap: true, render: (s) => s.scope },
        ]}
      />
      <p className="text-sm text-muted">{t.notices.disclaimer}</p>
    </div>
  );
}

export function NoticesPage() {
  const t = useT();
  useTitle(t.notices.title);
  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-6">
      <PageHeader title={t.notices.title} description={t.notices.description} breadcrumb={[{ label: t.publicNav.home, to: '/' }, { label: t.publicNav.changed }]} />
      <NoticesView />
    </div>
  );
}

/** Logged-in variant, inside the application layout. */
export function NoticesInAppPage() {
  const t = useT();
  useTitle(t.notices.title);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.notices.title} description={t.notices.description} />
      <NoticesView />
    </div>
  );
}

/** "1 change to the 2027–28 rules since your last visit · View", dismissible per user (kept on the server). */
export function NoticesBanner() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notices', 'unseen'], queryFn: () => api.get<{ count: number; cycles: string[] }>('/rules/notices/unseen') });
  const seen = useMutation({
    mutationFn: () => api.post('/rules/notices/seen'),
    onSuccess: () => qc.setQueryData(['notices', 'unseen'], { count: 0, cycles: [] }),
  });
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-2 text-base">
      <p>
        {t.notices.banner(n, q.data!.cycles.map(cycleLabel).join(', '))} ·{' '}
        <Link to="/college/notices" className="font-medium text-accent underline" onClick={() => seen.mutate()}>
          {t.common.view}
        </Link>
      </p>
      <IconButton label={t.common.dismiss} icon={<X size={18} aria-hidden />} onClick={() => seen.mutate()} />
    </div>
  );
}
