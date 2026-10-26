// Add-on A11: the remaining rule pack checks (schema, limits, concurrency, scopes, operational changes, form check,
// rollback pins, audit).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import { addWorkingDays, loadHolidays, nextWorkingDayFrom } from '../src/lib/workdays.js';
import { verifyChains } from '../src/lib/audit.js';
import { validatePack, type PackContent } from '../src/rules/schema.js';
import { forNewFiling } from '../src/rules/service.js';
import { approveVersion, createDraft, publishVersion, saveDraft, submitVersion } from '../src/rules/versions.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { validateForm } from '../src/formcheck/service.js';
import { bearer, resetDb, userByEmail } from './helpers.js';
import { defaultForm, submitApp } from './fixtures.js';

let app: Express;
type U = Awaited<ReturnType<typeof userByEmail>>;
let editor: U;
let approver: U;
const amendment = (title = 'Test change') => ({ kind: 'CIRCULAR' as const, refNo: 'TEST/1', issuedOn: '2026-11-01', title, summary: 'A test change.' });

async function published(code = '2027-28') {
  return prisma.rulePackVersion.findFirstOrThrow({ where: { cycle: { code }, status: 'PUBLISHED' } });
}

/** Draft from the published 2027-28 version, change it, then submit, approve and publish. */
async function change(mutate: (c: PackContent) => void, scope: Record<string, 'NEW_CASES' | 'LIVE'> = {}) {
  const parent = await published();
  const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: isoDate(clock.today()), amendment: { ...amendment(), applyScope: scope } });
  const c = JSON.parse(JSON.stringify(d.content)) as PackContent;
  mutate(c);
  const saved = await saveDraft(editor, d.id, { content: c });
  expect(saved.errors).toEqual([]);
  await submitVersion(editor, d.id);
  await approveVersion(approver, d.id);
  await publishVersion(approver, d.id);
  return d.id;
}

describe('rule packs (A11)', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
    editor = await userByEmail('rules.editor@demo.in');
    approver = await userByEmail('rules.approver@demo.in');
  });

  it('every seeded version validates against the schema', async () => {
    const all = await prisma.rulePackVersion.findMany();
    expect(all.length).toBe(4);
    for (const v of all) {
      const r = validatePack(v.content);
      expect(r.ok ? [] : r.errors, `v${v.version}`).toEqual([]);
    }
  });

  it('refuses a 9-deep or 3 KB expression and an unknown variable at save', async () => {
    const parent = await published();
    const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: '2026-11-02', amendment: amendment() });
    const c = JSON.parse(JSON.stringify(d.content)) as PackContent;
    let deep: unknown = { var: 'formData.facultyCount' };
    for (let i = 0; i < 9; i++) deep = { '!': deep };
    c.formCheckRules[0]!.when = deep;
    c.formCheckRules[1]!.when = { in: [{ var: 'programme.code' }, Array.from({ length: 400 }, (_, i) => `CODE_${i}`)] };
    c.formCheckRules[2]!.when = { '>': [{ var: 'formData.secretField' }, 1] };
    const { errors } = await saveDraft(editor, d.id, { content: c });
    const at = (i: number) => errors.filter((e) => e.path.startsWith(`formCheckRules[${i}].when`)).map((e) => e.message).join(' ');
    expect(at(0)).toMatch(/deep/i);
    expect(at(1)).toMatch(/2048|large|size/i);
    expect(at(2)).toMatch(/Unknown variable/);
  });

  it('keeps one PUBLISHED version per cycle under two concurrent publishes', async () => {
    const parent = await published();
    const ids: string[] = [];
    for (const t of ['A', 'B']) {
      const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: '2026-11-02', amendment: amendment(t) });
      await submitVersion(editor, d.id);
      await approveVersion(approver, d.id);
      ids.push(d.id);
    }
    const results = await Promise.allSettled(ids.map((id) => publishVersion(approver, id)));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const pub = await prisma.rulePackVersion.count({ where: { cycle: { code: '2027-28' }, status: 'PUBLISHED' } });
    expect(pub).toBe(1);
  });

  it('refuses as live an eligibility change that would flip an open case', async () => {
    const parent = await published();
    const i = (parent.content as unknown as PackContent).applicationTypes.findIndex((t) => t.type === 'NEW_INSTITUTION');
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    expect((await submitApp(app, college)).status).toBe(201);
    const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: '2026-11-02', amendment: { ...amendment(), applyScope: { 'applicationTypes.NEW_INSTITUTION': 'LIVE' } } });
    const c = JSON.parse(JSON.stringify(d.content)) as PackContent;
    c.applicationTypes[i]!.eligibility = { '==': [{ var: 'institution.kind' }, 'POLYTECHNIC'] };
    await saveDraft(editor, d.id, { content: c });
    await expect(submitVersion(editor, d.id)).rejects.toThrow(/eligibility.*can only apply to new cases/);
  });

  it('shows the late fee inside the late-fee window', async () => {
    const r = await forNewFiling(addDays(clock.today(), 62), { institution: { isTechnical: true }, application: { type: 'NEW_INSTITUTION' } });
    expect(r.ok && r.window.kind).toBe('LATE_FEE_WINDOW');
    expect(r.ok && r.lateFeeInr).toBe(100000);
  });

  it('a live window extension with a new-cases-only document leaves filed cases pinned (demo step 11)', async () => {
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    const filed = (await submitApp(app, college)).body.application.id as string;
    const v1 = await published();
    await change(
      (c) => {
        c.documents.push({ kind: 'FIRE_SAFETY_AUDIT', label: 'Fire safety audit report', appliesTo: ['NEW_INSTITUTION'], critical: true, hasExpiry: false });
        const w = c.schedule.find((s) => s.id === 'window-main')!;
        w.to = isoDate(addDays(new Date(`${w.to}T00:00:00Z`), 14));
      },
      { 'schedule.window-main': 'LIVE' },
    );
    expect((await prisma.application.findUniqueOrThrow({ where: { id: filed } })).rulePackVersionId).toBe(v1.id);
    const detail = await request(app).get(`/api/applications/${filed}`).set(...bearer(college));
    expect(detail.body.requiredDocuments.map((d: { kind: string }) => d.kind)).not.toContain('FIRE_SAFETY_AUDIT');
    const unseen = await request(app).get('/api/rules/notices/unseen').set(...bearer(college));
    expect(unseen.body).toEqual({ count: 1, cycles: ['2027-28'] });
    await request(app).post('/api/rules/notices/seen').set(...bearer(college));
    expect((await request(app).get('/api/rules/notices/unseen').set(...bearer(college))).body.count).toBe(0);
  });

  it('operational changes: new escalation thresholds apply on the next cycle once; weights only for new assignments; a holiday shifts new due dates', async () => {
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    const a = (await submitApp(app, college)).body.application.id as string;
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: a, type: 'STAGE_SLA', status: 'OPEN' } });
    await prisma.deadlineItem.update({ where: { id: item.id }, data: { dueDate: addWorkingDays(clock.today(), -2) } });
    await runEngineCycle({}, { digests: false });
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'ESCALATION' } })).toBe(0);
    const before = await prisma.assignment.findFirstOrThrow({ where: { applicationId: a, releasedAt: null } });

    const holiday = nextWorkingDayFrom(addDays(clock.today(), 1));
    await change((c) => {
      c.escalation.thresholds = [1, 2, 3];
      c.assignment.stageWeight.SCRUTINY = 2;
      c.calendar.holidays.push({ date: isoDate(holiday), name: 'Test holiday' });
    });
    await loadHolidays(prisma);
    await runEngineCycle({}, { digests: false });
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'ESCALATION' } })).toBe(2);
    await runEngineCycle({}, { digests: false });
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'ESCALATION' } })).toBe(2);

    expect(Number((await prisma.assignment.findUniqueOrThrow({ where: { id: before.id } })).weight)).toBe(Number(before.weight));
    const other = await prisma.user.findFirstOrThrow({ where: { role: 'COLLEGE', institution: { isTechnical: true, name: { not: 'ABC Engineering College' } } } });
    const b = (await submitApp(app, other)).body.application.id as string;
    expect(Number((await prisma.assignment.findFirstOrThrow({ where: { applicationId: b } })).weight)).toBe(3); // 2 × 1.5 (new institution)
    const due = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: b, type: 'STAGE_SLA' } });
    expect(isoDate(due.dueDate)).toBe(isoDate(addWorkingDays(clock.today(), 15)));
    expect(await prisma.holiday.count({ where: { date: holiday } })).toBe(1);
  });

  it('raising maxStudentsPerFaculty changes R4 in the impact preview, and live results only for new filings after publish', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const heavy = { ...defaultForm('NEW_INSTITUTION'), facultyCount: 10 } as never;
    const oldCheck = await validateForm(college, { draftId: 'r4-old', type: 'NEW_INSTITUTION', values: heavy });
    expect(oldCheck.warnings.some((w) => w.ruleId === 'R4')).toBe(true);
    const parent = await published();
    const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: '2026-11-02', amendment: amendment() });
    const c = JSON.parse(JSON.stringify(d.content)) as PackContent;
    c.norms.find((n) => n.key === 'maxStudentsPerFaculty')!.value = 400;
    await saveDraft(editor, d.id, { content: c });
    const impact = await request(app).get(`/api/rules/versions/${d.id}/impact`).set(...bearer(editor));
    const r4 = impact.body.formCheck.rules.find((r: { rule: string }) => r.rule === 'R4');
    expect(r4.samplesAfter).toBeLessThan(r4.samplesBefore);
    expect((await validateForm(college, { draftId: 'r4-draft', type: 'NEW_INSTITUTION', values: heavy })).warnings.some((w) => w.ruleId === 'R4')).toBe(true);
    await submitVersion(editor, d.id);
    await approveVersion(approver, d.id);
    await publishVersion(approver, d.id);
    expect((await validateForm(college, { draftId: 'r4-new', type: 'NEW_INSTITUTION', values: heavy })).warnings.some((w) => w.ruleId === 'R4')).toBe(false);
    const stored = await prisma.formCheckResult.findUniqueOrThrow({ where: { id: oldCheck.id } });
    expect((stored.warnings as { ruleId?: string }[]).some((w) => w.ruleId === 'R4')).toBe(true);
  });

  it('rollback to v1 creates v4 with v1 content and leaves cases pinned to v3', async () => {
    const v3 = await published('2026-27');
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    const filed = (await submitApp(app, college)).body.application.id as string;
    // Fixture: a case filed under 2026-27 v3 (the test database has no back-dated history).
    await prisma.application.update({ where: { id: filed }, data: { cycleId: v3.cycleId, rulePackVersionId: v3.id } });
    const pinned = await prisma.application.count({ where: { rulePackVersionId: v3.id } });
    expect(pinned).toBeGreaterThan(0);
    const v1 = await prisma.rulePackVersion.findFirstOrThrow({ where: { cycle: { code: '2026-27' }, version: 1 } });
    const rb = await request(app).post(`/api/rules/versions/${v3.id}/rollback-to/${v1.id}`).set(...bearer(editor)).send({ effectiveFrom: '2026-11-02' });
    expect(rb.body.version).toBe(4);
    await submitVersion(editor, rb.body.id);
    await approveVersion(approver, rb.body.id);
    await publishVersion(approver, rb.body.id);
    expect(await prisma.application.count({ where: { rulePackVersionId: v3.id } })).toBe(pinned);
  });

  it('every Rules Center action writes exactly one audit row and the chains verify', async () => {
    const count = () => prisma.auditLog.count({ where: { chainKey: 'rules' } });
    const parent = await published();
    let n = await count();
    const d = await createDraft(editor, { parentVersionId: parent.id, effectiveFrom: '2026-11-02', amendment: amendment() });
    expect(await count()).toBe(++n);
    await saveDraft(editor, d.id, { content: d.content });
    expect(await count()).toBe(++n);
    await submitVersion(editor, d.id);
    expect(await count()).toBe(++n);
    await approveVersion(approver, d.id);
    expect(await count()).toBe(++n);
    await publishVersion(approver, d.id);
    expect(await count()).toBe(++n);
    await request(app).get(`/api/rules/versions/${d.id}/export`).set(...bearer(editor));
    expect(await count()).toBe(++n);
    expect((await verifyChains()).ok).toBe(true);
  });
});
