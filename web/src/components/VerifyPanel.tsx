import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { CaseDetail } from '../api/types';
import { Button, Card, Field, ReasonDialog, Textarea, useToast } from './ui';

/** Verification tasks the officer holds on this case: undertaking evidence and document renewals. */
export function VerifyPanel({ detail }: { detail: CaseDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<CaseDetail['verifyTasks'][number] | null>(null);
  const [remarks, setRemarks] = useState('');
  const m = useMutation({
    mutationFn: (v: { task: CaseDetail['verifyTasks'][number]; accept: boolean; remarks?: string }) =>
      api.post(v.task.kind === 'EVIDENCE' ? `/undertakings/${v.task.refId}/verify` : `/documents/${v.task.refId}/verify-renewal`, { accept: v.accept, remarks: v.remarks }),
    onSuccess: (_d, v) => {
      toast(`${v.task.title} ${v.accept ? 'verified' : 'returned to the college'} for ${detail.application.applicationNo}`);
      setRejecting(null);
      setRemarks('');
      qc.invalidateQueries();
    },
  });
  if (!detail.verifyTasks?.length) return null;
  return (
    <Card title="Verification">
      <ul className="flex flex-col gap-4">
        {detail.verifyTasks.map((t) => (
          <li key={t.refId} className="flex flex-col gap-2">
            <p className="text-base font-medium">{t.title}</p>
            <p className="text-sm text-secondary">{t.detail}. The file is in the documents list.</p>
            <Field label="Remarks" optional>
              {({ id }) => <Textarea id={id} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" pending={m.isPending && m.variables?.task.refId === t.refId && m.variables.accept} onClick={() => m.mutate({ task: t, accept: true, remarks: remarks.trim() || undefined })}>
                Verify
              </Button>
              <Button variant="destructive" onClick={() => setRejecting(t)}>
                Reject with remarks
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {m.error ? <p role="alert" className="mt-2 text-sm text-danger">{m.error instanceof ApiError ? m.error.message : 'Could not save.'}</p> : null}
      <ReasonDialog
        open={!!rejecting}
        title={rejecting ? `Reject the ${rejecting.title.toLowerCase()}?` : ''}
        body="The college is told what is wrong and can upload again. The due date does not change."
        reasonLabel="Remarks for the college"
        confirmLabel="Reject"
        destructive
        pending={m.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(r) => rejecting && m.mutate({ task: rejecting, accept: false, remarks: r })}
      />
    </Card>
  );
}
