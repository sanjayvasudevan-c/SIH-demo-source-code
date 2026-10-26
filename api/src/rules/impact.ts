// Impact preview (add-on A8): a dry run of a version against the cycle's published version. Read-only; answers in
// plain sentences with counts and lists, never a score or a traffic light.
import fs from 'node:fs';
import path from 'node:path';
import type { AppType } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { today } from '../lib/clock.js';
import { isoDate } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { ResolvedRules, type EvalContext } from './resolved.js';
import { getVersion } from './service.js';
import { checkApplyScope, rebasesLiveCases, type ApplyScope } from './diff.js';
import { diffForPublish, plannedMoves } from './rebase.js';
import type { PackContent } from './schema.js';
import { computeFeatures, formValuesSchema, type FormValues } from '../formcheck/features.js';
import { ruleHits } from '../formcheck/rules.js';

const OPEN = ['IN_STAGE', 'RETURNED'] as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ITEM_NAME: Record<string, string> = { STAGE_SLA: 'stage deadline', EVC_SCHEDULE: 'EVC scheduling', EVC_REPORT: 'EVC report', VERIFICATION: 'verification' };

function resolved(v: Awaited<ReturnType<typeof getVersion>>): ResolvedRules {
  return new ResolvedRules(v.ref, v.ref, v.content);
}

export async function impactOf(versionId: string) {
  const started = performance.now();
  const target = await prisma.rulePackVersion.findUniqueOrThrow({ where: { id: versionId }, include: { amendment: true } });
  const basis = await prisma.rulePackVersion.findFirst({ where: { cycleId: target.cycleId, status: 'PUBLISHED' } });
  if (!basis) throw badRequest('The cycle has no published version to compare with.');
  if (basis.id === target.id) throw badRequest('This version is the published one; choose a draft or a version in review.');
  const [oldV, newV] = await Promise.all([getVersion(basis.id), getVersion(target.id)]);
  const oldR = resolved(oldV);
  const newR = resolved({ ...newV, content: target.content as unknown as PackContent });
  const diff = await diffForPublish(prisma, basis, target);
  const scope = (target.amendment?.applyScope ?? {}) as ApplyScope;
  const t = today();
  const sentences: string[] = [];

  // ---- live cases
  const pinned = await prisma.application.findMany({
    where: { rulePackVersionId: basis.id, status: { in: [...OPEN] } },
    select: { id: true, applicationNo: true, deadlineItems: { where: { status: { in: ['OPEN', 'PAUSED'] } } } },
  });
  const live = rebasesLiveCases(diff, scope);
  const moves = live ? pinned.flatMap((a) => plannedMoves(diff, a.deadlineItems).map((m) => ({ applicationId: a.id, applicationNo: a.applicationNo, item: ITEM_NAME[m.type] ?? m.type, oldDue: m.oldDue, newDue: m.newDue, pausedDaysAdded: m.oldPausedRemaining !== undefined ? m.addDays : null }))) : [];
  sentences.push(
    live
      ? `${plural(pinned.length, 'open application')} would move to this version; ${plural(moves.length, 'deadline')} would move later and none earlier.`
      : `No filed case is affected: the ${plural(pinned.length, 'open application')} pinned to v${basis.version} keep their rules, and new filings use this version.`,
  );

  // ---- new filings: the last 50 submitted applications re-evaluated
  const recent = await prisma.application.findMany({
    orderBy: { submittedAt: 'desc' },
    take: 50,
    select: { id: true, applicationNo: true, type: true, formData: true, institutionId: true, documents: { select: { kind: true } }, institution: { select: { isTechnical: true, kind: true, region: { select: { code: true } } } } },
  });
  const priorApproved = new Set(
    (await prisma.application.groupBy({ by: ['institutionId'], where: { status: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'CLOSED'] } } })).map((p) => p.institutionId),
  );
  const routeChange = new Map<string, { type: string; label: string; added: Set<string>; removed: Set<string>; apps: string[] }>();
  const missing = new Map<string, { label: string; apps: string[] }>();
  const purviewFalse: { applicationNo: string; reason: string }[] = [];
  for (const a of recent) {
    const type = a.type as AppType;
    if (!newR.hasType(type) || !oldR.hasType(type)) continue;
    const fd = a.formData as Record<string, unknown>;
    const ctx = (r: ResolvedRules): EvalContext => ({
      formData: fd,
      institution: { isTechnical: a.institution.isTechnical, kind: a.institution.kind, regionCode: a.institution.region.code, hasPriorApproval: priorApproved.has(a.institutionId) },
      application: { type },
      programme: r.programme(fd.programme as string | undefined),
    });
    const before = oldR.route(type, ctx(oldR));
    const after = newR.route(type, ctx(newR));
    if (before.join() !== after.join()) {
      const k = `${type}`;
      const e = routeChange.get(k) ?? { type, label: newR.type(type).label, added: new Set<string>(), removed: new Set<string>(), apps: [] };
      after.filter((s) => !before.includes(s)).forEach((s) => e.added.add(s));
      before.filter((s) => !after.includes(s)).forEach((s) => e.removed.add(s));
      e.apps.push(a.applicationNo);
      routeChange.set(k, e);
    }
    const attached = new Set(a.documents.map((d) => d.kind));
    const oldCritical = new Set(oldR.criticalKinds(type, ctx(oldR)));
    for (const d of newR.documents(type, ctx(newR)).filter((d) => d.critical && !oldCritical.has(d.kind) && !attached.has(d.kind))) {
      const e = missing.get(d.kind) ?? { label: d.label, apps: [] };
      e.apps.push(a.applicationNo);
      missing.set(d.kind, e);
    }
    const p = newR.programme(fd.programme as string | undefined);
    if (p && oldR.programme(p.code) && oldR.test(oldR.programme(p.code)!.inPurview, ctx(oldR)) && !newR.test(p.inPurview, ctx(newR))) purviewFalse.push({ applicationNo: a.applicationNo, reason: `${p.label} would be outside purview` });
    if (oldR.test(oldR.type(type).eligibility, ctx(oldR)) && !newR.test(newR.type(type).eligibility, ctx(newR))) purviewFalse.push({ applicationNo: a.applicationNo, reason: `No longer eligible for ${newR.type(type).label.toLowerCase()}` });
  }
  const routeChanges = [...routeChange.values()].map((e) => ({
    type: e.type,
    count: e.apps.length,
    applications: e.apps,
    sentence: `${e.type}: ${e.apps.length} would now ${[...e.added].length ? `include ${[...e.added].join(', ')}` : ''}${[...e.added].length && [...e.removed].length ? ' and ' : ''}${[...e.removed].length ? `skip ${[...e.removed].join(', ')}` : ''}.`,
  }));
  const missingDocs = [...missing.entries()].map(([kind, e]) => ({ kind, label: e.label, count: e.apps.length, applications: e.apps }));
  const rerouted = routeChanges.reduce((n, r) => n + r.count, 0);
  const missingCount = new Set(missingDocs.flatMap((d) => d.applications)).size;
  sentences.push(
    `Of the last ${recent.length} filings, filed again under this version: ${rerouted} would take a different route, ${missingCount} would miss a newly critical document, and ${purviewFalse.length} would fall outside purview or eligibility.`,
  );

  // ---- form check: shared samples and the seeded results
  const sampleFile = path.join(process.env.SHARED_DIR ?? path.resolve(process.cwd(), '../shared'), 'formcheck-samples.json');
  const samples = fs.existsSync(sampleFile) ? (JSON.parse(fs.readFileSync(sampleFile, 'utf8')) as { type: AppType; values: FormValues; today: string; requiredDocs: string[] }[]) : [];
  const count = (hits: string[][]) => hits.flat().reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
  const sampleOld = count(samples.map((s) => ruleHits(computeFeatures(s.values, s.today, s.requiredDocs), oldR.formCheckRules, oldR.norms())));
  const sampleNew = count(samples.map((s) => ruleHits(computeFeatures(s.values, s.today, s.requiredDocs), newR.formCheckRules, newR.norms())));
  const seeded = await prisma.formCheckResult.findMany({ where: { applicationId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 60, select: { application: { select: { type: true, formData: true, documents: { select: { kind: true } } } } } });
  const seededHits = (r: ResolvedRules) =>
    count(
      seeded
        .filter((x) => x.application)
        .map((x) => {
          const parsed = formValuesSchema.safeParse({ ...(x.application!.formData as object), documents: x.application!.documents.map((d) => d.kind) });
          if (!parsed.success) return [];
          const type = x.application!.type as AppType;
          return ruleHits(computeFeatures(parsed.data, isoDate(t), r.hasType(type) ? r.criticalKinds(type) : []), r.formCheckRules, r.norms(r.programme(parsed.data.programme)));
        }),
    );
  const seededOld = seededHits(oldR);
  const seededNew = seededHits(newR);
  const ruleIds = [...new Set([...oldR.formCheckRules, ...newR.formCheckRules].map((r) => r.id))];
  const formCheck = ruleIds.map((id) => ({ rule: id, samplesBefore: sampleOld[id] ?? 0, samplesAfter: sampleNew[id] ?? 0, seededBefore: seededOld[id] ?? 0, seededAfter: seededNew[id] ?? 0 }));
  const fcChanged = formCheck.filter((f) => f.samplesBefore !== f.samplesAfter || f.seededBefore !== f.seededAfter);
  sentences.push(
    fcChanged.length
      ? `Form check warnings change for ${fcChanged.map((f) => `${f.rule} (${f.samplesBefore} → ${f.samplesAfter} of ${samples.length} samples, ${f.seededBefore} → ${f.seededAfter} of ${seeded.length} seeded checks)`).join('; ')}.`
      : `Form check warnings stay the same on ${samples.length} samples and ${seeded.length} seeded checks.`,
  );

  // ---- assignment: projected utilisation per South officer if every open task were reweighted (display only)
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER', region: { code: 'SOUTH' }, active: true },
    select: { id: true, name: true, profile: { select: { capacityPoints: true } }, assignments: { where: { releasedAt: null }, select: { taskType: true, weight: true, application: { select: { type: true } } } } },
    orderBy: { name: 'asc' },
  });
  const reweigh = (r: ResolvedRules, a: { taskType: string; application: { type: string } }) =>
    Math.round(r.assignment.stageWeight[a.taskType as keyof PackContent['assignment']['stageWeight']] * (r.hasType(a.application.type) ? r.type(a.application.type as AppType).categoryWeight : 1) * 100) / 100;
  const assignment = officers.map((o) => {
    const cap = Number(o.profile?.capacityPoints ?? newR.assignment.defaultCapacityPoints);
    const before = o.assignments.reduce((s, a) => s + Number(a.weight), 0) / cap;
    const after = o.assignments.reduce((s, a) => s + reweigh(newR, a), 0) / cap;
    return { officer: o.name, openTasks: o.assignments.length, before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100 };
  });
  const asgChanged = assignment.filter((a) => a.before !== a.after);
  sentences.push(
    asgChanged.length
      ? `If every open task were reweighted, ${plural(asgChanged.length, 'South officer')}'s utilisation would change (display only: existing assignments keep their weight).`
      : 'Assignment weights do not change the utilisation of any South officer.',
  );

  // ---- schedule: who can file today, before and after
  const day = isoDate(t);
  const groups = newR.content.programmes.flatMap((p) => [true, false].map((tech) => ({ p, tech })));
  const canFile = (r: ResolvedRules, code: string, tech: boolean) => {
    const prog = r.programme(code);
    const ctx: EvalContext = { institution: { isTechnical: tech, kind: tech ? 'ENGINEERING_COLLEGE' : 'ARTS_SCIENCE_COLLEGE' }, programme: prog, formData: { programme: code } };
    return r.schedule.some((s) => (s.kind === 'APPLICATION_WINDOW' || s.kind === 'LATE_FEE_WINDOW') && s.from <= day && day <= s.to && r.test(s.appliesTo, ctx));
  };
  const schedule = groups.map(({ p, tech }) => ({ group: `${p.label} · ${tech ? 'technical' : 'non-technical'} institution`, before: canFile(oldR, p.code, tech), after: canFile(newR, p.code, tech) }));
  const opened = schedule.filter((s) => !s.before && s.after);
  const closed = schedule.filter((s) => s.before && !s.after);
  sentences.push(
    opened.length || closed.length
      ? `Today, ${plural(opened.length, 'group')} could newly file and ${plural(closed.length, 'group')} could no longer file.`
      : `Who can file today does not change (${plural(schedule.filter((s) => s.after).length, 'programme and institution group')} can file).`,
  );

  for (const d of diff.filter((x) => x.section === 'schedule' && x.classification === 'relaxing')) {
    const w = newR.schedule.find((s2) => d.path.startsWith(`schedule.${s2.id}`));
    const scopeText = w && w.appliesTo === true ? 'for all programme and institution groups' : 'for the groups it applies to';
    sentences.push(`${d.reason} ${scopeText}.`);
  }

  // ---- refusals
  const refusals = checkApplyScope(diff, scope);
  if (refusals.length) sentences.push(`${plural(refusals.length, 'change')} marked for live cases cannot apply to them: ${refusals.map((r) => r.message).join(' ')}`);

  return {
    version: { id: target.id, version: target.version, status: target.status },
    against: { id: basis.id, version: basis.version },
    changes: diff.length,
    sentences,
    live: { applies: live, pinnedOpenCases: pinned.length, moves },
    newFilings: { sampled: recent.length, routeChanges, missingDocs, outsidePurview: purviewFalse },
    formCheck: { samples: samples.length, seeded: seeded.length, rules: formCheck },
    assignment,
    schedule,
    refusals,
    ms: Math.round(performance.now() - started),
  };
}
