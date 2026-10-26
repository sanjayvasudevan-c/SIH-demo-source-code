import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { AppType, CaseDetail, DocCfg, FilingContext, ValidateResponse } from '../../api/types';
import { useMe } from '../../auth/AuthContext';
import { Badge, Button, Card, DateInput, ErrorSummary, Field, FileUpload, IconButton, Input, PageHeader, Select, Textarea, WarningList, useToast } from '../../components/ui';
import { cx, formatDate, formatNumber } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';

interface Course {
  name: string;
  intake: string;
  years: string;
}

interface DocPick {
  file: File | null;
  expiryDate: string;
}

const STEPS = ['Application type', 'Land and building', 'Courses and faculty', 'Documents', 'Review and submit'] as const;

function newDraftId(): string {
  return `draft-${crypto.randomUUID()}`;
}

function num(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function ApplyPage() {
  useTitle('New application');
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [draftId] = useState(newDraftId);
  const started = useRef(Date.now());
  const [type, setType] = useState<AppType>('NEW_INSTITUTION');
  const [land, setLand] = useState('');
  const [built, setBuilt] = useState('');
  const [leaseExpiry, setLeaseExpiry] = useState('');
  const [courses, setCourses] = useState<Course[]>([{ name: '', intake: '', years: '4' }]);
  const [faculty, setFaculty] = useState('');
  const [labs, setLabs] = useState('');
  const [increase, setIncrease] = useState('');
  const [proposedName, setProposedName] = useState('');
  const [docs, setDocs] = useState<Record<string, DocPick>>({});
  const [justification, setJustification] = useState('');
  const [check, setCheck] = useState<ValidateResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [programme, setProgramme] = useState('');
  // The cycle and rules a filing today falls under; documents and form check come from that version.
  const filing = useQuery({ queryKey: ['filing', programme], queryFn: () => api.get<FilingContext>(`/rules/filing${programme ? `?programme=${programme}` : ''}`) });
  const cfg = filing.data?.types.find((t) => t.type === type);
  const cfgDocs: DocCfg[] = cfg?.documents ?? [];
  const site = cfgDocs.some((d) => d.kind === 'LAND_LEASE');

  const values = useMemo(
    () => ({
      landAreaSqm: num(land),
      builtupAreaSqm: num(built),
      leaseExpiry: leaseExpiry || undefined,
      courses: courses
        .filter((c) => c.name.trim() || c.intake)
        .map((c) => ({ name: c.name.trim() || 'Unnamed course', intake: Math.round(num(c.intake) ?? 0), years: Math.round(num(c.years) ?? 4) })),
      facultyCount: num(faculty) !== undefined ? Math.round(num(faculty)!) : undefined,
      labCount: num(labs) !== undefined ? Math.round(num(labs)!) : undefined,
      ...(type === 'INTAKE_INCREASE' ? { intakeIncreasePct: num(increase) } : {}),
      ...(type === 'NAME_CHANGE' ? { proposedName: proposedName.trim() || undefined } : {}),
      ...(programme ? { programme } : {}),
      fillSeconds: Math.round((Date.now() - started.current) / 1000),
      // Documents count only once the applicant has reached the documents step.
      documents: step >= 3 ? Object.entries(docs).filter(([, d]) => d.file).map(([k]) => k) : undefined,
    }),
    [land, built, leaseExpiry, courses, faculty, labs, increase, proposedName, programme, docs, type, step],
  );

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await api.post<ValidateResponse>('/forms/validate', { draftId, type, values }));
    } catch (e) {
      setCheckError(e instanceof ApiError ? e.message : 'The check could not run. You can still continue.');
    } finally {
      setChecking(false);
    }
  }

  // "Check my entries" runs on every step change.
  useEffect(() => {
    if (step > 0) void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (errors.length) summaryRef.current?.focus();
  }, [errors]);

  const missingCritical = cfgDocs.filter((d) => d.critical && !docs[d.kind]?.file);
  const missingExpiry = cfgDocs.filter((d) => d.hasExpiry && docs[d.kind]?.file && !docs[d.kind]?.expiryDate);
  const warningsNeedJustification = !!check && check.severity !== 'NONE';

  function stepErrors(s: number): { field: string; message: string }[] {
    const out: { field: string; message: string }[] = [];
    if (s === 1 && site) {
      if (!num(land)) out.push({ field: 'land', message: 'Enter the land area in square metres' });
      if (!num(built)) out.push({ field: 'built', message: 'Enter the built-up area in square metres' });
      if (!leaseExpiry) out.push({ field: 'leaseExpiry', message: 'Enter the lease expiry date' });
    }
    if (s === 2) {
      if (!values.courses.length || values.courses.every((c) => c.intake <= 0)) out.push({ field: 'course-0-intake', message: 'Add at least one course with its intake' });
      if (!num(faculty)) out.push({ field: 'faculty', message: 'Enter the number of faculty members' });
      if (site && labs.trim() === '') out.push({ field: 'labs', message: 'Enter the number of laboratories' });
      if (type === 'INTAKE_INCREASE' && increase.trim() === '') out.push({ field: 'increase', message: 'Enter the intake increase as a percentage' });
      if (type === 'NAME_CHANGE' && !proposedName.trim()) out.push({ field: 'proposedName', message: 'Enter the proposed new name' });
    }
    if (s === 3) {
      for (const d of missingExpiry) out.push({ field: `doc-${d.kind}-expiry`, message: `Enter the expiry date for the ${d.label.toLowerCase()}` });
    }
    return out;
  }

  function next() {
    const errs = stepErrors(step);
    setErrors(errs);
    if (errs.length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('type', type);
      const { documents: _d, ...formData } = values;
      fd.set('formData', JSON.stringify(formData));
      fd.set('draftId', draftId);
      if (justification.trim()) fd.set('justification', justification.trim());
      const picked = Object.entries(docs).filter(([, d]) => d.file);
      fd.set('fileMeta', JSON.stringify(picked.map(([kind, d]) => ({ kind, expiryDate: d.expiryDate || null }))));
      for (const [, d] of picked) fd.append('files', d.file!);
      return api.post<CaseDetail>('/applications', fd);
    },
    onSuccess: (d) => {
      toast(`Application ${d.application.applicationNo} submitted`);
      navigate(`/college/applications/${d.application.id}`);
    },
  });

  function trySubmit() {
    const errs: { field: string; message: string }[] = [];
    for (let s = 1; s <= 3; s++) errs.push(...stepErrors(s));
    if (warningsNeedJustification && !justification.trim()) errs.push({ field: 'justification', message: 'Explain the warnings before you submit' });
    setErrors(errs);
    if (errs.length || missingCritical.length) return;
    submit.mutate();
  }

  const err = (f: string) => errors.find((e) => e.field === f)?.message ?? null;
  const totalIntake = values.courses.reduce((s, c) => s + c.intake, 0);

  return (
    <div>
      <PageHeader title="New application" description={`${me.institutionName ?? 'Your institution'} · one step at a time. Your entries are checked as you go; the check never blocks you.`} breadcrumb={[{ label: 'My applications', to: '/college' }, { label: 'New application' }]} />
      {filing.data ? <FilingHeader f={filing.data} /> : null}
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={cx('rounded px-3 py-1 text-sm', i === step ? 'bg-accent-soft font-semibold text-accent' : i < step ? 'text-primary' : 'text-muted')}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          className="flex flex-col gap-6 lg:col-span-7"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step === STEPS.length - 1) trySubmit();
            else next();
          }}
        >
          <ErrorSummary ref={summaryRef} errors={errors} />
          <Card title={STEPS[step]}>
            <div className="flex max-w-prose flex-col gap-4">
              {step === 0 ? (
                <>
                  <Field label="Programme" hint="The programme decides which rules, windows and norms apply." optional>
                    {({ id, describedBy }) => (
                      <Select id={id} aria-describedby={describedBy} value={programme} onChange={(e) => setProgramme(e.target.value)}>
                        <option value="">Not specified</option>
                        {(filing.data?.programmes ?? []).map((p) => (
                          <option key={p.code} value={p.code} disabled={!p.inPurview}>
                            {p.label}
                            {p.inPurview ? '' : ' (outside purview for your institution)'}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-base text-secondary">What are you applying for?</legend>
                    {(filing.data?.types ?? []).map((t) => (
                      <label key={t.type} className={cx('hit flex cursor-pointer items-start gap-3 rounded-lg border p-3', type === t.type ? 'border-accent bg-accent-soft' : 'hover:bg-subtle')}>
                        <input type="radio" name="type" value={t.type} checked={type === t.type} onChange={() => setType(t.type)} className="mt-1 accent-accent" />
                        <span>
                          <span className="block text-base font-medium">{t.label}</span>
                          <span className="block text-xs text-muted">
                            Route: {t.route.join(' → ')}
                            {t.eligible ? '' : ' · needs an earlier approval'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <Field label="Institution">{({ id }) => <Input id={id} value={me.institutionName ?? ''} readOnly disabled />}</Field>
                  <Field id="land" label="Land area (square metres)" hint="As stated on the lease or title deed." optional={!site} error={err('land')}>
                    {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} invalid={invalid} value={land} onChange={(e) => setLand(e.target.value)} />}
                  </Field>
                  <Field id="built" label="Built-up area (square metres)" hint="Total floor area of all buildings, in the same unit as the land area." optional={!site} error={err('built')}>
                    {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} invalid={invalid} value={built} onChange={(e) => setBuilt(e.target.value)} />}
                  </Field>
                  <Field id="leaseExpiry" label="Lease expiry date" hint="Leave empty if you own the land outright." optional={!site} error={err('leaseExpiry')}>
                    {({ id, describedBy, invalid }) => <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value={leaseExpiry} onChange={(e) => setLeaseExpiry(e.target.value)} />}
                  </Field>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-base font-medium">Courses and intake</legend>
                    {courses.map((c, i) => (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <Field label={`Course ${i + 1}`} className="min-w-content flex-1">
                          {({ id }) => <Input id={id} value={c.name} placeholder="B.Tech Computer Science" onChange={(e) => setCourses((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
                        </Field>
                        <Field id={`course-${i}-intake`} label="Intake" className="w-num" error={i === 0 ? err('course-0-intake') : null}>
                          {({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={c.intake} onChange={(e) => setCourses((xs) => xs.map((x, j) => (j === i ? { ...x, intake: e.target.value } : x)))} />}
                        </Field>
                        <Field label="Years" className="w-num">
                          {({ id }) => <Input id={id} inputMode="numeric" value={c.years} onChange={(e) => setCourses((xs) => xs.map((x, j) => (j === i ? { ...x, years: e.target.value } : x)))} />}
                        </Field>
                        {courses.length > 1 ? <IconButton label={`Remove course ${i + 1}`} icon={<Trash2 size={16} aria-hidden />} onClick={() => setCourses((xs) => xs.filter((_, j) => j !== i))} /> : null}
                      </div>
                    ))}
                    <div>
                      <Button size="sm" variant="tertiary" icon={<Plus size={16} aria-hidden />} onClick={() => setCourses((xs) => [...xs, { name: '', intake: '', years: '4' }])}>
                        Add course
                      </Button>
                    </div>
                    <p className="tnum text-sm text-secondary">Total intake: {formatNumber(totalIntake)}</p>
                  </fieldset>
                  <Field id="faculty" label="Faculty members in position" error={err('faculty')}>
                    {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} invalid={invalid} value={faculty} onChange={(e) => setFaculty(e.target.value)} />}
                  </Field>
                  <Field id="labs" label="Laboratories" optional={!site} error={err('labs')}>
                    {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" aria-describedby={describedBy} invalid={invalid} value={labs} onChange={(e) => setLabs(e.target.value)} />}
                  </Field>
                  {type === 'INTAKE_INCREASE' ? (
                    <Field id="increase" label="Intake increase (per cent)" hint="Increases above 50% need an expert visit." error={err('increase')}>
                      {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} invalid={invalid} value={increase} onChange={(e) => setIncrease(e.target.value)} />}
                    </Field>
                  ) : null}
                  {type === 'NAME_CHANGE' ? (
                    <Field id="proposedName" label="Proposed new name" error={err('proposedName')}>
                      {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={proposedName} onChange={(e) => setProposedName(e.target.value)} />}
                    </Field>
                  ) : null}
                </>
              ) : null}

              {step === 3 ? (
                <ul className="flex flex-col gap-4">
                  {cfgDocs.map((d) => (
                    <li key={d.kind} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium">{d.label}</span>
                        {d.critical ? <Badge tone="accent">Critical</Badge> : <span className="text-sm text-muted">(optional)</span>}
                      </div>
                      <FileUpload id={`doc-${d.kind}`} onFile={(f) => setDocs((x) => ({ ...x, [d.kind]: { file: f, expiryDate: x[d.kind]?.expiryDate ?? '' } }))} fileName={docs[d.kind]?.file?.name} />
                      {d.hasExpiry ? (
                        <Field id={`doc-${d.kind}-expiry`} label="Expiry date" optional={!d.critical} error={err(`doc-${d.kind}-expiry`)}>
                          {({ id, invalid }) => <DateInput id={id} invalid={invalid} value={docs[d.kind]?.expiryDate ?? ''} onChange={(e) => setDocs((x) => ({ ...x, [d.kind]: { file: x[d.kind]?.file ?? null, expiryDate: e.target.value } }))} />}
                        </Field>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {step === 4 ? (
                <>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm text-secondary">Type</dt>
                      <dd>{cfg?.label ?? type}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-secondary">Land / built-up area</dt>
                      <dd className="tnum">
                        {values.landAreaSqm ? formatNumber(values.landAreaSqm) : '—'} / {values.builtupAreaSqm ? formatNumber(values.builtupAreaSqm) : '—'} sq m
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-secondary">Total intake</dt>
                      <dd className="tnum">{formatNumber(totalIntake)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-secondary">Faculty</dt>
                      <dd className="tnum">{values.facultyCount ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-secondary">Documents attached</dt>
                      <dd className="tnum">
                        {(values.documents ?? []).length} of {cfgDocs.length}
                      </dd>
                    </div>
                  </dl>
                  {missingCritical.length ? (
                    <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3">
                      <p className="text-base font-medium text-danger">You cannot submit yet. Attach the missing critical documents:</p>
                      <ul className="mt-1 list-disc pl-6 text-base text-danger">
                        {missingCritical.map((d) => (
                          <li key={d.kind}>{d.label}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {warningsNeedJustification ? (
                    <Field id="justification" label="Explain the warnings" hint="Say why the values are correct, or what you changed. The scrutiny officer sees this." error={err('justification')}>
                      {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} />}
                    </Field>
                  ) : null}
                  {submit.error ? (
                    <p role="alert" className="text-base text-danger">
                      {(submit.error as Error).message}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </Card>
          <div className="flex justify-end gap-3">
            {step > 0 ? <Button onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
            {step < STEPS.length - 1 ? (
              <Button type="submit" variant="primary">
                Continue
              </Button>
            ) : (
              <Button type="submit" variant="primary" pending={submit.isPending} pendingLabel="Submitting…" disabled={missingCritical.length > 0} disabledReason={`Attach: ${missingCritical.map((d) => d.label).join(', ')}`}>
                Submit application
              </Button>
            )}
          </div>
        </form>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-topbar lg:pt-4">
            <Card
              title="Check my entries"
              action={
                <Button size="sm" variant="tertiary" pending={checking} pendingLabel="Checking…" onClick={() => void runCheck()} disabled={step === 0}>
                  Check now
                </Button>
              }
            >
              <div aria-live="polite" className="flex flex-col gap-3">
                <p className="text-sm text-secondary">Your entries are compared with plausibility rules and with similar applications. Warnings are advice: you can submit with a short explanation.</p>
                {checkError ? <p className="text-sm text-danger">{checkError}</p> : null}
                {!check ? (
                  <p className="text-base text-secondary">The check runs when you move to the next step.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted">{check.modelAvailable ? `Rules and statistical model (${check.modelVersion})` : 'Model unavailable: rules only'}</p>
                    {check.warnings.length === 0 ? <p className="text-base text-success">No warnings on your entries so far.</p> : <WarningList warnings={check.warnings} />}
                    {check.requiredMissing.length ? (
                      <div>
                        <p className="text-sm font-medium">Still to fill in</p>
                        <ul className="list-disc pl-6 text-sm text-secondary">
                          {check.requiredMissing.map((m) => (
                            <li key={m.field}>{m.message}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** "Filing under approval cycle 2027–28 · rules v1 (effective 18 Oct 2026)", the window and the late fee. */
function FilingHeader({ f }: { f: FilingContext }) {
  const cycle = f.rules.cycle.replace('-', '–');
  return (
    <div role="status" className={cx('mb-4 rounded-lg border px-4 py-3 text-sm', f.open ? 'border-border bg-subtle' : 'border-warning bg-warning-soft')}>
      <p className="font-medium">
        Filing under approval cycle {cycle} · rules v{f.rules.version} (effective {formatDate(f.rules.effectiveFrom)})
      </p>
      {f.open && f.window ? (
        <p className="text-secondary">
          {f.window.label} closes on {formatDate(f.window.to)}.{f.lateFeeInr !== null ? ` Late fee applicable: ₹${formatNumber(f.lateFeeInr)}.` : ' No late fee.'}
        </p>
      ) : (
        <p className="text-secondary">{f.message} You can prepare the application now; it can be submitted once a window opens.</p>
      )}
    </div>
  );
}
