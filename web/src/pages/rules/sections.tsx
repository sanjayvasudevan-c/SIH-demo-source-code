// Section editors of the Rules Center: every section is a table or a form, never raw JSON by default.
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, Checkbox, DateInput, Field, IconButton, Input, Select, Textarea } from '../../components/ui';
import { cx } from '../../lib/format';
import { ConditionBuilder, describeExpr, type VarList } from './ConditionBuilder';
import { APP_TYPES, sourceText, type Pack, type SectionId, type Source } from './types';

export interface SectionProps {
  pack: Pack;
  set: (p: Pack) => void;
  editable: boolean;
  vars: VarList | undefined;
  errors: { path: string; message: string }[];
}

const TYPE_SHORT: Record<string, string> = {
  NEW_INSTITUTION: 'New',
  EXTENSION: 'Extension',
  NAME_CHANGE: 'Name',
  INTAKE_INCREASE: 'Intake',
  CHANGE_OF_SITE: 'Site',
  VERIFICATION_VISIT: 'Verification',
  RESTORATION: 'Restoration',
};

const cellInput = 'h-control-sm w-full min-w-0 rounded border border-input bg-surface px-2 text-sm disabled:bg-subtle';

function SourceChip({ s }: { s: Source }) {
  const t = sourceText(s);
  return t ? <Badge tone="neutral">{t}</Badge> : null;
}

function rowErrors(errors: SectionProps['errors'], section: string, i: number) {
  return errors.filter((e) => e.path.startsWith(`${section}[${i}]`));
}

function ErrorsFor({ errors }: { errors: { path: string; message: string }[] }) {
  if (!errors.length) return null;
  return (
    <ul className="mt-1 text-sm text-danger" role="list">
      {errors.map((e) => (
        <li key={e.path + e.message}>
          <span className="font-mono text-xs">{e.path}</span> {e.message}
        </li>
      ))}
    </ul>
  );
}

/** A grid of rows with typed cells. */
function Grid<T>({ caption, rows, columns, editable, onChange, onAdd, blank, errorsFor, addLabel = 'Add a row' }: {
  caption: string;
  rows: T[];
  columns: { header: string; cell: (r: T, update: (patch: Partial<T>) => void, i: number) => ReactNode; className?: string }[];
  editable: boolean;
  onChange: (rows: T[]) => void;
  onAdd?: () => void;
  blank?: () => T;
  errorsFor?: (i: number) => { path: string; message: string }[];
  addLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded border" role="region" aria-label={caption} tabIndex={0}>
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-subtle text-left">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cx('px-2 py-2 font-medium text-secondary', c.className)}>
                  {c.header}
                </th>
              ))}
              {editable ? <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const errs = errorsFor?.(i) ?? [];
              return (
                <tr key={i} className={cx('border-t align-top', errs.length > 0 && 'bg-danger-soft')}>
                  {columns.map((c) => (
                    <td key={c.header} className={cx('px-2 py-1.5', c.className)}>
                      {c.cell(r, (patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
                      {c === columns[0] ? <ErrorsFor errors={errs} /> : null}
                    </td>
                  ))}
                  {editable ? (
                    <td className="px-2 py-1.5">
                      <IconButton label={`Remove row ${i + 1}`} icon={<Trash2 size={16} aria-hidden />} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (onAdd || blank) ? (
        <div>
          <Button size="sm" variant="tertiary" icon={<Plus size={16} aria-hidden />} onClick={() => (onAdd ? onAdd() : onChange([...rows, blank!()]))}>
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const text = (label: string, value: string | undefined, onChange: (v: string) => void, editable: boolean, mono = false) => (
  <input aria-label={label} className={cx(cellInput, mono && 'font-mono')} value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value)} />
);
const num = (label: string, value: number | undefined, onChange: (v: number | undefined) => void, editable: boolean) => (
  <input aria-label={label} inputMode="decimal" className={cx(cellInput, 'tnum text-right')} value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
);
const pick = (label: string, value: string | undefined, options: string[], onChange: (v: string) => void, editable: boolean) => (
  <select aria-label={label} className={cellInput} value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => (
      <option key={o} value={o}>
        {o || '—'}
      </option>
    ))}
  </select>
);
const tick = (label: string, value: boolean, onChange: (v: boolean) => void, editable: boolean) => (
  <input type="checkbox" aria-label={label} className="hit h-4 w-4 accent-accent" checked={value} disabled={!editable} onChange={(e) => onChange(e.target.checked)} />
);

/** Condition cell: plain words, with the builder below when the row is opened. */
function ConditionCell({ label, value, onChange, editable, vars, normKeys }: { label: string; value: unknown; onChange: (v: unknown) => void; editable: boolean; vars: VarList | undefined; normKeys: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">{describeExpr(value)}</span>
      {editable ? (
        <button type="button" className="self-start text-xs text-accent underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Close the condition' : 'Edit the condition'}
        </button>
      ) : null}
      {open ? <ConditionBuilder label={label} value={value} onChange={onChange} vars={vars} normKeys={normKeys} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- sections

function Programmes({ pack, set, editable, vars, errors }: SectionProps) {
  const normKeys = [...new Set(pack.norms.map((n) => n.key))];
  return (
    <Grid
      caption="Programmes"
      rows={pack.programmes}
      editable={editable}
      onChange={(programmes) => set({ ...pack, programmes })}
      blank={() => ({ code: 'NEW', label: 'New programme', level: 'UG', discipline: 'ENGINEERING', inPurview: true })}
      errorsFor={(i) => rowErrors(errors, 'programmes', i)}
      columns={[
        { header: 'Code', cell: (r, u) => text('Code', r.code, (code) => u({ code }), editable, true), className: 'w-36' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable) },
        { header: 'Level', cell: (r, u) => pick('Level', r.level, ['DIPLOMA', 'UG', 'PG', 'PGDM'], (level) => u({ level }), editable), className: 'w-28' },
        { header: 'Discipline', cell: (r, u) => text('Discipline', r.discipline, (discipline) => u({ discipline }), editable, true), className: 'w-44' },
        { header: 'In purview when', cell: (r, u) => <ConditionCell label={`Purview of ${r.label}`} value={r.inPurview} onChange={(inPurview) => u({ inPurview })} editable={editable} vars={vars} normKeys={normKeys} /> },
        { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-48' },
      ]}
    />
  );
}

function ApplicationTypes({ pack, set, editable, vars, errors }: SectionProps) {
  const normKeys = [...new Set(pack.norms.map((n) => n.key))];
  return (
    <Grid
      caption="Application types"
      rows={pack.applicationTypes}
      editable={false}
      onChange={(applicationTypes) => set({ ...pack, applicationTypes })}
      errorsFor={(i) => rowErrors(errors, 'applicationTypes', i)}
      columns={[
        { header: 'Type', cell: (r) => <span className="font-mono text-xs">{r.type}</span>, className: 'w-40' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable) },
        { header: 'Category', cell: (r, u) => pick('Category', r.category, ['NEW', 'EXTENSION', 'EXPANSION'], (category) => u({ category }), editable), className: 'w-32' },
        { header: 'Weight', cell: (r, u) => num('Category weight', r.categoryWeight, (v) => u({ categoryWeight: v ?? 1 }), editable), className: 'w-20' },
        { header: 'Rank', cell: (r, u) => num('Category rank', r.categoryRank, (v) => u({ categoryRank: v ?? 0 }), editable), className: 'w-16' },
        { header: 'Route', cell: (r) => <span>{r.route.map((s) => (s.when ? `${s.stage} (${describeExpr(s.when)})` : s.stage)).join(' → ')}</span> },
        { header: 'Eligible when', cell: (r, u) => <ConditionCell label={`Eligibility for ${r.label}`} value={r.eligibility} onChange={(eligibility) => u({ eligibility })} editable={editable} vars={vars} normKeys={normKeys} /> },
        { header: 'Channel', cell: (r, u) => pick('Channel', r.channel, ['PORTAL', 'NSWS'], (channel) => u({ channel }), editable), className: 'w-28' },
      ]}
    />
  );
}

function Documents({ pack, set, editable, vars, errors }: SectionProps) {
  const normKeys = [...new Set(pack.norms.map((n) => n.key))];
  return (
    <Grid
      caption="Documents"
      rows={pack.documents}
      editable={editable}
      onChange={(documents) => set({ ...pack, documents })}
      blank={() => ({ kind: 'NEW_DOCUMENT', label: 'New document', appliesTo: ['NEW_INSTITUTION'], critical: false, hasExpiry: false, format: 'PDF' }) as Pack['documents'][number]}
      errorsFor={(i) => rowErrors(errors, 'documents', i)}
      addLabel="Add a document"
      columns={[
        { header: 'Kind', cell: (r, u) => text('Kind', r.kind, (kind) => u({ kind }), editable, true), className: 'w-48' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable) },
        {
          header: 'Applies to',
          cell: (r, u) => (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {APP_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="accent-accent" disabled={!editable} checked={r.appliesTo.includes(t)} onChange={(e) => u({ appliesTo: e.target.checked ? [...r.appliesTo, t] : r.appliesTo.filter((x) => x !== t) })} />
                  {TYPE_SHORT[t]}
                </label>
              ))}
            </div>
          ),
          className: 'w-72',
        },
        { header: 'Critical', cell: (r, u) => tick(`${r.label} critical`, r.critical, (critical) => u({ critical }), editable), className: 'w-16 text-center' },
        { header: 'Expiry', cell: (r, u) => tick(`${r.label} has an expiry date`, r.hasExpiry, (hasExpiry) => u({ hasExpiry }), editable), className: 'w-16 text-center' },
        { header: 'Min. validity (years)', cell: (r, u) => num('Minimum validity in years', r.minValidityYears, (minValidityYears) => u({ minValidityYears }), editable), className: 'w-24' },
        { header: 'Required when', cell: (r, u) => <ConditionCell label={`When ${r.label} is required`} value={r.when ?? true} onChange={(when) => u({ when: when === true ? undefined : when })} editable={editable} vars={vars} normKeys={normKeys} /> },
        { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-44' },
      ]}
    />
  );
}

function Norms({ pack, set, editable, errors }: SectionProps) {
  return (
    <Grid
      caption="Norms"
      rows={pack.norms}
      editable={editable}
      onChange={(norms) => set({ ...pack, norms })}
      blank={() => ({ key: 'newNorm', label: 'New norm', unit: '', direction: 'MIN' as const, value: 0 })}
      errorsFor={(i) => rowErrors(errors, 'norms', i)}
      addLabel="Add a norm"
      columns={[
        { header: 'Key', cell: (r, u) => text('Key', r.key, (key) => u({ key }), editable, true), className: 'w-52' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable) },
        { header: 'Direction', cell: (r, u) => pick('Direction', r.direction, ['MIN', 'MAX'], (direction) => u({ direction: direction as 'MIN' | 'MAX' }), editable), className: 'w-24' },
        { header: 'Value', cell: (r, u) => num('Value', r.value, (value) => u({ value: value ?? 0 }), editable), className: 'w-24' },
        { header: 'Unit', cell: (r, u) => text('Unit', r.unit, (unit) => u({ unit }), editable), className: 'w-24' },
        { header: 'Level', cell: (r, u) => pick('Scope level', r.scope?.level ?? '', ['', 'DIPLOMA', 'UG', 'PG', 'PGDM'], (level) => u({ scope: { ...r.scope, level: level || undefined } }), editable), className: 'w-24' },
        { header: 'Discipline', cell: (r, u) => text('Scope discipline', r.scope?.discipline, (d) => u({ scope: { ...r.scope, discipline: d || undefined } }), editable, true), className: 'w-36' },
        { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-44' },
      ]}
    />
  );
}

function FormCheck({ pack, set, editable, vars, errors }: SectionProps) {
  const normKeys = [...new Set(pack.norms.map((n) => n.key))];
  return (
    <Grid
      caption="Form check rules"
      rows={pack.formCheckRules}
      editable={editable}
      onChange={(formCheckRules) => set({ ...pack, formCheckRules })}
      blank={() => ({ id: `R${pack.formCheckRules.length + 1}`, label: 'New rule', severity: 'MEDIUM' as const, when: { '>': [{ var: 'features.students_per_faculty' }, 100] }, message: 'Check this value.', fields: ['facultyCount'] })}
      errorsFor={(i) => rowErrors(errors, 'formCheckRules', i)}
      addLabel="Add a rule"
      columns={[
        { header: 'Id', cell: (r, u) => text('Id', r.id, (id) => u({ id }), editable, true), className: 'w-16' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable), className: 'w-48' },
        { header: 'Severity', cell: (r, u) => pick('Severity', r.severity, ['HIGH', 'MEDIUM'], (severity) => u({ severity: severity as 'HIGH' | 'MEDIUM' }), editable), className: 'w-24' },
        { header: 'Warn when', cell: (r, u) => <ConditionCell label={`Condition of ${r.id}`} value={r.when} onChange={(when) => u({ when })} editable={editable} vars={vars} normKeys={normKeys} /> },
        { header: 'Message to the college', cell: (r, u) => <textarea aria-label="Message" className={cx(cellInput, 'h-16 py-1')} value={r.message} disabled={!editable} onChange={(e) => u({ message: e.target.value })} /> },
      ]}
    />
  );
}

function NumberForm<K extends string>({ title, values, labels, onChange, editable, unit }: { title: string; values: Record<K, number>; labels: Record<K, string>; onChange: (v: Record<K, number>) => void; editable: boolean; unit?: string }) {
  return (
    <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="sr-only">{title}</legend>
      {(Object.keys(labels) as K[]).map((k) => (
        <Field key={k} label={labels[k]} hint={unit}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} inputMode="decimal" className="tnum" disabled={!editable} value={String(values[k] ?? '')} onChange={(e) => onChange({ ...values, [k]: Number(e.target.value) })} />}
        </Field>
      ))}
    </fieldset>
  );
}

function Timelines({ pack, set, editable, errors }: SectionProps) {
  return (
    <>
      <NumberForm
        title="Timelines"
        unit="Working days"
        values={pack.timelines}
        editable={editable}
        onChange={(timelines) => set({ ...pack, timelines })}
        labels={{ SCRUTINY: 'Scrutiny', SAC_SHC: 'SAC/SHC', DECISION: 'Decision', EVC_SCHEDULE: 'Schedule the EVC visit', EVC_REPORT: 'EVC report after the visit', VERIFICATION: 'Verify compliance evidence' }}
      />
      <ErrorsFor errors={errors} />
    </>
  );
}

function Fees({ pack, set, editable, errors }: SectionProps) {
  return (
    <>
      <p className="mb-2 text-sm text-secondary">Shown to colleges only. The prototype takes no payments.</p>
      <Grid
        caption="Fees"
        rows={pack.fees}
        editable={editable}
        onChange={(fees) => set({ ...pack, fees })}
        blank={() => ({ appliesTo: ['NEW_INSTITUTION'], amountInr: 0 }) as Pack['fees'][number]}
        errorsFor={(i) => rowErrors(errors, 'fees', i)}
        columns={[
          { header: 'Applies to', cell: (r) => r.appliesTo.map((t) => TYPE_SHORT[t] ?? t).join(', ') },
          { header: 'Fee (₹)', cell: (r, u) => num('Fee in rupees', r.amountInr, (v) => u({ amountInr: v ?? 0 }), editable), className: 'w-32' },
          { header: 'Late fee (₹)', cell: (r, u) => num('Late fee in rupees', r.lateFeeInr, (lateFeeInr) => u({ lateFeeInr }), editable), className: 'w-32' },
          { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-56' },
        ]}
      />
    </>
  );
}

interface LetterSample {
  id: string;
  label: string;
  values: Record<string, string>;
}

/** Logic-less Mustache: {{name}} from the whitelist, HTML-escaped by React. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k: string) => values[k] ?? `[${k}]`);
}

function Letters({ pack, set, editable, errors }: SectionProps) {
  const samples = useQuery({ queryKey: ['rules', 'letter-samples'], queryFn: () => api.get<{ samples: LetterSample[] }>('/rules/letter-samples') });
  const [sampleId, setSampleId] = useState('');
  const sample = samples.data?.samples.find((s) => s.id === sampleId) ?? samples.data?.samples[0];
  const months = pack.norms.find((n) => n.key === 'deficiencyCompliancePeriod')?.value;
  const values = { ...(sample?.values ?? {}), 'norms.deficiencyCompliancePeriod': String(months ?? ''), cycle: pack.meta.cycle, 'rules.version': `v${pack.meta.version}`, today: new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(Date.now()) };
  return (
    <div className="flex flex-col gap-6">
      <Field label="Preview with">
        {({ id }) => (
          <Select id={id} value={sample?.id ?? ''} onChange={(e) => setSampleId(e.target.value)}>
            {(samples.data?.samples ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {(['deficiency', 'decision'] as const).map((k) => (
        <div key={k} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">{k === 'deficiency' ? 'Deficiency letter' : 'Decision letter'}</h3>
            <Field label="Subject">{({ id }) => <Input id={id} disabled={!editable} value={pack.letters[k].subject} onChange={(e) => set({ ...pack, letters: { ...pack.letters, [k]: { ...pack.letters[k], subject: e.target.value } } })} />}</Field>
            <Field label="Body" hint="Placeholders such as {{application.no}}, {{institution.name}}, {{deficiency.items}}, {{decision.conditions}}, {{norms.deficiencyCompliancePeriod}}.">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={10} className="font-mono text-sm" disabled={!editable} value={pack.letters[k].body} onChange={(e) => set({ ...pack, letters: { ...pack.letters, [k]: { ...pack.letters[k], body: e.target.value } } })} />}
            </Field>
            <ErrorsFor errors={errors.filter((e) => e.path === `letters.${k}`)} />
          </div>
          <div className="rounded border bg-subtle p-4" aria-label={`${k} letter preview`}>
            <p className="text-xs font-medium uppercase text-muted">Preview</p>
            <p className="mt-2 font-semibold">{fill(pack.letters[k].subject, values)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{fill(pack.letters[k].body, values)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Schedule({ pack, set, editable, vars, errors }: SectionProps) {
  const normKeys = [...new Set(pack.norms.map((n) => n.key))];
  return (
    <Grid
      caption="Schedule"
      rows={pack.schedule}
      editable={editable}
      onChange={(schedule) => set({ ...pack, schedule })}
      blank={() => ({ id: `window-${pack.schedule.length + 1}`, label: 'New window', kind: 'APPLICATION_WINDOW', from: pack.schedule[0]?.from ?? '', to: pack.schedule[0]?.to ?? '', appliesTo: true })}
      errorsFor={(i) => rowErrors(errors, 'schedule', i)}
      addLabel="Add a dated row"
      columns={[
        { header: 'Id', cell: (r, u) => text('Id', r.id, (id) => u({ id }), editable, true), className: 'w-40' },
        { header: 'Label', cell: (r, u) => text('Label', r.label, (label) => u({ label }), editable) },
        { header: 'Kind', cell: (r, u) => pick('Kind', r.kind, ['APPLICATION_WINDOW', 'LATE_FEE_WINDOW', 'PAYMENT_DEADLINE', 'DECISION_LAST_DATE'], (kind) => u({ kind }), editable), className: 'w-48' },
        { header: 'From', cell: (r, u) => <DateInput aria-label="From" className="h-control-sm text-sm" disabled={!editable} value={r.from} onChange={(e) => u({ from: e.target.value })} />, className: 'w-40' },
        { header: 'To', cell: (r, u) => <DateInput aria-label="To" className="h-control-sm text-sm" disabled={!editable} value={r.to} onChange={(e) => u({ to: e.target.value })} />, className: 'w-40' },
        { header: 'Applies to', cell: (r, u) => <ConditionCell label={`Who ${r.label} applies to`} value={r.appliesTo} onChange={(appliesTo) => u({ appliesTo })} editable={editable} vars={vars} normKeys={normKeys} /> },
        { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-44' },
      ]}
    />
  );
}

function Reminders({ pack, set, editable, errors }: SectionProps) {
  const r = pack.reminders;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Compliance reminder offsets" hint="Calendar days before the due date, separated by commas.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={!editable} value={r.complianceOffsets.join(', ')} onChange={(e) => set({ ...pack, reminders: { ...r, complianceOffsets: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) } })} />}
      </Field>
      <NumberForm
        title="Reminders"
        values={{ atRiskPct: r.atRiskPct, stalledWorkingDays: r.stalledWorkingDays, urgentDays: r.urgentDays, dueSoonDays: r.dueSoonDays }}
        labels={{ atRiskPct: 'At risk after this share of the SLA (%)', stalledWorkingDays: 'Stalled after (working days)', urgentDays: 'Urgent within (working days)', dueSoonDays: 'Due soon within (days)' }}
        editable={editable}
        onChange={(v) => set({ ...pack, reminders: { ...r, ...v } })}
      />
      <p className="text-sm text-secondary">Operational: applies to future alerts as soon as it is published. Alerts already sent are never repeated.</p>
      <ErrorsFor errors={errors} />
    </div>
  );
}

function Escalation({ pack, set, editable, errors }: SectionProps) {
  const e = pack.escalation;
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`Level ${i + 1}: overdue by at least (days)`}>
            {({ id }) => <Input id={id} inputMode="numeric" className="tnum" disabled={!editable} value={String(e.thresholds[i] ?? '')} onChange={(ev) => set({ ...pack, escalation: { ...e, thresholds: e.thresholds.map((t, j) => (j === i ? Number(ev.target.value) : t)) } })} />}
          </Field>
          <Field label={`Level ${i + 1}: escalates to`}>
            {({ id }) => <Input id={id} disabled={!editable} value={e.levelTitles[i] ?? ''} onChange={(ev) => set({ ...pack, escalation: { ...e, levelTitles: e.levelTitles.map((t, j) => (j === i ? ev.target.value : t)) } })} />}
          </Field>
        </div>
      ))}
      <p className="text-sm text-secondary">Stage items count working days; compliance items count calendar days.</p>
      <ErrorsFor errors={errors} />
    </div>
  );
}

function Assignment({ pack, set, editable, errors }: SectionProps) {
  const a = pack.assignment;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-base font-semibold">Stage weights (points per task)</h3>
        <NumberForm title="Stage weights" values={a.stageWeight} labels={{ SCRUTINY: 'Scrutiny', RE_SCRUTINY: 'Re-scrutiny', EVC_DESK: 'EVC desk', VERIFY: 'Verify evidence', SAC_SHC_FORWARD: 'SAC/SHC forward' }} editable={editable} onChange={(stageWeight) => set({ ...pack, assignment: { ...a, stageWeight } })} />
      </div>
      <div>
        <h3 className="mb-2 text-base font-semibold">Load score weights (must add up to 1)</h3>
        <NumberForm title="Score weights" values={a.scoreWeights} labels={{ projectedUtil: 'Projected utilisation', recent: 'Recent assignments', mismatch: 'Specialisation mismatch' }} editable={editable} onChange={(scoreWeights) => set({ ...pack, assignment: { ...a, scoreWeights } })} />
        <ErrorsFor errors={errors.filter((x) => x.path.startsWith('assignment.scoreWeights'))} />
      </div>
      <div>
        <h3 className="mb-2 text-base font-semibold">Capacity and horizons</h3>
        <NumberForm
          title="Capacity"
          values={{ defaultCapacityPoints: a.defaultCapacityPoints, maxUtil: a.maxUtil, urgentMaxUtil: a.urgentMaxUtil, continuityUtilCap: a.continuityUtilCap, recentWorkingDays: a.recentWorkingDays, specialisationLookbackDays: a.specialisationLookbackDays, idleBelowTeamAverage: a.idleBelowTeamAverage, overloadedAbove: a.overloadedAbove }}
          labels={{
            defaultCapacityPoints: 'Default capacity (points)',
            maxUtil: 'Maximum utilisation',
            urgentMaxUtil: 'Maximum utilisation for urgent tasks',
            continuityUtilCap: 'Continuity cap',
            recentWorkingDays: 'Recent window (working days)',
            specialisationLookbackDays: 'Specialisation look-back (days)',
            idleBelowTeamAverage: 'Idle below the team average by',
            overloadedAbove: 'Overloaded above',
          }}
          editable={editable}
          onChange={(v) => set({ ...pack, assignment: { ...a, ...v } })}
        />
      </div>
      <p className="text-sm text-secondary">Operational: new assignments use these weights as soon as they are published; existing assignments keep their weight. Eligibility tiers are edited on the Advanced tab.</p>
    </div>
  );
}

function Committees({ pack, set, editable, errors }: SectionProps) {
  return (
    <Grid
      caption="Committees"
      rows={pack.committees}
      editable={editable}
      onChange={(committees) => set({ ...pack, committees })}
      blank={() => ({ committee: 'EXPERT', appointingAuthority: '', size: 3 }) as Pack['committees'][number]}
      errorsFor={(i) => rowErrors(errors, 'committees', i)}
      columns={[
        { header: 'Committee', cell: (r, u) => pick('Committee', r.committee, ['EVC', 'SAC', 'SHC', 'EXPERT', 'APPELLATE', 'HEARING'], (committee) => u({ committee }), editable), className: 'w-36' },
        { header: 'Appointing authority', cell: (r, u) => text('Appointing authority', r.appointingAuthority, (appointingAuthority) => u({ appointingAuthority }), editable) },
        { header: 'Members', cell: (r, u) => num('Members', r.size, (v) => u({ size: v ?? 1 }), editable), className: 'w-24' },
        { header: 'Source', cell: (r) => <SourceChip s={r.source} />, className: 'w-56' },
      ]}
    />
  );
}

function Calendar({ pack, set, editable, errors }: SectionProps) {
  return (
    <Grid
      caption="Holidays"
      rows={pack.calendar.holidays}
      editable={editable}
      onChange={(holidays) => set({ ...pack, calendar: { holidays } })}
      blank={() => ({ date: '', name: '' })}
      errorsFor={(i) => rowErrors(errors, 'calendar.holidays', i)}
      addLabel="Add a holiday"
      columns={[
        { header: 'Date', cell: (r, u) => <DateInput aria-label="Date" className="h-control-sm text-sm" disabled={!editable} value={r.date} onChange={(e) => u({ date: e.target.value })} />, className: 'w-44' },
        { header: 'Name', cell: (r, u) => text('Name', r.name, (name) => u({ name }), editable) },
      ]}
    />
  );
}

function ChangeNotice({ pack, set, editable, errors }: SectionProps) {
  return (
    <Grid
      caption="Change notices"
      rows={pack.changeNotice}
      editable={editable}
      onChange={(changeNotice) => set({ ...pack, changeNotice })}
      blank={() => ({ title: '', summary: '', audience: 'COLLEGE' as const })}
      errorsFor={(i) => rowErrors(errors, 'changeNotice', i)}
      addLabel="Add a notice"
      columns={[
        { header: 'Title', cell: (r, u) => text('Title', r.title, (title) => u({ title }), editable), className: 'w-72' },
        { header: 'Summary', cell: (r, u) => <textarea aria-label="Summary" className={cx(cellInput, 'h-16 py-1')} value={r.summary} disabled={!editable} onChange={(e) => u({ summary: e.target.value })} /> },
        { header: 'Audience', cell: (r, u) => pick('Audience', r.audience, ['COLLEGE', 'STAFF'], (audience) => u({ audience: audience as 'COLLEGE' | 'STAFF' }), editable), className: 'w-32' },
      ]}
    />
  );
}

const EDITORS: Record<SectionId, (p: SectionProps) => ReactNode> = {
  programmes: Programmes,
  applicationTypes: ApplicationTypes,
  documents: Documents,
  norms: Norms,
  formCheckRules: FormCheck,
  timelines: Timelines,
  fees: Fees,
  letters: Letters,
  schedule: Schedule,
  reminders: Reminders,
  escalation: Escalation,
  assignment: Assignment,
  committees: Committees,
  calendar: Calendar,
  changeNotice: ChangeNotice,
};

export function SectionEditor({ section, ...props }: SectionProps & { section: SectionId }) {
  const Editor = EDITORS[section];
  const errors = useMemo(() => props.errors.filter((e) => e.path === section || e.path.startsWith(`${section}.`) || e.path.startsWith(`${section}[`)), [props.errors, section]);
  return <Editor {...props} errors={errors} />;
}

export { Checkbox };
