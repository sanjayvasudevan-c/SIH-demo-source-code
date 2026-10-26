import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useCase, useCaseAction } from '../../api/hooks';
import type { CaseDetail } from '../../api/types';
import { statusKind } from '../../components/AppStatus';
import { DocumentViewer } from '../../components/DocumentViewer';
import { Button, Card, DateInput, ErrorState, Field, FileUpload, PageHeader, Skeleton, StatusBadge, Table, Textarea, Tracker, useToast } from '../../components/ui';
import { formatDate, formatDateTime, relativeDays } from '../../lib/format';
import { ACTION_HISTORY_LABEL } from '../../lib/labels';
import { useTitle } from '../../lib/useTitle';
import { NoAccessPage } from '../NoAccess';

function ReplyForm({ d }: { d: CaseDetail }) {
  const def = d.deficiencies.find((x) => !x.resolvedAt)!;
  const docKinds = def.items.filter((k) => d.requiredDocuments.some((r) => r.kind === k));
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Record<string, { file: File | null; expiryDate: string }>>({});
  const [tried, setTried] = useState(false);
  const mutation = useCaseAction(d.application.id);
  const toast = useToast();
  const missingExpiry = docKinds.filter((k) => d.requiredDocuments.find((r) => r.kind === k)?.hasExpiry && files[k]?.file && !files[k]?.expiryDate);

  async function send() {
    setTried(true);
    if (!note.trim() || missingExpiry.length) return;
    const fd = new FormData();
    fd.set('action', 'REPLY');
    fd.set('payload', JSON.stringify({ note: note.trim() }));
    const picked = Object.entries(files).filter(([, f]) => f.file);
    fd.set('fileMeta', JSON.stringify(picked.map(([kind, f]) => ({ kind, expiryDate: f.expiryDate || null }))));
    for (const [, f] of picked) fd.append('files', f.file!);
    await mutation.mutateAsync(fd);
    toast(`Reply sent for ${d.application.applicationNo}`);
  }

  return (
    <Card title="Reply to the deficiency">
      <div className="flex max-w-prose flex-col gap-4">
        <div className="rounded-lg border border-warning bg-warning-soft p-3">
          <p className="text-base font-medium text-warning">Returned on {formatDate(def.raisedAt)}</p>
          <p className="mt-1 text-base">{def.reason}</p>
          <p className="mt-1 text-sm text-secondary">Items asked for: {def.items.map((k) => d.requiredDocuments.find((r) => r.kind === k)?.label ?? k).join(', ')}</p>
        </div>
        {docKinds.map((k) => {
          const cfg = d.requiredDocuments.find((r) => r.kind === k)!;
          return (
            <div key={k} className="flex flex-col gap-2">
              <Field label={`New ${cfg.label.toLowerCase()}`} optional>
                {({ id }) => <FileUpload id={id} onFile={(f) => setFiles((x) => ({ ...x, [k]: { file: f, expiryDate: x[k]?.expiryDate ?? '' } }))} fileName={files[k]?.file?.name} />}
              </Field>
              {cfg.hasExpiry ? (
                <Field label="Expiry date of the new document" error={tried && missingExpiry.includes(k) ? 'Enter the expiry date' : null}>
                  {({ id, invalid }) => <DateInput id={id} invalid={invalid} value={files[k]?.expiryDate ?? ''} onChange={(e) => setFiles((x) => ({ ...x, [k]: { file: x[k]?.file ?? null, expiryDate: e.target.value } }))} />}
                </Field>
              ) : null}
            </div>
          );
        })}
        <Field label="Reply note" hint="Tell the officer what you changed or attached." error={tried && !note.trim() ? 'Enter a reply note' : null}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {mutation.error ? <p role="alert" className="text-base text-danger">{mutation.error instanceof ApiError ? mutation.error.message : 'The reply could not be sent.'}</p> : null}
        <div className="flex justify-end">
          <Button variant="primary" pending={mutation.isPending} pendingLabel="Sending…" onClick={send}>
            Send reply
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function CollegeCasePage() {
  const { id } = useParams();
  const q = useCase(id);
  useTitle(q.data ? q.data.application.applicationNo : 'Application');
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return <NoAccessPage />;
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const stageItem = d.deadlineItems.filter((i) => ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'].includes(i.type) && (i.status === 'OPEN' || i.status === 'PAUSED')).pop();
  const s = statusKind(d.application.status, stageItem?.daysToDue ?? null);
  const returned = d.permittedActions.includes('REPLY');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'My applications', to: '/college' }, { label: d.application.applicationNo }]}
        title={<span className="id-text text-xl">{d.application.applicationNo}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {d.application.typeLabel} · submitted {formatDate(d.application.submittedAt)}
            {d.rules ? ` · rules ${d.rules.cycle.replace('-', '–')} v${d.rules.version}` : ''} <StatusBadge kind={s.kind} label={s.label} />
          </span>
        }
      />
      <section className="rounded-lg border bg-surface p-4">
        <Tracker steps={d.routeSteps.map((r) => ({ label: r.label, state: r.state, date: r.completedAt ?? r.enteredAt ?? r.dueDate }))} />
        <p className="mt-4 border-t pt-3 text-base">
          <span className="text-secondary">With: </span>
          <span className="font-medium">{d.application.holderLabel}</span>
          {stageItem && stageItem.status === 'OPEN' ? <span className="tnum text-secondary"> · expected by {formatDate(stageItem.dueDate)} ({relativeDays(stageItem.daysToDue, stageItem.unit)})</span> : null}
          {stageItem && stageItem.status === 'PAUSED' ? <span className="text-secondary"> · the AICTE clock is paused until you reply</span> : null}
        </p>
      </section>
      {returned ? <ReplyForm d={d} /> : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <DocumentViewer documents={d.documents} title="Your documents" />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card title="Rounds">
            {d.deficiencies.length === 0 ? (
              <p className="text-base text-secondary">No deficiencies have been raised.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {d.deficiencies.map((x, i) => (
                  <li key={x.id} className="rounded-lg border p-3">
                    <p className="text-sm font-semibold">
                      Round {i + 1} · {formatDate(x.raisedAt)}
                    </p>
                    <p className="mt-1 text-base">{x.reason}</p>
                    <p className="mt-1 text-sm text-secondary">{x.resolvedAt ? `You replied ${formatDate(x.resolvedAt)}: ${x.replyNote}` : 'Waiting for your reply'}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {d.decision ? (
            <Card title="Decision">
              <p className="text-base">
                {d.decision.outcome === 'APPROVED' ? 'Approved' : d.decision.outcome === 'REJECTED' ? 'Rejected' : 'Approved with conditions'} on {formatDate(d.decision.at)}.
              </p>
              <p className="mt-1 text-base text-secondary">{d.decision.reason}</p>
            </Card>
          ) : null}
        </div>
      </div>
      <Table
        caption="History"
        rows={[...d.history].reverse()}
        rowKey={(r) => r.id}
        emptyMessage="No history yet."
        columns={[
          { key: 'at', header: 'When', render: (r) => <span className="tnum">{formatDateTime(r.at)}</span> },
          { key: 'what', header: 'What happened', render: (r) => ACTION_HISTORY_LABEL[r.action] ?? r.action },
          { key: 'details', header: 'Details', render: (r) => r.reason ?? '—', title: (r) => r.reason ?? '' },
        ]}
      />
    </div>
  );
}
