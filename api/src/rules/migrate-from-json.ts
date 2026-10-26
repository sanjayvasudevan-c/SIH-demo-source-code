// Builds the 2026-27 v1 rule pack from the three v3 JSON files (now shared/seed/*.json, seed input only) and,
// for a database created before the add-on, back-fills every application and assignment to it (add-on A10).
import fs from 'node:fs';
import path from 'node:path';
import type { PackContent } from './schema.js';
import { validatePack, APP_TYPES } from './schema.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const BASE_CYCLE = { code: '2026-27', label: 'Approval cycle 2026–27', baseRef: 'Approval Process Handbook 2024–27 (placeholder values)' };
export const BASE_AMENDMENT = {
  kind: 'PROTOTYPE_PLACEHOLDER' as const,
  refNo: 'PROTOTYPE/2026-27/BASE',
  issuedOn: '2025-11-28',
  title: 'Base rules for 2026–27 (placeholder)',
  summary: 'Placeholder values pending verification against the APH 2024–27.',
};
export const BASE_EFFECTIVE_FROM = '2025-11-28';

function seedDir(): string {
  return path.join(process.env.SHARED_DIR ?? path.resolve(process.cwd(), '../shared'), 'seed');
}
const read = (f: string): Json => JSON.parse(fs.readFileSync(path.join(seedDir(), f), 'utf8'));

const placeholder = { ref: 'Prototype placeholder (to be verified against the APH 2024–27)' };

export const PROGRAMMES: PackContent['programmes'] = [
  { code: 'DIPLOMA_ENGG', label: 'Diploma in Engineering', level: 'DIPLOMA', discipline: 'ENGINEERING', inPurview: true },
  { code: 'BTECH', label: 'B.E. / B.Tech', level: 'UG', discipline: 'ENGINEERING', inPurview: true },
  { code: 'MTECH', label: 'M.E. / M.Tech', level: 'PG', discipline: 'ENGINEERING', inPurview: true },
  { code: 'MBA', label: 'MBA', level: 'PG', discipline: 'MANAGEMENT', inPurview: true },
  { code: 'PGDM', label: 'PGDM', level: 'PGDM', discipline: 'MANAGEMENT', inPurview: true },
  { code: 'MCA', label: 'MCA', level: 'PG', discipline: 'COMPUTER_APPLICATIONS', inPurview: true },
  { code: 'BBA', label: 'BBA', level: 'UG', discipline: 'MANAGEMENT', inPurview: true },
  { code: 'BMS', label: 'BMS', level: 'UG', discipline: 'MANAGEMENT', inPurview: true },
  { code: 'BCA', label: 'BCA', level: 'UG', discipline: 'COMPUTER_APPLICATIONS', inPurview: true },
];

/** v3 route conditions {field, op, value} → expressions. */
function routeWhen(w: { field: string; op: string; value: number }) {
  const op = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '==' }[w.op]!;
  const rhs = w.field === 'intakeIncreasePct' && w.op === 'gt' ? { var: 'norms.evcIntakeIncreasePct' } : w.value;
  return { [op]: [{ var: `formData.${w.field}` }, rhs] };
}

/** v3 R1–R5 {feature, op, value|compare} → expressions over features and norms. */
const RULE_NORM: Record<string, string> = { R3: 'minDocsRatio', R4: 'maxStudentsPerFaculty', R5: 'minSqmPerStudent' };
const RULE_LABEL: Record<string, string> = {
  R1: 'Built-up area within the plot',
  R2: 'Lease still valid',
  R3: 'Required documents attached',
  R4: 'Students per faculty member',
  R5: 'Built-up area per student',
};
function ruleWhen(r: Json) {
  const op = { gt: '>', gte: '>=', lt: '<', lte: '<=', gt_feature: '>' }[r.op as string]!;
  const lhs = { var: `features.${r.feature}` };
  if (r.op === 'gt_feature') return { [op]: [lhs, { var: `features.${r.compare}` }] };
  return { [op]: [lhs, RULE_NORM[r.id] ? { var: `norms.${RULE_NORM[r.id]}` } : r.value] };
}

export function buildBasePack(holidays: { date: string; name: string }[] = []): PackContent {
  const rules = read('rules.json');
  const policy = read('assignment-policy.json');
  const fc = read('formcheck-rules.json');

  const applicationTypes = APP_TYPES.map((type) => {
    const t = rules.types[type];
    const c = rules.categories[t.category];
    return {
      type,
      label: t.label,
      category: t.category,
      categoryWeight: c.categoryWeight,
      categoryRank: c.categoryRank,
      eligibility: t.requiresPriorApproval ? { '==': [{ var: 'institution.hasPriorApproval' }, true] } : true,
      route: t.route.map((r: Json) => (r.when ? { stage: r.stage, when: routeWhen(r.when) } : { stage: r.stage })),
      channel: 'PORTAL' as const,
      source: placeholder,
    };
  });

  // One entry per (kind, critical, hasExpiry); a kind can be critical for one type and supporting for another.
  const docs = new Map<string, PackContent['documents'][number]>();
  for (const type of APP_TYPES) {
    for (const d of rules.types[type].documents as Json[]) {
      const key = `${d.kind}|${d.critical}|${d.hasExpiry}`;
      const cur = docs.get(key);
      if (cur) cur.appliesTo.push(type);
      else docs.set(key, { kind: d.kind, label: d.label, appliesTo: [type], critical: d.critical, hasExpiry: d.hasExpiry, format: 'PDF', source: placeholder });
    }
  }
  for (const d of docs.values()) if (d.kind === 'LAND_LEASE') d.minValidityYears = 3;

  const ruleValue = (id: string) => fc.rules.find((r: Json) => r.id === id).value as number;
  const norms: PackContent['norms'] = [
    { key: 'deficiencyCompliancePeriod', label: 'Period to comply with conditions of approval', unit: 'months', direction: 'MAX', value: 6, source: placeholder },
    { key: 'minLeaseYears', label: 'Minimum remaining land lease', unit: 'years', direction: 'MIN', value: 3, source: placeholder },
    { key: 'maxStudentsPerFaculty', label: 'Maximum students per faculty member', unit: 'students', direction: 'MAX', value: ruleValue('R4'), source: placeholder },
    { key: 'minSqmPerStudent', label: 'Minimum built-up area per student', unit: 'sq m', direction: 'MIN', value: ruleValue('R5'), source: placeholder },
    { key: 'minDocsRatio', label: 'Minimum share of required documents attached', unit: 'ratio', direction: 'MIN', value: ruleValue('R3'), source: placeholder },
    { key: 'evcIntakeIncreasePct', label: 'Intake increase above which an expert visit is needed', unit: '%', direction: 'MAX', value: 50, source: placeholder },
  ];

  const formCheckRules: PackContent['formCheckRules'] = (fc.rules as Json[]).map((r) => ({
    id: r.id,
    label: RULE_LABEL[r.id] ?? r.id,
    severity: r.severity,
    when: ruleWhen(r),
    message: r.message,
    fields: [r.field],
    valueVar: `features.${r.feature}`,
    ...(r.feature === 'docs_ratio' ? { valueAsPercent: true } : {}),
    source: placeholder,
  }));

  const { version: _v, note: _n, ...assignment } = policy as PackContent["assignment"] & { version: number; note?: string };

  const pack: PackContent = {
    meta: { cycle: BASE_CYCLE.code, version: 1, title: BASE_AMENDMENT.title, baseRef: BASE_CYCLE.baseRef, notes: rules.note },
    programmes: PROGRAMMES,
    applicationTypes,
    documents: [...docs.values()],
    norms,
    formCheckRules,
    timelines: rules.sla,
    fees: [
      { appliesTo: ['NEW_INSTITUTION'], amountInr: 900000, lateFeeInr: 100000, source: placeholder },
      { appliesTo: ['EXTENSION', 'NAME_CHANGE', 'VERIFICATION_VISIT', 'RESTORATION'], amountInr: 150000, lateFeeInr: 50000, source: placeholder },
      { appliesTo: ['INTAKE_INCREASE', 'CHANGE_OF_SITE'], amountInr: 300000, lateFeeInr: 50000, source: placeholder },
    ],
    letters: {
      deficiency: {
        subject: 'Deficiencies in application {{application.no}}',
        body:
          'To {{institution.name}} ({{institution.permanentId}}),\n\nScrutiny of application {{application.no}} ({{application.type}}) found the following deficiencies:\n\n{{deficiency.items}}\n\nReason: {{deficiency.reason}}\n\nReply with the corrected documents through the portal. This letter is issued under rules {{rules.version}} of cycle {{cycle}} on {{today}}.',
      },
      decision: {
        subject: 'Decision on application {{application.no}}',
        body:
          'To {{institution.name}} ({{institution.permanentId}}),\n\nThe competent authority has decided: {{decision.outcome}}.\n\nReason: {{decision.reason}}\n\nConditions, to be met within {{norms.deficiencyCompliancePeriod}} months unless a date is given:\n{{decision.conditions}}\n\nRules {{rules.version}}, cycle {{cycle}}. Issued on {{today}}.',
      },
    },
    schedule: [
      { id: 'window-main', label: 'Application window', kind: 'APPLICATION_WINDOW', from: '2025-12-01', to: '2026-01-31', appliesTo: true, source: placeholder },
      { id: 'late-fee', label: 'Late fee window', kind: 'LATE_FEE_WINDOW', from: '2026-02-01', to: '2026-02-07', appliesTo: true, source: placeholder },
      { id: 'decision-last', label: 'Last date for approval decisions', kind: 'DECISION_LAST_DATE', from: '2026-04-30', to: '2026-04-30', appliesTo: true, source: placeholder },
    ],
    reminders: {
      complianceOffsets: rules.complianceReminderOffsets,
      atRiskPct: rules.atRiskPct,
      stalledWorkingDays: rules.stalledWorkingDays,
      urgentDays: rules.urgentDays,
      dueSoonDays: rules.dueSoonDays,
    },
    escalation: { thresholds: rules.escalationThresholds, stageUnit: 'WORKING', complianceUnit: 'CALENDAR', levelTitles: ['Senior officer', 'Super senior officer', 'Head of department'] },
    assignment,
    committees: [
      { committee: 'EVC', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 3, source: placeholder },
      { committee: 'SAC', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 5, source: placeholder },
      { committee: 'SHC', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 5, source: placeholder },
      { committee: 'EXPERT', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 3, source: placeholder },
      { committee: 'APPELLATE', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 3, source: placeholder },
      { committee: 'HEARING', appointingAuthority: 'Chairman, AICTE (placeholder)', size: 3, source: placeholder },
    ],
    calendar: { holidays },
    changeNotice: [
      {
        title: 'Rules for the 2026–27 approval cycle',
        summary: 'The application types, documents, timelines and norms used by this prototype. All values are placeholders pending verification against the Approval Process Handbook 2024–27.',
        audience: 'COLLEGE',
      },
    ],
  };
  const v = validatePack(pack);
  if (!v.ok) throw new Error(`Base pack is invalid: ${v.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return v.pack;
}

/**
 * Back-fill a database created before the add-on: create 2026-27 v1 (published, by SYSTEM) if no cycle exists
 * and pin every application and assignment without a rule pack to it. Runs as the migrator, before
 * prisma/sql/002_rulepack_guard.sql makes the columns NOT NULL. A fresh `npm run setup` never needs it.
 */
export async function backfillExisting(c: import('pg').Client): Promise<{ backfilled: number }> {
  const pending = await c.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM "Application" WHERE "rulePackVersionId" IS NULL) + (SELECT count(*) FROM "Assignment" WHERE "rulePackVersionId" IS NULL) AS n`,
  );
  if (Number(pending.rows[0]!.n) === 0) return { backfilled: 0 };
  const { computeRowHash, GENESIS } = await import('../lib/audit.js');
  const { contentHash } = await import('./hash.js');
  const crypto = await import('node:crypto');
  const { now } = await import('../lib/clock.js');
  await c.query('BEGIN');
  try {
    let version = (await c.query<{ id: string; cycleId: string }>(`SELECT v.id, v."cycleId" FROM "RulePackVersion" v JOIN "ApprovalCycle" c ON c.id = v."cycleId" WHERE c.code = $1 AND v.version = 1`, [BASE_CYCLE.code])).rows[0];
    if (!version) {
      const hol = await c.query<{ date: string; name: string }>(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM "Holiday" ORDER BY date`);
      const content = buildBasePack(hol.rows.filter((h) => h.date >= '2025-07-01' && h.date <= '2027-06-30'));
      const at = now();
      const cycleId = crypto.randomUUID();
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO "ApprovalCycle" (id, code, label, "baseRef", "createdAt") VALUES ($1, $2, $3, $4, $5)`, [cycleId, BASE_CYCLE.code, BASE_CYCLE.label, BASE_CYCLE.baseRef, at]);
      await c.query(
        `INSERT INTO "RulePackVersion" (id, "cycleId", version, status, content, "contentHash", "createdById", "createdAt", "effectiveFrom") VALUES ($1, $2, 1, 'DRAFT', $3, $4, 'system', $5, $6)`,
        [id, cycleId, JSON.stringify(content), contentHash(content), at, BASE_EFFECTIVE_FROM],
      );
      await c.query(`INSERT INTO "Amendment" (id, "versionId", kind, "refNo", "issuedOn", title, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        crypto.randomUUID(), id, BASE_AMENDMENT.kind, BASE_AMENDMENT.refNo, BASE_AMENDMENT.issuedOn, BASE_AMENDMENT.title, BASE_AMENDMENT.summary,
      ]);
      for (const s of ['IN_REVIEW', 'APPROVED', 'PUBLISHED']) await c.query(`UPDATE "RulePackVersion" SET status = $2 WHERE id = $1`, [id, s]);
      await c.query(`UPDATE "RulePackVersion" SET "approvedById" = 'system', "approvedAt" = $2, "publishedById" = 'system', "publishedAt" = $2 WHERE id = $1`, [id, at]);
      const last = await c.query<{ rowHash: string }>(`SELECT "rowHash" FROM "AuditLog" WHERE "chainKey" = 'rules' ORDER BY id DESC LIMIT 1`);
      const row = { at, chainKey: 'rules', actorId: null, actorRole: 'SYSTEM', action: 'RULES_PUBLISHED', applicationId: null, fromState: null, toState: null, reason: 'Migrated from shared/*.json', meta: { versionId: id, cycleId, version: 1, migratedFromJson: true } };
      const prevHash = last.rows[0]?.rowHash ?? GENESIS;
      await c.query(
        `INSERT INTO "AuditLog" ("chainKey", at, "actorId", "actorRole", action, "applicationId", reason, meta, "prevHash", "rowHash") VALUES ($1, $2, NULL, $3, $4, NULL, $5, $6, $7, $8)`,
        [row.chainKey, at, row.actorRole, row.action, row.reason, JSON.stringify(row.meta), prevHash, computeRowHash(prevHash, row)],
      );
      version = { id, cycleId };
    }
    const apps = await c.query(`UPDATE "Application" SET "cycleId" = $2, "rulePackVersionId" = $1 WHERE "rulePackVersionId" IS NULL`, [version.id, version.cycleId]);
    const asg = await c.query(`UPDATE "Assignment" SET "rulePackVersionId" = $1 WHERE "rulePackVersionId" IS NULL`, [version.id]);
    await c.query('COMMIT');
    return { backfilled: (apps.rowCount ?? 0) + (asg.rowCount ?? 0) };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}

/** The base pack as resolved rules, for offline tools (sample generation) that run without a database. */
export async function baseRules() {
  const { ResolvedRules } = await import('./resolved.js');
  const ref = { id: 'base', cycleId: 'base', cycleCode: BASE_CYCLE.code, version: 1, effectiveFrom: BASE_EFFECTIVE_FROM, contentHash: '' };
  return new ResolvedRules(ref, ref, buildBasePack());
}
