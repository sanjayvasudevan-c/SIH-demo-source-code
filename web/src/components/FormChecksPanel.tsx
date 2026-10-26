import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '../api/client';
import type { FormCheckView } from '../api/types';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, WarningList } from './ui';

function CheckBlock({ check, applicationId, canLabel, latest }: { check: FormCheckView; applicationId: string; canLabel: boolean; latest: boolean }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const label = async (i: number, useful: boolean) => {
    setPending(`${i}-${useful}`);
    await api.post(`/form-checks/${check.id}/label`, { warningIndex: i, useful }).finally(() => setPending(null));
    qc.invalidateQueries({ queryKey: ['case', applicationId] });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
        <Badge tone={check.severity === 'HIGH' ? 'danger' : check.severity === 'MEDIUM' ? 'warning' : 'success'}>{check.severity === 'NONE' ? 'No warnings' : check.severity === 'HIGH' ? 'High' : 'Medium'}</Badge>
        <span>{latest ? 'At submission' : 'While filling the form'}</span>
        <span>· {check.modelAvailable ? `model ${check.modelVersion}` : 'model unavailable, rules only'}</span>
        <span className="tnum">· {formatDateTime(check.createdAt)}</span>
      </div>
      <WarningList
        warnings={check.warnings}
        renderExtra={(_, i) => {
          const l = check.officerLabels[String(i)];
          return (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {l ? <span className="text-xs text-secondary">Marked {l.useful ? 'useful' : 'not useful'} by {l.byName} (model {l.modelVersion})</span> : null}
              {canLabel ? (
                <>
                  <Button size="sm" icon={<ThumbsUp size={16} aria-hidden />} pending={pending === `${i}-true`} aria-pressed={l?.useful === true} onClick={() => label(i, true)}>
                    Useful
                  </Button>
                  <Button size="sm" icon={<ThumbsDown size={16} aria-hidden />} pending={pending === `${i}-false`} aria-pressed={l?.useful === false} onClick={() => label(i, false)}>
                    Not useful
                  </Button>
                </>
              ) : null}
            </div>
          );
        }}
      />
      {check.justification ? (
        <div className="rounded-lg border bg-page p-3">
          <h3 className="text-sm font-semibold text-secondary">College's justification</h3>
          <p className="mt-1 text-base">{check.justification}</p>
        </div>
      ) : null}
    </div>
  );
}

/** "Check my entries" results for this application: the check at submission and earlier checks with warnings. */
export function FormChecksPanel({ checks, applicationId, canLabel }: { checks: FormCheckView[]; applicationId: string; canLabel: boolean }) {
  const [latest, ...earlier] = checks;
  const earlierWithWarnings = earlier.filter((c) => c.warnings.length > 0);
  return (
    <Card title="Form checks">
      {!latest ? (
        <EmptyState message="No form checks were stored for this application." />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">Advisory only. It never blocks filing or changes routing, deadlines or assignment.</p>
          <CheckBlock check={latest} applicationId={applicationId} canLabel={canLabel} latest />
          {earlierWithWarnings.length ? (
            <div className="flex flex-col gap-4 border-t pt-4">
              <h3 className="text-sm font-semibold text-secondary">Earlier checks with warnings ({earlierWithWarnings.length} of {earlier.length})</h3>
              {earlierWithWarnings.map((c) => (
                <CheckBlock key={c.id} check={c} applicationId={applicationId} canLabel={canLabel} latest={false} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
