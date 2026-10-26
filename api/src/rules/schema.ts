// Rule pack schema (add-on A1). One pack = the complete rule set of one approval cycle version.
// Pinned sections are read from the application's pinned version; operational sections from the cycle's current
// published version. Cross-field checks run on every save and before review.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateExpr, type ExprError } from './expr.js';

export const STAGES = ['SCRUTINY', 'EVC', 'SAC_SHC', 'DECISION'] as const;
export const APP_TYPES = ['NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION'] as const;
export const TASKS = ['SCRUTINY', 'RE_SCRUTINY', 'EVC_DESK', 'VERIFY', 'SAC_SHC_FORWARD'] as const;
export const AMENDMENT_KINDS = ['APH', 'ADDENDUM', 'CORRIGENDUM', 'PUBLIC_NOTICE', 'REVISED_PUBLIC_NOTICE', 'CIRCULAR', 'ACADEMIC_CALENDAR', 'FEE_NOTIFICATION', 'PROTOTYPE_PLACEHOLDER'] as const;

export const PINNED_SECTIONS = ['programmes', 'applicationTypes', 'documents', 'norms', 'formCheckRules', 'timelines', 'fees', 'letters'] as const;
export const OPERATIONAL_SECTIONS = ['schedule', 'reminders', 'escalation', 'assignment', 'committees', 'calendar'] as const;
export const SECTIONS = ['meta', ...PINNED_SECTIONS, ...OPERATIONAL_SECTIONS, 'changeNotice'] as const;
export type SectionName = (typeof SECTIONS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const expr = z.any();

export const sourceSchema = z.object({ amendmentId: z.string().optional(), ref: z.string().min(1).max(200), clause: z.string().max(100).optional() });

const metaSchema = z.object({
  cycle: z.string().regex(/^\d{4}-\d{2}$/, 'Use a cycle code like 2026-27'),
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  baseRef: z.string().min(1).max(200),
  notes: z.string().max(4000).optional(),
  /** Set on a rollback: the older version whose content this version restores. */
  rollbackOfVersionId: z.string().optional(),
});

const programmeSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,20}$/, 'Use capitals, digits and underscores'),
  label: z.string().min(1).max(120),
  level: z.enum(['DIPLOMA', 'UG', 'PG', 'PGDM']),
  discipline: z.string().min(1).max(40),
  inPurview: expr,
  source: sourceSchema.optional(),
});

const appTypeSchema = z.object({
  type: z.enum(APP_TYPES),
  label: z.string().min(1).max(120),
  category: z.enum(['NEW', 'EXTENSION', 'EXPANSION']),
  categoryWeight: z.number().positive().max(10),
  categoryRank: z.number().int().min(0).max(20),
  eligibility: expr,
  route: z.array(z.object({ stage: z.enum(STAGES), when: expr.optional() })).min(1),
  channel: z.enum(['PORTAL', 'NSWS']),
  source: sourceSchema.optional(),
});

const documentSchema = z.object({
  kind: z.string().regex(/^[A-Z0-9_]{2,40}$/, 'Use capitals, digits and underscores'),
  label: z.string().min(1).max(160),
  appliesTo: z.array(z.enum(APP_TYPES)).min(1),
  when: expr.optional(),
  critical: z.boolean(),
  hasExpiry: z.boolean(),
  minValidityYears: z.number().min(0).max(99).optional(),
  format: z.literal('PDF').optional(),
  source: sourceSchema.optional(),
});

const normSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,60}$/, 'Use a camelCase key'),
  label: z.string().min(1).max(160),
  unit: z.string().min(1).max(40),
  direction: z.enum(['MIN', 'MAX']),
  value: z.number().finite(),
  scope: z.object({ level: z.string().optional(), discipline: z.string().optional() }).optional(),
  source: sourceSchema.optional(),
});

const formCheckRuleSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/),
  label: z.string().min(1).max(120),
  severity: z.enum(['HIGH', 'MEDIUM']),
  when: expr,
  message: z.string().min(1).max(400),
  fields: z.array(z.string()).min(1),
  /** The value shown with the warning (a feature path); shown as a percentage when valueAsPercent. */
  valueVar: z.string().optional(),
  valueAsPercent: z.boolean().optional(),
  source: sourceSchema.optional(),
});

const timelinesSchema = z.object({
  SCRUTINY: z.number().int().positive().max(200),
  SAC_SHC: z.number().int().positive().max(200),
  DECISION: z.number().int().positive().max(200),
  EVC_SCHEDULE: z.number().int().positive().max(200),
  EVC_REPORT: z.number().int().positive().max(200),
  VERIFICATION: z.number().int().positive().max(200),
});

const feeSchema = z.object({
  appliesTo: z.array(z.enum(APP_TYPES)).min(1),
  programmeLevel: z.string().optional(),
  amountInr: z.number().int().min(0),
  lateFeeInr: z.number().int().min(0).optional(),
  source: sourceSchema.optional(),
});

const letterSchema = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(8000) });

const scheduleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Use lower case, digits and hyphens'),
  label: z.string().min(1).max(160),
  kind: z.enum(['APPLICATION_WINDOW', 'LATE_FEE_WINDOW', 'PAYMENT_DEADLINE', 'DECISION_LAST_DATE']),
  from: isoDate,
  to: isoDate,
  appliesTo: expr,
  source: sourceSchema.optional(),
});

const eligibilitySchema = z.array(z.object({ tier: z.number().int().min(0), role: z.enum(['OFFICER', 'BUREAU']), region: z.enum(['HOME', 'ANY']), skill: z.string().optional() }));

const assignmentSchema = z.object({
  stageWeight: z.object(Object.fromEntries(TASKS.map((t) => [t, z.number().positive()])) as Record<(typeof TASKS)[number], z.ZodNumber>),
  defaultCapacityPoints: z.number().positive(),
  maxUtil: z.number().positive(),
  urgentMaxUtil: z.number().positive(),
  continuityUtilCap: z.number().positive(),
  scoreWeights: z.object({ projectedUtil: z.number().min(0), recent: z.number().min(0), mismatch: z.number().min(0) }),
  recentWorkingDays: z.number().int().positive(),
  specialisationLookbackDays: z.number().int().positive(),
  idleBelowTeamAverage: z.number().positive(),
  overloadedAbove: z.number().positive(),
  eligibility: z.object(Object.fromEntries(TASKS.map((t) => [t, eligibilitySchema])) as Record<(typeof TASKS)[number], typeof eligibilitySchema>),
  taskSkill: z.object(Object.fromEntries(TASKS.map((t) => [t, z.string().nullable()])) as Record<(typeof TASKS)[number], z.ZodNullable<z.ZodString>>),
});

export const LETTER_PLACEHOLDERS = [
  'application.no',
  'application.type',
  'institution.name',
  'institution.permanentId',
  'deficiency.items',
  'deficiency.reason',
  'decision.outcome',
  'decision.reason',
  'decision.conditions',
  'norms.deficiencyCompliancePeriod',
  'cycle',
  'rules.version',
  'today',
] as const;

export const packObject = z.object({
  meta: metaSchema,
  programmes: z.array(programmeSchema).min(1),
  applicationTypes: z.array(appTypeSchema).min(1),
  documents: z.array(documentSchema),
  norms: z.array(normSchema),
  formCheckRules: z.array(formCheckRuleSchema),
  timelines: timelinesSchema,
  fees: z.array(feeSchema),
  letters: z.object({ deficiency: letterSchema, decision: letterSchema }),
  schedule: z.array(scheduleSchema),
  reminders: z.object({
    complianceOffsets: z.array(z.number().int().min(0).max(365)).min(1),
    atRiskPct: z.number().min(1).max(100),
    stalledWorkingDays: z.number().int().positive(),
    urgentDays: z.number().int().min(0),
    dueSoonDays: z.number().int().positive(),
  }),
  escalation: z.object({
    thresholds: z.array(z.number().int().positive()).length(3),
    stageUnit: z.literal('WORKING'),
    complianceUnit: z.literal('CALENDAR'),
    levelTitles: z.array(z.string().min(1).max(80)).length(3),
  }),
  assignment: assignmentSchema,
  committees: z.array(
    z.object({ committee: z.enum(['EVC', 'SAC', 'SHC', 'EXPERT', 'APPELLATE', 'HEARING']), appointingAuthority: z.string().min(1).max(120), size: z.number().int().positive().max(20), source: sourceSchema.optional() }),
  ),
  calendar: z.object({ holidays: z.array(z.object({ date: isoDate, name: z.string().min(1).max(80) })) }),
  changeNotice: z.array(z.object({ title: z.string().min(1).max(200), summary: z.string().min(1).max(2000), audience: z.enum(['COLLEGE', 'STAFF']), amendmentId: z.string().optional() })),
});

export type PackContent = z.infer<typeof packObject>;

// ---------------------------------------------------------------- variables and cross-field validation

interface VarsFile {
  vars: Record<string, string>;
  prefixes: Record<string, string>;
}
let varsCache: VarsFile | null = null;
export function exprVars(): VarsFile {
  if (!varsCache) {
    const dir = process.env.SHARED_DIR ?? path.resolve(process.cwd(), '../shared');
    varsCache = JSON.parse(fs.readFileSync(path.join(dir, 'expr-vars.json'), 'utf8')) as VarsFile;
  }
  return varsCache;
}

export function knownVarFor(pack: Pick<PackContent, 'norms'>) {
  const norms = new Set(pack.norms.map((n) => n.key));
  const vars = exprVars().vars;
  return (p: string) => p in vars || (p.startsWith('norms.') && norms.has(p.slice(6)));
}

/** Approval cycle span used for validation: 1 July of the year before the cycle starts to 30 June of its last year. */
export function cycleSpan(code: string): { from: string; to: string } {
  const start = Number(code.slice(0, 4));
  return { from: `${start - 1}-07-01`, to: `${start + 1}-06-30` };
}

function dupes<T>(xs: T[], key: (x: T) => string): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const x of xs) {
    const k = key(x);
    if (seen.has(k)) out.add(k);
    seen.add(k);
  }
  return [...out];
}

export function crossValidate(pack: PackContent): ExprError[] {
  const errors: ExprError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  const known = knownVarFor(pack);
  const exprAt = (e: unknown, p: string) => errors.push(...validateExpr(e, known, p));
  const types = new Set(pack.applicationTypes.map((t) => t.type));

  for (const d of dupes(pack.programmes, (p) => p.code)) add('programmes', `Programme code ${d} is used twice.`);
  pack.programmes.forEach((p, i) => exprAt(p.inPurview, `programmes[${i}].inPurview`));

  for (const d of dupes(pack.applicationTypes, (t) => t.type)) add('applicationTypes', `Application type ${d} is listed twice.`);
  pack.applicationTypes.forEach((t, i) => {
    exprAt(t.eligibility, `applicationTypes[${i}].eligibility`);
    const stages = t.route.map((r) => r.stage);
    if (new Set(stages).size !== stages.length) add(`applicationTypes[${i}].route`, `The route of ${t.type} repeats a stage.`);
    if (stages.at(-1) !== 'DECISION') add(`applicationTypes[${i}].route`, `The route of ${t.type} must end with DECISION.`);
    t.route.forEach((r, j) => r.when !== undefined && exprAt(r.when, `applicationTypes[${i}].route[${j}].when`));
  });

  // A kind may appear in several entries (critical for one type, supporting for another) but once per type.
  for (const t of types) {
    for (const d of dupes(pack.documents.filter((x) => x.appliesTo.includes(t)), (x) => x.kind)) add('documents', `Document kind ${d} is listed twice for ${t}.`);
  }
  pack.documents.forEach((d, i) => {
    d.appliesTo.forEach((t, j) => !types.has(t) && add(`documents[${i}].appliesTo[${j}]`, `Application type ${t} does not exist in this pack.`));
    if (d.when !== undefined) exprAt(d.when, `documents[${i}].when`);
  });

  for (const d of dupes(pack.norms, (n) => `${n.key}|${n.scope?.level ?? ''}|${n.scope?.discipline ?? ''}`)) add('norms', `Norm ${d.split('|')[0]} is defined twice for the same scope.`);

  for (const d of dupes(pack.formCheckRules, (r) => r.id)) add('formCheckRules', `Rule ${d} is defined twice.`);
  pack.formCheckRules.forEach((r, i) => {
    exprAt(r.when, `formCheckRules[${i}].when`);
    if (r.valueVar && !known(r.valueVar)) add(`formCheckRules[${i}].valueVar`, `Unknown variable "${r.valueVar}".`);
  });

  pack.fees.forEach((f, i) => f.appliesTo.forEach((t, j) => !types.has(t) && add(`fees[${i}].appliesTo[${j}]`, `Application type ${t} does not exist in this pack.`)));

  for (const [name, l] of Object.entries(pack.letters)) {
    for (const m of `${l.subject}\n${l.body}`.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      if (!(LETTER_PLACEHOLDERS as readonly string[]).includes(m[1]!)) add(`letters.${name}`, `Placeholder {{${m[1]}}} is not allowed.`);
    }
  }

  for (const d of dupes(pack.schedule, (s) => s.id)) add('schedule', `Schedule id ${d} is used twice.`);
  pack.schedule.forEach((s, i) => {
    if (s.from > s.to) add(`schedule[${i}].to`, `The window "${s.label}" ends before it starts.`);
    exprAt(s.appliesTo, `schedule[${i}].appliesTo`);
  });

  const w = pack.assignment.scoreWeights;
  if (Math.abs(w.projectedUtil + w.recent + w.mismatch - 1) > 1e-9) add('assignment.scoreWeights', 'Score weights must add up to 1.');
  const th = pack.escalation.thresholds;
  if (!(th[0]! < th[1]! && th[1]! < th[2]!)) add('escalation.thresholds', 'Escalation thresholds must increase from level 1 to level 3.');

  const span = cycleSpan(pack.meta.cycle);
  for (const d of dupes(pack.calendar.holidays, (h) => h.date)) add('calendar.holidays', `Holiday ${d} is listed twice.`);
  pack.calendar.holidays.forEach((h, i) => {
    if (h.date < span.from || h.date > span.to) add(`calendar.holidays[${i}].date`, `${h.date} is outside the ${pack.meta.cycle} cycle (${span.from} to ${span.to}).`);
  });
  return errors;
}

export type ValidationResult = { ok: true; pack: PackContent } | { ok: false; errors: ExprError[] };

/** Schema plus cross-field validation. Errors are returned as [{path, message}] for the editor. */
export function validatePack(input: unknown): ValidationResult {
  const parsed = packObject.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.').replace(/\.\[/g, '['), message: i.message })) };
  }
  const errors = crossValidate(parsed.data);
  return errors.length ? { ok: false, errors } : { ok: true, pack: parsed.data };
}
