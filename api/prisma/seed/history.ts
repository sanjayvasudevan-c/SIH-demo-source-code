// Case history for the demo (section 12). Every application, assignment, deadline item and audit row is created
// by running the real action and assignment functions with a backdated clock (clock.setOverride).
import type { AppType } from '@prisma/client';
import type { Directory } from './directory.js';
import { prisma } from '../../src/lib/db.js';
import * as clock from '../../src/lib/clock.js';
import { addDays, isoDate, toDateOnly } from '../../src/lib/dates.js';
import { addWorkingDays, isWorkingDay, loadHolidays } from '../../src/lib/workdays.js';
import { placeholderPdf } from '../../src/lib/storage.js';
import { forApplication, newestRules } from '../../src/rules/service.js';
import type { ResolvedRules } from '../../src/rules/resolved.js';
import { performAction, submitApplication, type UploadInput } from '../../src/workflow/actions.js';
import { validateForm } from '../../src/formcheck/service.js';
import { runEngineCycle } from '../../src/engine/cycle.js';
import type { AuthUser } from '../../src/auth/middleware.js';

type Inst = Directory['institutions'][number];

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COURSES = ['B.Tech Computer Science', 'B.Tech Electronics and Communication', 'B.Tech Mechanical', 'B.Tech Civil', 'B.Tech Electrical', 'MBA', 'MCA', 'B.Pharm', 'B.Arch', 'Diploma in Mechanical'];
const COMMITTEE_EMAILS = ['committee1@demo.in', 'committee2@demo.in', 'committee3@demo.in', 'committee4@demo.in', 'committee5@demo.in', 'committee6@demo.in'];

/** Programme code for the first course (no code for courses outside the prototype's programmes). */
function programmeOf(course: string): string | undefined {
  if (course.startsWith('B.Tech')) return 'BTECH';
  if (course.startsWith('Diploma')) return 'DIPLOMA_ENGG';
  if (course === 'MBA') return 'MBA';
  if (course === 'MCA') return 'MCA';
  return undefined;
}

interface Fault {
  builtupOverLand?: boolean;
  facultyShortage?: boolean;
  expiredLeaseDays?: number;
}

export async function seedHistory(dir: Directory): Promise<void> {
  const T0 = clock.today();
  const rand = rng(20261024);
  const wd = (n: number) => addWorkingDays(T0, -n);
  /** Filing date that leaves exactly `left` working days on a 15-day scrutiny clock today. */
  const sla = (await newestRules()).timelines;
  const filedWithLeft = (left: number) => addWorkingDays(addWorkingDays(T0, left), -sla.SCRUTINY);
  const users = new Map<string, AuthUser>();
  async function user(id: string): Promise<AuthUser> {
    if (!users.has(id)) {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true, reportsToId: true, title: true },
      });
      users.set(id, u);
    }
    return users.get(id)!;
  }
  const byEmail = (e: string) => user(dir.byEmail.get(e)!);
  let minute = 0;
  let currentDay = T0;
  function setDay(d: Date) {
    currentDay = toDateOnly(d);
    minute = 0;
    clock.setOverride(new Date(currentDay.getTime() + 9 * 3_600_000));
  }
  function tick() {
    minute += 3;
    clock.setOverride(new Date(currentDay.getTime() + 9 * 3_600_000 + minute * 60_000));
  }

  const south = dir.institutions.filter((i) => i.regionId === dir.regions.SOUTH && i.name !== 'ABC Engineering College');
  const west = dir.institutions.filter((i) => i.regionId === dir.regions.WEST);
  const [priya, arjun, meena, ravi, sneha] = dir.kumarTeam;
  const portfolioOf = (officerId: string) => south.filter((i) => i.portfolioOfficerId === officerId);
  const used = new Set<string>();
  const take = (list: Inst[], n: number) => {
    const out = list.filter((i) => !used.has(i.id)).slice(0, n);
    out.forEach((i) => used.add(i.id));
    return out;
  };
  /** Like take(), but at most one institution per portfolio officer, so every officer keeps a fresh case. */
  const takeSpread = (list: Inst[], n: number) => {
    const seen = new Set<string>();
    const out: Inst[] = [];
    for (const i of list) {
      if (out.length >= n) break;
      if (used.has(i.id) || seen.has(i.portfolioOfficerId)) continue;
      seen.add(i.portfolioOfficerId);
      out.push(i);
    }
    out.forEach((i) => used.add(i.id));
    return out;
  };
  const otherSouth = () => south.filter((i) => ![priya, arjun, meena, ravi, sneha].includes(i.portfolioOfficerId));

  // ---------------------------------------------------------------- helpers over the real actions
  function formValues(type: AppType, f: Fault = {}, leaseExpiry?: string) {
    const nCourses = 1 + Math.floor(rand() * 3);
    const courses = Array.from({ length: nCourses }, (_, i) => ({ name: COURSES[(Math.floor(rand() * COURSES.length) + i) % COURSES.length]!, intake: [60, 60, 120, 180][Math.floor(rand() * 4)]!, years: 4 }));
    const total = courses.reduce((s, c) => s + c.intake * c.years, 0);
    const land = Math.round(15000 + rand() * 25000);
    const built = f.builtupOverLand ? Math.round(land * 1.6) : Math.round(land * (0.35 + rand() * 0.25));
    return {
      landAreaSqm: land,
      builtupAreaSqm: built,
      courses,
      facultyCount: f.facultyShortage ? Math.max(4, Math.round(total / 55)) : Math.round(total / (12 + rand() * 6)),
      labCount: Math.round(nCourses * (4 + rand() * 4)),
      leaseExpiry: leaseExpiry ?? isoDate(addDays(T0, 900 + Math.floor(rand() * 2000))),
      fillSeconds: Math.round(900 + rand() * 2400),
      ...(type === 'INTAKE_INCREASE' ? { intakeIncreasePct: Math.round(10 + rand() * 30) } : {}),
      ...(type === 'NAME_CHANGE' ? { proposedName: 'Sri Venkateswara Institute of Technology' } : {}),
      ...(programmeOf(courses[0]!.name) ? { programme: programmeOf(courses[0]!.name) } : {}),
    };
  }

  function docsFor(r: ResolvedRules, type: AppType, inst: Inst, leaseExpiry: string, withOptional: boolean): UploadInput[] {
    return r
      .documents(type)
      .filter((d) => d.critical || withOptional)
      .map((d) => ({
        buffer: placeholderPdf([d.label, inst.name, `Placeholder document generated for the demo seed`]),
        originalname: `${d.kind.toLowerCase()}.pdf`,
        mimetype: 'application/pdf',
        kind: d.kind,
        expiryDate: d.hasExpiry ? (d.kind === 'LAND_LEASE' ? leaseExpiry : isoDate(addDays(T0, 400 + Math.floor(rand() * 300)))) : null,
      }));
  }

  // Back-dated filings are pinned to the version published on their filing date: the 2027-28 version once its
  // window has opened, otherwise the 2026-27 version in force on that date.
  async function pinFor(at: Date): Promise<{ cycleId: string; rulePackVersionId: string }> {
    const v = await prisma.rulePackVersion.findFirst({
      where: { publishedAt: { lte: at }, status: { in: ['PUBLISHED', 'SUPERSEDED'] } },
      orderBy: [{ cycle: { code: 'desc' } }, { publishedAt: 'desc' }],
    });
    if (!v) throw new Error(`No rules were published by ${at.toISOString()}`);
    return { cycleId: v.cycleId, rulePackVersionId: v.id };
  }

  const appIds = new Map<string, string>();
  async function file(key: string, inst: Inst, type: AppType, opts: { fault?: Fault; lease?: number; optional?: boolean; justification?: string } = {}) {
    tick();
    const leaseExpiry = opts.fault?.expiredLeaseDays !== undefined ? isoDate(addDays(T0, -opts.fault.expiredLeaseDays)) : opts.lease !== undefined ? isoDate(addDays(T0, opts.lease)) : isoDate(addDays(T0, 900 + Math.floor(rand() * 2000)));
    const values = formValues(type, opts.fault, leaseExpiry);
    const pin = await pinFor(clock.now());
    const pinned = await forApplication(pin);
    const files = docsFor(pinned, type, inst, leaseExpiry, opts.optional ?? rand() < 0.5);
    const college = await user(inst.collegeUserId);
    const draftId = `seed-${key}`;
    const check = await validateForm(college, { draftId, type, values: { ...values, documents: files.map((f) => f.kind) } }, prisma, pinned);
    const justification = check.severity !== 'NONE' ? opts.justification ?? 'The figures are correct; the plan approval letter is attached for reference.' : undefined;
    const id = await submitApplication(college, { type, formData: values, draftId, justification }, files, { pin });
    appIds.set(key, id);
    return id;
  }

  async function holderOf(id: string, types: string[]): Promise<AuthUser | null> {
    const a = await prisma.assignment.findFirst({ where: { applicationId: id, releasedAt: null, taskType: { in: types as never[] } } });
    return a ? user(a.officerId) : null;
  }
  const A = (key: string) => appIds.get(key)!;
  async function complete(key: string) {
    tick();
    const u = await holderOf(A(key), ['SCRUTINY', 'RE_SCRUTINY']);
    if (u) await performAction(u, A(key), 'COMPLETE_STAGE', {});
  }
  async function ret(key: string, reason: string, items: string[]) {
    tick();
    const u = await holderOf(A(key), ['SCRUTINY', 'RE_SCRUTINY']);
    if (u) await performAction(u, A(key), 'RETURN', { reason, payload: { items } });
  }
  async function reply(key: string, note: string) {
    tick();
    const app = await prisma.application.findUniqueOrThrow({ where: { id: A(key) }, include: { institution: true } });
    const college = (await prisma.user.findFirstOrThrow({ where: { institutionId: app.institutionId, role: 'COLLEGE' } })).id;
    await performAction(await user(college), A(key), 'REPLY', { payload: { note } });
  }
  let memberRot = 0;
  async function schedule(key: string, visit: Date, mode: 'ONLINE' | 'PHYSICAL' = 'ONLINE') {
    tick();
    const u = await holderOf(A(key), ['EVC_DESK']);
    if (!u) return;
    const members = [0, 1, 2].map((i) => dir.byEmail.get(COMMITTEE_EMAILS[(memberRot + i) % 6]!)!);
    memberRot = (memberRot + 1) % 6;
    await performAction(u, A(key), 'SCHEDULE_EVC', { payload: { memberIds: members, visitDate: isoDate(visit), mode } });
  }
  async function report(key: string, rec: 'RECOMMEND_APPROVAL' | 'RECOMMEND_CONDITIONS' | 'RECOMMEND_REJECTION' = 'RECOMMEND_APPROVAL') {
    tick();
    const v = await prisma.evcVisit.findUniqueOrThrow({ where: { applicationId: A(key) } });
    const member = await user((v.memberIds as string[])[0]!);
    await performAction(member, A(key), 'SUBMIT_EVC_REPORT', {
      payload: {
        checklist: { landBuilding: true, labs: true, faculty: rec !== 'RECOMMEND_REJECTION', library: true, safety: rec === 'RECOMMEND_APPROVAL' },
        recommendation: rec,
        reportText: rec === 'RECOMMEND_APPROVAL' ? 'Land, buildings, laboratories and faculty match the application.' : rec === 'RECOMMEND_CONDITIONS' ? 'Facilities broadly match; some compliance items are pending.' : 'Built-up area and faculty fall well short of the application.',
      },
    });
  }
  async function forward(key: string) {
    tick();
    const u = await holderOf(A(key), ['SAC_SHC_FORWARD']);
    if (u) await performAction(u, A(key), 'FORWARD_SAC_SHC', { payload: { note: 'Forwarded with the EVC report for a recommendation on restoration.' } });
  }
  async function decide(key: string, outcome: 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED', conditions: { condition: string; due: number }[] = []) {
    tick();
    const app = await prisma.application.findUniqueOrThrow({ where: { id: A(key) } });
    const authority = await prisma.user.findFirstOrThrow({ where: { role: 'AUTHORITY', regionId: app.regionId } });
    const reason =
      outcome === 'REJECTED' ? 'The institution does not meet the norms for land and faculty.' : outcome === 'APPROVED' ? 'Meets the norms on scrutiny and the expert visit.' : 'Meets the norms subject to the conditions listed.';
    await performAction(await user(authority.id), A(key), 'DECIDE', {
      reason,
      payload: { outcome, ...(conditions.length ? { conditions: conditions.map((c) => ({ condition: c.condition, dueDate: isoDate(addDays(T0, c.due)) })) } : {}) },
    });
  }
  async function evidence(key: string) {
    tick();
    const u = await prisma.undertaking.findFirstOrThrow({ where: { applicationId: A(key), status: 'OPEN' } });
    const app = await prisma.application.findUniqueOrThrow({ where: { id: A(key) }, include: { institution: true } });
    const college = await prisma.user.findFirstOrThrow({ where: { institutionId: app.institutionId, role: 'COLLEGE' } });
    const { uploadEvidence } = await import('../../src/workflow/actions.js');
    await uploadEvidence(await user(college.id), u.id, { buffer: placeholderPdf(['Evidence', u.condition, app.institution.name]), originalname: 'evidence.pdf', mimetype: 'application/pdf', kind: 'EVIDENCE' });
  }
  async function verify(key: string) {
    tick();
    const u = await prisma.undertaking.findFirstOrThrow({ where: { applicationId: A(key), status: 'SUBMITTED' } });
    const officer = await holderOf(A(key), ['VERIFY']);
    if (!officer) return;
    const { verifyEvidence } = await import('../../src/workflow/actions.js');
    await verifyEvidence(officer, u.id, { accept: true, remarks: 'Document checked against the original.' });
  }
  async function label(key: string, useful: boolean) {
    tick();
    const fc = await prisma.formCheckResult.findFirst({ where: { applicationId: A(key) }, orderBy: { createdAt: 'desc' } });
    const officer = await holderOf(A(key), ['SCRUTINY', 'RE_SCRUTINY']);
    if (!fc || !officer || ((fc.warnings as unknown[]) ?? []).length === 0) return;
    const labels = { '0': { useful, by: officer.id, byName: officer.name, at: clock.now().toISOString(), modelVersion: fc.modelVersion } };
    await prisma.formCheckResult.update({ where: { id: fc.id }, data: { officerLabels: labels } });
    const { appendAuditStandalone } = await import('../../src/lib/audit.js');
    await appendAuditStandalone({ actorId: officer.id, actorRole: officer.role, action: 'FORM_CHECK_LABEL', applicationId: A(key), meta: { formCheckId: fc.id, warningIndex: 0, useful, modelVersion: fc.modelVersion } });
  }
  async function away(userIds: string[], from: Date, to: Date, kind: 'LEAVE' | 'TRAINING' | 'FIELD_VISIT', reason: string, by: string) {
    for (const u of userIds) await prisma.officerAvailability.create({ data: { userId: u, kind, startsOn: from, endsOn: to, reason, createdById: by } });
  }

  // ---------------------------------------------------------------- the schedule
  type Ev = { date: Date; run: () => Promise<unknown> };
  const events: Ev[] = [];
  const on = (date: Date, run: () => Promise<unknown>) => events.push({ date: toDateOnly(date), run });
  const kumarId = dir.byEmail.get('kumar@demo.in')!;

  // Meena is in training for the whole backdated history, ending yesterday (so she shows as idle).
  const start = wd(125);
  await away([meena!], addDays(start, -1), addDays(T0, -1), 'TRAINING', 'Induction training at the AICTE academy', kumarId);

  // Earlier approvals for institutions that later file extension-type applications (verification visits).
  const arjunInsts = portfolioOf(arjun!);
  const snehaInsts = portfolioOf(sneha!);
  const priyaSecond = portfolioOf(priya!)[0]!;
  arjunInsts.concat(snehaInsts).forEach((i) => used.add(i.id));
  used.add(priyaSecond.id);
  for (const i of portfolioOf(meena!).concat(portfolioOf(ravi!))) used.add(i.id);
  const priorPool = [...arjunInsts, ...snehaInsts, ...take(otherSouth(), 18)];
  priorPool.forEach((inst, k) => {
    const d = wd(118 - k * 2);
    const key = `prior-${inst.id}`;
    on(d, () => file(key, inst, 'VERIFICATION_VISIT'));
    on(addWorkingDays(d, 1), () => schedule(key, addWorkingDays(d, 3), k % 3 === 0 ? 'PHYSICAL' : 'ONLINE'));
    on(addWorkingDays(d, 3), () => report(key));
    on(addWorkingDays(d, 5), () => decide(key, 'APPROVED'));
  });
  const westPrior = west.slice(0, 5);
  westPrior.forEach((inst, k) => {
    const d = wd(112 - k * 3);
    const key = `prior-${inst.id}`;
    on(d, () => file(key, inst, 'VERIFICATION_VISIT'));
    on(addWorkingDays(d, 1), () => schedule(key, addWorkingDays(d, 2)));
    on(addWorkingDays(d, 2), () => report(key));
    on(addWorkingDays(d, 4), () => decide(key, 'APPROVED'));
  });

  // Decided new institutions with land leases spread from 20 days past to 400 days ahead, and undertakings.
  const decided: { key: string; lease: number; outcome: 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED'; conditions?: { condition: string; due: number }[]; inst?: Inst }[] = [
    { key: 'd-lease-m20', lease: -20, outcome: 'APPROVED' },
    { key: 'd-lease-m5', lease: -5, outcome: 'APPROVED' },
    { key: 'd-lease-10', lease: 10, outcome: 'APPROVED' },
    { key: 'd-lease-25', lease: 25, outcome: 'APPROVED' },
    { key: 'd-lease-110', lease: 110, outcome: 'APPROVED', inst: priyaSecond },
    { key: 'd-awc-10', lease: 200, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Submit fire safety NOC from the state fire service', due: 10 }] },
    { key: 'd-awc-25', lease: 400, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Appoint a principal with AICTE-approved qualifications', due: 25 }] },
    { key: 'd-awc-60', lease: 250, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Complete library automation and upload the stock register', due: 60 }] },
    {
      key: 'd-awc-overdue',
      lease: 300,
      outcome: 'APPROVED_WITH_CONDITIONS',
      conditions: [
        { condition: 'Submit the building occupancy certificate', due: -12 },
        { condition: 'Upload faculty salary statements for the last two quarters', due: -4 },
      ],
    },
    { key: 'd-rejected', lease: 600, outcome: 'REJECTED' },
    { key: 'd-pending-1', lease: 500, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Upload the NBA accreditation application receipt', due: 45 }] },
    { key: 'd-pending-2', lease: 520, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Submit the audited accounts for 2025-26', due: 40 }] },
    { key: 'd-closed-1', lease: 700, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Submit the fire safety NOC', due: 30 }] },
    { key: 'd-closed-2', lease: 800, outcome: 'APPROVED_WITH_CONDITIONS', conditions: [{ condition: 'Appoint a librarian with the required qualifications', due: 20 }] },
  ];
  const decidedPool = take(otherSouth(), decided.length);
  // Earlier-approved institutions used for open special cases: one per portfolio officer.
  const sp = [priorPool[6]!, priorPool[8]!, priorPool[10]!, priorPool[12]!];
  decided.forEach((d, k) => {
    const inst = d.inst ?? decidedPool[k]!;
    const f = wd(80 - k * 3);
    on(f, () => file(d.key, inst, 'NEW_INSTITUTION', { lease: d.lease, optional: true }));
    on(addWorkingDays(f, 6 + (k % 4)), () => complete(d.key));
    on(addWorkingDays(f, 9 + (k % 4)), () => schedule(d.key, addWorkingDays(f, 12 + (k % 4)), k % 2 ? 'PHYSICAL' : 'ONLINE'));
    on(addWorkingDays(f, 12 + (k % 4)), () => report(d.key, d.outcome === 'REJECTED' ? 'RECOMMEND_REJECTION' : d.outcome === 'APPROVED' ? 'RECOMMEND_APPROVAL' : 'RECOMMEND_CONDITIONS'));
    on(addWorkingDays(f, 16 + (k % 4)), () => decide(d.key, d.outcome, d.conditions));
  });
  // Evidence waiting for verification beyond 5 working days, and two cases closed after verification.
  on(wd(9), () => evidence('d-pending-1'));
  on(wd(8), () => evidence('d-pending-2'));
  on(wd(22), () => evidence('d-closed-1'));
  on(wd(20), () => verify('d-closed-1'));
  on(wd(19), () => evidence('d-closed-2'));
  on(wd(18), () => verify('d-closed-2'));
  // An on-time extension decided (scrutiny then decision) and a rejected extension.
  on(wd(40), () => file('d-ext-ok', priorPool[4]!, 'EXTENSION'));
  on(wd(34), () => complete('d-ext-ok'));
  on(wd(31), () => decide('d-ext-ok', 'APPROVED'));
  on(wd(38), () => file('d-ext-rej', priorPool[5]!, 'EXTENSION', { fault: { facultyShortage: true }, justification: 'Faculty recruitment is under way; appointment letters will follow.' }));
  on(wd(30), () => complete('d-ext-rej'));
  on(wd(26), () => decide('d-ext-rej', 'REJECTED'));

  // Open South cases arranged so every Action Center reason appears.
  const pool = takeSpread(otherSouth(), 14);
  // Overdue scrutiny at escalation levels 3, 2 (Sneha, Kumar's team) and 1 (Arjun and Priya).
  on(wd(31), () => file('o-l3', pool[0]!, 'NEW_INSTITUTION'));
  on(wd(30), () => file('o-l3b', pool[1]!, 'NEW_INSTITUTION', { fault: { builtupOverLand: true }, justification: 'Built-up area includes two basement floors approved by the local authority.' }));
  on(wd(25), () => file('o-l2', snehaInsts[0]!, 'EXTENSION'));
  on(wd(19), () => file('o-l1-arjun', arjunInsts[0]!, 'NAME_CHANGE'));
  on(wd(19), () => file('o-l1-priya', priyaSecond, 'INTAKE_INCREASE'));
  // At risk and urgent (2 and 3 working days left), stalled (no action for 11 working days).
  on(filedWithLeft(2), () => file('o-risk1', pool[2]!, 'NEW_INSTITUTION'));
  on(filedWithLeft(3), () => file('o-risk2', pool[3]!, 'NEW_INSTITUTION', { fault: { facultyShortage: true }, justification: 'Additional faculty join in the next academic session.' }));
  on(filedWithLeft(4), () => file('o-stall1', pool[4]!, 'NEW_INSTITUTION'));
  on(filedWithLeft(5), () => file('o-stall2', pool[5]!, 'NEW_INSTITUTION'));
  // Returned to colleges (three in Kumar's team).
  on(wd(9), () => file('o-ret-sneha1', snehaInsts[1]!, 'EXTENSION'));
  on(wd(9), () => file('o-ret-sneha2', snehaInsts[0]!, 'NAME_CHANGE'));
  on(wd(9), () => file('o-ret-arjun', arjunInsts[1]!, 'NAME_CHANGE'));
  on(wd(9), () => file('o-ret-other', pool[6]!, 'NEW_INSTITUTION'));
  on(wd(6), () => ret('o-ret-sneha1', 'The faculty list does not show qualifications for 6 members.', ['FACULTY_LIST']));
  on(wd(6), () => ret('o-ret-sneha2', 'The society resolution is not signed by the secretary.', ['SOCIETY_RESOLUTION']));
  on(wd(5), () => ret('o-ret-arjun', 'The affidavit is not on non-judicial stamp paper.', ['AFFIDAVIT']));
  on(wd(4), () => ret('o-ret-other', 'The building plan is not approved by the local planning authority.', ['BUILDING_PLAN']));
  // A returned case that was replied to and went back to the same officer.
  on(wd(14), () => file('o-replied', pool[7]!, 'NEW_INSTITUTION'));
  on(wd(12), () => ret('o-replied', 'The lease deed pages 4 to 6 are missing.', ['LAND_LEASE']));
  on(wd(8), () => reply('o-replied', 'Attached the complete lease deed.'));
  // EVC not scheduled: Ravi (escalates to Kumar) and a Bureau overflow while Ravi was away.
  on(wd(30), () => file('o-evc-ravi', pool[8]!, 'NEW_INSTITUTION'));
  on(wd(14), () => complete('o-evc-ravi'));
  on(wd(28), () => file('o-evc-bureau', sp[0]!, 'CHANGE_OF_SITE'));
  on(wd(16), () => away([ravi!], wd(16), wd(15), 'FIELD_VISIT', 'Inspection visits in Tirunelveli district', kumarId));
  on(wd(16), () => complete('o-evc-bureau'));
  // No eligible officer: Ravi and the whole Bureau away when the case reached EVC.
  on(wd(22), () => file('o-blocked', pool[9]!, 'NEW_INSTITUTION'));
  on(wd(9), async () => {
    const bureau = (await prisma.user.findMany({ where: { role: 'BUREAU' } })).map((b) => b.id);
    await away([ravi!, ...bureau], wd(9), wd(8), 'LEAVE', 'Annual review meeting in New Delhi', dir.byEmail.get('hod.south@demo.in')!);
  });
  on(wd(9), () => complete('o-blocked'));
  // EVC reports overdue (committee owners).
  on(wd(36), () => file('o-evcrep1', pool[10]!, 'NEW_INSTITUTION'));
  on(wd(24), () => complete('o-evcrep1'));
  on(wd(21), () => schedule('o-evcrep1', wd(15), 'PHYSICAL'));
  on(wd(33), () => file('o-evcrep2', pool[11]!, 'NEW_INSTITUTION'));
  on(wd(22), () => complete('o-evcrep2'));
  on(wd(19), () => schedule('o-evcrep2', wd(12)));
  // Blocked: the land lease (a critical document) has already expired.
  on(wd(4), () => file('o-doc-blocked', pool[12]!, 'NEW_INSTITUTION', { fault: { expiredLeaseDays: 3 }, justification: 'Lease renewal is with the state revenue department; the receipt is attached.' }));
  // In decision: one due soon, one overdue.
  on(wd(14), () => file('o-dec1', sp[1]!, 'EXTENSION'));
  on(wd(4), () => complete('o-dec1'));
  on(wd(22), () => file('o-dec2', sp[2]!, 'EXTENSION'));
  on(wd(12), () => complete('o-dec2'));
  // SAC/SHC: one forwarded and overdue with the committee, one waiting for the Bureau to forward.
  on(wd(21), () => file('o-sac1', sp[3]!, 'RESTORATION'));
  on(wd(20), () => schedule('o-sac1', wd(18)));
  on(wd(18), () => report('o-sac1', 'RECOMMEND_CONDITIONS'));
  on(wd(17), () => forward('o-sac1'));
  on(wd(7), () => file('o-sac2', pool[13]!, 'RESTORATION'));
  on(wd(6), () => schedule('o-sac2', wd(5)));
  on(wd(5), () => report('o-sac2'));

  // Arjun's portfolio files several applications (continuity sends them to him); later his capacity drops.
  const arjunTypes: AppType[] = ['EXTENSION', 'INTAKE_INCREASE', 'CHANGE_OF_SITE'];
  arjunInsts.forEach((inst, i) =>
    arjunTypes.forEach((t, j) => on(wd(6 - j - i), () => file(`arjun-${i}-${t}`, inst, t))),
  );
  on(wd(1), async () => {
    await prisma.officerProfile.update({ where: { userId: arjun! }, data: { capacityPoints: 6 } });
  });

  // Every South institution without an open case files a fresh one, so officers carry real load. Institutions with
  // an earlier approval file extension-type applications; the rest file for a new institution.
  const openInst = new Set<string>([...pool.map((p) => p.id), ...arjunInsts.map((i) => i.id), ...snehaInsts.map((i) => i.id), priyaSecond.id, ...sp.map((i) => i.id)]);
  const approved = new Set<string>(priorPool.map((p) => p.id));
  decided.forEach((d, k) => {
    if (d.outcome !== 'REJECTED') approved.add((d.inst ?? decidedPool[k]!).id);
  });
  const fresh = south.filter((i) => !openInst.has(i.id));
  fresh.forEach((inst, k) => {
    const type: AppType = approved.has(inst.id) ? (k % 2 ? 'EXTENSION' : 'NAME_CHANGE') : 'NEW_INSTITUTION';
    const fault: Fault | undefined = k % 9 === 4 ? { builtupOverLand: true } : k % 11 === 7 ? { facultyShortage: true } : undefined;
    // Filed two to ten working days ago (never on Meena's last training day, when the next-day horizon would pick her).
    on(wd(2 + (k % 9)), () => file(`fresh-${k}`, inst, type, { fault }));
  });
  // Balance: officers carrying under 3 points get extension-type applications from earlier-approved institutions in
  // their portfolio, so a busy region looks busy (and an idle officer stands out).
  on(wd(2), async () => {
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER', regionId: dir.regions.SOUTH, id: { notIn: [meena!, arjun!, ravi!] } } });
    for (const o of officers) {
      const pts = Number((await prisma.assignment.aggregate({ where: { officerId: o.id, releasedAt: null }, _sum: { weight: true } }))._sum.weight ?? 0);
      let load = pts;
      for (const inst of south.filter((i) => i.portfolioOfficerId === o.id && approved.has(i.id))) {
        for (const type of ['INTAKE_INCREASE', 'EXTENSION', 'NAME_CHANGE'] as AppType[]) {
          if (load >= 3) break;
          const open = await prisma.application.count({ where: { institutionId: inst.id, type, status: { in: ['IN_STAGE', 'RETURNED'] } } });
          if (open) continue;
          await file(`balance-${inst.id}-${type}`, inst, type);
          load += type === 'INTAKE_INCREASE' ? 1.2 : 1.0;
        }
      }
    }
  });
  for (const k of [2, 5, 9, 14]) on(wd(0), () => label(`fresh-${k}`, true).catch(() => undefined));
  on(wd(0), () => label('o-l3b', true));
  on(wd(0), () => label('o-risk2', false));
  on(wd(0), () => label('o-doc-blocked', true));

  // West: a smaller region with the same kinds of cases.
  const westFresh = west.slice(5);
  westFresh.forEach((inst, k) => {
    const key = `w-${k}`;
    on(wd(2 + ((k * 3) % 20)), () => file(key, inst, 'NEW_INSTITUTION', { fault: k === 3 ? { builtupOverLand: true } : undefined }));
    if (k < 4) {
      on(wd(1 + ((k * 3) % 20)), () => complete(key));
    }
    if (k === 5) on(wd(1), () => ret(key, 'The approved building plan is missing the fire exits page.', ['BUILDING_PLAN']));
  });
  westPrior.forEach((inst, k) => {
    if (k < 2) {
      const key = `w-ext-${k}`;
      on(wd(30 - k * 6), () => file(key, inst, 'EXTENSION'));
      on(wd(24 - k * 6), () => complete(key));
      on(wd(21 - k * 6), () => decide(key, k === 0 ? 'APPROVED' : 'REJECTED'));
    } else {
      on(wd(3 + k), () => file(`w-ext-${k}`, inst, 'EXTENSION'));
    }
  });

  // ---------------------------------------------------------------- run day by day
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  const skipCycle = new Set([wd(16), wd(15), wd(9), wd(8)].map(isoDate));
  let n = 0;
  let wdCount = 0;
  for (let day = start; day < T0; day = addDays(day, 1)) {
    setDay(day);
    await loadHolidays(prisma);
    const todays = events.filter((e) => e.date.getTime() === day.getTime());
    if (isWorkingDay(day)) {
      wdCount++;
      if (wdCount % 5 === 0 && !skipCycle.has(isoDate(day))) await runEngineCycle({ source: 'seed' }, { flags: false, digests: false });
    }
    for (const e of todays) {
      await e.run();
      n++;
    }
  }
  // Events dated today (labels) run at the real date.
  setDay(T0);
  for (const e of events.filter((x) => x.date.getTime() === T0.getTime())) {
    await e.run();
    n++;
  }
  clock.setOverride(null);
  await runEngineCycle({ source: 'seed-final' });
  console.log(`[seed] ${n} events, ${appIds.size} applications`);
}
