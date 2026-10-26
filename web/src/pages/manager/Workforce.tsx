import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { UnassignedRow, WorkloadRow } from '../../api/types';
import { useMe } from '../../auth/AuthContext';
import { Badge, Button, Dialog, Field, PageHeader, Select, Table, Textarea, UtilisationBar, useToast } from '../../components/ui';
import { formatDate, roleLabel } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';

const KIND: Record<string, string> = { LEAVE: 'On leave', TRAINING: 'In training', FIELD_VISIT: 'On a field visit', OFFLINE: 'Offline' };

interface Options {
  recommended: { id: string; name: string; reasonText: string } | null;
  eligible: { id: string; name: string; role: string; tier: number; utilisationAfter: number; blocked: string | null }[];
}

function ReassignDialog({ task, onClose }: { task: WorkloadRow['openTasks'][number] | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const opts = useQuery({ queryKey: ['options', task?.assignmentId], queryFn: () => api.get<Options>(`/assignments/${task!.assignmentId}/options`), enabled: !!task });
  const m = useMutation({
    mutationFn: () => api.post<{ reasonText: string }>('/assignments/reassign', { assignmentId: task!.assignmentId, toOfficerId: to, reason: reason.trim() }),
    onSuccess: () => {
      toast(`${task!.taskLabel} for ${task!.applicationNo} reassigned`);
      qc.invalidateQueries();
      onClose();
    },
  });
  const open = !!task;
  return (
    <Dialog
      open={open}
      title={task ? `Reassign ${task.taskLabel.toLowerCase()} for ${task.applicationNo}?` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={m.isPending}
            onClick={() => {
              setTried(true);
              if (to && reason.trim()) m.mutate();
            }}
          >
            Reassign task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">The deadline stays as it is. Your choice and the system's recommendation are both recorded.</p>
        {opts.data?.recommended ? (
          <div className="rounded-lg border bg-page p-3">
            <p className="text-base font-medium">Recommended by system: {opts.data.recommended.name}</p>
            <p className="mt-1 text-sm text-secondary">{opts.data.recommended.reasonText}</p>
          </div>
        ) : opts.isLoading ? null : (
          <p className="text-sm text-warning">The system found no eligible officer.</p>
        )}
        <Field label="Reassign to" error={tried && !to ? 'Choose an officer' : null}>
          {({ id, invalid }) => (
            <Select id={id} invalid={invalid} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose an officer</option>
              {(opts.data?.eligible ?? []).map((o) => (
                <option key={o.id} value={o.id} disabled={!!o.blocked}>
                  {o.name} ({roleLabel(o.role)}) · utilisation after {o.utilisationAfter.toFixed(2)}
                  {o.blocked ? ` · ${o.blocked}` : ''}
                  {opts.data?.recommended?.id === o.id ? ' · recommended' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" hint="Recorded in the audit log." error={tried && !reason.trim() ? 'Enter a reason' : null}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error ? <p role="alert" className="text-sm text-danger">{m.error instanceof ApiError ? m.error.message : 'Could not reassign.'}</p> : null}
      </div>
    </Dialog>
  );
}

function PortfolioDialog({ inst, officers, onClose }: { inst: { id: string; name: string; fromId: string } | null; officers: WorkloadRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post(`/institutions/${inst!.id}/portfolio`, { toOfficerId: to, reason: reason.trim() }),
    onSuccess: () => {
      toast(`${inst!.name} moved to a new portfolio`);
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!inst}
      title={inst ? `Move ${inst.name} to another portfolio?` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={m.isPending}
            onClick={() => {
              setTried(true);
              if (to && reason.trim()) m.mutate();
            }}
          >
            Move portfolio
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">Future scrutiny and verification tasks for this institution prefer the new portfolio officer. Open tasks stay where they are.</p>
        <Field label="New portfolio officer" error={tried && !to ? 'Choose an officer' : null}>
          {({ id, invalid }) => (
            <Select id={id} invalid={invalid} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose an officer</option>
              {officers
                .filter((o) => o.role === 'OFFICER' && o.id !== inst?.fromId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.portfolioSize} institutions
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" error={tried && !reason.trim() ? 'Enter a reason' : null}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error ? <p role="alert" className="text-sm text-danger">{m.error instanceof ApiError ? m.error.message : 'Could not move the portfolio.'}</p> : null}
      </div>
    </Dialog>
  );
}

function AssignDialog({ row, officers, onClose }: { row: UnassignedRow | null; officers: WorkloadRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post('/assignments/unassigned/assign', { applicationId: row!.applicationId, taskType: row!.taskType, taskRefId: row!.taskRefId, toOfficerId: to, reason: reason.trim() }),
    onSuccess: () => {
      toast(`${row!.taskLabel} for ${row!.applicationNo} assigned`);
      qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!row}
      title={row ? `Assign ${row.taskLabel.toLowerCase()} for ${row.applicationNo}?` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={m.isPending}
            onClick={() => {
              setTried(true);
              if (to && reason.trim()) m.mutate();
            }}
          >
            Assign task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">{row?.reasonText}</p>
        <Field label="Assign to" error={tried && !to ? 'Choose an officer' : null}>
          {({ id, invalid }) => (
            <Select id={id} invalid={invalid} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose an officer</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id} disabled={!!o.availability}>
                  {o.name} ({roleLabel(o.role)}) · utilisation {o.utilisation.toFixed(2)}
                  {o.availability ? ` · ${KIND[o.availability.kind]}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" error={tried && !reason.trim() ? 'Enter a reason' : null}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error ? <p role="alert" className="text-sm text-danger">{m.error instanceof ApiError ? m.error.message : 'Could not assign.'}</p> : null}
      </div>
    </Dialog>
  );
}

export function WorkforcePage() {
  useTitle('Workforce');
  const me = useMe();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reassign, setReassign] = useState<WorkloadRow['openTasks'][number] | null>(null);
  const [move, setMove] = useState<{ id: string; name: string; fromId: string } | null>(null);
  const [assign, setAssign] = useState<UnassignedRow | null>(null);
  const q = useQuery({ queryKey: ['workload'], queryFn: () => api.get<{ rows: WorkloadRow[] }>('/assignments/workload') });
  const canQueue = me.role === 'HOD' || me.role === 'BUREAU';
  const queue = useQuery({ queryKey: ['unassigned'], queryFn: () => api.get<{ rows: UnassignedRow[] }>('/assignments/unassigned'), enabled: canQueue });
  const rows = q.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Workforce" description="Load against capacity, availability today and portfolios for every officer you manage. Open a row to reassign a task or move a portfolio." />
      {canQueue ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">No eligible officer</h2>
          <Table
            caption="No eligible officer queue"
            rows={queue.data?.rows}
            rowKey={(r) => r.flagId}
            loading={queue.isLoading}
            emptyMessage="Every task has an officer."
            columns={[
              { key: 'no', header: 'Application no', render: (r) => <Link to={`/cases/${r.applicationId}`} className="id-text text-accent underline">{r.applicationNo}</Link> },
              { key: 'inst', header: 'Institution', render: (r) => r.institutionName, title: (r) => r.institutionName },
              { key: 'task', header: 'Task', render: (r) => r.taskLabel },
              { key: 'since', header: 'Since', align: 'right', render: (r) => formatDate(r.since) },
              { key: 'why', header: 'Why', render: (r) => r.reasonText, title: (r) => r.reasonText },
              { key: 'act', header: 'Action', srOnlyHeader: true, render: (r) => <Button size="sm" onClick={() => setAssign(r)}>Assign</Button> },
            ]}
          />
        </section>
      ) : null}
      <Table
        caption="Officers"
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        onRetry={() => q.refetch()}
        emptyMessage="No officers report to you."
        onRowClick={(r) => setExpanded((x) => (x === r.id ? null : r.id))}
        rowLabel={(r) => `${expanded === r.id ? 'Hide' : 'Show'} tasks and portfolio for ${r.name}`}
        expandedKey={expanded}
        selectedKey={expanded}
        pageSize={60}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name },
          { key: 'senior', header: 'Senior', render: (r) => r.senior?.name ?? '—' },
          { key: 'util', header: 'Utilisation', render: (r) => <UtilisationBar used={r.openPoints} capacity={r.capacity} compact />, sortValue: (r) => r.utilisation, className: 'min-w-content' },
          { key: 'avail', header: 'Today', render: (r) => (r.availability ? <Badge tone="warning">{KIND[r.availability.kind]} until {formatDate(r.availability.until)}</Badge> : 'Available') },
          { key: 'portfolio', header: 'Portfolio', align: 'right', render: (r) => r.portfolioSize },
          {
            key: 'flag',
            header: 'Flag',
            render: (r) =>
              r.flag === 'OVERLOADED' ? (
                <Badge tone="danger">Overloaded</Badge>
              ) : r.flag === 'IDLE' ? (
                <Badge tone="warning">Idle</Badge>
              ) : (
                <Badge tone="success">OK</Badge>
              ),
            sortValue: (r) => r.flag,
          },
        ]}
        renderExpanded={(r) => (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-secondary">Open tasks ({r.openTasks.length}) · team average utilisation {r.teamAverage.toFixed(2)}</h3>
              {r.openTasks.length === 0 ? (
                <p className="mt-2 text-base text-secondary">No open tasks.</p>
              ) : (
                <ul className="mt-2 flex flex-col divide-y rounded-lg border bg-surface">
                  {r.openTasks.map((t) => (
                    <li key={t.assignmentId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-base">
                          <span className="id-text">{t.applicationNo}</span> · {t.taskLabel} · <span className="tnum">{t.weight} pts</span>
                        </p>
                        <p className="truncate text-xs text-muted" title={t.reasonText}>
                          {t.institutionName}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setReassign(t)}>
                        Reassign
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary">Portfolio institutions ({r.portfolioSize})</h3>
              {r.portfolio.length === 0 ? (
                <p className="mt-2 text-base text-secondary">No institutions.</p>
              ) : (
                <ul className="mt-2 flex flex-col divide-y rounded-lg border bg-surface">
                  {r.portfolio.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-base">{i.name}</p>
                        <p className="id-text text-xs text-muted">{i.permanentId}</p>
                      </div>
                      <Button size="sm" variant="tertiary" onClick={() => setMove({ id: i.id, name: i.name, fromId: r.id })}>
                        Move portfolio
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      />
      <ReassignDialog task={reassign} onClose={() => setReassign(null)} />
      <PortfolioDialog inst={move} officers={rows} onClose={() => setMove(null)} />
      <AssignDialog row={assign} officers={rows} onClose={() => setAssign(null)} />
    </div>
  );
}
