import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { verifyChains } from '../src/lib/audit.js';
import { bearer, resetDb, setToday, userByEmail } from './helpers.js';
import { PDF, decideWithConditions, defaultForm, submitApp, toDecision, userById } from './fixtures.js';

let app: Express;
const day = async (n = 1) => {
  setToday(addDays(clock.today(), n));
  return runEngineCycle();
};

async function verifier(applicationId: string) {
  const a = await prisma.assignment.findFirstOrThrow({ where: { applicationId, taskType: 'VERIFY', releasedAt: null } });
  return userById(a.officerId);
}

describe('post-approval compliance', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('undertaking: reminder → overdue → escalation → evidence → verify → CLOSED [5]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = await toDecision(app, college);
    await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 10 }]);
    const u = await prisma.undertaking.findFirstOrThrow({ where: { applicationId: id } });
    for (let i = 0; i < 15; i++) await day(1);
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'UNDERTAKING' } });
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'REMINDER' } })).toBe(4); // 30 and 15 (late, already passed at decision), 7, 0
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'OVERDUE' } })).toBe(1);
    expect(item.escalationLevel).toBe(1);
    expect(await prisma.exceptionFlag.count({ where: { applicationId: id, reasonCode: 'UNDERTAKING_OVERDUE', resolvedAt: null } })).toBe(1);

    const up = await request(app).post(`/api/undertakings/${u.id}/evidence`).set(...bearer(college)).attach('file', PDF, { filename: 'noc.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect((await prisma.undertaking.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('SUBMITTED');
    const officer = await verifier(id);
    expect(officer.id).toBe(priya.id); // continuity: portfolio officer
    expect(await prisma.deadlineItem.count({ where: { applicationId: id, type: 'VERIFICATION', status: 'OPEN' } })).toBe(1);

    const v = await request(app).post(`/api/undertakings/${u.id}/verify`).set(...bearer(officer)).send({ accept: true, remarks: 'NOC is valid' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const after = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('CLOSED');
    expect(await prisma.auditLog.count({ where: { applicationId: id, action: 'CLOSED' } })).toBe(1);
    expect(await prisma.deadlineItem.count({ where: { applicationId: id, type: { in: ['UNDERTAKING', 'VERIFICATION'] }, status: 'OPEN' } })).toBe(0);
    await runEngineCycle();
    expect(await prisma.exceptionFlag.count({ where: { applicationId: id, reasonCode: 'UNDERTAKING_OVERDUE', resolvedAt: null } })).toBe(0);
    expect((await verifyChains()).ok).toBe(true);
  });

  it('rejected evidence returns to OPEN and notifies the college', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const id = await toDecision(app, college);
    await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 30 }, { condition: 'Appoint principal', dueInDays: 60 }]);
    const u = await prisma.undertaking.findFirstOrThrow({ where: { applicationId: id, condition: 'Submit fire NOC' } });
    await request(app).post(`/api/undertakings/${u.id}/evidence`).set(...bearer(college)).attach('file', PDF, { filename: 'noc.pdf', contentType: 'application/pdf' });
    const officer = await verifier(id);
    // Someone else cannot verify.
    const other = await userByEmail('arjun@demo.in');
    expect((await request(app).post(`/api/undertakings/${u.id}/verify`).set(...bearer(other)).send({ accept: true })).status).toBe(403);
    expect((await request(app).post(`/api/undertakings/${u.id}/verify`).set(...bearer(officer)).send({ accept: false })).status).toBe(400);
    const r = await request(app).post(`/api/undertakings/${u.id}/verify`).set(...bearer(officer)).send({ accept: false, remarks: 'The NOC has expired.' });
    expect(r.status).toBe(200);
    const after = await prisma.undertaking.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.status).toBe('OPEN');
    expect(after.remarks).toBe('The NOC has expired.');
    expect(await prisma.notification.count({ where: { userId: college.id, kind: 'EVIDENCE_REJECTED' } })).toBe(1);
    expect(await prisma.assignment.count({ where: { applicationId: id, taskType: 'VERIFY', releasedAt: null } })).toBe(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED_WITH_CONDITIONS');
  });

  it('verified renewal replaces the expiry item [6]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const id = await toDecision(app, college, 'NEW_INSTITUTION');
    await request(app)
      .post(`/api/applications/${id}/actions`)
      .set(...bearer(await userByEmail('authority.south@demo.in')))
      .send({ action: 'DECIDE', reason: 'ok', payload: { outcome: 'APPROVED' } });
    const lease = await prisma.document.findFirstOrThrow({ where: { applicationId: id, kind: 'LAND_LEASE' } });
    const oldItem = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'DOC_EXPIRY', sourceId: lease.id } });
    const newExpiry = isoDate(addDays(clock.today(), 1500));
    const up = await request(app).post(`/api/documents/${lease.id}/renewal`).set(...bearer(college)).field('expiryDate', newExpiry).attach('file', PDF, { filename: 'lease-new.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const renewed = await prisma.document.findFirstOrThrow({ where: { supersedesId: lease.id } });
    const officer = await verifier(id);
    const v = await request(app).post(`/api/documents/${renewed.id}/verify-renewal`).set(...bearer(officer)).send({ accept: true });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect((await prisma.deadlineItem.findUniqueOrThrow({ where: { id: oldItem.id } })).status).toBe('CLOSED');
    const fresh = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'DOC_EXPIRY', sourceId: renewed.id } });
    expect(isoDate(fresh.dueDate)).toBe(newExpiry);
    expect(fresh.status).toBe('OPEN');
  });
});

describe('form check through the API', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('flags built-up larger than plot before submit and needs a justification, shown to the officer [27]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const values = defaultForm('NEW_INSTITUTION', { builtupAreaSqm: 25000 });
    const v = await request(app).post('/api/forms/validate').set(...bearer(college)).send({ draftId: 'draft-r1', type: 'NEW_INSTITUTION', values: { ...values, documents: ['LAND_LEASE', 'BUILDING_PLAN', 'AFFIDAVIT'] } });
    expect(v.status).toBe(200);
    expect(v.body.severity).toBe('HIGH');
    expect(v.body.justificationRequired).toBe(true);
    expect(v.body.warnings.some((w: { ruleId: string }) => w.ruleId === 'R1')).toBe(true);
    const blocked = await submitApp(app, college, { form: values, draftId: 'draft-r1' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/Explain the warnings/);
    const ok = await submitApp(app, college, { form: values, draftId: 'draft-r1', justification: 'Built-up area includes the basement floors.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const detail = await request(app).get(`/api/applications/${ok.body.application.id}`).set(...bearer(priya));
    expect(detail.body.formChecks[0].justification).toBe('Built-up area includes the basement floors.');
    expect(await prisma.auditLog.count({ where: { action: 'FORM_CHECK_JUSTIFIED' } })).toBe(1);
  });

  it('with the service stopped, warnings are rules-only and marked model unavailable; filing works [29]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const v = await request(app).post('/api/forms/validate').set(...bearer(college)).send({ draftId: 'd-down', type: 'NEW_INSTITUTION', values: defaultForm('NEW_INSTITUTION') });
    expect(v.body.modelAvailable).toBe(false);
    expect(v.body.modelVersion).toBe('rules-2027-28 v1');
    expect(v.body.canSubmit).toBe(true);
    expect((await submitApp(app, college, { draftId: 'd-down' })).status).toBe(201);
  });

  it('stores an officer label with the model version on the result [30]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const values = defaultForm('NEW_INSTITUTION', { facultyCount: 10 });
    const s = await submitApp(app, college, { form: values, justification: 'Recruitment under way.' });
    const fc = await prisma.formCheckResult.findFirstOrThrow({ where: { applicationId: s.body.application.id } });
    const r = await request(app).post(`/api/form-checks/${fc.id}/label`).set(...bearer(priya)).send({ warningIndex: 0, useful: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await prisma.formCheckResult.findUniqueOrThrow({ where: { id: fc.id } });
    expect((after.officerLabels as Record<string, { useful: boolean; modelVersion: string }>)['0']).toMatchObject({ useful: true, modelVersion: fc.modelVersion });
    expect(await prisma.auditLog.count({ where: { action: 'FORM_CHECK_LABEL' } })).toBe(1);
  });
});
