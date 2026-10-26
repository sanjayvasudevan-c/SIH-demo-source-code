import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError, qs } from '../../api/client';
import { useClock } from '../../components/Layout';
import { Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader, Select, StatTile, Table, Tabs, useToast } from '../../components/ui';
import { formatDate, formatDateTime, roleLabel } from '../../lib/format';
import { ACTION_HISTORY_LABEL } from '../../lib/labels';
import { useTitle } from '../../lib/useTitle';

interface AuditRow {
  id: string;
  chainKey: string;
  at: string;
  actorName: string | null;
  actorRole: string;
  action: string;
  applicationNo: string | null;
  reason: string | null;
  meta: Record<string, unknown>;
}

interface Verify {
  ok: boolean;
  chainsChecked: number;
  rowsChecked: number;
  firstBroken?: { chainKey: string; id: string };
  brokenChains: string[];
}

interface DirUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  reportsToId: string | null;
  region: string | null;
}

const AUDIT_ACTIONS = ['SUBMIT', 'COMPLETE_STAGE', 'RETURN', 'REPLY', 'SCHEDULE_EVC', 'SUBMIT_EVC_REPORT', 'FORWARD_SAC_SHC', 'SUBMIT_RECOMMENDATION', 'REVERT', 'DECIDE', 'ASSIGN', 'RELEASE', 'REASSIGN', 'ASSIGN_OVERRIDE', 'ASSIGN_FAILED', 'AVAILABILITY_SET', 'ESCALATED', 'ALERTS_SENT', 'CLOSED', 'UPLOAD_EVIDENCE', 'VERIFY_EVIDENCE', 'UPLOAD_RENEWAL', 'VERIFY_RENEWAL', 'FORM_CHECK_WARNING', 'FORM_CHECK_JUSTIFIED', 'FORM_CHECK_LABEL', 'TIME_ADVANCED', 'DEMO_RESET', 'ACCESS_DENIED', 'LOGIN', 'LOGIN_FAILED', 'FLAG_RESOLVED', 'RULES_DRAFTED', 'RULES_EDITED', 'RULES_SUBMITTED', 'RULES_APPROVED', 'RULES_REJECTED', 'RULES_PUBLISHED', 'RULES_ROLLED_BACK', 'RULES_REBASED', 'RULES_IMPORTED', 'RULES_EXPORTED', 'DEMO_IGNORE_SCHEDULE'];

function DemoControls() {
  const clock = useClock();
  const qc = useQueryClient();
  const toast = useToast();
  const [custom, setCustom] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [last, setLast] = useState<{ today: string; offsetDays: number; cycle: Record<string, number | string> } | null>(null);
  const advance = useMutation({
    mutationFn: (days: number) => api.post<{ today: string; offsetDays: number; cycle: Record<string, number | string> }>('/demo/advance-time', { days }),
    onSuccess: (r) => {
      setLast(r);
      qc.invalidateQueries();
      toast(`Simulated date is now ${formatDate(r.today)}`);
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ ms: number; today: string }>('/demo/reset'),
    onSuccess: (r) => {
      setConfirmReset(false);
      setLast(null);
      qc.invalidateQueries();
      toast(`Demo reset in ${(r.ms / 1000).toFixed(1)} seconds`);
    },
  });
  const n = Number(custom);
  const customOk = Number.isInteger(n) && n >= 1 && n <= 400;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Time travel">
        <div className="flex flex-col gap-4">
          <p className="text-base text-secondary">
            {clock.data?.simulated ? 'Simulated date' : 'Today'}: <span className="tnum font-medium text-primary">{clock.data ? formatDate(clock.data.today) : '—'}</span>
            {clock.data?.simulated ? ` (${clock.data.offsetDays} days ahead of real time)` : ''}. Moving the date runs one engine cycle straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 7, 30].map((d) => (
              <Button key={d} pending={advance.isPending && advance.variables === d} pendingLabel="Advancing…" onClick={() => advance.mutate(d)}>
                Advance {d} {d === 1 ? 'day' : 'days'}
              </Button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Field label="Custom number of days" error={custom && !customOk ? 'Enter a whole number from 1 to 400' : null}>
              {({ id, invalid }) => <Input id={id} inputMode="numeric" invalid={invalid} value={custom} onChange={(e) => setCustom(e.target.value)} />}
            </Field>
            <Button disabled={!customOk} disabledReason="Enter a whole number from 1 to 400" pending={advance.isPending && advance.variables === n} onClick={() => advance.mutate(n)}>
              Advance
            </Button>
          </div>
          {advance.error ? <p role="alert" className="text-sm text-danger">{advance.error instanceof ApiError ? advance.error.message : 'Could not advance.'}</p> : null}
          {last ? (
            <div className="rounded-lg border bg-page p-3" aria-live="polite">
              <p className="text-base font-medium">New simulated date: {formatDate(last.today)}</p>
              <ul className="tnum mt-1 grid grid-cols-2 gap-x-4 text-sm text-secondary">
                {Object.entries(last.cycle)
                  .filter(([k]) => k !== 'today')
                  .map(([k, v]) => (
                    <li key={k}>
                      {k.replace(/([A-Z])/g, ' $1').toLowerCase()}: {String(v)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>
      <Card title="Reset demo">
        <div className="flex flex-col gap-4">
          <p className="text-base text-secondary">Recreate the database from the seed template. Every change since the seed is discarded and the simulated date returns to today.</p>
          <div>
            <Button variant="destructive" onClick={() => setConfirmReset(true)}>
              Reset demo
            </Button>
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo?"
        body="All changes since the seed are discarded and everyone is signed out of their current work. This cannot be undone."
        confirmLabel="Reset demo"
        destructive
        pending={reset.isPending}
        error={reset.error instanceof ApiError ? reset.error.message : null}
        onConfirm={() => reset.mutate()}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function AuditLog() {
  const [applicationNo, setApplicationNo] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [chain, setChain] = useState('');
  const [filters, setFilters] = useState({ applicationNo: '', action: '', actor: '', chain: '' });
  const q = useQuery({ queryKey: ['audit', filters], queryFn: () => api.get<{ total: number; rows: AuditRow[] }>(`/admin/audit${qs({ ...filters, pageSize: 200 })}`) });
  const verify = useMutation({ mutationFn: () => api.get<Verify>('/admin/audit/verify') });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Integrity">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" pending={verify.isPending} pendingLabel="Verifying…" onClick={() => verify.mutate()}>
            Verify integrity
          </Button>
          {verify.data ? (
            verify.data.ok ? (
              <p className="flex items-center gap-2 text-base text-success" role="status">
                <CheckCircle2 size={16} aria-hidden /> OK: {verify.data.chainsChecked} chains and {verify.data.rowsChecked} rows match their hashes.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-base text-danger" role="alert">
                <XCircle size={16} aria-hidden /> Broken: row {verify.data.firstBroken?.id} in chain {verify.data.firstBroken?.chainKey === 'global' ? 'global' : verify.data.firstBroken?.chainKey} does not match its hash. Every later row in that chain is suspect.
                {verify.data.brokenChains.length > 1 ? ` ${verify.data.brokenChains.length} chains are broken.` : ' Every other chain verifies.'}
              </p>
            )
          ) : (
            <p className="text-base text-secondary">Recomputes every hash chain and names the first row that does not match.</p>
          )}
        </div>
      </Card>
      <Table
        caption="Audit log"
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        onRetry={() => q.refetch()}
        emptyMessage="No audit rows match these filters."
        pageSize={50}
        toolbar={
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ applicationNo: applicationNo.trim(), action, actor: actor.trim(), chain });
            }}
          >
            <Field label="Application no">{({ id }) => <Input id={id} value={applicationNo} placeholder="S-2026-0001" onChange={(e) => setApplicationNo(e.target.value)} />}</Field>
            <Field label="Action">
              {({ id }) => (
                <Select id={id} value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="">All actions</option>
                  {AUDIT_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Actor">{({ id }) => <Input id={id} value={actor} placeholder="Name or email" onChange={(e) => setActor(e.target.value)} />}</Field>
            <Field label="Chain">
              {({ id }) => (
                <Select id={id} value={chain} onChange={(e) => setChain(e.target.value)}>
                  <option value="">All chains</option>
                  <option value="rules">Rules Center</option>
                  <option value="global">Global</option>
                </Select>
              )}
            </Field>
            <Button type="submit">Apply filters</Button>
            <span className="tnum pb-2 text-sm text-secondary">{q.data ? `${q.data.total} rows` : ''}</span>
          </form>
        }
        columns={[
          { key: 'id', header: 'Row', align: 'right', render: (r) => <span className="id-text">{r.id}</span> },
          { key: 'at', header: 'When', render: (r) => <span className="tnum">{formatDateTime(r.at)}</span> },
          { key: 'action', header: 'Action', render: (r) => <span title={ACTION_HISTORY_LABEL[r.action] ?? r.action}>{r.action}</span> },
          { key: 'app', header: 'Application', render: (r) => (r.applicationNo ? <span className="id-text">{r.applicationNo}</span> : <span className="text-muted">Global</span>) },
          { key: 'actor', header: 'Actor', render: (r) => (r.actorName ? `${r.actorName} (${roleLabel(r.actorRole)})` : r.actorRole === 'SYSTEM' ? 'System' : roleLabel(r.actorRole)) },
          { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—', title: (r) => r.reason ?? '' },
        ]}
      />
    </div>
  );
}

function Directory() {
  const q = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: DirUser[] }>('/admin/directory') });
  const users = q.data?.users ?? [];
  const children = (id: string | null) => users.filter((u) => u.reportsToId === id && (id !== null || ['HOD', 'AUTHORITY', 'ADMIN', 'COMMITTEE'].includes(u.role) || (u.role === 'BUREAU' && !u.reportsToId)));
  const Node = ({ u, depth }: { u: DirUser; depth: number }) => {
    const kids = children(u.id);
    return (
      <li>
        <div className="flex flex-wrap items-center gap-2 py-1">
          <span className="text-base font-medium">{u.name}</span>
          <span className="text-sm text-secondary">
            {u.title ?? roleLabel(u.role)}
            {u.region ? `, ${u.region === 'SOUTH' ? 'South' : 'West'}` : ''}
          </span>
          {kids.length ? <Badge>{kids.length} direct</Badge> : null}
        </div>
        {kids.length && depth < 4 ? (
          <ul className="ml-4 border-l pl-4">
            {kids.map((k) => (
              <Node key={k.id} u={k} depth={depth + 1} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  };
  return (
    <Card title="Directory">
      {q.isLoading ? <p className="text-base text-secondary">Loading the directory…</p> : null}
      <ul>
        {children(null).map((u) => (
          <Node key={u.id} u={u} depth={0} />
        ))}
      </ul>
    </Card>
  );
}

function Scheduler() {
  const q = useQuery({
    queryKey: ['scheduler'],
    queryFn: () => api.get<{ instances: { instanceId: string; isLeader: boolean; lastRunAt: string; lastResult: Record<string, unknown> }[]; formcheck: string }>('/admin/scheduler'),
    refetchInterval: 5000,
  });
  const clock = useClock();
  const nowMs = clock.data ? new Date(clock.data.now).getTime() : 0;
  const instances = q.data?.instances ?? [];
  const live = (at: string) => nowMs - new Date(at).getTime() < 150_000;
  const leader = instances.find((i) => i.isLeader && live(i.lastRunAt));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Scheduler leader" value={leader ? leader.instanceId : 'None'} />
        <StatTile label="Instances reporting" value={instances.filter((i) => live(i.lastRunAt)).length} />
        <StatTile label="Form check service" value={q.data?.formcheck === 'ok' ? 'Running' : 'Down'} emphasis={q.data?.formcheck === 'ok' ? undefined : 'warning'} />
      </div>
      <Table
        caption="Scheduler instances"
        rows={instances}
        rowKey={(r) => r.instanceId}
        loading={q.isLoading}
        emptyMessage="No scheduler has reported yet."
        columns={[
          { key: 'id', header: 'Instance', render: (r) => <span className="id-text">{r.instanceId}</span> },
          { key: 'role', header: 'Role', render: (r) => (r.isLeader && live(r.lastRunAt) ? <Badge tone="success">Leader</Badge> : live(r.lastRunAt) ? <Badge>Standby</Badge> : <Badge tone="danger">Not reporting</Badge>) },
          { key: 'last', header: 'Last heartbeat', render: (r) => <span className="tnum">{formatDateTime(r.lastRunAt)}</span> },
          { key: 'result', header: 'Last cycle', render: (r) => Object.entries(r.lastResult ?? {}).filter(([k]) => ['reminders', 'overdue', 'escalations', 'released', 'error'].includes(k)).map(([k, v]) => `${k} ${String(v)}`).join(', ') || '—' },
        ]}
      />
    </div>
  );
}

export function AdminPage() {
  useTitle('Administration');
  const [tab, setTab] = useState<'demo' | 'audit' | 'directory' | 'scheduler'>('demo');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Administration" description="Demo controls, the audit log and its integrity check, the directory and the scheduler. Administrators take no case actions." />
      <Tabs
        label="Administration sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'demo', label: 'Demo controls' },
          { id: 'audit', label: 'Audit log' },
          { id: 'directory', label: 'Directory' },
          { id: 'scheduler', label: 'Scheduler' },
        ]}
      >
        {tab === 'demo' ? <DemoControls /> : tab === 'audit' ? <AuditLog /> : tab === 'directory' ? <Directory /> : <Scheduler />}
      </Tabs>
    </div>
  );
}
