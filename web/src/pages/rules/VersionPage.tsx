// /rules/versions/:id (+ /diff, /impact, /review): one rule pack version, its section editors, its diff against the
// version it replaces, the impact preview and the approver's review.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, ApiError, downloadBlob } from '../../api/client';
import { Badge, Button, Card, ConfirmDialog, DateInput, Dialog, ErrorState, Field, Input, PageHeader, ReasonDialog, Select, Skeleton, Tabs, Textarea, useToast } from '../../components/ui';
import { cx, formatDate, formatDateTime } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';
import { useMe } from '../../auth/AuthContext';
import { useT } from '../../lib/prefs';
import type { VarList } from './ConditionBuilder';
import { SectionEditor } from './sections';
import { useToday } from './RulesHome';
import { KIND_LABEL, SECTION_LIST, STATUS_LABEL, STATUS_TONE, cycleLabel, sourceText, type DiffChange, type Impact, type Pack, type SectionId, type VersionDetail } from './types';

function useVersion(id: string) {
  return useQuery({ queryKey: ['rules', 'version', id], queryFn: () => api.get<VersionDetail>(`/rules/versions/${id}`) });
}

function useVars() {
  return useQuery({ queryKey: ['rules', 'vars'], queryFn: () => api.get<VarList>('/rules/vars'), staleTime: Infinity });
}

function errMsg(e: unknown): string | null {
  return e ? (e instanceof ApiError ? e.message : 'Something went wrong. Try again.') : null;
}

/** Header: version, status, hash, source chip and the one primary action allowed for the status and role. */
function VersionHeader({ v, current }: { v: VersionDetail; current: 'edit' | 'diff' | 'impact' | 'review' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<null | 'submit' | 'publish' | 'schedule'>(null);
  const today = useToday();
  const t = useT();
  const me = useMe();
  const [rollback, setRollback] = useState(false);
  const canRollback = me.role === 'RULE_EDITOR' && v.status === 'SUPERSEDED' && !!v.cyclePublished;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['rules'] });
  };
  const act = useMutation({
    mutationFn: (what: 'submit' | 'publish' | 'schedule') => api.post<{ rebased?: number; scheduled?: boolean }>(`/rules/versions/${v.id}/${what === 'schedule' ? 'publish' : what}`, what === 'schedule' ? { scheduled: true } : {}),
    onSuccess: (r, what) => {
      setConfirm(null);
      toast(what === 'submit' ? 'Submitted for review' : r.scheduled ? `Scheduled to publish on ${formatDate(v.effectiveFrom)}` : `Published${r.rebased ? `; ${r.rebased} open cases moved to this version` : ''}`);
      refresh();
    },
  });
  const p = v.permissions;
  const future = v.effectiveFrom > (today || v.effectiveFrom);
  const primary: ReactNode = p.canSubmit ? (
    <Button variant="primary" disabled={v.errors.length > 0} disabledReason="Fix the errors first." onClick={() => setConfirm('submit')}>
      Submit for review
    </Button>
  ) : p.canReview ? (
    <Button variant="primary" onClick={() => navigate(`/rules/versions/${v.id}/review`)}>
      Approve
    </Button>
  ) : p.canPublish ? (
    <Button variant="primary" onClick={() => setConfirm(future ? 'schedule' : 'publish')}>
      {future ? 'Schedule publication' : 'Publish'}
    </Button>
  ) : v.permissions.reviewBlockedReason ? (
    <Button variant="primary" disabled disabledReason={v.permissions.reviewBlockedReason}>
      Approve
    </Button>
  ) : null;
  const tabs = [
    { id: 'edit', label: t.rules.rulesTab, to: `/rules/versions/${v.id}` },
    { id: 'diff', label: t.rules.changes, to: `/rules/versions/${v.id}/diff` },
    { id: 'impact', label: t.rules.impact, to: `/rules/versions/${v.id}/impact` },
    ...(p.canReview || v.permissions.reviewBlockedReason ? [{ id: 'review', label: t.rules.review, to: `/rules/versions/${v.id}/review` }] : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        breadcrumb={[{ label: t.rules.center, to: '/rules' }, { label: `${cycleLabel(v.cycle.code)} v${v.version}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {cycleLabel(v.cycle.code)} · version {v.version}
            <Badge tone={STATUS_TONE[v.status]}>
              {t.rules.status[v.status]}
              {v.scheduledPublish ? ' · scheduled' : ''}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {v.amendment ? <Badge tone="neutral">{`${KIND_LABEL[v.amendment.kind] ?? v.amendment.kind} · ${v.amendment.refNo}`}</Badge> : null}
            <span>Effective from {formatDate(v.effectiveFrom)}</span>
            <span>
              Hash <span className="font-mono">{v.contentHash.slice(0, 12)}</span>
            </span>
            <span>Maker: {v.maker}</span>
            {v.checker ? <span>Checker: {v.checker}</span> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {primary}
            {canRollback ? <Button onClick={() => setRollback(true)}>Roll back to this version</Button> : null}
            <Button icon={<Download size={18} aria-hidden />} onClick={() => void downloadBlob(`/rules/versions/${v.id}/export`).then((b) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `rules-${v.cycle.code}-v${v.version}.json`; a.click(); URL.revokeObjectURL(u); })}>
              {t.rules.export}
            </Button>
          </div>
        }
      />
      {v.status === 'REJECTED' && v.rejectedRemarks ? (
        <div role="status" className="rounded border border-danger bg-danger-soft px-4 py-3 text-sm">
          <span className="font-medium">Returned by the approver:</span> {v.rejectedRemarks} Edit the draft and submit it again.
        </div>
      ) : null}
      <nav aria-label="Version views" className="flex gap-4 border-b">
        {tabs.map((t) => (
          <NavLink key={t.id} to={t.to} end className={cx('hit -mb-px border-b-2 px-1 py-2 text-base', current === t.id ? 'border-accent font-semibold text-accent' : 'border-transparent text-secondary hover:text-primary')} aria-current={current === t.id ? 'page' : undefined}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <RollbackDialog open={rollback} v={v} onClose={() => setRollback(false)} onCreated={(nid) => navigate(`/rules/versions/${nid}`)} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'submit' ? 'Submit this version for review?' : confirm === 'schedule' ? 'Schedule this version?' : 'Publish this version?'}
        body={
          confirm === 'submit'
            ? 'Its content is frozen from now on. A rule approver who did not edit it will review it.'
            : confirm === 'schedule'
              ? `The engine publishes it on ${formatDate(v.effectiveFrom)}. Until then the current version stays in force.`
              : `It replaces the current published version of ${cycleLabel(v.cycle.code)} from today. New filings use it at once; open cases move only if the amendment is marked for live cases.`
        }
        confirmLabel={confirm === 'submit' ? 'Submit for review' : confirm === 'schedule' ? 'Schedule' : 'Publish'}
        pending={act.isPending}
        error={errMsg(act.error)}
        onConfirm={() => confirm && act.mutate(confirm)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function RollbackDialog({ open, v, onClose, onCreated }: { open: boolean; v: VersionDetail; onClose: () => void; onCreated: (id: string) => void }) {
  const today = useToday();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [summary, setSummary] = useState('');
  const qc = useQueryClient();
  useEffect(() => {
    if (open) {
      setEffectiveFrom(today);
      setSummary(`The rules of ${cycleLabel(v.cycle.code)} return to those of version ${v.version}.`);
    }
  }, [open, today, v]);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/rules/versions/${v.cyclePublished!.id}/rollback-to/${v.id}`, { effectiveFrom, summary }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['rules'] });
      onCreated(r.id);
    },
  });
  return (
    <Dialog
      open={open}
      title={`Roll back ${cycleLabel(v.cycle.code)} to version ${v.version}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={create.isPending} onClick={() => create.mutate()}>
            Create the rollback draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-base text-secondary">
          A new draft is created with the content of version {v.version}. History is not edited: v{v.cyclePublished?.version} stays on record, and a rule approver must still approve and publish the rollback. Open cases keep their pinned version unless the rollback is marked for live cases.
        </p>
        <Field label="Effective from">{({ id }) => <DateInput id={id} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />}</Field>
        <Field label="Summary for colleges">{({ id }) => <Textarea id={id} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        {create.error ? <p role="alert" className="text-sm text-danger">{errMsg(create.error)}</p> : null}
      </div>
    </Dialog>
  );
}

function Loading({ q }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  if (q.isLoading) return <Skeleton lines={6} />;
  return <ErrorState message={errMsg(q.error) ?? undefined} onRetry={() => void q.refetch()} />;
}

// ---------------------------------------------------------------- edit

export function VersionPage() {
  const { id = '' } = useParams();
  const q = useVersion(id);
  const v = q.data;
  useTitle(v ? `${cycleLabel(v.cycle.code)} v${v.version} · Rules` : 'Rules');
  if (!v) return <Loading q={q} />;
  return (
    <div className="flex flex-col gap-6">
      <VersionHeader v={v} current="edit" />
      <VersionEditor key={`${v.id}-${v.contentHash}`} v={v} />
    </div>
  );
}

function VersionEditor({ v }: { v: VersionDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const vars = useVars();
  const [pack, setPack] = useState<Pack>(v.content);
  const [section, setSection] = useState<SectionId>('programmes');
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState(() => JSON.stringify(v.content, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [errors, setErrors] = useState(v.errors);
  const editable = v.permissions.canEdit;
  const dirtySections = useMemo(() => SECTION_LIST.filter((s) => JSON.stringify(pack[s.id]) !== JSON.stringify(v.content[s.id])).map((s) => s.id), [pack, v.content]);
  const save = useMutation({
    mutationFn: () => api.patch<{ errors: { path: string; message: string }[] }>(`/rules/versions/${v.id}`, { patch: dirtySections.map((s) => ({ op: 'replace', path: `/${s}`, value: pack[s] })) }),
    onSuccess: (r) => {
      setErrors(r.errors);
      toast(r.errors.length ? `Saved with ${r.errors.length} ${r.errors.length === 1 ? 'error' : 'errors'} to fix` : 'Saved');
      void qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });
  useEffect(() => {
    if (tab === 'json') setJson(JSON.stringify(pack, null, 2));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorCount = (s: string) => errors.filter((e) => e.path === s || e.path.startsWith(`${s}.`) || e.path.startsWith(`${s}[`)).length;

  return (
    <div className="flex flex-col gap-6">
      <AmendmentCard v={v} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <nav aria-label="Sections" className="lg:col-span-3">
          <ul className="flex flex-col gap-1">
            {SECTION_LIST.map((s) => {
              const changed = v.changedBySection[s.id] ?? 0;
              const errs = errorCount(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={section === s.id ? 'true' : undefined}
                    onClick={() => {
                      setSection(s.id);
                      setTab('form');
                    }}
                    className={cx('hit flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-base', section === s.id ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-subtle')}
                  >
                    <span>{t.rules.sections[s.id] ?? s.label}</span>
                    <span className="flex gap-1">
                      {changed ? <Badge tone="accent">{`${changed} changed`}</Badge> : null}
                      {errs ? <Badge tone="danger">{`${errs} to fix`}</Badge> : null}
                      {dirtySections.includes(s.id) ? <Badge tone="warning">Unsaved</Badge> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-4 lg:col-span-9">
          <Tabs label="Editor" value={tab} onChange={setTab} tabs={[{ id: 'form', label: SECTION_LIST.find((s) => s.id === section)!.label }, { id: 'json', label: 'Advanced (JSON)' }]} />
          {tab === 'form' ? (
            <SectionEditor section={section} pack={pack} set={setPack} editable={editable} vars={vars.data} errors={errors} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-secondary">The whole pack as JSON. It is checked against the schema as you type and again when saved.</p>
              <Textarea
                aria-label="Rule pack JSON"
                className="font-mono text-xs"
                rows={28}
                disabled={!editable}
                value={json}
                onChange={(e) => {
                  setJson(e.target.value);
                  try {
                    setPack(JSON.parse(e.target.value) as Pack);
                    setJsonError(null);
                  } catch (err) {
                    setJsonError(`Not valid JSON: ${(err as Error).message}`);
                  }
                }}
              />
              {jsonError ? <p className="text-sm text-danger">{jsonError}</p> : null}
            </div>
          )}
          {errors.length ? (
            <div role="status" className="rounded border border-danger bg-danger-soft p-3 text-sm">
              <p className="font-medium">{errors.length} {errors.length === 1 ? 'problem' : 'problems'} to fix before review</p>
              <ul className="mt-1 list-disc pl-5">
                {errors.slice(0, 8).map((e) => (
                  <li key={e.path + e.message}>
                    <span className="font-mono text-xs">{e.path}</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {editable ? (
            <div className="flex items-center gap-3">
              <Button variant="primary" pending={save.isPending} disabled={!dirtySections.length || !!jsonError} disabledReason="No unsaved changes." onClick={() => save.mutate()}>
                Save draft
              </Button>
              <Button variant="tertiary" disabled={!dirtySections.length} onClick={() => setPack(v.content)}>
                Discard changes
              </Button>
              {save.error ? <p role="alert" className="text-sm text-danger">{errMsg(save.error)}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-secondary">{v.status === 'DRAFT' || v.status === 'REJECTED' ? 'Read only: only rule editors change drafts.' : `Read only: a ${STATUS_LABEL[v.status].toLowerCase()} version cannot change. History is never edited; draft an amendment instead.`}</p>
          )}
          <HistoryCard v={v} />
        </div>
      </div>
    </div>
  );
}

/** The amendment: source, summary for colleges, effective date and apply scope per changed path. */
function AmendmentCard({ v }: { v: VersionDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const a = v.amendment;
  const editable = v.permissions.canEdit;
  const diff = useQuery({ queryKey: ['rules', 'diff', v.id], queryFn: () => api.get<{ changes: DiffChange[] }>(`/rules/versions/${v.id}/diff`) });
  const [form, setForm] = useState({ refNo: a?.refNo ?? '', issuedOn: a?.issuedOn ?? '', title: a?.title ?? '', summary: a?.summary ?? '', effectiveFrom: v.effectiveFrom, applyScope: a?.applyScope ?? {} });
  const save = useMutation({
    mutationFn: () => api.patch(`/rules/versions/${v.id}`, { amendment: { refNo: form.refNo, issuedOn: form.issuedOn, title: form.title, summary: form.summary, applyScope: form.applyScope }, effectiveFrom: form.effectiveFrom }),
    onSuccess: () => {
      toast('Amendment saved');
      void qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });
  const paths = [...new Set((diff.data?.changes ?? []).map((c) => c.path.split('.').slice(0, 2).join('.')))];
  if (!a) return null;
  return (
    <Card title="Amendment" action={sourceText({ ref: a.refNo }) ? <Badge tone="neutral">{KIND_LABEL[a.kind] ?? a.kind}</Badge> : null}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Title">{({ id }) => <Input id={id} disabled={!editable} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Reference">{({ id }) => <Input id={id} disabled={!editable} value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })} />}</Field>
            <Field label="Issued on">{({ id }) => <DateInput id={id} disabled={!editable} value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} />}</Field>
            <Field label="Effective from">{({ id }) => <DateInput id={id} disabled={!editable} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />}</Field>
          </div>
          <Field label="Summary for colleges">{({ id }) => <Textarea id={id} rows={3} disabled={!editable} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />}</Field>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Apply to</h3>
          <p className="text-sm text-secondary">Every change applies to new filings. Mark a change for live cases only when it relaxes the rules (a later date, a longer period, a lower minimum); the check on submit refuses anything else.</p>
          {paths.length === 0 ? <p className="text-sm text-muted">No changes from the published version yet.</p> : null}
          <ul className="flex flex-col gap-1">
            {paths.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                <span className="truncate font-mono text-xs" title={p}>
                  {p}
                </span>
                <Select aria-label={`Apply scope of ${p}`} className="h-control-sm w-48 text-sm" disabled={!editable} value={form.applyScope[p] ?? 'NEW_CASES'} onChange={(e) => setForm({ ...form, applyScope: { ...form.applyScope, [p]: e.target.value as 'NEW_CASES' | 'LIVE' } })}>
                  <option value="NEW_CASES">New cases only</option>
                  <option value="LIVE">Live cases too</option>
                </Select>
              </li>
            ))}
          </ul>
          {editable ? (
            <div className="mt-2">
              <Button pending={save.isPending} onClick={() => save.mutate()}>
                Save amendment
              </Button>
              {save.error ? <p role="alert" className="mt-1 text-sm text-danger">{errMsg(save.error)}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  RULES_DRAFTED: 'Drafted',
  RULES_EDITED: 'Edited',
  RULES_SUBMITTED: 'Submitted for review',
  RULES_APPROVED: 'Approved',
  RULES_REJECTED: 'Returned to the maker',
  RULES_PUBLISHED: 'Published',
  RULES_ROLLED_BACK: 'Published as a rollback',
  RULES_PUBLISH_SCHEDULED: 'Publication scheduled',
  RULES_IMPORTED: 'Imported',
  RULES_EXPORTED: 'Exported',
  RULES_DELETED: 'Deleted',
};

function HistoryCard({ v }: { v: VersionDetail }) {
  return (
    <Card title="History">
      <ol className="flex flex-col gap-2">
        {v.history.map((h, i) => (
          <li key={i} className="flex flex-wrap gap-x-3 text-sm">
            <span className="tnum text-muted">{formatDateTime(h.at)}</span>
            <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
            <span>by {h.actor}</span>
            {h.reason ? <span className="text-secondary">· {h.reason}</span> : null}
            {Array.isArray(h.meta.paths) && (h.meta.paths as string[]).length ? <span className="font-mono text-xs text-muted">{(h.meta.paths as string[]).join(', ')}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------- diff

const OP_LABEL = { add: 'Added', remove: 'Removed', change: 'Changed' } as const;
const OP_TONE = { add: 'success', remove: 'danger', change: 'accent' } as const;
const CLASS_TONE = { relaxing: 'success', tightening: 'warning', neutral: 'neutral' } as const;
const CLASS_LABEL = { relaxing: 'Relaxing', tightening: 'Tightening', neutral: 'Neutral' } as const;

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  const o = v as Record<string, unknown>;
  if (typeof o.label === 'string') return o.label;
  return JSON.stringify(v);
}

export function DiffList({ changes }: { changes: DiffChange[] }) {
  const bySection = SECTION_LIST.map((s) => ({ ...s, changes: changes.filter((c) => c.section === s.id) })).filter((s) => s.changes.length);
  if (!bySection.length) return <p className="text-base text-secondary">No changes.</p>;
  return (
    <div className="flex flex-col gap-6">
      {bySection.map((s) => (
        <section key={s.id} aria-labelledby={`diff-${s.id}`}>
          <h3 id={`diff-${s.id}`} className="mb-2 text-base font-semibold">
            {s.label} <span className="font-normal text-muted">({s.changes.length})</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {s.changes.map((c) => (
              <li key={c.path + c.op} className={cx('rounded border-l-4 border bg-surface p-3', c.op === 'add' ? 'border-l-success' : c.op === 'remove' ? 'border-l-danger' : 'border-l-accent')}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={OP_TONE[c.op]}>{OP_LABEL[c.op]}</Badge>
                  <Badge tone={CLASS_TONE[c.classification]}>{CLASS_LABEL[c.classification]}</Badge>
                  <Badge tone={c.applyScope === 'LIVE' ? 'accent' : 'neutral'}>{c.applyScope === 'LIVE' ? 'Live cases too' : 'New cases only'}</Badge>
                  {sourceText(c.source) ? <Badge tone="neutral">{sourceText(c.source)!}</Badge> : null}
                  <span className="font-mono text-xs text-muted">{c.path}</span>
                </div>
                <p className="mt-1 text-sm">{c.reason}</p>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-xs font-medium text-muted">Before</span>
                    <p className={cx('break-words', c.op === 'remove' && 'line-through')}>{show(c.old)}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted">After</span>
                    <p className="break-words">{show(c.new)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function useDiff(id: string) {
  return useQuery({ queryKey: ['rules', 'diff', id], queryFn: () => api.get<{ against: { id: string; version: number } | null; changes: DiffChange[] }>(`/rules/versions/${id}/diff`) });
}

export function DiffPage() {
  const { id = '' } = useParams();
  const q = useVersion(id);
  const d = useDiff(id);
  useTitle('Changes · Rules');
  if (!q.data) return <Loading q={q} />;
  return (
    <div className="flex flex-col gap-6">
      <VersionHeader v={q.data} current="diff" />
      {d.data ? (
        <>
          <p className="text-base text-secondary">{d.data.against ? `Compared with v${d.data.against.version}: ${d.data.changes.length} ${d.data.changes.length === 1 ? 'change' : 'changes'}.` : 'This is the first version of the cycle.'}</p>
          <DiffList changes={d.data.changes} />
        </>
      ) : (
        <Loading q={d} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- impact

function Expand({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="rounded border bg-surface p-3">
      <summary className="hit cursor-pointer text-base font-medium">
        {title} <span className="font-normal text-muted">({count})</span>
      </summary>
      <div className="mt-2 text-sm">{children}</div>
    </details>
  );
}

export function ImpactView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['rules', 'impact', id], queryFn: () => api.get<Impact>(`/rules/versions/${id}/impact`) });
  const i = q.data;
  if (!i) return <Loading q={q} />;
  return (
    <div className="flex flex-col gap-4">
      <Card title={`Compared with the published v${i.against.version}`}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
          {i.sentences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">A dry run: nothing was changed. Computed in {i.ms} ms.</p>
      </Card>
      <Expand title="Deadlines that would move" count={i.live.moves.length}>
        <ul className="flex flex-col gap-1">
          {i.live.moves.map((m) => (
            <li key={`${m.applicationNo}-${m.item}-${m.oldDue}`}>
              <Link className="text-accent underline" to={`/cases/${m.applicationId}`}>
                {m.applicationNo}
              </Link>{' '}
              · {m.item}: {m.pausedDaysAdded !== null ? `paused; ${m.pausedDaysAdded} more working days when resumed` : `${formatDate(m.oldDue)} → ${formatDate(m.newDue)}`}
            </li>
          ))}
        </ul>
      </Expand>
      <Expand title="Route changes for new filings" count={i.newFilings.routeChanges.length}>
        <ul>{i.newFilings.routeChanges.map((r) => <li key={r.type}>{r.sentence} {r.applications.join(', ')}</li>)}</ul>
      </Expand>
      <Expand title="Newly missing critical documents" count={i.newFilings.missingDocs.reduce((n, d) => n + d.count, 0)}>
        <ul>{i.newFilings.missingDocs.map((d) => <li key={d.kind}>{d.label}: {d.count} ({d.applications.join(', ')})</li>)}</ul>
      </Expand>
      <Expand title="Outside purview or eligibility" count={i.newFilings.outsidePurview.length}>
        <ul>{i.newFilings.outsidePurview.map((p) => <li key={p.applicationNo + p.reason}>{p.applicationNo}: {p.reason}</li>)}</ul>
      </Expand>
      <Expand title="Form check warnings by rule" count={i.formCheck.rules.length}>
        <table className="text-sm">
          <caption className="sr-only">Form check rule hits before and after</caption>
          <thead>
            <tr className="text-left text-secondary">
              <th className="pr-4">Rule</th>
              <th className="pr-4">{i.formCheck.samples} samples</th>
              <th>{i.formCheck.seeded} seeded checks</th>
            </tr>
          </thead>
          <tbody>
            {i.formCheck.rules.map((r) => (
              <tr key={r.rule}>
                <td className="pr-4 font-mono">{r.rule}</td>
                <td className="tnum pr-4">{r.samplesBefore} → {r.samplesAfter}</td>
                <td className="tnum">{r.seededBefore} → {r.seededAfter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Expand>
      <Expand title="South officers' utilisation if open tasks were reweighted (display only)" count={i.assignment.filter((a) => a.before !== a.after).length}>
        <ul>{i.assignment.filter((a) => a.before !== a.after).map((a) => <li key={a.officer} className="tnum">{a.officer}: {a.before.toFixed(2)} → {a.after.toFixed(2)}</li>)}</ul>
      </Expand>
      <Expand title="Who can file today" count={i.schedule.filter((s) => s.before !== s.after).length}>
        <ul>{i.schedule.filter((s) => s.before !== s.after).map((s) => <li key={s.group}>{s.group}: {s.before ? 'can file' : 'cannot file'} → {s.after ? 'can file' : 'cannot file'}</li>)}</ul>
      </Expand>
      {i.refusals.length ? (
        <Card title="Refused for live cases">
          <ul className="list-disc pl-5 text-sm text-danger">{i.refusals.map((r) => <li key={r.path + r.message}><span className="font-mono text-xs">{r.path}</span> {r.message}</li>)}</ul>
        </Card>
      ) : null}
    </div>
  );
}

export function ImpactPage() {
  const { id = '' } = useParams();
  const q = useVersion(id);
  useTitle('Impact · Rules');
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  return (
    <div className="flex flex-col gap-6">
      <VersionHeader v={v} current="impact" />
      {v.status === 'PUBLISHED' || v.status === 'SUPERSEDED' ? <p className="text-base text-secondary">Impact is shown for drafts and versions in review, against the published version.</p> : <ImpactView id={v.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- review

export function ReviewPage() {
  const { id = '' } = useParams();
  const q = useVersion(id);
  const d = useDiff(id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [remarks, setRemarks] = useState('');
  useTitle('Review · Rules');
  const approve = useMutation({
    mutationFn: () => api.post(`/rules/versions/${id}/approve`, remarks.trim() ? { remarks: remarks.trim() } : {}),
    onSuccess: () => {
      toast('Approved. Publish it when it should take effect.');
      setApproving(false);
      void qc.invalidateQueries({ queryKey: ['rules'] });
      navigate(`/rules/versions/${id}`);
    },
  });
  const reject = useMutation({
    mutationFn: (r: string) => api.post(`/rules/versions/${id}/reject`, { remarks: r }),
    onSuccess: () => {
      toast('Returned to the maker');
      setRejecting(false);
      void qc.invalidateQueries({ queryKey: ['rules'] });
      navigate('/rules');
    },
  });
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const blocked = v.permissions.reviewBlockedReason;
  return (
    <div className="flex flex-col gap-6">
      <VersionHeader v={v} current="review" />
      <Card title="What colleges will read">
        <p className="text-lg font-semibold">{v.amendment?.title}</p>
        <p className="mt-1 text-sm text-secondary">
          {KIND_LABEL[v.amendment?.kind ?? ''] ?? v.amendment?.kind} · {v.amendment?.refNo} · issued {formatDate(v.amendment?.issuedOn)} · effective {formatDate(v.effectiveFrom)}
        </p>
        <p className="mt-3 text-base">{v.amendment?.summary}</p>
        <p className="mt-3 text-xs text-muted">Made by {v.maker}{v.makers.length > 1 ? `; edited by ${v.makers.join(', ')}` : ''}.</p>
      </Card>
      <Card title="Changes">{d.data ? <DiffList changes={d.data.changes} /> : <Skeleton lines={3} />}</Card>
      <ImpactView id={v.id} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!v.permissions.canReview} disabledReason={blocked ?? 'Only a rule approver can review a version in review.'} onClick={() => setApproving(true)}>
          Approve
        </Button>
        <Button variant="destructive" disabled={!v.permissions.canReview} disabledReason={blocked ?? 'Only a rule approver can review a version in review.'} onClick={() => setRejecting(true)}>
          Reject with remarks
        </Button>
        {blocked ? <p className="text-sm text-secondary">{blocked}</p> : null}
      </div>
      <Dialog
        open={approving}
        title="Approve this version?"
        onClose={() => setApproving(false)}
        footer={
          <>
            <Button onClick={() => setApproving(false)}>Cancel</Button>
            <Button variant="primary" pending={approve.isPending} onClick={() => approve.mutate()}>
              Approve
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-base text-secondary">Approving does not publish. The rules take effect when an approver publishes them.</p>
          <Field label="Remarks" optional>{({ id: fid }) => <Textarea id={fid} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}</Field>
          {approve.error ? <p role="alert" className="text-sm text-danger">{errMsg(approve.error)}</p> : null}
        </div>
      </Dialog>
      <ReasonDialog
        open={rejecting}
        title="Return this version to the maker?"
        body="Say what must change. The maker can edit the draft and submit it again."
        confirmLabel="Return to the maker"
        destructive
        reasonLabel="Remarks for the maker"
        pending={reject.isPending}
        error={errMsg(reject.error)}
        onConfirm={(r) => reject.mutate(r)}
        onClose={() => setRejecting(false)}
      />
    </div>
  );
}
