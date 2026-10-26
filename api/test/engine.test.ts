import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, isoDate, parseDateOnly } from '../src/lib/dates.js';
import { addWorkingDays, loadHolidays, workingDaysBetween } from '../src/lib/workdays.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { bearer, resetDb, setToday, userByEmail } from './helpers.js';
import { act, decideWithConditions, openAssignment, submitApp, toDecision } from './fixtures.js';

let app: Express;

async function day(n = 1) {
  setToday(addDays(clock.today(), n));
  return runEngineCycle();
}

describe('deadline engine', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('pause stores remaining working days and resume restores them exactly', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'STAGE_SLA' } });
    setToday('2026-11-05');
    await act(app, priya, id, 'RETURN', { reason: 'Missing', payload: { items: ['AFFIDAVIT'] } });
    const paused = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedRemaining).toBe(workingDaysBetween(parseDateOnly('2026-11-05'), item.dueDate));
    setToday('2026-11-30');
    await act(app, college, id, 'REPLY', { payload: { note: 'Done' } });
    const resumed = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(resumed.status).toBe('OPEN');
    expect(workingDaysBetween(parseDateOnly('2026-11-30'), resumed.dueDate)).toBe(paused.pausedRemaining);
  });

  it('holidays shift due dates', async () => {
    // The seed holds holidays on 9 Nov and 24 Nov 2026; 15 working days from Mon 2 Nov skip both.
    const college = await userByEmail('college.abc@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'STAGE_SLA' } });
    const { setHolidays } = await import('../src/lib/workdays.js');
    const withHolidays = isoDate(addWorkingDays(parseDateOnly('2026-11-02'), 15));
    setHolidays([]);
    const without = isoDate(addWorkingDays(parseDateOnly('2026-11-02'), 15));
    await loadHolidays(prisma);
    expect(isoDate(item.dueDate)).toBe(withHolidays);
    expect(without).toBe('2026-11-23');
    expect(withHolidays).toBe('2026-11-25');
  });

  it('fires each compliance offset once over 30 days, and repeated cycles add nothing [6]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const id = await toDecision(app, college);
    await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 30 }]);
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'UNDERTAKING' } });
    for (let i = 0; i <= 31; i++) {
      await runEngineCycle();
      await runEngineCycle();
      if (i < 31) await day(1);
    }
    const reminders = await prisma.alertLog.findMany({ where: { itemId: item.id, kind: 'REMINDER' }, orderBy: { offsetOrLevel: 'desc' } });
    expect(reminders.map((r) => r.offsetOrLevel)).toEqual([30, 15, 7, 0]);
    expect(reminders.every((r) => !r.late)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: college.id, kind: 'REMINDER' } })).toBe(4);
    expect(await prisma.alertLog.count({ where: { itemId: item.id, kind: 'OVERDUE' } })).toBe(1);
  });

  it('sends missed offsets once each, marked late, after the scheduler was down for 10 days [18]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const id = await toDecision(app, college);
    await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 16 }]);
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'UNDERTAKING' } });
    await day(1); // due in 15: offset 15 fires on time
    await day(10); // scheduler down; due in 5: offset 7 was missed
    await runEngineCycle();
    const rows = await prisma.alertLog.findMany({ where: { itemId: item.id, kind: 'REMINDER' }, orderBy: { offsetOrLevel: 'desc' } });
    expect(rows.map((r) => [r.offsetOrLevel, r.late])).toEqual([
      [30, true],
      [15, false],
      [7, true],
    ]);
  });

  it('escalates an overdue EVC schedule through levels 1, 2, 3 by the reportsTo chain [4]', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const kumar = await userByEmail('kumar@demo.in');
    const lakshmi = await userByEmail('lakshmi@demo.in');
    const hod = await userByEmail('hod.south@demo.in');
    const authority = await userByEmail('authority.south@demo.in');
    const ravi = await userByEmail('ravi@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'EVC_SCHEDULE' } });
    expect(item.responsibleUserId).toBe(ravi.id);
    const levelsAt: Record<number, number> = {};
    for (let i = 0; i < 40; i++) {
      await day(1);
      const cur = await prisma.deadlineItem.findUniqueOrThrow({ where: { id: item.id } });
      const over = -workingDaysBetween(clock.today(), cur.dueDate);
      if (cur.escalationLevel && !levelsAt[cur.escalationLevel]) levelsAt[cur.escalationLevel] = over;
      if (cur.escalationLevel === 3) break;
    }
    expect(levelsAt).toEqual({ 1: 3, 2: 7, 3: 14 });
    const esc = await prisma.notification.findMany({ where: { kind: 'ESCALATION', applicationId: id } });
    const to = (uid: string) => esc.filter((n) => n.userId === uid).map((n) => n.message.match(/level (\d)/)![1]);
    expect(to(kumar.id)).toEqual(['1']);
    expect(to(lakshmi.id)).toEqual(['2']);
    expect(to(hod.id)).toEqual(['3']);
    expect(to(authority.id)).toEqual(['3']);
    expect(await prisma.notification.count({ where: { kind: 'OVERDUE', userId: ravi.id, applicationId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { applicationId: id, action: 'ESCALATED' } })).toBe(3);
    // Repeated cycles: no duplicates.
    await runEngineCycle();
    await runEngineCycle();
    expect(await prisma.notification.count({ where: { kind: 'ESCALATION', applicationId: id } })).toBe(4);
  });

  it('falls back to the region HoD when the reportsTo chain ends', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const ravi = await userByEmail('ravi@demo.in');
    const hod = await userByEmail('hod.south@demo.in');
    const head = await userByEmail('bureau.head@demo.in');
    await prisma.officerAvailability.create({ data: { userId: ravi.id, kind: 'LEAVE', startsOn: clock.today(), endsOn: addDays(clock.today(), 60), reason: 'Long leave', createdById: ravi.id } });
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    const a = (await openAssignment(id))!;
    expect(a.officer.role).toBe('BUREAU');
    for (let i = 0; i < 45; i++) {
      await day(1);
      if ((await prisma.deadlineItem.findFirstOrThrow({ where: { applicationId: id, type: 'EVC_SCHEDULE' } })).escalationLevel === 3) break;
    }
    const esc = await prisma.notification.findMany({ where: { kind: 'ESCALATION', applicationId: id } });
    const level = (uid: string) => esc.filter((n) => n.userId === uid).map((n) => Number(n.message.match(/level (\d)/)![1]));
    if (a.officerId !== head.id) {
      expect(level(head.id)).toEqual([1]);
      expect(level(hod.id).sort()).toEqual([2, 3]);
    } else {
      expect(level(hod.id).sort()).toEqual([1, 2, 3]);
    }
  });

  it('sends a daily digest once per day to managers', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const kumar = await userByEmail('kumar@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await act(app, priya, id, 'COMPLETE_STAGE');
    for (let i = 0; i < 18; i++) await day(1);
    await runEngineCycle();
    const digests = await prisma.notification.findMany({ where: { userId: kumar.id, kind: 'DIGEST' } });
    expect(digests.length).toBeGreaterThan(0);
    const days = digests.map((d) => isoDate(d.createdAt));
    expect(new Set(days).size).toBe(days.length);
    expect(digests.some((d) => /escalated to you/.test(d.message))).toBe(true);
  });

  it('releases tasks when availability begins and the officer is away beyond tomorrow', async () => {
    const college = await userByEmail('college.abc@demo.in');
    const priya = await userByEmail('priya@demo.in');
    const id = (await submitApp(app, college)).body.application.id;
    await prisma.officerAvailability.create({
      data: { userId: priya.id, kind: 'TRAINING', startsOn: addDays(clock.today(), 1), endsOn: addDays(clock.today(), 8), reason: 'Training', createdById: priya.id },
    });
    await runEngineCycle();
    expect((await openAssignment(id))!.officerId).toBe(priya.id);
    await day(1);
    expect((await openAssignment(id))!.officerId).not.toBe(priya.id);
  });

  it('advances time as admin and runs one cycle synchronously', async () => {
    clock.setOverride(null);
    const admin = await userByEmail('admin@demo.in');
    const r = await request(app).post('/api/demo/advance-time').set(...bearer(admin)).send({ days: 3 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.offsetDays).toBe(3);
    expect(r.body.cycle).toHaveProperty('itemsChecked');
    expect(await prisma.auditLog.count({ where: { action: 'TIME_ADVANCED' } })).toBe(1);
    const officer = await userByEmail('priya@demo.in');
    expect((await request(app).post('/api/demo/advance-time').set(...bearer(officer)).send({ days: 1 })).status).toBe(403);
  });
});
