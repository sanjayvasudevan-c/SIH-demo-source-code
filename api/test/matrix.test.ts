import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import { nextWorkingDayFrom } from '../src/lib/workdays.js';
import { can } from '../src/policy/can.js';
import { CASE_ACTIONS } from '../src/workflow/transitions.js';
import type { AuthUser } from '../src/auth/middleware.js';
import { resetDb, userByEmail } from './helpers.js';
import { act, collegeOf, openAssignment, submitApp, userById } from './fixtures.js';

let app: Express;
let users: Record<string, AuthUser>;

async function allowed(appId: string): Promise<Set<string>> {
  const a = await prisma.application.findUniqueOrThrow({ where: { id: appId } });
  const out = new Set<string>();
  for (const [key, u] of Object.entries(users)) {
    for (const action of CASE_ACTIONS) if ((await can(u, action, a)).ok) out.add(`${key}:${action}`);
  }
  return out;
}

describe('role × action matrix [8]', () => {
  beforeAll(async () => {
    await resetDb();
    app = createApp();
    const emails: Record<string, string> = {
      college: 'college.abc@demo.in',
      priya: 'priya@demo.in',
      arjun: 'arjun@demo.in',
      ravi: 'ravi@demo.in',
      kumar: 'kumar@demo.in',
      lakshmi: 'lakshmi@demo.in',
      hod: 'hod.south@demo.in',
      bureauHead: 'bureau.head@demo.in',
      bureau1: 'bureau1@demo.in',
      bureau2: 'bureau2@demo.in',
      authority: 'authority.south@demo.in',
      authorityWest: 'authority.west@demo.in',
      west: 'officer.west@demo.in',
      admin: 'admin@demo.in',
    };
    for (let i = 1; i <= 6; i++) emails[`c${i}`] = `committee${i}@demo.in`;
    users = {};
    for (const [k, e] of Object.entries(emails)) users[k] = await userByEmail(e);
    const other = await prisma.institution.findFirstOrThrow({ where: { region: { code: 'SOUTH' }, name: { not: 'ABC Engineering College' } } });
    users.otherCollege = await collegeOf(other.name);
  });

  it('allows only the transition table cells', async () => {
    const id = (await submitApp(app, users.college!)).body.application.id;
    expect([...(await allowed(id))].sort()).toEqual(['priya:COMPLETE_STAGE', 'priya:RETURN']);

    await act(app, users.priya!, id, 'RETURN', { reason: 'Missing lease pages', payload: { items: ['LAND_LEASE'] } });
    expect([...(await allowed(id))].sort()).toEqual(['college:REPLY']);

    await act(app, users.college!, id, 'REPLY', { payload: { note: 'Attached' } });
    await act(app, users.priya!, id, 'COMPLETE_STAGE');
    expect([...(await allowed(id))].sort()).toEqual(['kumar:REVERT', 'priya:REVERT', 'ravi:SCHEDULE_EVC']);

    const members = await prisma.user.findMany({ where: { role: 'COMMITTEE' }, orderBy: { email: 'asc' } });
    const visit = nextWorkingDayFrom(addDays(clock.today(), 1));
    const r = await act(app, users.ravi!, id, 'SCHEDULE_EVC', { payload: { memberIds: members.slice(0, 3).map((m) => m.id), visitDate: isoDate(visit), mode: 'PHYSICAL' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([...(await allowed(id))].sort()).toEqual(['c1:SUBMIT_EVC_REPORT', 'c2:SUBMIT_EVC_REPORT', 'c3:SUBMIT_EVC_REPORT', 'kumar:REVERT', 'priya:REVERT']);

    clock.setOverride(new Date(visit.getTime() + 10 * 3_600_000));
    await act(app, users.c2!, id, 'SUBMIT_EVC_REPORT', {
      payload: { checklist: { a: true, b: true, c: true, d: true, e: false }, recommendation: 'RECOMMEND_CONDITIONS', reportText: 'Fire NOC pending.' },
    });
    expect([...(await allowed(id))].sort()).toEqual(['authority:DECIDE']);
  });

  it('covers the SAC/SHC cells and refuses with 403 plus ACCESS_DENIED', async () => {
    const id = (await submitApp(app, users.otherCollege!, { type: 'RESTORATION' })).body.application.id;
    const desk = await userById((await openAssignment(id))!.officerId);
    const members = await prisma.user.findMany({ where: { role: 'COMMITTEE' }, orderBy: { email: 'asc' } });
    const visit = nextWorkingDayFrom(addDays(clock.today(), 1));
    await act(app, desk, id, 'SCHEDULE_EVC', { payload: { memberIds: members.slice(3, 6).map((m) => m.id), visitDate: isoDate(visit), mode: 'ONLINE' } });
    clock.setOverride(new Date(visit.getTime() + 10 * 3_600_000));
    await act(app, await userById(members[3]!.id), id, 'SUBMIT_EVC_REPORT', {
      payload: { checklist: { a: true, b: true, c: true, d: true, e: true }, recommendation: 'RECOMMEND_APPROVAL', reportText: 'ok' },
    });
    const forwarder = (await openAssignment(id))!.officerId;
    const key = Object.entries(users).find(([, u]) => u.id === forwarder)![0];
    const portfolio = (await prisma.institution.findFirstOrThrow({ where: { id: users.otherCollege!.institutionId! } })).portfolioOfficerId!;
    const pKey = Object.entries(users).find(([, u]) => u.id === portfolio)?.[0];
    const got = [...(await allowed(id))].sort();
    expect(got).toContain(`${key}:FORWARD_SAC_SHC`);
    expect(got.filter((g) => !g.endsWith(':REVERT'))).toEqual([`${key}:FORWARD_SAC_SHC`]);
    if (pKey) expect(got).toContain(`${pKey}:REVERT`);

    const denied = await act(app, users.arjun!, id, 'FORWARD_SAC_SHC', { payload: { note: 'x' } });
    expect(denied.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_DENIED', actorId: users.arjun!.id } })).toBeGreaterThan(0);

    await act(app, await userById(forwarder), id, 'FORWARD_SAC_SHC', { payload: { note: 'Forwarded' } });
    const after = [...(await allowed(id))].filter((g) => !g.endsWith(':REVERT')).sort();
    expect(after).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((c) => `${c}:SUBMIT_RECOMMENDATION`));
  });
});
