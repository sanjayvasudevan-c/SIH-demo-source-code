// Seed rule packs (add-on A10) through the real state machine, with the clock back-dated:
// - 2026-27 v1: built from shared/seed/*.json (PROTOTYPE_PLACEHOLDER).
// - 2026-27 v2: modelled on the Addendum to the APH of 04 Dec 2025.
// - 2026-27 v3: modelled on the Revised Public Notice of 04 Feb 2026 (BBA/BCA/BMS window to 28 Feb).
// - 2027-28 v1: a copy of 2026-27 v3 with a placeholder window from seed date − 7 to + 60 days.
// Every item is labelled "modelled on": nothing here is an official AICTE text.
import type { PrismaClient } from '@prisma/client';
import * as clock from '../../src/lib/clock.js';
import { addDays, isoDate, parseDateOnly } from '../../src/lib/dates.js';
import { buildBasePack, BASE_AMENDMENT, BASE_CYCLE, BASE_EFFECTIVE_FROM } from '../../src/rules/migrate-from-json.js';
import { cycleSpan, type PackContent } from '../../src/rules/schema.js';
import { approveVersion, createBaseVersion, createCycle, createDraft, publishVersion, saveDraft, submitVersion, type RulesActor } from '../../src/rules/versions.js';
import { clearRulesCache } from '../../src/rules/service.js';
import { holidaysAfter } from './directory.js';

const at = (day: string | Date, hour: number) => clock.setOverride(new Date((typeof day === 'string' ? parseDateOnly(day) : day).getTime() + hour * 3_600_000));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function actor(db: PrismaClient, email: string): Promise<RulesActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true, name: true } });
  return u;
}

export interface SeededPacks {
  base: string;
  v2: string;
  v3: string;
  next: string;
}

export async function seedRulePacks(db: PrismaClient, opts: { today: Date }): Promise<SeededPacks> {
  const editor = await actor(db, 'rules.editor@demo.in');
  const approver = await actor(db, 'rules.approver@demo.in');
  const T = opts.today;
  const holidays = holidaysAfter(T).map((h) => ({ date: isoDate(h.date), name: h.name }));
  const inSpan = (code: string) => {
    const s = cycleSpan(code);
    return holidays.filter((h) => h.date >= s.from && h.date <= s.to);
  };
  clearRulesCache();

  async function review(id: string, day: string | Date) {
    at(day, 11);
    await submitVersion(editor, id);
    at(day, 15);
    await approveVersion(approver, id);
    at(day, 17);
    await publishVersion(approver, id);
  }

  // ---- 2026-27 v1 (base, from JSON)
  at(BASE_EFFECTIVE_FROM, 10);
  const base = await db.$transaction((tx) =>
    createBaseVersion(tx, editor, { cycle: BASE_CYCLE, content: buildBasePack(inSpan(BASE_CYCLE.code)), amendment: { ...BASE_AMENDMENT }, effectiveFrom: BASE_EFFECTIVE_FROM }),
  );
  await review(base.id, BASE_EFFECTIVE_FROM);

  // ---- 2026-27 v2: modelled on the Addendum of 04 Dec 2025
  at('2025-12-04', 10);
  const v2 = await createDraft(editor, {
    parentVersionId: base.id,
    effectiveFrom: '2025-12-04',
    amendment: {
      kind: 'ADDENDUM',
      refNo: 'Modelled on: Addendum to APH 2024–27, 04 Dec 2025',
      issuedOn: '2025-12-04',
      title: 'Addendum for 2026–27 (modelled on 04 Dec 2025)',
      summary:
        'Supernumerary seats for foreign nationals rise to 25% for PG engineering and management. Extension and intake increase applications must attach a nil-deficiency self-disclosure. BBA, BMS and BCA in non-technical institutions are outside purview. Expert, appellate and hearing committees are appointed by the full council.',
    },
  });
  {
    const a = await db.amendment.findUniqueOrThrow({ where: { versionId: v2.id } });
    const src = (clause: string) => ({ amendmentId: a.id, ref: 'Addendum 04 Dec 2025 (modelled)', clause });
    const c = clone(v2.content as unknown as PackContent);
    c.norms.push(
      { key: 'foreignSupernumeraryPct', label: 'Supernumerary seats for foreign nationals', unit: '%', direction: 'MAX', value: 15, scope: { level: 'UG', discipline: 'ENGINEERING' }, source: src('item 1') },
      { key: 'foreignSupernumeraryPct', label: 'Supernumerary seats for foreign nationals', unit: '%', direction: 'MAX', value: 25, scope: { level: 'PG', discipline: 'ENGINEERING' }, source: src('item 1') },
      { key: 'foreignSupernumeraryPct', label: 'Supernumerary seats for foreign nationals', unit: '%', direction: 'MAX', value: 25, scope: { discipline: 'MANAGEMENT' }, source: src('item 1') },
    );
    c.documents.push({ kind: 'NIL_DEFICIENCY_DISCLOSURE', label: 'Nil deficiency self-disclosure', appliesTo: ['EXTENSION', 'INTAKE_INCREASE'], critical: true, hasExpiry: false, format: 'PDF', source: src('item 2') });
    for (const p of c.programmes) if (['BBA', 'BMS', 'BCA'].includes(p.code)) Object.assign(p, { inPurview: { var: 'institution.isTechnical' }, source: src('item 4') });
    for (const m of c.committees) if (['EXPERT', 'APPELLATE', 'HEARING'].includes(m.committee)) Object.assign(m, { appointingAuthority: 'Full Council (placeholder)', source: src('item 5') });
    c.changeNotice = [
      {
        title: 'Addendum for 2026–27 (modelled on 04 Dec 2025)',
        summary: 'Extension and intake increase applications now need a nil-deficiency self-disclosure. BBA, BMS and BCA in non-technical institutions are outside purview. Applications already filed are not affected.',
        audience: 'COLLEGE',
        amendmentId: a.id,
      },
      ...c.changeNotice,
    ];
    at('2025-12-04', 10.5);
    await saveDraft(editor, v2.id, { content: c, paths: ['norms', 'documents', 'programmes', 'committees', 'changeNotice'] });
  }
  await review(v2.id, '2025-12-04');

  // ---- 2026-27 v3: modelled on the Revised Public Notice of 04 Feb 2026
  at('2026-02-04', 9);
  const v3 = await createDraft(editor, {
    parentVersionId: v2.id,
    effectiveFrom: '2026-02-04',
    amendment: {
      kind: 'REVISED_PUBLIC_NOTICE',
      refNo: 'Modelled on: Revised Public Notice, 04 Feb 2026',
      issuedOn: '2026-02-04',
      title: 'Revised schedule for 2026–27 (modelled on 04 Feb 2026)',
      summary: 'Institutions with pending dues may pay until 11 Feb 2026. Only BBA, BCA and BMS institutions may apply until 28 Feb 2026.',
      applyScope: { 'schedule.window-bba-bca-bms': 'LIVE' },
    },
  });
  {
    const a = await db.amendment.findUniqueOrThrow({ where: { versionId: v3.id } });
    const src = (clause: string) => ({ amendmentId: a.id, ref: 'Revised Public Notice 04 Feb 2026 (modelled)', clause });
    const c = clone(v3.content as unknown as PackContent);
    c.schedule.push(
      { id: 'payment-dues', label: 'Payment of pending dues', kind: 'PAYMENT_DEADLINE', from: '2026-02-04', to: '2026-02-11', appliesTo: true, source: src('para 2') },
      { id: 'window-bba-bca-bms', label: 'Application window for BBA, BCA and BMS', kind: 'APPLICATION_WINDOW', from: '2026-02-04', to: '2026-02-28', appliesTo: { in: [{ var: 'programme.code' }, ['BBA', 'BCA', 'BMS']] }, source: src('para 3') },
    );
    c.changeNotice = [
      { title: 'Revised schedule for 2026–27 (modelled on 04 Feb 2026)', summary: 'Pending dues can be paid until 11 Feb 2026. BBA, BCA and BMS institutions can apply until 28 Feb 2026.', audience: 'COLLEGE', amendmentId: a.id },
      ...c.changeNotice,
    ];
    at('2026-02-04', 9.5);
    await saveDraft(editor, v3.id, { content: c, paths: ['schedule', 'changeNotice'] });
  }
  await review(v3.id, '2026-02-04');

  // ---- 2027-28 v1: copy of 2026-27 v3, placeholder window around the seed date
  const opened = addDays(T, -7);
  at(addDays(T, -9), 10);
  const created = await createCycle(editor, {
    code: '2027-28',
    copyFromVersionId: v3.id,
    effectiveFrom: isoDate(opened),
    amendment: {
      kind: 'PROTOTYPE_PLACEHOLDER',
      refNo: 'PROTOTYPE/2027-28/BASE',
      issuedOn: isoDate(addDays(T, -9)),
      title: 'Rules for 2027–28 (placeholder)',
      summary: 'The 2026–27 rules as amended, carried forward. The application window is a placeholder for the demo.',
    },
  });
  {
    const c = clone(created.version.content as unknown as PackContent);
    const ph = { ref: 'Placeholder window for the demo' };
    c.schedule = [
      { id: 'window-main', label: 'Placeholder window for the demo', kind: 'APPLICATION_WINDOW', from: isoDate(opened), to: isoDate(addDays(T, 60)), appliesTo: true, source: ph },
      { id: 'late-fee', label: 'Late fee window (placeholder)', kind: 'LATE_FEE_WINDOW', from: isoDate(addDays(T, 61)), to: isoDate(addDays(T, 67)), appliesTo: true, source: ph },
      { id: 'decision-last', label: 'Last date for approval decisions (placeholder)', kind: 'DECISION_LAST_DATE', from: isoDate(addDays(T, 150)), to: isoDate(addDays(T, 150)), appliesTo: true, source: ph },
    ];
    c.calendar = { holidays: inSpan('2027-28') };
    c.changeNotice = [{ title: 'Rules for 2027–28 (placeholder)', summary: 'The 2026–27 rules as amended are carried forward to 2027–28. The application window shown is a placeholder for the demo.', audience: 'COLLEGE' }];
    at(addDays(T, -9), 10.5);
    await saveDraft(editor, created.version.id, { content: c, paths: ['schedule', 'calendar', 'changeNotice'] });
  }
  await review(created.version.id, opened);
  clock.setOverride(null);
  // Everything seeded counts as seen: the college banner shows only changes published after the seed.
  const last = await db.rulePackVersion.aggregate({ _max: { publishedAt: true } });
  const seenAt = new Date(Math.max(clock.now().getTime(), last._max.publishedAt?.getTime() ?? 0));
  await db.user.updateMany({ data: { noticesSeenAt: seenAt } });
  return { base: base.id, v2: v2.id, v3: v3.id, next: created.version.id };
}
