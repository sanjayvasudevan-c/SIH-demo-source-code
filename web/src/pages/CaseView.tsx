import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useCase } from '../api/hooks';
import { useAuth, useMe } from '../auth/AuthContext';
import { ActionPanel } from '../components/ActionPanel';
import { statusKind } from '../components/AppStatus';
import { DocumentViewer } from '../components/DocumentViewer';
import { FormChecksPanel } from '../components/FormChecksPanel';
import { VerifyPanel } from '../components/VerifyPanel';
import { useClock } from '../components/Layout';
import { Badge, Card, ErrorState, PageHeader, Skeleton, StatusBadge, Table, Tabs, Tracker, type Tone } from '../components/ui';
import { formatDate, formatDateTime, formatNumber, relativeDays, roleLabel } from '../lib/format';
import { ACTION_HISTORY_LABEL, ITEM_LABEL, REASON_LABEL } from '../lib/labels';
import { useTitle } from '../lib/useTitle';
import { NoAccessPage } from './NoAccess';
import type { CaseDetail } from '../api/types';

function flagTone(code: string): Tone {
  if (['STAGE_OVERDUE', 'EVC_OVERDUE', 'UNDERTAKING_OVERDUE', 'DOC_EXPIRED', 'ESCALATED', 'BLOCKED', 'URGENT'].includes(code)) return 'danger';
  if (['STAGE_AT_RISK', 'WAITING_ON_COLLEGE', 'STALLED', 'UNDERTAKING_DUE_SOON', 'DOC_EXPIRING', 'EVC_NOT_SCHEDULED', 'EVIDENCE_PENDING_VERIFICATION'].includes(code)) return 'warning';
  return 'neutral';
}

function Facts({ d }: { d: CaseDetail }) {
  const f = d.application.formData as Record<string, unknown>;
  const courses = (f.courses as { name: string; intake: number; years: number }[] | undefined) ?? [];
  const me = useMe();
  const canOpenRules = ['RULE_EDITOR', 'RULE_APPROVER', 'ADMIN', 'HOD', 'BUREAU'].includes(me.role);
  const rulesText = d.rules ? `${d.rules.cycle.replace('-', '–')} v${d.rules.version} (effective ${formatDate(d.rules.effectiveFrom)})` : '—';
  const rows: [string, ReactNode][] = [
    ['Application type', d.application.typeLabel],
    ['Submitted', formatDate(d.application.submittedAt)],
    ['Rules', d.rules && canOpenRules ? <Link className="text-accent underline" to={`/rules/versions/${d.rules.versionId}`}>{rulesText}</Link> : rulesText],
    ['Land area', f.landAreaSqm ? `${formatNumber(Number(f.landAreaSqm))} sq m` : '—'],
    ['Built-up area', f.builtupAreaSqm ? `${formatNumber(Number(f.builtupAreaSqm))} sq m` : '—'],
    ['Faculty', f.facultyCount ? formatNumber(Number(f.facultyCount)) : '—'],
    ['Laboratories', f.labCount !== undefined ? formatNumber(Number(f.labCount)) : '—'],
    ['Lease expiry', f.leaseExpiry ? formatDate(String(f.leaseExpiry)) : '—'],
  ];
  if (f.intakeIncreasePct !== undefined) rows.push(['Intake increase', `${f.intakeIncreasePct}%`]);
  if (f.proposedName) rows.push(['Proposed name', String(f.proposedName)]);
  return (
    <Card title="Application details">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-secondary">{k}</dt>
            <dd className="tnum text-base">{v}</dd>
          </div>
        ))}
      </dl>
      {courses.length ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-secondary">Courses and intake</h3>
          <ul className="mt-1 text-base">
            {courses.map((c) => (
              <li key={c.name} className="tnum">
                {c.name}: {formatNumber(c.intake)} seats, {c.years} years
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Rounds({ d }: { d: CaseDetail }) {
  if (!d.deficiencies.length && !d.evcVisit && !d.decision && !d.recommendations.length) return null;
  return (
    <Card title="Rounds and outcomes">
      <ol className="flex flex-col gap-3">
        {d.deficiencies.map((x, i) => (
          <li key={x.id} className="rounded-lg border p-3">
            <p className="text-sm font-semibold">
              Deficiency round {i + 1} · raised {formatDate(x.raisedAt)} by {x.raisedBy}
            </p>
            <p className="mt-1 text-base">{x.reason}</p>
            <p className="mt-1 text-sm text-secondary">Items: {x.items.map((k) => d.requiredDocuments.find((r) => r.kind === k)?.label ?? k).join(', ')}</p>
            {x.resolvedAt ? (
              <p className="mt-1 text-sm text-secondary">
                College replied {formatDate(x.resolvedAt)}: {x.replyNote}
              </p>
            ) : (
              <p className="mt-1 text-sm font-medium text-warning">Waiting for the college to reply</p>
            )}
          </li>
        ))}
        {d.evcVisit && d.evcVisit.status !== 'UNSCHEDULED' ? (
          <li className="rounded-lg border p-3">
            <p className="text-sm font-semibold">
              EVC visit · {formatDate(d.evcVisit.visitDate)} · {d.evcVisit.mode === 'ONLINE' ? 'online' : 'physical'}
            </p>
            <p className="mt-1 text-sm text-secondary">Committee: {d.evcVisit.members.map((m) => m.name).join(', ')}</p>
            {d.evcVisit.proposed.length && d.evcVisit.proposed.map((p) => p.id).join() !== d.evcVisit.members.map((m) => m.id).join() ? (
              <p className="mt-1 text-sm text-secondary">System proposed: {d.evcVisit.proposed.map((m) => m.name).join(', ')}</p>
            ) : null}
            {d.evcVisit.reportText ? (
              <p className="mt-1 text-base">
                Report ({d.evcVisit.recommendation?.replace('RECOMMEND_', '').toLowerCase().replace('_', ' ')}): {d.evcVisit.reportText}
              </p>
            ) : null}
          </li>
        ) : null}
        {d.recommendations.map((r) => (
          <li key={r.id} className="rounded-lg border p-3">
            <p className="text-sm font-semibold">SAC/SHC recommendation · {formatDate(r.at)} · {r.by}</p>
            <p className="mt-1 text-base">{r.text}</p>
          </li>
        ))}
        {d.decision ? (
          <li className="rounded-lg border p-3">
            <p className="text-sm font-semibold">
              Decision · {formatDate(d.decision.at)} · {d.decision.by}
            </p>
            <p className="mt-1 text-base">
              {d.decision.outcome === 'APPROVED' ? 'Approved' : d.decision.outcome === 'REJECTED' ? 'Rejected' : 'Approved with conditions'}: {d.decision.reason}
            </p>
            {d.undertakings.length ? (
              <ul className="mt-1 text-sm text-secondary">
                {d.undertakings.map((u) => (
                  <li key={u.id} className="tnum">
                    {u.condition} — due {formatDate(u.dueDate)} · {u.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ol>
    </Card>
  );
}

export function CaseViewPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useCase(id);
  const clock = useClock();
  const [tab, setTab] = useState<'overview' | 'deadlines' | 'history'>('overview');
  useTitle(q.data ? q.data.application.applicationNo : 'Application');

  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return <NoAccessPage />;
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const stageItem = d.deadlineItems.filter((i) => ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'].includes(i.type) && (i.status === 'OPEN' || i.status === 'PAUSED')).pop();
  const level = Math.max(0, ...d.flags.map((f) => f.escalationLevel));
  const s = statusKind(d.application.status, stageItem?.daysToDue ?? null, level);
  const isOfficer = user?.role === 'OFFICER' || user?.role === 'BUREAU';

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: d.application.applicationNo }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="id-text text-xl">{d.application.applicationNo}</span>
            <span>{d.institution.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Permanent ID <span className="id-text">{d.institution.permanentId}</span>
            </span>
            <span>· {d.application.typeLabel}</span>
            <span>· {d.institution.regionName}</span>
            <StatusBadge kind={s.kind} label={s.label} level={s.level} />
          </span>
        }
      />
      <section className="mb-6 rounded-lg border bg-surface p-4">
        <Tracker steps={d.routeSteps.map((r) => ({ label: r.label, state: r.state, date: r.completedAt ?? r.enteredAt ?? r.dueDate, note: r.state === 'upcoming' ? '' : undefined }))} />
        <div className="mt-4 flex flex-col gap-1 border-t pt-3">
          <p className="text-base">
            <span className="text-secondary">With: </span>
            <span className="font-medium">{d.application.holderLabel}</span>
            {stageItem ? (
              <span className="tnum text-secondary">
                {' '}
                · {stageItem.status === 'PAUSED' ? `clock paused, ${stageItem.pausedRemaining} working days left` : `due ${formatDate(stageItem.dueDate)} · ${relativeDays(stageItem.daysToDue, stageItem.unit)}`}
              </span>
            ) : null}
          </p>
          {d.currentAssignment ? (
            <p className="text-sm text-secondary">
              <span className="font-medium text-primary">Assigned because: </span>
              {d.currentAssignment.reasonText}
            </p>
          ) : null}
        </div>
      </section>

      <Tabs
        label="Case sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'deadlines', label: 'Deadlines', count: d.deadlineItems.filter((i) => i.status === 'OPEN' || i.status === 'PAUSED').length },
          { id: 'history', label: 'History', count: d.history.length },
        ]}
      >
        {tab === 'overview' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-6 lg:col-span-7">
              <DocumentViewer documents={d.documents} />
              <Facts d={d} />
              <Rounds d={d} />
            </div>
            <aside className="flex flex-col gap-6 lg:col-span-5">
              <div className="flex flex-col gap-6 lg:sticky lg:top-topbar lg:pt-4">
                <Card title="Open flags">
                  {d.flags.length === 0 ? (
                    <p className="text-base text-secondary">No open flags.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {d.flags.map((f) => (
                        <li key={f.id}>
                          <Badge tone={flagTone(f.reasonCode)}>{f.reasonCode === 'ESCALATED' ? `Escalated · Level ${f.escalationLevel}` : REASON_LABEL[f.reasonCode] ?? f.reasonCode}</Badge>
                          <p className="mt-1 text-sm text-secondary">{f.reasonText}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <VerifyPanel detail={d} />
                <Card title="Actions">
                  <ActionPanel detail={d} today={clock.data?.today ?? new Date().toISOString().slice(0, 10)} />
                </Card>
                {user?.role !== 'COLLEGE' ? <FormChecksPanel checks={d.formChecks} applicationId={d.application.id} canLabel={isOfficer} /> : null}
              </div>
            </aside>
          </div>
        ) : tab === 'deadlines' ? (
          <Table
            caption="Deadlines"
            rows={d.deadlineItems}
            rowKey={(r) => r.id}
            emptyMessage="No deadlines have been set."
            columns={[
              { key: 'type', header: 'Deadline', render: (r) => ITEM_LABEL[r.type] ?? r.type },
              { key: 'due', header: 'Due', align: 'right', render: (r) => formatDate(r.dueDate), sortValue: (r) => r.dueDate },
              { key: 'left', header: 'Time left', render: (r) => (r.status === 'OPEN' ? relativeDays(r.daysToDue, r.unit) : r.status === 'PAUSED' ? `Paused, ${r.pausedRemaining} working days left` : '—') },
              { key: 'status', header: 'Status', render: (r) => r.status.charAt(0) + r.status.slice(1).toLowerCase() },
              { key: 'level', header: 'Escalation', align: 'right', render: (r) => (r.escalationLevel ? `Level ${r.escalationLevel}` : '—') },
              { key: 'who', header: 'Responsible', render: (r) => r.responsibleName ?? '—' },
            ]}
          />
        ) : (
          <Table
            caption="History"
            rows={[...d.history].reverse()}
            rowKey={(r) => r.id}
            emptyMessage="No history yet."
            pageSize={50}
            columns={[
              { key: 'at', header: 'When', render: (r) => <span className="tnum">{formatDateTime(r.at)}</span> },
              { key: 'action', header: 'What happened', render: (r) => ACTION_HISTORY_LABEL[r.action] ?? r.action },
              { key: 'who', header: 'By', render: (r) => (r.actorName ? `${r.actorName} (${roleLabel(r.actorRole)})` : r.actorRole === 'SYSTEM' ? 'System' : roleLabel(r.actorRole)) },
              { key: 'reason', header: 'Details', render: (r) => r.reason ?? '—', title: (r) => r.reason ?? '' },
            ]}
          />
        )}
      </Tabs>
    </div>
  );
}
