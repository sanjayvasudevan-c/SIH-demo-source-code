import request from 'supertest';
import type { Express } from 'express';
import type { AppType } from '@prisma/client';
import { prisma } from '../src/lib/db.js';
import { placeholderPdf } from '../src/lib/storage.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import * as clock from '../src/lib/clock.js';
import { newestRules } from '../src/rules/service.js';
import { bearer } from './helpers.js';

export const PDF = placeholderPdf(['Test document']);

export function defaultForm(type: AppType, overrides: Record<string, unknown> = {}) {
  return {
    landAreaSqm: 20000,
    builtupAreaSqm: 9000,
    courses: [
      { name: 'B.Tech Computer Science', intake: 120, years: 4 },
      { name: 'B.Tech Electronics', intake: 60, years: 4 },
    ],
    facultyCount: 60,
    labCount: 12,
    leaseExpiry: isoDate(addDays(clock.today(), 365 * 3)),
    fillSeconds: 900,
    ...(type === 'INTAKE_INCREASE' ? { intakeIncreasePct: 20 } : {}),
    ...(type === 'NAME_CHANGE' ? { proposedName: 'New Name College of Engineering' } : {}),
    ...overrides,
  };
}

/** Critical documents under the rules a filing today falls under (the newest cycle in tests). */
export async function criticalKinds(type: AppType): Promise<string[]> {
  return (await newestRules()).criticalKinds(type);
}

let draftNo = 0;

export async function submitApp(
  app: Express,
  user: { id: string; role: string },
  opts: { type?: AppType; form?: Record<string, unknown>; docs?: string[]; justification?: string; draftId?: string } = {},
) {
  const type = opts.type ?? 'NEW_INSTITUTION';
  const docs = opts.docs ?? (await criticalKinds(type));
  const expiry = isoDate(addDays(clock.today(), 365 * 2));
  const docRules = (await newestRules()).documents(type);
  const meta = docs.map((kind) => ({ kind, expiryDate: docRules.find((d) => d.kind === kind)?.hasExpiry ? expiry : null }));
  let req = request(app)
    .post('/api/applications')
    .set(...bearer(user))
    .field('type', type)
    .field('formData', JSON.stringify(opts.form ?? defaultForm(type)))
    .field('draftId', opts.draftId ?? `draft-${Date.now()}-${draftNo++}`)
    .field('fileMeta', JSON.stringify(meta));
  if (opts.justification) req = req.field('justification', opts.justification);
  for (const k of docs) req = req.attach('files', PDF, { filename: `${k.toLowerCase()}.pdf`, contentType: 'application/pdf' });
  return req;
}

export async function act(app: Express, user: { id: string; role: string }, id: string, action: string, body: { reason?: string; payload?: unknown } = {}) {
  return request(app)
    .post(`/api/applications/${id}/actions`)
    .set(...bearer(user))
    .send({ action, ...body });
}

/** Test fixture only: mark an institution as previously approved so EXTENSION-type applications are eligible. */
/** Test fixture: the newest cycle's published version, for rows created directly. */
export async function currentPin(): Promise<{ cycleId: string; rulePackVersionId: string }> {
  const v = await prisma.rulePackVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' }, orderBy: { cycle: { code: 'desc' } } });
  return { cycleId: v.cycleId, rulePackVersionId: v.id };
}

export async function grantPriorApproval(institutionId: string) {
  const inst = await prisma.institution.findUniqueOrThrow({ where: { id: institutionId } });
  const at = addDays(clock.today(), -400);
  await prisma.application.create({
    data: {
      applicationNo: `FIXTURE-${institutionId.slice(0, 8)}`,
      institutionId,
      regionId: inst.regionId,
      type: 'NEW_INSTITUTION',
      ...(await currentPin()),
      category: 'NEW',
      categoryRank: 0,
      route: ['SCRUTINY', 'EVC', 'DECISION'],
      stage: 'DECISION',
      status: 'APPROVED',
      holderType: 'NONE',
      submittedAt: at,
      stageEnteredAt: at,
      lastActionAt: at,
      formData: {},
    },
  });
}

export async function collegeOf(institutionName: string) {
  return prisma.user.findFirstOrThrow({
    where: { role: 'COLLEGE', institution: { name: institutionName } },
    select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true, reportsToId: true, title: true },
  });
}

export async function openAssignment(applicationId: string) {
  return prisma.assignment.findFirst({ where: { applicationId, releasedAt: null }, include: { officer: true } });
}

export async function userById(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true, reportsToId: true, title: true },
  });
}

/** Drive an application through the EVC to DECISION using the real actions (VERIFICATION_VISIT route). */
export async function toDecision(app: Express, college: { id: string; role: string }, type: AppType = 'VERIFICATION_VISIT') {
  const { addDays: add } = await import('../src/lib/dates.js');
  const { nextWorkingDayFrom } = await import('../src/lib/workdays.js');
  const s = await submitApp(app, college, { type });
  if (s.status !== 201) throw new Error(JSON.stringify(s.body));
  const id: string = s.body.application.id;
  let a = await openAssignment(id);
  if (a?.taskType === 'SCRUTINY') {
    await act(app, await userById(a.officerId), id, 'COMPLETE_STAGE');
    a = await openAssignment(id);
  }
  const members = await prisma.user.findMany({ where: { role: 'COMMITTEE' }, orderBy: { email: 'asc' } });
  const back = clock.now();
  const visit = nextWorkingDayFrom(add(clock.today(), 0));
  const r = await act(app, await userById(a!.officerId), id, 'SCHEDULE_EVC', { payload: { memberIds: members.slice(0, 3).map((m) => m.id), visitDate: isoDate(visit), mode: 'ONLINE' } });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  clock.setOverride(new Date(Math.max(back.getTime(), visit.getTime() + 10 * 3_600_000)));
  const rep = await act(app, await userById(members[0]!.id), id, 'SUBMIT_EVC_REPORT', {
    payload: { checklist: { a: true, b: true, c: true, d: true, e: true }, recommendation: 'RECOMMEND_CONDITIONS', reportText: 'ok' },
  });
  if (rep.status !== 200) throw new Error(JSON.stringify(rep.body));
  return id;
}

export async function decideWithConditions(app: Express, id: string, conditions: { condition: string; dueInDays: number }[]) {
  const authority = await prisma.user.findFirstOrThrow({ where: { role: 'AUTHORITY', region: { applications: { some: { id } } } } });
  const r = await act(app, authority, id, 'DECIDE', {
    reason: 'Approved subject to conditions.',
    payload: { outcome: 'APPROVED_WITH_CONDITIONS', conditions: conditions.map((c) => ({ condition: c.condition, dueDate: isoDate(addDays(clock.today(), c.dueInDays)) })) },
  });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r;
}
