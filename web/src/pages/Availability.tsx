import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, qs } from '../api/client';
import { useMe } from '../auth/AuthContext';
import { useClock } from '../components/Layout';
import { Badge, Button, Card, ConfirmDialog, DateInput, Field, PageHeader, Select, Table, Textarea, useToast } from '../components/ui';
import { formatDate, roleLabel } from '../lib/format';
import { useTitle } from '../lib/useTitle';

interface Period {
  id: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  current: boolean;
  future: boolean;
}

interface Reassigned {
  applicationId: string;
  applicationNo: string | null;
  taskLabel: string;
  toOfficerName: string | null;
  reasonText: string | null;
}

const KIND: Record<string, string> = { LEAVE: 'Leave', TRAINING: 'Training', FIELD_VISIT: 'Field visit', OFFLINE: 'Offline' };

export function AvailabilityPage() {
  useTitle('Availability');
  const me = useMe();
  const clock = useClock();
  const today = clock.data?.today ?? '';
  const qc = useQueryClient();
  const toast = useToast();
  const isManager = ['SENIOR', 'SUPER_SENIOR', 'HOD'].includes(me.role);
  const [userId, setUserId] = useState(me.id);
  const [kind, setKind] = useState('LEAVE');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Reassigned[] | null>(null);
  const [deleting, setDeleting] = useState<Period | null>(null);

  useEffect(() => {
    if (today && !startsOn) {
      setStartsOn(today);
      setEndsOn(today);
    }
  }, [today, startsOn]);

  const team = useQuery({ queryKey: ['availability-team'], queryFn: () => api.get<{ users: { id: string; name: string; role: string }[] }>('/availability/team'), enabled: isManager });
  const periods = useQuery({ queryKey: ['availability', userId], queryFn: () => api.get<{ periods: Period[] }>(`/availability${qs({ userId })}`) });
  const create = useMutation({
    mutationFn: () => api.post<{ coversToday: boolean; reassigned: Reassigned[] }>('/availability', { userId, kind, startsOn, endsOn, reason: reason.trim() }),
    onSuccess: (r) => {
      setResult(r.coversToday ? r.reassigned : null);
      setReason('');
      setTried(false);
      setConfirm(false);
      qc.invalidateQueries();
      toast(`${KIND[kind]} recorded${r.reassigned.length ? `; ${r.reassigned.length} open ${r.reassigned.length === 1 ? 'task was' : 'tasks were'} reassigned` : ''}`);
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/availability/${id}`),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['availability'] });
      toast('Period deleted');
    },
  });

  const coversToday = !!today && startsOn <= today && endsOn >= today;
  const invalidRange = !!startsOn && !!endsOn && endsOn < startsOn;
  const who = team.data?.users.find((u) => u.id === userId)?.name ?? me.name;

  function save() {
    setTried(true);
    if (!reason.trim() || invalidRange || !startsOn || !endsOn) return;
    if (coversToday) setConfirm(true);
    else create.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Availability" description="Leave, training, field visits and offline days. Work is not assigned to anyone who is away." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card title="Add a period" className="lg:col-span-5">
          <div className="flex flex-col gap-4">
            {isManager ? (
              <Field label="Team member">
                {({ id }) => (
                  <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    {(team.data?.users ?? [{ id: me.id, name: me.name, role: me.role }]).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({roleLabel(u.role)})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label="Kind">
              {({ id }) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">{({ id }) => <DateInput id={id} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
              <Field label="To" error={invalidRange ? 'The end date must be on or after the start date' : null}>
                {({ id, invalid }) => <DateInput id={id} invalid={invalid} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
              </Field>
            </div>
            <Field label="Reason" error={tried && !reason.trim() ? 'Enter a reason' : null}>
              {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            {coversToday ? <p className="text-sm text-warning">This period covers today. Open tasks will be reassigned.</p> : null}
            {create.error ? <p role="alert" className="text-sm text-danger">{create.error instanceof ApiError ? create.error.message : 'Could not save.'}</p> : null}
            <div className="flex justify-end">
              <Button variant="primary" pending={create.isPending} onClick={save}>
                Add period
              </Button>
            </div>
          </div>
        </Card>
        <div className="flex flex-col gap-6 lg:col-span-7">
          {result ? (
            <Card title="Tasks reassigned">
              {result.length === 0 ? (
                <p className="text-base text-secondary">There were no open tasks to reassign.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {result.map((r) => (
                    <li key={r.applicationId + r.taskLabel}>
                      <p className="text-base font-medium">
                        <span className="id-text">{r.applicationNo}</span> · {r.taskLabel} → {r.toOfficerName ?? 'No eligible officer (sent to the head of department)'}
                      </p>
                      {r.reasonText ? <p className="text-sm text-secondary">{r.reasonText}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
          <Table
            caption={`Availability periods for ${who}`}
            rows={periods.data?.periods}
            rowKey={(r) => r.id}
            loading={periods.isLoading}
            error={periods.error ? (periods.error as Error).message : null}
            emptyMessage={`No periods recorded for ${who}.`}
            toolbar={<span className="text-base font-medium">{who}</span>}
            columns={[
              { key: 'kind', header: 'Kind', render: (r) => KIND[r.kind] ?? r.kind },
              { key: 'from', header: 'From', align: 'right', render: (r) => formatDate(r.startsOn), sortValue: (r) => r.startsOn },
              { key: 'to', header: 'To', align: 'right', render: (r) => formatDate(r.endsOn), sortValue: (r) => r.endsOn },
              { key: 'reason', header: 'Reason', render: (r) => r.reason, title: (r) => r.reason },
              { key: 'state', header: 'Status', render: (r) => (r.current ? <Badge tone="warning">Now</Badge> : r.future ? <Badge tone="accent">Upcoming</Badge> : <Badge>Past</Badge>) },
              { key: 'act', header: 'Actions', srOnlyHeader: true, render: (r) => (r.future ? <Button size="sm" variant="tertiary" onClick={() => setDeleting(r)}>Delete</Button> : null) },
            ]}
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title={`Record ${KIND[kind]?.toLowerCase()} for ${who} starting today?`}
        body="Open tasks will be reassigned to other eligible officers now. Deadlines stay as they are."
        confirmLabel="Add period and reassign"
        pending={create.isPending}
        error={create.error instanceof ApiError ? create.error.message : null}
        onConfirm={() => create.mutate()}
        onClose={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this period?"
        body={deleting ? `${KIND[deleting.kind]} from ${formatDate(deleting.startsOn)} to ${formatDate(deleting.endsOn)}.` : ''}
        confirmLabel="Delete period"
        destructive
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
