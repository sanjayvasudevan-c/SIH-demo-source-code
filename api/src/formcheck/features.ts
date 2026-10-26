// Form check features (section 9.2). Computed identically in Python (formcheck/app/features.py).
import { z } from 'zod';
import type { AppType } from '@prisma/client';
import type { ResolvedRules, EvalContext } from '../rules/resolved.js';
import { parseDateOnly } from '../lib/dates.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const formValuesSchema = z.object({
  landAreaSqm: z.number().min(0).max(10_000_000).optional(),
  builtupAreaSqm: z.number().min(0).max(10_000_000).optional(),
  courses: z
    .array(z.object({ name: z.string().trim().min(1).max(120), intake: z.number().int().min(0).max(5000), years: z.number().int().min(1).max(6) }))
    .max(30)
    .optional(),
  facultyCount: z.number().int().min(0).max(100_000).optional(),
  labCount: z.number().int().min(0).max(10_000).optional(),
  leaseExpiry: isoDate.optional(),
  intakeIncreasePct: z.number().min(0).max(1000).optional(),
  proposedName: z.string().trim().max(200).optional(),
  fillSeconds: z.number().min(0).max(1_000_000).optional(),
  documents: z.array(z.string().max(60)).max(30).optional(),
  /** Programme code from the cycle's rule pack (add-on): drives purview, schedule scope and norms. */
  programme: z.string().regex(/^[A-Z0-9_]{2,20}$/).optional(),
});
export type FormValues = z.infer<typeof formValuesSchema>;

export type Features = Record<string, number | null>;

export const FEATURE_NAMES = [
  'land_area_sqm',
  'builtup_area_sqm',
  'builtup_ratio',
  'total_intake',
  'sqm_per_student',
  'faculty_count',
  'students_per_faculty',
  'labs_per_course',
  'lease_years_remaining',
  'docs_ratio',
  'log_fill_seconds',
] as const;

export const FIELD_LABEL: Record<string, string> = {
  landAreaSqm: 'Land area',
  builtupAreaSqm: 'Built-up area',
  courses: 'Courses and intake',
  facultyCount: 'Faculty count',
  labCount: 'Laboratories',
  leaseExpiry: 'Lease expiry date',
  intakeIncreasePct: 'Intake increase',
  proposedName: 'Proposed name',
  documents: 'Required documents attached (%)',
  land_area_sqm: 'Land area',
  builtup_area_sqm: 'Built-up area',
  builtup_ratio: 'Built-up to land ratio',
  total_intake: 'Total intake',
  sqm_per_student: 'Square metres per student',
  faculty_count: 'Faculty count',
  students_per_faculty: 'Students per faculty member',
  labs_per_course: 'Laboratories per course',
  lease_years_remaining: 'Years left on the lease',
  docs_ratio: 'Share of required documents attached',
  log_fill_seconds: 'Time spent filling the form',
};


const num = (v: number | undefined | null): number | null => (v === undefined || v === null || !Number.isFinite(v) ? null : v);
const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);

/** `required`: the critical document kinds of the case's rules (the required set for docs_ratio). */
export function computeFeatures(v: FormValues, todayIso: string, required: string[]): Features {
  const courses = v.courses ?? [];
  const land = num(v.landAreaSqm);
  const built = num(v.builtupAreaSqm);
  const totalIntake = courses.length ? courses.reduce((s, c) => s + c.intake, 0) : null;
  const studentYears = courses.length ? courses.reduce((s, c) => s + c.intake * c.years, 0) : null;
  const faculty = num(v.facultyCount);
  const labs = num(v.labCount);
  let leaseYears: number | null = null;
  if (v.leaseExpiry) {
    const days = (parseDateOnly(v.leaseExpiry).getTime() - parseDateOnly(todayIso).getTime()) / 86_400_000;
    leaseYears = days / 365.25;
  }
  // docs_ratio is unknown until the applicant reaches the documents step (documents omitted).
  const uploaded = new Set(v.documents ?? []);
  const docsRatio = v.documents === undefined ? null : required.length ? required.filter((k) => uploaded.has(k)).length / required.length : 1;
  return {
    land_area_sqm: land,
    builtup_area_sqm: built,
    builtup_ratio: div(built, land),
    total_intake: totalIntake,
    sqm_per_student: div(built, totalIntake),
    faculty_count: faculty,
    students_per_faculty: div(studentYears, faculty),
    labs_per_course: courses.length && labs !== null ? labs / courses.length : null,
    lease_years_remaining: leaseYears,
    docs_ratio: docsRatio,
    log_fill_seconds: v.fillSeconds !== undefined ? Math.log1p(v.fillSeconds) : null,
  };
}

/** Required-field validation per type (the form check itself never blocks). */
export function requiredMissing(r: ResolvedRules, type: AppType, v: FormValues, ctx: EvalContext = {}): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  const needsSite = r.documents(type, ctx).some((d) => d.kind === 'LAND_LEASE');
  if (!v.courses || v.courses.length === 0 || v.courses.every((c) => c.intake <= 0)) out.push({ field: 'courses', message: 'Add at least one course with its intake.' });
  if (!v.facultyCount) out.push({ field: 'facultyCount', message: 'Enter the number of faculty members.' });
  if (needsSite) {
    if (!v.landAreaSqm) out.push({ field: 'landAreaSqm', message: 'Enter the land area in square metres.' });
    if (!v.builtupAreaSqm) out.push({ field: 'builtupAreaSqm', message: 'Enter the built-up area in square metres.' });
    if (v.labCount === undefined) out.push({ field: 'labCount', message: 'Enter the number of laboratories.' });
    if (!v.leaseExpiry) out.push({ field: 'leaseExpiry', message: 'Enter the lease expiry date.' });
  }
  if (type === 'INTAKE_INCREASE' && v.intakeIncreasePct === undefined) out.push({ field: 'intakeIncreasePct', message: 'Enter the intake increase as a percentage.' });
  if (type === 'NAME_CHANGE' && !v.proposedName) out.push({ field: 'proposedName', message: 'Enter the proposed new name.' });
  return out;
}
