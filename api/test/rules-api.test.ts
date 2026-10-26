import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { isoDate } from '../src/lib/dates.js';
import { addWorkingDays } from '../src/lib/workdays.js';
import { bearer, resetDb, setToday, userByEmail } from './helpers.js';
import { submitApp } from './fixtures.js';

let app: Express;
type U = Awaited<ReturnType<typeof userByEmail>>;
let editor: U;
let approver: U;

const amendment = (over: Record<string, unknown> = {}) => ({ kind: 'CIRCULAR', refNo: 'TEST/2026/1', issuedOn: '2026-11-01', title: 'Test circular', summary: 'A test change.', ...over });

async function published(code: string) {
  return prisma.rulePackVersion.findFirstOrThrow({ where: { cycle: { code }, status: 'PUBLISHED' } });
}

async function draft(over: Record<string, unknown> = {}, effectiveFrom = '2026-11-02') {
  const parent = await published('2027-28');
  const res = await request(app).post('/api/rules/versions').set(...bearer(editor)).send({ parentVersionId: parent.id, effectiveFrom, amendment: amendment(over) });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const patch = (id: string, ops: unknown[]) => request(app).patch(`/api/rules/versions/${id}`).set(...bearer(editor)).send({ patch: ops });
const post = (u: U, path: string, body: unknown = {}) => request(app).post(`/api/rules${path}`).set(...bearer(u)).send(body as object);

async function approveAndPublish(id: string) {
  expect((await post(editor, `/versions/${id}/submit`)).status).toBe(200);
  expect((await post(approver, `/versions/${id}/approve`)).status).toBe(200);
  const pub = await post(approver, `/versions/${id}/publish`);
  expect(pub.status).toBe(200);
  return pub.body as { rebased: number; movedItems: number };
}

describe('/api/rules', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
    editor = await userByEmail('rules.editor@demo.in');
    approver = await userByEmail('rules.approver@demo.in');
  });

  it('a live, relaxing SLA change rebases open cases and moves their due date later', async () => {
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    const filed = await submitApp(app, college);
    expect(filed.status).toBe(201);
    const caseId = filed.body.application.id as string;
    const before = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: caseId, type: 'STAGE_SLA', status: 'OPEN' } });

    const id = await draft({ applyScope: { 'timelines.SCRUTINY': 'LIVE' } });
    const p = await patch(id, [{ op: 'replace', path: '/timelines/SCRUTINY', value: 20 }]);
    expect(p.body.errors).toEqual([]);
    const diff = await request(app).get(`/api/rules/versions/${id}/diff`).set(...bearer(approver));
    expect(diff.body.changes).toEqual([expect.objectContaining({ path: 'timelines.SCRUTINY', op: 'change', old: 15, new: 20, classification: 'relaxing', applyScope: 'LIVE' })]);

    const impact = await request(app).get(`/api/rules/versions/${id}/impact`).set(...bearer(approver));
    expect(impact.status).toBe(200);
    expect(impact.body.ms).toBeLessThan(3000);
    expect(impact.body.live.moves.some((m: { applicationId: string }) => m.applicationId === caseId)).toBe(true);
    expect(impact.body.sentences[0]).toMatch(/would move to this version/);

    const out = await approveAndPublish(id);
    expect(out.rebased).toBeGreaterThanOrEqual(1);
    const a = await prisma.application.findUniqueOrThrow({ where: { id: caseId } });
    expect(a.rulePackVersionId).toBe(id);
    const after = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(isoDate(after.dueDate)).toBe(isoDate(addWorkingDays(before.dueDate, 5)));
    expect(after.totalDays).toBe(20);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { applicationId: caseId, action: 'RULES_REBASED' } });
    expect(audit.meta).toMatchObject({ from: before.applicationId ? expect.any(String) : null, to: id, changes: ['timelines.SCRUTINY'] });
    expect(await prisma.notification.count({ where: { applicationId: caseId, kind: 'RULES_REBASED' } })).toBe(1);
  });

  it('refuses a tightening change marked live, with the path and the reason', async () => {
    const id = await draft({ applyScope: { 'timelines.SCRUTINY': 'LIVE' } });
    await patch(id, [{ op: 'replace', path: '/timelines/SCRUTINY', value: 10 }]);
    const res = await post(editor, `/versions/${id}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Shortens SCRUTINY SLA from 15 to 10 working days; can only apply to new cases.');
    expect(res.body.details.errors[0].path).toBe('timelines.SCRUTINY');
  });

  it('a new critical document applies to new filings only; filed cases stay pinned', async () => {
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    const old = await submitApp(app, college);
    const v1 = await published('2027-28');
    const id = await draft();
    await patch(id, [{ op: 'add', path: '/documents/-', value: { kind: 'ANTI_RAGGING_UNDERTAKING', label: 'Anti-ragging undertaking', appliesTo: ['NEW_INSTITUTION'], critical: true, hasExpiry: false } }]);
    const d = await request(app).get(`/api/rules/versions/${id}/diff`).set(...bearer(editor));
    expect(d.body.changes[0]).toMatchObject({ op: 'add', classification: 'tightening', applyScope: 'NEW_CASES' });
    expect((await approveAndPublish(id)).rebased).toBe(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: old.body.application.id } })).rulePackVersionId).toBe(v1.id);
    const other = await prisma.user.findFirstOrThrow({ where: { role: 'COLLEGE', institution: { isTechnical: true, name: { not: 'ABC Engineering College' } } } });
    const refused = await submitApp(app, other, { docs: ['LAND_LEASE', 'BUILDING_PLAN', 'AFFIDAVIT'] });
    expect(refused.status).toBe(400);
    expect(refused.body.details.missingDocuments).toEqual(['ANTI_RAGGING_UNDERTAKING']);
  });

  it('keeps live and new-case changes to pinned sections in separate amendments', async () => {
    const id = await draft({ applyScope: { 'timelines.SCRUTINY': 'LIVE' } });
    await patch(id, [
      { op: 'replace', path: '/timelines/SCRUTINY', value: 20 },
      { op: 'replace', path: '/timelines/DECISION', value: 5 },
    ]);
    const res = await post(editor, `/versions/${id}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.details.errors.map((e: { message: string }) => e.message).join(' ')).toMatch(/must be separate amendments/);
  });

  it('classifies a purview change by evaluating every institution: widening is relaxing, narrowing is tightening', async () => {
    const v1 = await published('2027-28');
    const bba = (v1.content as { programmes: { code: string }[] }).programmes.findIndex((p) => p.code === 'BBA');
    const widen = await draft({ applyScope: { 'programmes.BBA': 'LIVE' } });
    await patch(widen, [{ op: 'replace', path: `/programmes/${bba}/inPurview`, value: true }]);
    const w = await request(app).get(`/api/rules/versions/${widen}/diff`).set(...bearer(editor));
    expect(w.body.changes[0]).toMatchObject({ path: 'programmes.BBA.inPurview', classification: 'relaxing' });
    expect((await post(editor, `/versions/${widen}/submit`)).status).toBe(200);
    await post(approver, `/versions/${widen}/reject`, { remarks: 'Not now.' });
    await patch(widen, [{ op: 'replace', path: `/programmes/${bba}/inPurview`, value: { '==': [{ var: 'institution.kind' }, 'POLYTECHNIC'] } }]);
    const n = await request(app).get(`/api/rules/versions/${widen}/diff`).set(...bearer(editor));
    expect(n.body.changes[0]).toMatchObject({ classification: 'tightening' });
  });

  it('exports and imports a version: schema-validated, hash recomputed, a new DRAFT', async () => {
    const v1 = await published('2027-28');
    const exp = await request(app).get(`/api/rules/versions/${v1.id}/export`).set(...bearer(editor));
    expect(exp.status).toBe(200);
    expect(exp.body).toMatchObject({ schemaVersion: 1, cycle: '2027-28', version: 1, contentHash: v1.contentHash });
    const imp = await post(editor, '/import', { ...exp.body, contentHash: exp.body.contentHash });
    expect(imp.status).toBe(201);
    expect(imp.body.hashMatched).toBe(true);
    const created = await prisma.rulePackVersion.findUniqueOrThrow({ where: { id: imp.body.id } });
    expect(created.status).toBe('DRAFT');
    expect(await prisma.auditLog.count({ where: { action: 'RULES_IMPORTED', meta: { path: ['versionId'], equals: created.id } } })).toBe(1);
    const bad = await post(editor, '/import', { ...exp.body, content: { ...exp.body.content, timelines: { SCRUTINY: 'soon' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.details.errors.length).toBeGreaterThan(0);
  });

  it('rolls back by publishing a new version equal to an older one', async () => {
    const v3 = await published('2026-27');
    const v1 = await prisma.rulePackVersion.findFirstOrThrow({ where: { cycle: { code: '2026-27' }, version: 1 } });
    const rb = await post(editor, `/versions/${v3.id}/rollback-to/${v1.id}`, { effectiveFrom: '2026-11-02' });
    expect(rb.status).toBe(201);
    await approveAndPublish(rb.body.id);
    const v = await prisma.rulePackVersion.findUniqueOrThrow({ where: { id: rb.body.id } });
    const strip = (c: unknown) => ({ ...(c as object), meta: undefined });
    expect(strip(v.content)).toEqual(strip(v1.content));
    expect(await prisma.auditLog.count({ where: { action: 'RULES_ROLLED_BACK', meta: { path: ['versionId'], equals: v.id } } })).toBe(1);
    expect((await prisma.rulePackVersion.findUniqueOrThrow({ where: { id: v3.id } })).status).toBe('SUPERSEDED');
  });

  it('serves notices and the schedule without login; staff read, others are refused', async () => {
    const pub = await request(app).get('/api/rules/public/notices');
    expect(pub.status).toBe(200);
    expect(pub.body.notices.map((n: { kind: string }) => n.kind)).toEqual(expect.arrayContaining(['ADDENDUM', 'REVISED_PUBLIC_NOTICE', 'PROTOTYPE_PLACEHOLDER']));
    const addendum = pub.body.notices.find((n: { kind: string }) => n.kind === 'ADDENDUM');
    expect(addendum.affectedTypes).toEqual(expect.arrayContaining(['Extension of approval', 'Increase in intake']));
    const sch = await request(app).get('/api/rules/public/schedule');
    expect(sch.body.schedule.find((s: { id: string; cycle: string }) => s.id === 'window-bba-bca-bms' && s.cycle === '2026-27').scope).toBe('Only BBA, BCA, BMS');

    const officer = await userByEmail('priya@demo.in');
    expect((await request(app).get('/api/rules/cycles').set(...bearer(officer))).status).toBe(200);
    expect((await post(officer, '/versions', {})).status).toBe(403);
    const college = await userByEmail('college.abc@demo.in');
    expect((await request(app).get('/api/rules/cycles').set(...bearer(college))).status).toBe(403);
    const cycles = await request(app).get('/api/rules/cycles').set(...bearer(editor));
    expect(cycles.body.cycles.map((c: { code: string }) => c.code)).toEqual(['2027-28', '2026-27']);
    expect(cycles.body.cycles[1].versions[0]).toMatchObject({ version: 3, status: 'PUBLISHED', maker: 'Ravi Narayanan', checker: 'Dr. Kavita Rao' });
  });

  it('demo admin can ignore the schedule (audited); filing outside a window then works', async () => {
    setToday('2026-08-03');
    const college = await prisma.user.findFirstOrThrow({ where: { email: 'college.abc@demo.in' } });
    expect((await submitApp(app, college)).status).toBe(400);
    const admin = await userByEmail('admin@demo.in');
    expect((await request(app).post('/api/demo/ignore-schedule').set(...bearer(admin)).send({ on: true })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'DEMO_IGNORE_SCHEDULE' } })).toBe(1);
    expect((await submitApp(app, college)).status).toBe(201);
  });
});
