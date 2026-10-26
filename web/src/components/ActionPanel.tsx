import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../auth/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '../api/client';
import { useCaseAction } from '../api/hooks';
import type { CaseAction, CaseDetail } from '../api/types';
import { formatDate } from '../lib/format';
import { Button, Checkbox, ConfirmDialog, DateInput, Dialog, Field, IconButton, Input, ReasonDialog, SegmentedControl, Select, Textarea, useToast } from './ui';

export const ACTION_LABEL: Record<CaseAction, string> = {
  COMPLETE_STAGE: 'Complete scrutiny',
  RETURN: 'Return to college',
  REPLY: 'Reply to deficiency',
  SCHEDULE_EVC: 'Schedule EVC visit',
  SUBMIT_EVC_REPORT: 'Submit EVC report',
  FORWARD_SAC_SHC: 'Forward to SAC/SHC',
  SUBMIT_RECOMMENDATION: 'Submit recommendation',
  REVERT: 'Revert to scrutiny',
  DECIDE: 'Record decision',
};

const ORDER: CaseAction[] = ['COMPLETE_STAGE', 'SCHEDULE_EVC', 'SUBMIT_EVC_REPORT', 'FORWARD_SAC_SHC', 'SUBMIT_RECOMMENDATION', 'DECIDE', 'RETURN', 'REVERT'];

function errMsg(e: unknown): string | null {
  if (!e) return null;
  return e instanceof ApiError ? e.message : 'The action could not be saved. Try again.';
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ActionPanel({ detail, today }: { detail: CaseDetail; today: string }) {
  const [open, setOpen] = useState<CaseAction | null>(null);
  const mutation = useCaseAction(detail.application.id);
  const toast = useToast();
  const actions = ORDER.filter((a) => detail.permittedActions.includes(a));
  const no = detail.application.applicationNo;

  const navigate = useNavigate();
  const { user } = useAuth();
  const run = async (body: { action: CaseAction; reason?: string; payload?: unknown }, done: string) => {
    const res = await mutation.mutateAsync(body);
    setOpen(null);
    mutation.reset();
    if (!res || !('application' in res)) {
      toast(`${done} for ${no}. The application has moved on from your desk.`);
      if (user) navigate(homeFor(user));
      return;
    }
    toast(`${done} for ${no}`);
  };
  const close = () => {
    setOpen(null);
    mutation.reset();
  };
  const error = errMsg(mutation.error);

  if (actions.length === 0) {
    return <p className="text-base text-secondary">There is nothing for you to do on this application right now.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {actions.map((a, i) => (
        <Button key={a} variant={a === 'RETURN' ? 'destructive' : i === 0 ? 'primary' : 'secondary'} onClick={() => setOpen(a)} className="w-full">
          {ACTION_LABEL[a]}
        </Button>
      ))}

      <ConfirmDialog
        open={open === 'COMPLETE_STAGE'}
        title={`Complete scrutiny for ${no}?`}
        body={`The application moves to ${nextLabel(detail)} and the documents on file are marked verified.`}
        confirmLabel="Complete scrutiny"
        pending={mutation.isPending}
        error={error}
        onConfirm={() => run({ action: 'COMPLETE_STAGE' }, 'Scrutiny completed')}
        onClose={close}
      />
      <ReturnDialog open={open === 'RETURN'} detail={detail} pending={mutation.isPending} error={error} onClose={close} onSubmit={(reason, items) => run({ action: 'RETURN', reason, payload: { items } }, 'Returned to the college')} />
      <ScheduleDialog open={open === 'SCHEDULE_EVC'} detail={detail} today={today} pending={mutation.isPending} error={error} onClose={close} onSubmit={(payload) => run({ action: 'SCHEDULE_EVC', payload }, 'EVC visit scheduled')} />
      <ReportDialog open={open === 'SUBMIT_EVC_REPORT'} pending={mutation.isPending} error={error} onClose={close} onSubmit={(payload) => run({ action: 'SUBMIT_EVC_REPORT', payload }, 'EVC report submitted')} />
      <ReasonDialog
        open={open === 'FORWARD_SAC_SHC'}
        title={`Forward ${no} to SAC/SHC?`}
        body="The committee is asked for a recommendation. The Bureau task is released."
        reasonLabel="Note to the committee"
        confirmLabel="Forward to SAC/SHC"
        pending={mutation.isPending}
        error={error}
        onClose={close}
        onConfirm={(note) => run({ action: 'FORWARD_SAC_SHC', payload: { note } }, 'Forwarded to SAC/SHC')}
      />
      <ReasonDialog
        open={open === 'SUBMIT_RECOMMENDATION'}
        title={`Submit the SAC/SHC recommendation for ${no}?`}
        body="The application moves to the competent authority for a decision. The recommendation is advisory."
        reasonLabel="Recommendation"
        confirmLabel="Submit recommendation"
        pending={mutation.isPending}
        error={error}
        onClose={close}
        onConfirm={(text) => run({ action: 'SUBMIT_RECOMMENDATION', payload: { text } }, 'Recommendation submitted')}
      />
      <ReasonDialog
        open={open === 'REVERT'}
        title={`Revert ${no} to scrutiny?`}
        body="Open tasks in this stage are released and a new scrutiny clock starts."
        confirmLabel="Revert to scrutiny"
        pending={mutation.isPending}
        error={error}
        onClose={close}
        onConfirm={(reason) => run({ action: 'REVERT', reason }, 'Reverted to scrutiny')}
      />
      <DecideDialog open={open === 'DECIDE'} detail={detail} today={today} pending={mutation.isPending} error={error} onClose={close} onSubmit={(reason, payload) => run({ action: 'DECIDE', reason, payload }, 'Decision recorded')} />
    </div>
  );
}

function nextLabel(d: CaseDetail): string {
  const i = d.application.route.indexOf(d.application.stage);
  const next = d.application.route[i + 1];
  return next === 'EVC' ? 'EVC' : next === 'SAC_SHC' ? 'SAC/SHC' : 'the competent authority for a decision';
}

function ReturnDialog({ open, detail, pending, error, onClose, onSubmit }: { open: boolean; detail: CaseDetail; pending: boolean; error: string | null; onClose: () => void; onSubmit: (reason: string, items: string[]) => void }) {
  const [items, setItems] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setItems([]);
      setOther('');
      setReason('');
      setTried(false);
    }
  }, [open]);
  const all = [...items, ...(other.trim() ? [other.trim()] : [])];
  const itemErr = tried && all.length === 0 ? 'Choose at least one deficiency item' : null;
  const reasonErr = tried && !reason.trim() ? 'Enter a reason' : null;
  return (
    <Dialog
      open={open}
      title={`Return ${detail.application.applicationNo} to the college?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            pending={pending}
            onClick={() => {
              setTried(true);
              if (all.length && reason.trim()) onSubmit(reason.trim(), all);
            }}
          >
            Return to college
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">The scrutiny clock pauses until the college replies. The college sees the items and the reason.</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">Deficiency items</legend>
          {detail.requiredDocuments.map((d) => (
            <Checkbox key={d.kind} label={d.label} description={d.critical ? 'Critical document' : undefined} checked={items.includes(d.kind)} onChange={(v) => setItems((xs) => (v ? [...xs, d.kind] : xs.filter((x) => x !== d.kind)))} />
          ))}
          {itemErr ? <p className="text-sm text-danger">{itemErr}</p> : null}
        </fieldset>
        <Field label="Other item" optional hint="For anything not in the document list.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={other} onChange={(e) => setOther(e.target.value)} />}
        </Field>
        <Field label="Reason" hint="This is recorded in the audit log and shown to the college." error={reasonErr}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

interface Proposal {
  visitDate: string;
  proposal: { userId: string; name: string; load: number; visits: number; reason: string }[];
  unavailable: number;
  conflicted: number;
  members: { id: string; name: string; title: string | null }[];
}

function ScheduleDialog({ open, detail, today, pending, error, onClose, onSubmit }: { open: boolean; detail: CaseDetail; today: string; pending: boolean; error: string | null; onClose: () => void; onSubmit: (p: { memberIds: string[]; visitDate: string; mode: string }) => void }) {
  const [date, setDate] = useState(addDaysIso(today, 1));
  const [mode, setMode] = useState<'ONLINE' | 'PHYSICAL'>('ONLINE');
  const [picked, setPicked] = useState<string[]>(['', '', '']);
  const q = useQuery({
    queryKey: ['proposal', detail.application.id, date],
    queryFn: () => api.get<Proposal>(`/evc/${detail.application.id}/proposal${qs({ date })}`),
    enabled: open && !!date,
  });
  useEffect(() => {
    if (open) setDate(addDaysIso(today, 1));
  }, [open, today]);
  useEffect(() => {
    if (q.data) setPicked([0, 1, 2].map((i) => q.data!.proposal[i]?.userId ?? ''));
  }, [q.data]);
  const dup = new Set(picked.filter(Boolean)).size !== picked.filter(Boolean).length;
  const incomplete = picked.some((p) => !p);
  const changed = q.data ? q.data.proposal.map((p) => p.userId).join() !== picked.join() : false;
  return (
    <Dialog
      open={open}
      size="lg"
      title={`Schedule the EVC visit for ${detail.application.applicationNo}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={pending} disabled={incomplete || dup} disabledReason={dup ? 'Choose three different members' : 'Choose three members'} onClick={() => onSubmit({ memberIds: picked, visitDate: date, mode })}>
            Schedule visit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">The committee is notified and the report is due 5 working days after the visit. The system proposes members; you can change them.</p>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Visit date">{({ id }) => <DateInput id={id} min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">Mode</span>
            <SegmentedControl label="Visit mode" value={mode} onChange={setMode} options={[{ value: 'ONLINE', label: 'Online' }, { value: 'PHYSICAL', label: 'Physical' }]} />
          </div>
        </div>
        {q.data ? (
          <div className="rounded-lg border bg-page p-3">
            <h3 className="text-sm font-semibold text-secondary">Proposed by the system for {formatDate(q.data.visitDate)}</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {q.data.proposal.map((p) => (
                <li key={p.userId} className="text-sm">
                  <span className="font-medium">{p.name}</span> — {p.reason}
                </li>
              ))}
            </ul>
            {q.data.unavailable ? <p className="mt-2 text-xs text-muted">{q.data.unavailable} members are not available on this date.</p> : null}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Field key={i} label={`Member ${i + 1}`}>
              {({ id }) => (
                <Select id={id} value={picked[i]} onChange={(e) => setPicked((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}>
                  <option value="">Choose a member</option>
                  {(q.data?.members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
        {changed ? <p className="text-sm text-warning">You changed the proposed committee. Both the proposal and your choice are recorded.</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

const CHECKLIST: [string, string][] = [
  ['landBuilding', 'Land and buildings match the application'],
  ['labs', 'Laboratories and equipment are in place'],
  ['faculty', 'Faculty are in position as stated'],
  ['library', 'Library and learning resources are adequate'],
  ['safety', 'Fire safety and accessibility are adequate'],
];

function ReportDialog({ open, pending, error, onClose, onSubmit }: { open: boolean; pending: boolean; error: string | null; onClose: () => void; onSubmit: (p: { checklist: Record<string, boolean>; recommendation: string; reportText: string }) => void }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [rec, setRec] = useState('RECOMMEND_APPROVAL');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setChecks(Object.fromEntries(CHECKLIST.map(([k]) => [k, false])));
      setRec('RECOMMEND_APPROVAL');
      setText('');
      setTried(false);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      title="Submit the EVC report?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={pending}
            onClick={() => {
              setTried(true);
              if (text.trim()) onSubmit({ checklist: checks, recommendation: rec, reportText: text.trim() });
            }}
          >
            Submit report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">The application moves to the next stage. Your recommendation is advisory; the competent authority decides.</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">Checklist</legend>
          {CHECKLIST.map(([k, label]) => (
            <Checkbox key={k} label={label} checked={!!checks[k]} onChange={(v) => setChecks((c) => ({ ...c, [k]: v }))} />
          ))}
        </fieldset>
        <Field label="Recommendation">
          {({ id }) => (
            <Select id={id} value={rec} onChange={(e) => setRec(e.target.value)}>
              <option value="RECOMMEND_APPROVAL">Recommend approval</option>
              <option value="RECOMMEND_CONDITIONS">Recommend approval with conditions</option>
              <option value="RECOMMEND_REJECTION">Recommend rejection</option>
            </Select>
          )}
        </Field>
        <Field label="Report" error={tried && !text.trim() ? 'Enter the report' : null}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={4} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function DecideDialog({ open, detail, today, pending, error, onClose, onSubmit }: { open: boolean; detail: CaseDetail; today: string; pending: boolean; error: string | null; onClose: () => void; onSubmit: (reason: string, payload: unknown) => void }) {
  const [outcome, setOutcome] = useState<'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED'>('APPROVED');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<{ condition: string; dueDate: string }[]>([]);
  const [tried, setTried] = useState(false);
  // Default due date from the case's rules (norms.deficiencyCompliancePeriod).
  const defaultDue = detail.ruleDefaults?.undertakingDueDate ?? addDaysIso(today, 90);
  useEffect(() => {
    if (open) {
      setOutcome('APPROVED');
      setReason('');
      setRows([{ condition: '', dueDate: defaultDue }]);
      setTried(false);
    }
  }, [open, defaultDue]);
  const conditions = useMemo(() => rows.filter((r) => r.condition.trim()), [rows]);
  const needConditions = outcome === 'APPROVED_WITH_CONDITIONS' && conditions.length === 0;
  const evc = detail.evcVisit?.recommendation;
  return (
    <Dialog
      open={open}
      size="lg"
      title={`Record the decision on ${detail.application.applicationNo}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={outcome === 'REJECTED' ? 'destructive' : 'primary'}
            pending={pending}
            onClick={() => {
              setTried(true);
              if (!reason.trim() || needConditions) return;
              onSubmit(reason.trim(), { outcome, ...(outcome === 'APPROVED_WITH_CONDITIONS' ? { conditions } : {}) });
            }}
          >
            {outcome === 'REJECTED' ? 'Reject application' : outcome === 'APPROVED' ? 'Approve application' : 'Approve with conditions'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">This is the decision of the competent authority. It is final in this system and recorded with your reason.</p>
        {evc ? <p className="text-sm text-secondary">EVC committee recommendation: {evc.replace('RECOMMEND_', '').toLowerCase().replace('_', ' ')}.</p> : null}
        <div className="flex flex-col gap-1">
          <span className="text-base font-medium">Outcome</span>
          <SegmentedControl
            label="Outcome"
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: 'APPROVED', label: 'Approve' },
              { value: 'APPROVED_WITH_CONDITIONS', label: 'Approve with conditions' },
              { value: 'REJECTED', label: 'Reject' },
            ]}
          />
        </div>
        {outcome === 'APPROVED_WITH_CONDITIONS' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">Conditions (undertakings)</legend>
            {rows.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={`Condition ${i + 1}`} className="flex-1">
                  {({ id }) => <Input id={id} value={r.condition} placeholder="Submit fire NOC" onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))} />}
                </Field>
                <Field label="Due date">{({ id }) => <DateInput id={id} min={today} value={r.dueDate} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />}</Field>
                <IconButton label={`Remove condition ${i + 1}`} icon={<Trash2 size={16} aria-hidden />} onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div>
              <Button size="sm" variant="tertiary" icon={<Plus size={16} aria-hidden />} onClick={() => setRows((xs) => [...xs, { condition: '', dueDate: defaultDue }])}>
                Add condition
              </Button>
            </div>
            {tried && needConditions ? <p className="text-sm text-danger">Add at least one condition with a due date</p> : null}
          </fieldset>
        ) : null}
        <Field label="Reason" hint="Recorded in the audit log and sent to the college." error={tried && !reason.trim() ? 'Enter a reason' : null}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}
