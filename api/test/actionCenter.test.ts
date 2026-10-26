import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, formatDate } from '../src/lib/dates.js';
import { addWorkingDays, workingDaysBetween } from '../src/lib/workdays.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { buildFlags } from '../src/engine/flags.js';
import { getSubtreeUserIds } from '../src/policy/subtree.js';
import { bearer, resetDb, setToday, userByEmail } from './helpers.js';
import { act, collegeOf, decideWithConditions, grantPriorApproval, openAssignment, submitApp, toDecision, userById } from './fixtures.js';

let app: Express;
const day = async (n = 1) => {
  setToday(addDays(clock.today(), n));
  return runEngineCycle();
};

describe('Action Center', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('reason text numbers match the items [15]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    for (let i = 0; i < 25; i++) await day(1);
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'STAGE_SLA' } });
    const overdue = -workingDaysBetween(clock.today(), item.dueDate);
    const flag = await prisma.exceptionFlag.findFirstOrThrow({ where: { applicationId: id, reasonCode: 'STAGE_OVERDUE', resolvedAt: null } });
    expect(flag.ownerUserId).toBe(priya.id);
    expect(flag.reasonText).toContain(`Scrutiny deadline ${overdue} working days overdue (due ${formatDate(item.dueDate)})`);
    expect(flag.reasonText).toContain('owner: Priya Raman (Officer, South)');
    const nextLevel = item.escalationLevel + 1;
    const th = [3, 7, 14][nextLevel - 1]!;
    expect(flag.reasonText).toContain(`next escalation: level ${nextLevel}`);
    expect(flag.reasonText).toContain(formatDate(addWorkingDays(item.dueDate, th)));
    expect((flag.sortKeys as { daysOverdue: number }).daysOverdue).toBe(overdue);
  });

  it('never counts college-owned flags as officer overdue; shows them under Waiting on college [16]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = await toDecision(app, college);
    await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 5 }]);
    for (let i = 0; i < 8; i++) await day(1);
    const f = await prisma.exceptionFlag.findFirstOrThrow({ where: { applicationId: id, reasonCode: 'UNDERTAKING_OVERDUE', resolvedAt: null } });
    expect(f.ownerRole).toBe('COLLEGE');
    const summary = await request(app).get('/api/action-center/summary').set(...bearer(priya));
    expect(summary.body.overdue).toBe(0);
    expect(summary.body.waitingOnCollege).toBe(1);
    const mine = await request(app).get('/api/action-center').set(...bearer(priya));
    expect(mine.body.rows.find((r: { applicationId: string }) => r.applicationId === id)).toBeUndefined();
    const waiting = await request(app).get('/api/action-center?filter=waitingOnCollege').set(...bearer(priya));
    expect(waiting.body.rows.map((r: { applicationId: string }) => r.applicationId)).toContain(id);
    const own = await request(app).get('/api/action-center').set(...bearer(college));
    expect(own.body.rows[0].primary.reasonCode).toBe('UNDERTAKING_OVERDUE');
  });

  it('orders by the five keys; a new institution comes before an extension at equal delay [12, 14]', async () => {
    const priya = await userByEmail('priya@demo.in');
    const inst = await prisma.institution.findFirstOrThrow({ where: { portfolioOfficerId: priya.id, name: { not: 'ABC Engineering College' } } });
    await grantPriorApproval(inst.id);
    const ext = (await submitApp(app, await collegeOf(inst.name), { type: 'EXTENSION' })).body.application.id;
    const neu = (await submitApp(app, await userByEmail('college.abc@demo.in'))).body.application.id;
    for (let i = 0; i < 22; i++) await day(1);
    const r = await request(app).get('/api/action-center').set(...bearer(priya));
    const ids = r.body.rows.map((x: { applicationId: string }) => x.applicationId);
    expect(ids.indexOf(neu)).toBeLessThan(ids.indexOf(ext));
    const keys = r.body.rows.map((x: { sortKeys: { escalationLevel: number; daysOverdue: number; categoryRank: number } }) => x.sortKeys);
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1];
      const b = keys[i];
      expect(a.escalationLevel > b.escalationLevel || (a.escalationLevel === b.escalationLevel && a.daysOverdue >= b.daysOverdue)).toBe(true);
    }
  });

  it('BLOCKED names the missing item and the case is URGENT inside the window [20]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    const members = await prisma.user.findMany({ where: { role: 'COMMITTEE' } });
    for (const m of members.slice(0, 4)) {
      await prisma.officerAvailability.create({ data: { userId: m.id, kind: 'FIELD_VISIT', startsOn: clock.today(), endsOn: addDays(clock.today(), 40), reason: 'Visits', createdById: m.id } });
    }
    await runEngineCycle();
    expect(await prisma.exceptionFlag.count({ where: { applicationId: id, reasonCode: 'BLOCKED', resolvedAt: null } })).toBe(0);
    for (let i = 0; i < 12; i++) await day(1);
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'EVC_SCHEDULE' } });
    const d = workingDaysBetween(clock.today(), item.dueDate);
    expect(d).toBeLessThanOrEqual(3);
    const blocked = await prisma.exceptionFlag.findFirstOrThrow({ where: { applicationId: id, reasonCode: 'BLOCKED', resolvedAt: null } });
    expect(blocked.reasonText).toMatch(/committee proposal: only 2 of 3 members available/);
    expect(blocked.nextAction).toBe('Supply or assign: committee members');
    if (d >= 0) expect(await prisma.exceptionFlag.count({ where: { applicationId: id, reasonCode: 'URGENT', resolvedAt: null } })).toBe(1);
  });

  it('resolves flags when their cause is fixed, with an audit row', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'RETURN', { reason: 'Missing', payload: { items: ['AFFIDAVIT'] } });
    await buildFlags(clock.today());
    const f = await prisma.exceptionFlag.findFirstOrThrow({ where: { applicationId: id, reasonCode: 'WAITING_ON_COLLEGE' } });
    expect(f.resolvedAt).toBeNull();
    await act(app, college, id, 'REPLY', { payload: { note: 'Added' } });
    await buildFlags(clock.today());
    expect((await prisma.exceptionFlag.findUniqueOrThrow({ where: { id: f.id } })).resolvedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { applicationId: id, action: 'FLAG_RESOLVED' } })).toBe(1);
  });
});

describe('dashboards and workforce', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  async function spread() {
    const insts = await prisma.institution.findMany({ where: { region: { code: 'SOUTH' } }, orderBy: { permanentId: 'asc' }, take: 24 });
    const ids: string[] = [];
    for (const i of insts) ids.push((await submitApp(app, await collegeOf(i.name))).body.application.id);
    // Some progress and some returns so every metric moves.
    for (const id of ids.slice(0, 6)) {
      const a = (await openAssignment(id))!;
      await act(app, await userById(a.officerId), id, 'COMPLETE_STAGE');
    }
    for (const id of ids.slice(6, 9)) {
      const a = (await openAssignment(id))!;
      await act(app, await userById(a.officerId), id, 'RETURN', { reason: 'Missing page', payload: { items: ['AFFIDAVIT'] } });
    }
    for (let i = 0; i < 20; i++) await day(1);
    return ids;
  }

  it('roll-up totals for a super senior equal the sum of their seniors; drill-down returns the next level', async () => {
    await spread();
    const lakshmi = await userByEmail('lakshmi@demo.in');
    const r = await request(app).get('/api/reports/team?period=30').set(...bearer(lakshmi));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const kumar = await userByEmail('kumar@demo.in');
    let sumHeld = 0;
    let sumReceived = 0;
    let sumOverdue = 0;
    let sumCompleted = 0;
    for (const row of r.body.rows) {
      const d = await request(app).get(`/api/reports/team?period=30&drill=${row.user.id}`).set(...bearer(lakshmi));
      expect(d.body.totals.heldNow).toBe(row.metrics.heldNow);
      expect(d.body.totals.received).toBe(row.metrics.received);
      sumHeld += row.metrics.heldNow;
      sumReceived += row.metrics.received;
      sumOverdue += row.metrics.overdueNow;
      sumCompleted += row.metrics.completed;
    }
    expect(r.body.totals.heldNow).toBe(sumHeld);
    expect(r.body.totals.received).toBe(sumReceived);
    expect(r.body.totals.overdueNow).toBe(sumOverdue);
    expect(r.body.totals.completed).toBe(sumCompleted);
    expect(r.body.rows.map((x: { user: { id: string } }) => x.user.id)).toContain(kumar.id);
    // Outside the subtree is refused.
    const west = await userByEmail('mahesh@demo.in');
    expect((await request(app).get(`/api/reports/team?drill=${west.id}`).set(...bearer(lakshmi))).status).toBe(403);
  });

  it('counts by region, stage, ageing and workload match the data [11]', async () => {
    await spread();
    const hod = await userByEmail('hod.south@demo.in');
    const r = await request(app).get('/api/reports/team?period=90').set(...bearer(hod));
    const southOfficers = await prisma.user.findMany({ where: { role: 'OFFICER', region: { code: 'SOUTH' } }, select: { id: true } });
    const ids = southOfficers.map((o) => o.id);
    const held = await prisma.assignment.count({ where: { officerId: { in: ids }, releasedAt: null } });
    expect(r.body.totals.heldNow).toBe(held);
    const a = r.body.totals.ageing;
    expect(a.d0to7 + a.d8to15 + a.d16plus).toBe(new Set((await prisma.assignment.findMany({ where: { officerId: { in: ids }, releasedAt: null } })).map((x) => x.applicationId)).size);
    const open = await prisma.application.findMany({ where: { regionId: hod.regionId!, status: { in: ['IN_STAGE', 'RETURNED'] } } });
    const w = r.body.waitingOn;
    expect(w.officer + w.college + w.evcOrCommittee + w.authority).toBe(open.length);
    expect(w.college).toBe(open.filter((x) => x.holderType === 'COLLEGE').length);
    const wl = await request(app).get('/api/assignments/workload').set(...bearer(hod));
    expect(wl.body.rows).toHaveLength(ids.length);
    const points = wl.body.rows.reduce((s: number, x: { openPoints: number }) => s + x.openPoints, 0);
    const agg = await prisma.assignment.aggregate({ where: { officerId: { in: ids }, releasedAt: null }, _sum: { weight: true } });
    expect(points).toBeCloseTo(Number(agg._sum.weight ?? 0), 5);
  });

  it('computes OVERLOADED and IDLE against the right team average', async () => {
    const kumar = await userByEmail('kumar@demo.in');
    const arjun = await userByEmail('arjun@demo.in');
    const meena = await userByEmail('meena@demo.in');
    const team = await prisma.user.findMany({ where: { reportsToId: kumar.id } });
    // Load everyone in Kumar's team except Meena through real filings.
    const insts = await prisma.institution.findMany({ where: { portfolioOfficerId: { in: team.filter((t) => t.id !== meena.id).map((t) => t.id) } } });
    for (const i of insts) await submitApp(app, await collegeOf(i.name));
    await prisma.officerProfile.update({ where: { userId: arjun.id }, data: { capacityPoints: 2 } });
    const r = await request(app).get('/api/assignments/workload').set(...bearer(kumar));
    const row = (id: string) => r.body.rows.find((x: { id: string }) => x.id === id);
    expect(row(arjun.id).flag).toBe('OVERLOADED');
    const avg = row(meena.id).teamAverage;
    expect(row(meena.id).utilisation).toBeLessThan(avg - 0.35);
    expect(row(meena.id).flag).toBe('IDLE');
    expect(r.body.rows.every((x: { senior: { id: string } }) => x.senior.id === kumar.id)).toBe(true);
    expect((await getSubtreeUserIds(kumar.id)).length).toBe(5);
  });

  it('records the system recommendation on a manual reassignment through the API', async () => {
    const kumar = await userByEmail('kumar@demo.in');
    const college = await userByEmail('college.abc@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const a = (await openAssignment(id))!;
    const opts = await request(app).get(`/api/assignments/${a.id}/options`).set(...bearer(kumar));
    expect(opts.status, JSON.stringify(opts.body)).toBe(200);
    expect(opts.body.recommended).toBeTruthy();
    const target = opts.body.eligible.find((e: { id: string; blocked: string | null }) => !e.blocked && e.id !== opts.body.recommended.id && (e as unknown as { tier: number }).tier === 0);
    const team = await getSubtreeUserIds(kumar.id);
    const pick = team.includes(target.id) ? target : opts.body.eligible.find((e: { id: string; blocked: string | null }) => team.includes(e.id) && !e.blocked);
    const r = await request(app).post('/api/assignments/reassign').set(...bearer(kumar)).send({ assignmentId: a.id, toOfficerId: pick.id, reason: 'Balancing load' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { applicationId: id, action: { in: ['ASSIGN_OVERRIDE', 'REASSIGN'] } } });
    expect((row.meta as { recommendedOfficerId: string }).recommendedOfficerId).toBe(opts.body.recommended.id);
    expect(row.action).toBe(pick.id === opts.body.recommended.id ? 'REASSIGN' : 'ASSIGN_OVERRIDE');
  });
});
