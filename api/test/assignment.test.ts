import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays } from '../src/lib/dates.js';
import { newestRules } from '../src/rules/service.js';
import { bearer, resetDb, userByEmail } from './helpers.js';
import { act, collegeOf, currentPin, openAssignment, submitApp } from './fixtures.js';

let app: Express;

async function southInstitutionWithoutPortfolio() {
  const inst = await prisma.institution.findFirstOrThrow({ where: { region: { code: 'SOUTH' }, name: { not: 'ABC Engineering College' } }, orderBy: { permanentId: 'desc' } });
  await prisma.institution.update({ where: { id: inst.id }, data: { portfolioOfficerId: null } });
  return inst;
}

async function addOpenLoad(officerId: string, points: number, applicationId: string) {
  // Test fixture: synthetic open load on an officer (one VERIFY assignment with the given weight).
  await prisma.assignment.create({
    data: { applicationId, taskType: 'VERIFY', taskRefId: `load-${officerId}-${points}`, officerId, weight: points, tier: 0, reasonText: 'fixture', rulePackVersionId: (await currentPin()).rulePackVersionId, assignedAt: clock.now() },
  });
}

describe('assignment engine', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('assigns a new scrutiny case to the lowest-score eligible officer and lists exclusions [21]', async () => {
    const inst = await southInstitutionWithoutPortfolio();
    const college = await collegeOf(inst.name);
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER', region: { code: 'SOUTH' } }, orderBy: { id: 'asc' } });
    // Everyone gets some load so the choice is decided by score; one officer stays empty.
    const anchor = await submitApp(app, await userByEmail('college.abc@demo.in'));
    const anchorId = anchor.body.application.id;
    const target = officers[7]!;
    // Equal history for everyone (no specialisation mismatch); the target carries the least load.
    for (const o of officers) {
      const cap = Number((await prisma.officerProfile.findUniqueOrThrow({ where: { userId: o.id } })).capacityPoints);
      await addOpenLoad(o.id, o.id === target.id ? 1 : 0.2 * cap, anchorId);
    }
    await prisma.officerAvailability.create({
      data: { userId: officers[3]!.id, kind: 'LEAVE', startsOn: clock.today(), endsOn: addDays(clock.today(), 10), reason: 'Medical', createdById: officers[3]!.id },
    });
    await addOpenLoad(officers[5]!.id, 8, anchorId); // 10 points + 1.5 > capacity 10
    // Clear the anchor's own scrutiny assignment so it does not count against Priya.
    const s = await submitApp(app, college);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const a = await openAssignment(s.body.application.id);
    expect(a!.officerId).toBe(target.id);
    expect(a!.reasonText).toMatch(/lowest load score/);
    expect(a!.reasonText).toMatch(/1 on leave until/);
    expect(a!.reasonText).toMatch(/over capacity \(1\.\d\d/);
    expect(a!.reasonText).toMatch(/Tier 0\. Rules 2027-28 v1\.$/);
  });

  it('releases and reassigns open tasks when leave covering today is added; due dates are kept [22]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const kumar = await userByEmail('kumar@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'STAGE_SLA' } });
    const r = await request(app)
      .post('/api/availability')
      .set(...bearer(kumar))
      .send({ userId: priya.id, kind: 'LEAVE', startsOn: clock.today().toISOString().slice(0, 10), endsOn: addDays(clock.today(), 4).toISOString().slice(0, 10), reason: 'Family function' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.coversToday).toBe(true);
    expect(r.body.reassigned).toHaveLength(1);
    const a = await openAssignment(id);
    expect(a!.officerId).not.toBe(priya.id);
    expect(r.body.reassigned[0].reasonText).toBe(a!.reasonText);
    const after = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.dueDate.getTime()).toBe(item.dueDate.getTime());
    expect(after.responsibleUserId).toBe(a!.officerId);
    expect(await prisma.assignment.count({ where: { applicationId: id, releasedReason: 'LEAVE' } })).toBe(1);
  });

  it('overflows to the Bureau (tier 1), then blocks to the HoD queue when nobody is eligible [23]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const ravi = await userByEmail('ravi@demo.in');
    const hod = await userByEmail('hod.south@demo.in');
    const today = clock.today();
    await prisma.officerAvailability.create({ data: { userId: ravi.id, kind: 'TRAINING', startsOn: today, endsOn: addDays(today, 5), reason: 'Workshop', createdById: ravi.id } });
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    const a = await openAssignment(id);
    expect(a!.taskType).toBe('EVC_DESK');
    expect(a!.tier).toBe(1);
    expect(a!.officer.role).toBe('BUREAU');
    expect(a!.reasonText).toMatch(/Tier 1 \(Bureau overflow: no eligible officer in South\)/);

    // Second case: Ravi and every Bureau officer unavailable → BLOCKED and the HoD queue.
    const bureau = await prisma.user.findMany({ where: { role: 'BUREAU' } });
    for (const b of bureau) await prisma.officerAvailability.create({ data: { userId: b.id, kind: 'LEAVE', startsOn: today, endsOn: addDays(today, 5), reason: 'Leave', createdById: b.id } });
    const inst2 = await prisma.institution.findFirstOrThrow({ where: { portfolioOfficerId: priya.id, name: { not: 'ABC Engineering College' } } });
    const id2 = (await submitApp(app, await collegeOf(inst2.name))).body.application.id;
    await act(app, priya, id2, 'COMPLETE_STAGE');
    expect(await openAssignment(id2)).toBeNull();
    const cur = await prisma.application.findUniqueOrThrow({ where: { id: id2 } });
    expect(cur.holderType).toBe('NONE');
    const flag = await prisma.exceptionFlag.findFirstOrThrow({ where: { applicationId: id2, reasonCode: 'BLOCKED' } });
    expect(flag.ownerUserId).toBe(hod.id);
    expect(await prisma.auditLog.count({ where: { applicationId: id2, action: 'ASSIGN_FAILED' } })).toBe(1);
    const q = await request(app).get('/api/assignments/unassigned').set(...bearer(hod));
    expect(q.body.rows.map((r: { applicationId: string }) => r.applicationId)).toContain(id2);

    // HoD assigns by hand; the block resolves.
    const officer = await prisma.user.findFirstOrThrow({ where: { role: 'OFFICER', region: { code: 'SOUTH' }, id: { not: priya.id } } });
    await prisma.officerProfile.update({ where: { userId: officer.id }, data: { skills: ['EVC_DESK'] } });
    const m = await request(app).post('/api/assignments/unassigned/assign').set(...bearer(hod)).send({ applicationId: id2, taskType: 'EVC_DESK', taskRefId: '', toOfficerId: officer.id, reason: 'Covering for Ravi' });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect((await openAssignment(id2))!.officerId).toBe(officer.id);
    expect((await prisma.exceptionFlag.findUniqueOrThrow({ where: { id: flag.id } })).resolvedAt).not.toBeNull();
  });

  it('50 concurrent filings in one region: nobody over maxUtil, no double assignment, points add up [24]', async () => {
    const insts = await prisma.institution.findMany({ where: { region: { code: 'SOUTH' } }, orderBy: { permanentId: 'asc' }, take: 50 });
    const colleges = await Promise.all(insts.map((i) => collegeOf(i.name)));
    const results = await Promise.all(colleges.map((c) => submitApp(app, c)));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const open = await prisma.assignment.findMany({ where: { releasedAt: null }, include: { officer: { include: { profile: true } } } });
    expect(open).toHaveLength(50);
    expect(new Set(open.map((a) => a.applicationId)).size).toBe(50);
    const byOfficer = new Map<string, { points: number; cap: number; max: number }>();
    for (const a of open) {
      const e = byOfficer.get(a.officerId) ?? { points: 0, cap: Number(a.officer.profile!.capacityPoints), max: Number(a.officer.profile!.maxUtil) };
      e.points += Number(a.weight);
      byOfficer.set(a.officerId, e);
    }
    for (const [, e] of byOfficer) expect(e.points / e.cap).toBeLessThanOrEqual(Math.max(e.max, (await newestRules()).assignment.continuityUtilCap) + 1e-9);
    const sum = await prisma.assignment.aggregate({ where: { releasedAt: null }, _sum: { weight: true } });
    expect(Number(sum._sum.weight)).toBeCloseTo(50 * 1.5, 5);
    expect([...byOfficer.values()].reduce((s, e) => s + e.points, 0)).toBeCloseTo(75, 5);
  });

  it('reassignment by a senior stores the system recommendation', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const kumar = await userByEmail('kumar@demo.in');
    const meena = await userByEmail('meena@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const a = (await openAssignment(id))!;
    const { reassignManual } = await import('../src/assignment/engine.js');
    const r = await reassignManual(kumar, a.id, meena.id, 'Balancing load');
    expect(r.recommendedOfficerId).toBeTruthy();
    const b = (await openAssignment(id))!;
    expect(b.officerId).toBe(meena.id);
    expect(b.recommendedOfficerId).toBe(r.recommendedOfficerId);
    expect(b.reasonText).toMatch(/System recommended: /);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { applicationId: id, action: { in: ['ASSIGN_OVERRIDE', 'REASSIGN'] } } });
    expect((row.meta as { recommendedOfficerId: string }).recommendedOfficerId).toBe(r.recommendedOfficerId);
  });
});
