import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { bearer, resetDb, setToday } from './helpers.js';
import { defaultForm, grantPriorApproval, submitApp } from './fixtures.js';

let app: Express;

async function college(where: Record<string, unknown>) {
  const inst = await prisma.institution.findFirstOrThrow({ where, orderBy: { permanentId: 'asc' } });
  const user = await prisma.user.findFirstOrThrow({ where: { institutionId: inst.id, role: 'COLLEGE' } });
  return { inst, user };
}

describe('consumers read the pinned rules', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('pins a filing to the cycle whose window is open and shows it on the case', async () => {
    const { user } = await college({ name: 'ABC Engineering College' });
    const res = await submitApp(app, user);
    expect(res.status).toBe(201);
    const a = await prisma.application.findUniqueOrThrow({ where: { id: res.body.application.id }, include: { cycle: true, rulePackVersion: true } });
    expect(`${a.cycle.code} v${a.rulePackVersion.version}`).toBe('2027-28 v1');
    expect(res.body.rules.label).toBe('2027-28 v1');
    const asg = await prisma.assignment.findFirstOrThrow({ where: { applicationId: a.id } });
    expect(asg.rulePackVersionId).toBe(a.rulePackVersionId);
  });

  it('requires the nil-deficiency disclosure for an extension (modelled addendum, carried into 2027-28)', async () => {
    const { inst, user } = await college({ name: 'ABC Engineering College' });
    await grantPriorApproval(inst.id);
    const res = await submitApp(app, user, { type: 'EXTENSION', docs: ['AFFIDAVIT', 'FACULTY_LIST'] });
    expect(res.status).toBe(400);
    expect(res.body.details.missingDocuments).toEqual(['NIL_DEFICIENCY_DISCLOSURE']);
  });

  it('refuses BBA at a non-technical institution (outside purview) and allows it at a technical one', async () => {
    const nonTech = await college({ isTechnical: false });
    const refused = await submitApp(app, nonTech.user, { form: { ...defaultForm('NEW_INSTITUTION'), programme: 'BBA' } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/BBA at your institution is outside the purview of rules 2027-28 v1/);
    const tech = await college({ name: 'ABC Engineering College' });
    expect((await submitApp(app, tech.user, { form: { ...defaultForm('NEW_INSTITUTION'), programme: 'BBA' } })).status).toBe(201);
  });

  it('refuses filing when no window is open and names the next one', async () => {
    setToday('2026-08-03');
    const { user } = await college({ name: 'ABC Engineering College' });
    const res = await submitApp(app, user);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Applications for 2027–28 open on /);
    const ctx = await request(app).get('/api/rules/filing').set(...bearer(user));
    expect(ctx.body.open).toBe(false);
    expect(ctx.body.types.find((t: { type: string }) => t.type === 'NEW_INSTITUTION').documents.length).toBeGreaterThan(0);
  });

  it('gives the apply form its rules: header facts, purview per programme, route words from norms', async () => {
    const nonTech = await college({ isTechnical: false });
    const res = await request(app).get('/api/rules/filing').set(...bearer(nonTech.user));
    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.rules.label).toBe('2027-28 v1');
    expect(res.body.window.label).toBe('Placeholder window for the demo');
    expect(res.body.programmes.find((p: { code: string }) => p.code === 'BCA').inPurview).toBe(false);
    expect(res.body.types.find((t: { type: string }) => t.type === 'INTAKE_INCREASE').route).toContain('EVC if intake rises over 50%');
  });
});
