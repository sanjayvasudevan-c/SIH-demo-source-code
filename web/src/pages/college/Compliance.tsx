import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { ComplianceView } from '../../api/types';
import { Badge, Button, DateInput, Dialog, Field, FileUpload, PageHeader, StatusBadge, Table, Textarea, useToast } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';

function countdown(days: number): string {
  if (days === 0) return 'due today';
  return days > 0 ? `in ${days} ${days === 1 ? 'day' : 'days'}` : `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
}

type Target = { mode: 'evidence'; id: string; title: string } | { mode: 'renewal'; id: string; title: string };

function UploadDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      if (target!.mode === 'renewal') fd.set('expiryDate', expiry);
      else if (note.trim()) fd.set('note', note.trim());
      return api.post(target!.mode === 'evidence' ? `/undertakings/${target!.id}/evidence` : `/documents/${target!.id}/renewal`, fd);
    },
    onSuccess: () => {
      toast(target!.mode === 'evidence' ? `Evidence uploaded for ${target!.title}` : `Renewed document uploaded: ${target!.title}`);
      qc.invalidateQueries();
      setFile(null);
      setExpiry('');
      setNote('');
      setTried(false);
      onClose();
    },
  });
  const isRenewal = target?.mode === 'renewal';
  return (
    <Dialog
      open={!!target}
      title={target ? (isRenewal ? `Upload a renewed ${target.title.toLowerCase()}?` : `Upload evidence for "${target.title}"?`) : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={m.isPending}
            pendingLabel="Uploading…"
            onClick={() => {
              setTried(true);
              if (file && (!isRenewal || expiry)) m.mutate();
            }}
          >
            {isRenewal ? 'Upload renewal' : 'Upload evidence'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base text-secondary">Your portfolio officer verifies it within 5 working days. You are told the result.</p>
        <Field label="File" error={tried && !file ? 'Choose a file' : null}>
          {({ id, invalid }) => <FileUpload id={id} invalid={invalid} onFile={setFile} fileName={file?.name} />}
        </Field>
        {isRenewal ? (
          <Field label="New expiry date" error={tried && !expiry ? 'Enter the new expiry date' : null}>
            {({ id, invalid }) => <DateInput id={id} invalid={invalid} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
          </Field>
        ) : (
          <Field label="Note to the officer" optional>
            {({ id }) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        )}
        {m.error ? <p role="alert" className="text-sm text-danger">{m.error instanceof ApiError ? m.error.message : 'The upload failed.'}</p> : null}
      </div>
    </Dialog>
  );
}

export function CompliancePage() {
  useTitle('Compliance');
  const q = useQuery({ queryKey: ['compliance'], queryFn: () => api.get<ComplianceView>('/compliance') });
  const [target, setTarget] = useState<Target | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Compliance" description="Conditions of your approvals and documents that expire. Upload evidence or a renewal before the due date; reminders arrive 30, 15 and 7 days ahead and on the day." />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Undertakings</h2>
        <Table
          caption="Undertakings"
          rows={q.data?.undertakings}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          error={q.error ? (q.error as Error).message : null}
          onRetry={() => q.refetch()}
          emptyMessage="You have no undertakings."
          columns={[
            { key: 'no', header: 'Application no', render: (r) => <span className="id-text">{r.applicationNo}</span> },
            { key: 'cond', header: 'Condition', render: (r) => (r.remarks && r.status === 'OPEN' ? <span title={`Officer's remarks: ${r.remarks}`}>{r.condition}</span> : r.condition), title: (r) => r.condition },
            { key: 'due', header: 'Due', align: 'right', render: (r) => formatDate(r.dueDate), sortValue: (r) => r.dueDate },
            { key: 'left', header: 'Countdown', render: (r) => (r.status === 'VERIFIED' ? '—' : <span className={r.daysToDue < 0 ? 'font-medium text-danger' : r.daysToDue <= 30 ? 'text-warning' : ''}>{countdown(r.daysToDue)}</span>) },
            {
              key: 'status',
              header: 'Status',
              render: (r) =>
                r.status === 'VERIFIED' ? (
                  <StatusBadge kind="done" label="Verified" />
                ) : r.status === 'SUBMITTED' ? (
                  <StatusBadge kind="inProgress" label="Waiting for verification" />
                ) : r.daysToDue < 0 ? (
                  <StatusBadge kind="overdue" />
                ) : r.remarks ? (
                  <Badge tone="warning">Evidence not accepted</Badge>
                ) : (
                  <StatusBadge kind="upcoming" label="Open" />
                ),
            },
            { key: 'act', header: 'Action', srOnlyHeader: true, render: (r) => (r.status === 'OPEN' ? <Button size="sm" onClick={() => setTarget({ mode: 'evidence', id: r.id, title: r.condition })}>Upload evidence</Button> : null) },
          ]}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Documents with an expiry date</h2>
        <Table
          caption="Documents with an expiry date"
          rows={q.data?.documents}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          emptyMessage="None of your approved documents has an expiry date."
          columns={[
            { key: 'no', header: 'Application no', render: (r) => <span className="id-text">{r.applicationNo}</span> },
            { key: 'kind', header: 'Document', render: (r) => r.label },
            { key: 'exp', header: 'Expires', align: 'right', render: (r) => formatDate(r.expiryDate), sortValue: (r) => r.expiryDate },
            { key: 'left', header: 'Countdown', render: (r) => <span className={r.daysToExpiry < 0 ? 'font-medium text-danger' : r.daysToExpiry <= 30 ? 'text-warning' : ''}>{countdown(r.daysToExpiry).replace('due today', 'expires today').replace('overdue', 'ago (expired)')}</span> },
            {
              key: 'state',
              header: 'Status',
              render: (r) => (r.renewalPending ? <StatusBadge kind="inProgress" label={`Renewal waiting (to ${formatDate(r.renewalPending.expiryDate)})`} /> : r.daysToExpiry < 0 ? <StatusBadge kind="overdue" label="Expired" /> : r.daysToExpiry <= 30 ? <StatusBadge kind="atRisk" label="Expiring" /> : <StatusBadge kind="done" label="Valid" />),
            },
            { key: 'act', header: 'Action', srOnlyHeader: true, render: (r) => (r.renewalPending ? null : <Button size="sm" onClick={() => setTarget({ mode: 'renewal', id: r.id, title: r.label })}>Upload renewal</Button>) },
          ]}
        />
      </section>
      <UploadDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
