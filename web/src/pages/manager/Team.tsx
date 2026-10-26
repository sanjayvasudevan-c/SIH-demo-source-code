import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../../api/client';
import type { TeamReport } from '../../api/types';
import { useMe } from '../../auth/AuthContext';
import { Badge, Button, Card, ErrorState, PageHeader, SegmentedControl, Skeleton, StatTile, Table } from '../../components/ui';
import { formatDate, formatNumber, roleLabel } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';

// Chart colours come from the design tokens (neutral, warning, danger), read from the Tailwind config at build time.
import tokens from '../../lib/chartTokens';

const KIND: Record<string, string> = { LEAVE: 'On leave', TRAINING: 'In training', FIELD_VISIT: 'On a field visit', OFFLINE: 'Offline' };

export function TeamPage() {
  useTitle('Team');
  const me = useMe();
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const drill = trail.at(-1)?.id;
  const q = useQuery({ queryKey: ['team', period, drill], queryFn: () => api.get<TeamReport>(`/reports/team${qs({ period, drill })}`) });
  const d = q.data;
  const t = d?.totals;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Work received, done and pending across your team. Figures for a person include everyone who reports to them. There is no ranking or score."
        breadcrumb={trail.length ? [{ label: me.name, to: undefined }, ...trail.map((x) => ({ label: x.name }))] : undefined}
        actions={<SegmentedControl label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      />
      {trail.length ? (
        <div>
          <Button size="sm" variant="tertiary" onClick={() => setTrail((x) => x.slice(0, -1))}>
            Back to {trail.length > 1 ? trail.at(-2)!.name : 'my team'}
          </Button>
        </div>
      ) : null}
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Team held now" value={t ? t.heldNow : '—'} hint={t ? `${formatNumber(t.openPoints, true)} of ${formatNumber(t.capacity)} points` : undefined} />
        <StatTile label="Overdue now" value={t ? t.overdueNow : '—'} emphasis={t && t.overdueNow > 0 ? 'danger' : undefined} hint={t && t.worstOverdueDays ? `Worst ${t.worstOverdueDays} working days` : undefined} />
        <StatTile label="Escalated to me" value={d ? d.escalatedToMe.length : '—'} emphasis={d && d.escalatedToMe.length > 0 ? 'danger' : undefined} />
        <StatTile label="Deadlines met" value={t?.slaMetPct !== null && t?.slaMetPct !== undefined ? `${t.slaMetPct}%` : '—'} hint={t ? `${t.slaMet} of ${t.slaTotal} closed in ${period} days` : undefined} />
      </div>

      <Table
        caption={`Direct reports of ${d?.base.name ?? me.name}`}
        rows={d?.rows}
        rowKey={(r) => r.user.id}
        loading={q.isLoading}
        emptyMessage="No one reports to this person."
        onRowClick={(r) => (r.hasReports ? setTrail((x) => [...x, { id: r.user.id, name: r.user.name }]) : undefined)}
        rowLabel={(r) => (r.hasReports ? `Show the team of ${r.user.name}` : r.user.name)}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (r) => (
              <span>
                <span className="font-medium">{r.user.name}</span> <span className="text-sm text-secondary">{r.user.title ?? roleLabel(r.user.role)}</span>
              </span>
            ),
          },
          { key: 'received', header: 'Received', align: 'right', render: (r) => r.metrics.received, sortValue: (r) => r.metrics.received },
          { key: 'completed', header: 'Completed', align: 'right', render: (r) => r.metrics.completed, sortValue: (r) => r.metrics.completed },
          { key: 'returned', header: 'Returned', align: 'right', render: (r) => r.metrics.returned },
          { key: 'held', header: 'Held now', align: 'right', render: (r) => r.metrics.heldNow, sortValue: (r) => r.metrics.heldNow },
          { key: 'overdue', header: 'Overdue', align: 'right', render: (r) => (r.metrics.overdueNow ? <span className="font-medium text-danger">{r.metrics.overdueNow}</span> : 0), sortValue: (r) => r.metrics.overdueNow },
          {
            key: 'util',
            header: 'Utilisation · availability',
            render: (r) => (
              <span className="tnum text-sm">
                {r.metrics.utilisation !== null ? r.metrics.utilisation.toFixed(2) : '—'} ·{' '}
                {r.availability ? (
                  <Badge tone="warning">
                    {KIND[r.availability.kind]} until {formatDate(r.availability.until)}
                  </Badge>
                ) : r.hasReports ? (
                  `${r.metrics.availableToday} of ${r.metrics.officers} available`
                ) : (
                  'Available'
                )}
              </span>
            ),
          },
        ]}
      />
      {d && d.rows.length ? (
        <p className="tnum text-sm text-secondary">
          Team in the last {period} days: {t?.closed ?? 0} portfolio cases decided or closed · average {t?.avgWorkingDaysPerStage ?? '—'} working days per completed stage · deadlines met{' '}
          {t?.slaMetPct !== null && t?.slaMetPct !== undefined ? `${t.slaMetPct}%` : '—'}.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card title="Days in stage for held cases" className="lg:col-span-7">
          {!d ? (
            <Skeleton lines={6} />
          ) : (
            <>
              <div className="h-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.rows.map((r) => ({ name: r.user.name.split(' ')[0], '0–7 days': r.metrics.ageing.d0to7, '8–15 days': r.metrics.ageing.d8to15, '16+ days': r.metrics.ageing.d16plus }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke={tokens.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: tokens.axis }} tickLine={false} axisLine={{ stroke: tokens.grid }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: tokens.axis }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: tokens.cursor }} contentStyle={{ fontSize: 13, borderRadius: 8, borderColor: tokens.grid }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="0–7 days" stackId="a" fill={tokens.neutral} />
                    <Bar dataKey="8–15 days" stackId="a" fill={tokens.warning} />
                    <Bar dataKey="16+ days" stackId="a" fill={tokens.danger} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="tnum mt-2 text-sm text-secondary">
                Team total: {t?.ageing.d0to7} cases 0–7 days, {t?.ageing.d8to15} cases 8–15 days, {t?.ageing.d16plus} cases 16 or more working days in stage.
              </p>
            </>
          )}
        </Card>
        <Card title="Waiting on" className="lg:col-span-5">
          {!d ? (
            <Skeleton lines={4} />
          ) : (
            <dl className="flex flex-col divide-y">
              {[
                ['Officers', d.waitingOn.officer],
                ['Colleges', d.waitingOn.college],
                ['EVC desk or committee', d.waitingOn.evcOrCommittee],
                ['Competent authority', d.waitingOn.authority],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between py-2">
                  <dt className="text-base text-secondary">{k}</dt>
                  <dd className="tnum text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <Card title="Escalated to me">
        {!d ? (
          <Skeleton lines={3} />
        ) : d.escalatedToMe.length === 0 ? (
          <p className="text-base text-secondary">Nothing has been escalated to you.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {d.escalatedToMe.map((e) => (
              <li key={e.flagId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="id-text">{e.applicationNo}</span>
                    <span className="font-medium">{e.institutionName}</span>
                    <Badge tone="danger">Escalated · Level {e.level}</Badge>
                  </p>
                  <p className="mt-1 text-sm text-secondary">{e.reasonText}</p>
                </div>
                <Link to={`/cases/${e.applicationId}`} className="hit inline-flex h-control-sm items-center rounded border border-input bg-surface px-3 text-sm font-medium hover:bg-subtle">
                  Open case
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
