// /rules: approval cycles and their rule pack versions. Rule editors draft amendments, create cycles and import.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, Upload } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useMe } from '../../auth/AuthContext';
import { Badge, Button, Card, DateInput, Dialog, Field, Input, PageHeader, Select, Table, Textarea, useToast } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';
import { useClock } from '../../components/Layout';
import { useT } from '../../lib/prefs';
import { AMENDMENT_KINDS, KIND_LABEL, STATUS_LABEL, STATUS_TONE, cycleLabel, type CycleRow } from './types';

export function useCycles() {
  return useQuery({ queryKey: ['rules', 'cycles'], queryFn: () => api.get<{ cycles: CycleRow[] }>('/rules/cycles') });
}

/** Today on the (possibly simulated) server clock. */
export function useToday(): string {
  return useClock().data?.today ?? '';
}

export function RulesHomePage() {
  const t = useT();
  useTitle(t.rules.center);
  const me = useMe();
  const navigate = useNavigate();
  const cycles = useCycles();
  const [draftOpen, setDraftOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const editor = me.role === 'RULE_EDITOR';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.rules.center}
        description={t.rules.intro}
        actions={
          editor ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<FilePlus2 size={18} aria-hidden />} onClick={() => setDraftOpen(true)}>
                {t.rules.draft}
              </Button>
              <Button onClick={() => setCycleOpen(true)}>{t.rules.newCycle}</Button>
              <Button icon={<Upload size={18} aria-hidden />} onClick={() => setImportOpen(true)}>
                {t.rules.importJson}
              </Button>
            </div>
          ) : null
        }
      />
      <Table
        caption={t.rules.cycles}
        loading={cycles.isLoading}
        error={cycles.error ? (cycles.error as Error).message : null}
        onRetry={() => void cycles.refetch()}
        rows={cycles.data?.cycles}
        rowKey={(c) => c.id}
        emptyMessage="No approval cycles yet."
        onRowClick={(c) => c.published && navigate(`/rules/versions/${c.published.id}`)}
        rowLabel={(c) => `Open the published rules of ${cycleLabel(c.code)}`}
        columns={[
          { key: 'cycle', header: t.rules.cycle, render: (c) => <span className="font-medium">{cycleLabel(c.code)}</span> },
          { key: 'pub', header: t.rules.publishedVersion, render: (c) => (c.published ? `v${c.published.version}` : '—') },
          { key: 'eff', header: t.rules.effectiveFrom, render: (c) => (c.published ? formatDate(c.published.effectiveFrom) : '—') },
          { key: 'pinned', header: t.rules.pinnedOpen, align: 'right', render: (c) => c.pinnedOpenCases },
          { key: 'draft', header: t.rules.draftInProgress, render: (c) => (c.draftInProgress ? `v${c.draftInProgress.version} · ${STATUS_LABEL[c.draftInProgress.status].toLowerCase()}` : 'None') },
        ]}
      />
      {(cycles.data?.cycles ?? []).map((c) => (
        <Card key={c.id} title={t.rules.versionsOf(cycleLabel(c.code))}>
          <p className="mb-3 text-sm text-secondary">Base: {c.baseRef}</p>
          <Table
            caption={`Rule pack versions of ${cycleLabel(c.code)}`}
            rows={c.versions}
            rowKey={(v) => v.id}
            emptyMessage="No versions yet."
            onRowClick={(v) => navigate(`/rules/versions/${v.id}`)}
            rowLabel={(v) => `Open version ${v.version}`}
            columns={[
              { key: 'v', header: t.rules.version, render: (v) => <span className="tnum font-medium">v{v.version}</span> },
              { key: 'kind', header: t.rules.amendment, wrap: true, render: (v) => (v.kind ? `${KIND_LABEL[v.kind] ?? v.kind} · ${v.refNo}` : '—') },
              { key: 'issued', header: t.rules.issuedOn, render: (v) => (v.issuedOn ? formatDate(v.issuedOn) : '—') },
              { key: 'status', header: t.track.status, render: (v) => <Badge tone={STATUS_TONE[v.status]}>{t.rules.status[v.status]}{v.scheduledPublish ? ' · scheduled' : ''}</Badge> },
              { key: 'maker', header: t.rules.maker, render: (v) => v.maker ?? '—' },
              { key: 'checker', header: t.rules.checker, render: (v) => v.checker ?? '—' },
              { key: 'pinned', header: t.rules.openCases, align: 'right', render: (v) => v.pinnedOpenCases },
            ]}
          />
        </Card>
      ))}
      <DraftDialog open={draftOpen} onClose={() => setDraftOpen(false)} cycles={cycles.data?.cycles ?? []} onCreated={(id) => navigate(`/rules/versions/${id}`)} />
      <CycleDialog open={cycleOpen} onClose={() => setCycleOpen(false)} cycles={cycles.data?.cycles ?? []} onCreated={(id) => navigate(`/rules/versions/${id}`)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onCreated={(id) => navigate(`/rules/versions/${id}`)} />
    </div>
  );
}

interface AmendmentForm {
  kind: string;
  refNo: string;
  issuedOn: string;
  title: string;
  summary: string;
}

function AmendmentFields({ value, onChange }: { value: AmendmentForm; onChange: (v: AmendmentForm) => void }) {
  return (
    <>
      <Field label="Source">
        {({ id }) => (
          <Select id={id} value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value })}>
            {AMENDMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Reference number" hint="As printed on the source document.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={value.refNo} onChange={(e) => onChange({ ...value, refNo: e.target.value })} />}
      </Field>
      <Field label="Issued on">{({ id }) => <DateInput id={id} value={value.issuedOn} onChange={(e) => onChange({ ...value, issuedOn: e.target.value })} />}</Field>
      <Field label="Title">{({ id }) => <Input id={id} value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />}</Field>
      <Field label="Summary for colleges" hint="Plain language: what changes and who it affects.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={value.summary} onChange={(e) => onChange({ ...value, summary: e.target.value })} />}
      </Field>
    </>
  );
}

const emptyAmendment = (today: string): AmendmentForm => ({ kind: 'CIRCULAR', refNo: '', issuedOn: today, title: '', summary: '' });

function DraftDialog({ open, onClose, cycles, onCreated }: { open: boolean; onClose: () => void; cycles: CycleRow[]; onCreated: (id: string) => void }) {
  const toast = useToast();
  const today = useToday();
  const [cycleId, setCycleId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [a, setA] = useState(() => emptyAmendment(today));
  useEffect(() => {
    if (open) {
      setEffectiveFrom(today);
      setA(emptyAmendment(today));
    }
  }, [open, today]);
  const cycle = cycles.find((c) => c.id === (cycleId || cycles[0]?.id));
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/rules/versions', { parentVersionId: cycle?.published?.id, effectiveFrom, amendment: a }),
    onSuccess: (r) => {
      toast('Draft created');
      onCreated(r.id);
    },
  });
  return (
    <Dialog
      open={open}
      title="Draft an amendment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={create.isPending} disabled={!cycle?.published || !a.refNo.trim() || !a.title.trim() || !a.summary.trim()} disabledReason="Fill in the reference, title and summary." onClick={() => create.mutate()}>
            Create draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Cycle" hint="The draft starts as a copy of the cycle's published version.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={cycle?.id ?? ''} onChange={(e) => setCycleId(e.target.value)}>
              {cycles.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.published}>
                  {cycleLabel(c.code)} {c.published ? `(from v${c.published.version})` : '(nothing published)'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Effective from">{({ id }) => <DateInput id={id} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />}</Field>
        <AmendmentFields value={a} onChange={setA} />
        {create.error ? <p role="alert" className="text-sm text-danger">{(create.error as Error).message}</p> : null}
      </div>
    </Dialog>
  );
}

function CycleDialog({ open, onClose, cycles, onCreated }: { open: boolean; onClose: () => void; cycles: CycleRow[]; onCreated: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [from, setFrom] = useState('');
  const today = useToday();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [a, setA] = useState<AmendmentForm>(() => ({ ...emptyAmendment(today), kind: 'APH' }));
  useEffect(() => {
    if (open) {
      setEffectiveFrom(today);
      setA({ ...emptyAmendment(today), kind: 'APH' });
    }
  }, [open, today]);
  const sources = cycles.flatMap((c) => c.versions.filter((v) => v.status === 'PUBLISHED').map((v) => ({ id: v.id, label: `${cycleLabel(c.code)} v${v.version}` })));
  const create = useMutation({
    mutationFn: () => api.post<{ versionId: string }>('/rules/cycles', { code, copyFromVersionId: from || sources[0]?.id, effectiveFrom, amendment: a }),
    onSuccess: (r) => onCreated(r.versionId),
  });
  return (
    <Dialog
      open={open}
      title="Start a new approval cycle"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={create.isPending} disabled={!/^\d{4}-\d{2}$/.test(code) || !a.refNo.trim() || !a.title.trim() || !a.summary.trim()} disabledReason="Enter a cycle code like 2028-29 and the source details." onClick={() => create.mutate()}>
            Create cycle
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Cycle code" hint="For example 2028-29.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Field label="Copy rules from">
          {({ id }) => (
            <Select id={id} value={from || sources[0]?.id || ''} onChange={(e) => setFrom(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Effective from">{({ id }) => <DateInput id={id} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />}</Field>
        <AmendmentFields value={a} onChange={setA} />
        {create.error ? <p role="alert" className="text-sm text-danger">{(create.error as Error).message}</p> : null}
      </div>
    </Dialog>
  );
}

function ImportDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<{ path: string; message: string }[]>([]);
  const [pending, setPending] = useState(false);
  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setDetails([]);
    setPending(true);
    try {
      const json = JSON.parse(await f.text());
      const r = await api.post<{ id: string; hashMatched: boolean }>('/rules/import', json);
      toast(r.hashMatched ? 'Imported as a new draft' : 'Imported as a new draft; the file’s hash did not match its content');
      onCreated(r.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The file is not valid JSON.');
      const errs = (e as ApiError).details as { errors?: { path: string; message: string }[] } | undefined;
      setDetails(errs?.errors ?? []);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} title="Import rules from a JSON file" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-base text-secondary">Choose a file exported from the Rules Center. It becomes a new draft of its cycle; nothing in it is run, and it is checked against the schema first.</p>
        <Field label="JSON file">{({ id }) => <input id={id} type="file" accept="application/json,.json" disabled={pending} onChange={(e) => void onFile(e.target.files?.[0])} className="text-base" />}</Field>
        {error ? (
          <div role="alert" className="text-sm text-danger">
            <p>{error}</p>
            <ul className="mt-1 list-disc pl-5">
              {details.slice(0, 10).map((d) => (
                <li key={d.path + d.message}>
                  <span className="font-mono">{d.path}</span>: {d.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
