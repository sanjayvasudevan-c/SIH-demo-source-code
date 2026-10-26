import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { verifyChains } from '../src/lib/audit.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import * as clock from '../src/lib/clock.js';
import { nextWorkingDayFrom } from '../src/lib/workdays.js';
import { appendAudit } from '../src/lib/audit.js';
import { resetDb, userByEmail, firstUser } from './helpers.js';
import { act, collegeOf, grantPriorApproval, openAssignment, submitApp, userById } from './fixtures.js';

let app: Express;

async function committee() {
  return prisma.user.findMany({ where: { role: 'COMMITTEE' }, orderBy: { email: 'asc' } });
}

async function holderOf(id: string) {
  const a = await openAssignment(id);
  return a ? userById(a.officerId) : null;
}

async function scheduleAndReport(id: string) {
  const desk = (await holderOf(id))!;
  const members = await committee();
  const visitDate = nextWorkingDayFrom(addDays(clock.today(), 1));
  let r = await act(app, desk, id, 'SCHEDULE_EVC', { payload: { memberIds: members.slice(0, 3).map((m) => m.id), visitDate: isoDate(visitDate), mode: 'ONLINE' } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  clock.setOverride(new Date(visitDate.getTime() + 10 * 3_600_000));
  const member = await userById(members[0]!.id);
  r = await act(app, member, id, 'SUBMIT_EVC_REPORT', {
    payload: { checklist: { land: true, building: true, labs: true, faculty: true, library: true }, recommendation: 'RECOMMEND_APPROVAL', reportText: 'Facilities match the application.' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
}

async function decide(id: string, outcome = 'APPROVED') {
  const authority = await userByEmail('authority.south@demo.in');
  const r = await act(app, authority, id, 'DECIDE', { reason: 'Meets the norms.', payload: { outcome } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
}

describe('workflow', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('blocks submission without critical documents and names them', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const r = await submitApp(app, college, { docs: ['BUILDING_PLAN', 'AFFIDAVIT'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Land lease or title deed/);
    expect(await prisma.application.count()).toBe(0);
  });

  it('happy path SCRUTINY → EVC → DECISION (new institution) [1]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const ravi = await userByEmail('ravi@demo.in');
    const s = await submitApp(app, college);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const id = s.body.application.id;
    expect(s.body.application.stage).toBe('SCRUTINY');
    // College sees a desk, not a name.
    expect(s.body.application.holderLabel).toBe('Scrutiny officer, South');
    const a1 = await openAssignment(id);
    expect(a1!.officerId).toBe(priya.id);
    expect(a1!.reasonText).toMatch(/^Assigned to Priya Raman \(Officer, South\): portfolio officer for ABC Engineering College; utilisation/);

    let r = await act(app, priya, id, 'COMPLETE_STAGE');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body?.application?.stage ?? (await prisma.application.findUniqueOrThrow({ where: { id } })).stage).toBe('EVC');
    expect((await openAssignment(id))!.officerId).toBe(ravi.id);

    await scheduleAndReport(id);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).stage).toBe('DECISION');
    r = await decide(id);
    const final = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(final.status).toBe('APPROVED');
    expect(final.holderType).toBe('NONE');
  });

  it('happy path SCRUTINY → DECISION (extension) [3]', async () => {
    const inst = await prisma.institution.findFirstOrThrow({ where: { name: { not: 'ABC Engineering College' }, region: { code: 'SOUTH' } }, orderBy: { permanentId: 'asc' } });
    await grantPriorApproval(inst.id);
    const college = await collegeOf(inst.name);
    const s = await submitApp(app, college, { type: 'EXTENSION' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const id = s.body.application.id;
    const officer = (await holderOf(id))!;
    expect(officer.id).toBe(inst.portfolioOfficerId);
    expect((await act(app, officer, id, 'COMPLETE_STAGE')).status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).stage).toBe('DECISION');
    await decide(id);
  });

  it('refuses extension without a past approval and a second open application of the same type', async () => {
    const college = await userByEmail('college.abc@demo.in');
    expect((await submitApp(app, college, { type: 'EXTENSION' })).status).toBe(400);
    expect((await submitApp(app, college)).status).toBe(201);
    expect((await submitApp(app, college)).status).toBe(409);
  });

  it('happy path EVC → DECISION (verification visit)', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const s = await submitApp(app, college, { type: 'VERIFICATION_VISIT' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const id = s.body.application.id;
    expect(s.body.application.stage).toBe('EVC');
    await scheduleAndReport(id);
    await decide(id);
  });

  it('happy path EVC → SAC_SHC → DECISION (restoration)', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const s = await submitApp(app, college, { type: 'RESTORATION' });
    const id = s.body.application.id;
    await scheduleAndReport(id);
    const app1 = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(app1.stage).toBe('SAC_SHC');
    const bureau = (await holderOf(id))!;
    expect(bureau.role).toBe('BUREAU');
    expect((await act(app, bureau, id, 'FORWARD_SAC_SHC', { payload: { note: 'Forwarded with the EVC report.' } })).status).toBe(200);
    const member = await userById((await committee())[3]!.id);
    expect((await act(app, member, id, 'SUBMIT_RECOMMENDATION', { payload: { text: 'Restore approval for 2026-27.' } })).status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).stage).toBe('DECISION');
    await decide(id, 'REJECTED');
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('REJECTED');
  });

  it('resolves the conditional EVC for intake increase at submission', async () => {
    const insts = await prisma.institution.findMany({ where: { region: { code: 'SOUTH' }, name: { not: 'ABC Engineering College' } }, take: 2, orderBy: { permanentId: 'asc' } });
    for (const i of insts) await grantPriorApproval(i.id);
    const small = await submitApp(app, await collegeOf(insts[0]!.name), { type: 'INTAKE_INCREASE', form: undefined });
    expect(small.body.application.route).toEqual(['SCRUTINY', 'DECISION']);
    const { defaultForm } = await import('./fixtures.js');
    const big = await submitApp(app, await collegeOf(insts[1]!.name), { type: 'INTAKE_INCREASE', form: defaultForm('INTAKE_INCREASE', { intakeIncreasePct: 60 }) });
    expect(big.body.application.route).toEqual(['SCRUTINY', 'EVC', 'DECISION']);
  });

  it('RETURN then REPLY goes back to the same officer with the remaining days [25]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const before = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'STAGE_SLA' } });
    clock.setOverride(new Date(addDays(clock.today(), 2).getTime() + 10 * 3_600_000)); // Wednesday
    let r = await act(app, priya, id, 'RETURN', { reason: 'Lease covers 2 years, 3 required', payload: { items: ['LAND_LEASE'] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    let cur = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(cur.status).toBe('RETURNED');
    expect(cur.holderType).toBe('COLLEGE');
    const paused = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedRemaining).toBe(13);
    expect(await prisma.notification.count({ where: { userId: college.id, kind: 'RETURN' } })).toBe(1);

    clock.setOverride(new Date(addDays(clock.today(), 5).getTime() + 10 * 3_600_000));
    r = await act(app, college, id, 'REPLY', { payload: { note: 'Attached a 3-year lease.' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    cur = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(cur.status).toBe('IN_STAGE');
    const a = await openAssignment(id);
    expect(a!.officerId).toBe(priya.id);
    expect(a!.taskType).toBe('RE_SCRUTINY');
    expect(a!.reasonText).toMatch(/returned this application earlier \(continuity\)/);
    const resumed = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(resumed.status).toBe('OPEN');
    const { workingDaysBetween } = await import('../src/lib/workdays.js');
    expect(workingDaysBetween(clock.today(), resumed.dueDate)).toBe(13);
  });

  it('REVERT moves an EVC case back to scrutiny with a new clock [9]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const kumar = await userByEmail('kumar@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).stage).toBe('EVC');
    const r = await act(app, kumar, id, 'REVERT', { reason: 'Building plan does not match the site.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cur = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(cur.stage).toBe('SCRUTINY');
    expect(await prisma.assignment.count({ where: { applicationId: id, taskType: 'EVC_DESK', releasedAt: null } })).toBe(0);
    expect(await prisma.deadlineItem.count({ where: { applicationId: id, type: 'EVC_SCHEDULE', status: 'CLOSED' } })).toBe(1);
    expect(await prisma.deadlineItem.count({ where: { applicationId: id, type: 'STAGE_SLA', status: 'OPEN' } })).toBe(1);
    expect((await openAssignment(id))!.officerId).toBe(priya.id);
  });

  it('refuses DECIDE by an authority who handled the case (separation of duties)', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const authority = await userByEmail('authority.south@demo.in');
    const id = (await submitApp(app, college, { type: 'VERIFICATION_VISIT' })).body.application.id;
    await scheduleAndReport(id);
    await prisma.$transaction((tx) => appendAudit(tx, { actorId: authority.id, actorRole: 'AUTHORITY', action: 'COMPLETE_STAGE', applicationId: id, reason: 'fixture' }));
    const r = await act(app, authority, id, 'DECIDE', { reason: 'ok', payload: { outcome: 'APPROVED' } });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Separation of duties/);
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', actorId: authority.id } })).toBe(1);
    void priya;
  });

  it('writes exactly one audit row per action and every chain verifies', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'RETURN', { reason: 'Missing page', payload: { items: ['AFFIDAVIT'] } });
    await act(app, college, id, 'REPLY', { payload: { note: 'Added' } });
    await act(app, priya, id, 'COMPLETE_STAGE');
    await scheduleAndReport(id);
    await decide(id);
    const rows = await prisma.auditLog.findMany({ where: { applicationId: id } });
    const count = (a: string) => rows.filter((r) => r.action === a).length;
    for (const a of ['SUBMIT', 'RETURN', 'REPLY', 'COMPLETE_STAGE', 'SCHEDULE_EVC', 'SUBMIT_EVC_REPORT', 'DECIDE']) expect(count(a), a).toBe(1);
    expect((await verifyChains()).ok).toBe(true);
  });

  it('keeps scope: a South officer cannot list or open a West case; a college cannot see another college [8]', async () => {
    const westInst = await prisma.institution.findFirstOrThrow({ where: { region: { code: 'WEST' } } });
    const westCollege = await collegeOf(westInst.name);
    const s = await submitApp(app, westCollege);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const id = s.body.application.id;
    const priya = await userByEmail('priya@demo.in');
    const request = (await import('supertest')).default;
    const { bearer } = await import('./helpers.js');
    const list = await request(app).get('/api/applications').set(...bearer(priya));
    expect(list.body.rows.map((r: { id: string }) => r.id)).not.toContain(id);
    const open = await request(app).get(`/api/applications/${id}`).set(...bearer(priya));
    expect(open.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', actorId: priya.id } })).toBe(1);
    const abc = await userByEmail('college.abc@demo.in');
    expect((await request(app).get(`/api/applications/${id}`).set(...bearer(abc))).status).toBe(404);
    expect((await request(app).get('/api/applications').set(...bearer(abc))).body.rows).toHaveLength(0);
    const hodWest = await userByEmail('hod.west@demo.in');
    expect((await request(app).get(`/api/applications/${id}`).set(...bearer(hodWest))).status).toBe(200);
    const hodSouth = await firstUser('HOD', { region: { code: 'SOUTH' } });
    expect((await request(app).get(`/api/applications/${id}`).set(...bearer(hodSouth))).status).toBe(404);
  });
});
