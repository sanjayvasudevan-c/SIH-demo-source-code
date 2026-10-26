// Action Center flags (section 7.2). Rebuilt every cycle: desired set → upsert, open flags not desired → resolved.
// Rule-based and explainable: every flag carries a reason text, an owner, a next action and five sort keys.
import type { DeadlineItem, Prisma, ReasonCode, Role, Stage } from '@prisma/client';
import { prisma, type Db } from '../lib/db.js';
import * as clock from '../lib/clock.js';
import { addDays, calendarDaysBetween, formatDate, toDateOnly } from '../lib/dates.js';
import { addWorkingDays, nextWorkingDayFrom, workingDaysBetween } from '../lib/workdays.js';
import { appendAudit } from '../lib/audit.js';
import { rulesForApp } from '../rules/service.js';
import { managerAtLevel, regionHod } from '../policy/subtree.js';
import { proposeCommittee } from '../assignment/committee.js';
import { parseAssignSource } from '../assignment/unassigned.js';
import { taskLabel } from '../assignment/engine.js';

export const REASON_LABEL: Record<ReasonCode, string> = {
  STAGE_AT_RISK: 'At risk',
  STAGE_OVERDUE: 'Overdue',
  WAITING_ON_COLLEGE: 'Waiting on college',
  STALLED: 'Stalled',
  EVC_NOT_SCHEDULED: 'EVC not scheduled',
  EVC_OVERDUE: 'EVC report overdue',
  EVIDENCE_PENDING_VERIFICATION: 'Evidence waiting for verification',
  UNDERTAKING_DUE_SOON: 'Undertaking due soon',
  UNDERTAKING_OVERDUE: 'Undertaking overdue',
  DOC_EXPIRING: 'Document expiring',
  DOC_EXPIRED: 'Document expired',
  BLOCKED: 'Blocked',
  URGENT: 'Urgent',
  ESCALATED: 'Escalated',
};

const ROLE_LABEL: Record<string, string> = {
  COLLEGE: 'College',
  OFFICER: 'Officer',
  SENIOR: 'Senior officer',
  SUPER_SENIOR: 'Super senior officer',
  HOD: 'Head of department',
  BUREAU: 'Bureau',
  COMMITTEE: 'Committee',
  AUTHORITY: 'Competent authority',
};
const REGION: Record<string, string> = { SOUTH: 'South', WEST: 'West' };
const STAGE_ITEM_LABEL: Record<Stage, string> = { SCRUTINY: 'Scrutiny deadline', EVC: 'EVC deadline', SAC_SHC: 'SAC/SHC forwarding deadline', DECISION: 'Decision deadline' };

export interface SortKeys {
  escalationLevel: number;
  daysOverdue: number;
  categoryRank: number;
  daysToDue: number;
  submittedAt: string;
}

export interface DesiredFlag {
  applicationId: string;
  reasonCode: ReasonCode;
  sourceItemId: string;
  ownerRole: Role;
  ownerUserId: string | null;
  reasonText: string;
  nextAction: string;
  nextEscalationAt: Date | null;
  escalationLevel: number;
  sortKeys: SortKeys;
}

/** Ordering for GET /action-center: escalation desc → days overdue desc → category rank asc → days to due asc → submitted asc. */
export function compareSortKeys(a: SortKeys, b: SortKeys): number {
  return (
    b.escalationLevel - a.escalationLevel ||
    b.daysOverdue - a.daysOverdue ||
    a.categoryRank - b.categoryRank ||
    a.daysToDue - b.daysToDue ||
    a.submittedAt.localeCompare(b.submittedAt)
  );
}

function unitWord(unit: 'WORKING' | 'CALENDAR', n: number): string {
  return `${unit === 'WORKING' ? 'working ' : ''}${n === 1 ? 'day' : 'days'}`;
}

type Person = { id: string; name: string; role: Role; title: string | null; regionCode: string | null };

export async function buildDesiredFlags(today: Date, db: Db = prisma): Promise<DesiredFlag[]> {
  const apps = await db.application.findMany({
    where: { OR: [{ status: { in: ['IN_STAGE', 'RETURNED'] } }, { deadlineItems: { some: { status: 'OPEN' } } }] },
    include: {
      region: true,
      institution: { select: { name: true, portfolioOfficerId: true } },
      deadlineItems: { where: { status: { in: ['OPEN', 'PAUSED'] } } },
      evcVisit: true,
      undertakings: true,
      flags: { where: { reasonCode: 'BLOCKED', sourceItemId: { startsWith: 'assign:' }, resolvedAt: null } },
    },
  });
  const users = await db.user.findMany({
    where: { role: { not: 'COLLEGE' } },
    select: { id: true, name: true, role: true, title: true, reportsToId: true, region: { select: { code: true } } },
  });
  const people = new Map<string, Person>(users.map((u) => [u.id, { id: u.id, name: u.name, role: u.role, title: u.title, regionCode: u.region?.code ?? null }]));
  const who = (id: string | null | undefined, fallback = 'unassigned') => {
    const p = id ? people.get(id) : undefined;
    if (!p) return fallback;
    return `${p.name} (${ROLE_LABEL[p.role] ?? p.role}${p.regionCode ? `, ${REGION[p.regionCode] ?? p.regionCode}` : ''})`;
  };
  const docs = await db.document.findMany({ where: { applicationId: { in: apps.map((a) => a.id) } } });
  const nextDay = nextWorkingDayFrom(addDays(today, 1));
  const out: DesiredFlag[] = [];

  for (const app of apps) {
    const pack = await rulesForApp(app, db);
    const cfgDocs = pack.documents(app.type, { formData: app.formData as Record<string, unknown> });
    const regionLabel = REGION[app.region.code] ?? app.region.code;
    const daysInStage = Math.max(0, workingDaysBetween(toDateOnly(app.stageEnteredAt), today));
    const base = { categoryRank: app.categoryRank, submittedAt: app.submittedAt.toISOString() };
    const collegeOwner = `owner: ${app.institution.name} (College, ${regionLabel})`;

    const itemName = (it: DeadlineItem): string => {
      switch (it.type) {
        case 'STAGE_SLA':
          return STAGE_ITEM_LABEL[(it.sourceId as Stage) || app.stage] ?? 'Stage deadline';
        case 'EVC_SCHEDULE':
          return 'EVC scheduling';
        case 'EVC_REPORT':
          return 'EVC report';
        case 'VERIFICATION':
          return 'Evidence verification';
        case 'UNDERTAKING': {
          const u = app.undertakings.find((x) => x.id === it.sourceId);
          return u ? `Undertaking "${u.condition}"` : 'Undertaking';
        }
        case 'DOC_EXPIRY': {
          const d = docs.find((x) => x.id === it.sourceId);
          return `${cfgDocs.find((c) => c.kind === d?.kind)?.label ?? d?.kind ?? 'Document'} expiry`;
        }
      }
    };
    const dtd = (it: DeadlineItem) => (it.unit === 'WORKING' ? workingDaysBetween(today, it.dueDate) : calendarDaysBetween(today, it.dueDate));
    const metric = (it: DeadlineItem) => {
      const d = dtd(it);
      if (d < 0) return `${-d} ${unitWord(it.unit, -d)} overdue (due ${formatDate(it.dueDate)})`;
      if (d === 0) return `due today (${formatDate(it.dueDate)})`;
      return `due ${formatDate(it.dueDate)}, in ${d} ${unitWord(it.unit, d)}`;
    };
    /** Next escalation: the first threshold above the current level, its date and the manager's title. */
    const nextEscalation = async (it: DeadlineItem): Promise<{ text: string; at: Date | null }> => {
      const th = pack.escalation.thresholds;
      const next = it.escalationLevel + 1;
      if (next > th.length) return { text: '', at: null };
      const t = th[next - 1]!;
      const at = it.unit === 'WORKING' ? addWorkingDays(it.dueDate, t) : addDays(it.dueDate, t);
      let target = await managerAtLevel(it.responsibleUserId, next, db);
      if (!target || target === it.responsibleUserId) target = await regionHod(app.regionId, db);
      const p = target ? people.get(target) : undefined;
      return { text: `next escalation: level ${next} (${p?.title ?? 'head of department'}) on ${formatDate(at)}`, at };
    };
    const compose = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join('; ');
    const push = (f: Omit<DesiredFlag, 'applicationId'>) => out.push({ applicationId: app.id, ...f });

    for (const it of app.deadlineItems) {
      if (it.status !== 'OPEN') continue;
      const d = dtd(it);
      const overdue = d < 0;
      const waiting = Math.max(0, it.unit === 'WORKING' ? workingDaysBetween(toDateOnly(it.createdAt), today) : calendarDaysBetween(it.createdAt, today));
      const sort: SortKeys = { ...base, escalationLevel: it.escalationLevel, daysOverdue: Math.max(0, -d), daysToDue: d };
      const esc = overdue ? await nextEscalation(it) : { text: '', at: null };
      const resp = it.responsibleUserId;
      const respRole = people.get(resp)?.role ?? 'OFFICER';
      const isCompliance = it.type === 'UNDERTAKING' || it.type === 'DOC_EXPIRY';
      const undertaking = it.type === 'UNDERTAKING' ? app.undertakings.find((u) => u.id === it.sourceId) : undefined;
      // Evidence submitted and waiting for verification is not the college's to act on.
      // A renewal waiting for verification is not the college's to act on either.
      const renewalPending = it.type === 'DOC_EXPIRY' && docs.some((x) => x.supersedesId === it.sourceId && !x.verified);
      const collegeActs = (it.type !== 'UNDERTAKING' || undertaking?.status === 'OPEN') && !renewalPending;

      switch (it.type) {
        case 'STAGE_SLA': {
          const next = app.stage === 'DECISION' ? 'Record the decision' : app.stage === 'SAC_SHC' ? 'Forward or recommend' : 'Complete stage, return or revert';
          if (overdue) {
            push({
              reasonCode: 'STAGE_OVERDUE',
              sourceItemId: it.id.toString(),
              ownerRole: respRole,
              ownerUserId: resp,
              reasonText: compose([`${REASON_LABEL.STAGE_OVERDUE} — ${itemName(it)} ${metric(it)}`, `owner: ${who(resp)}`, `waiting ${waiting} days`, `next: ${next}`, esc.text]),
              nextAction: next,
              nextEscalationAt: esc.at,
              escalationLevel: it.escalationLevel,
              sortKeys: sort,
            });
          } else if (it.totalDays && (it.totalDays - d) / it.totalDays >= pack.reminders.atRiskPct / 100) {
            const pct = Math.round(((it.totalDays - d) / it.totalDays) * 100);
            push({
              reasonCode: 'STAGE_AT_RISK',
              sourceItemId: it.id.toString(),
              ownerRole: respRole,
              ownerUserId: resp,
              reasonText: compose([`${REASON_LABEL.STAGE_AT_RISK} — ${itemName(it)} ${pct}% of ${it.totalDays} working days used, ${metric(it)}`, `owner: ${who(resp)}`, `waiting ${waiting} days`, `next: ${next}`]),
              nextAction: next,
              nextEscalationAt: null,
              escalationLevel: it.escalationLevel,
              sortKeys: sort,
            });
          }
          break;
        }
        case 'EVC_SCHEDULE': {
          if (overdue) {
            push({
              reasonCode: 'EVC_NOT_SCHEDULED',
              sourceItemId: it.id.toString(),
              ownerRole: respRole,
              ownerUserId: resp,
              reasonText: compose([`${REASON_LABEL.EVC_NOT_SCHEDULED} — ${itemName(it)} ${metric(it)}`, `owner: ${who(resp)}`, `waiting ${waiting} days`, 'next: Confirm committee and schedule visit', esc.text]),
              nextAction: 'Confirm committee and schedule visit',
              nextEscalationAt: esc.at,
              escalationLevel: it.escalationLevel,
              sortKeys: sort,
            });
          }
          if (!app.evcScheduled && d <= pack.reminders.urgentDays) {
            const { proposal } = await proposeCommittee(app.id, nextDay, db);
            if (proposal.length < 3) {
              push({
                reasonCode: 'BLOCKED',
                sourceItemId: `evc:${it.id}`,
                ownerRole: respRole,
                ownerUserId: resp,
                reasonText: compose([
                  `${REASON_LABEL.BLOCKED} — EVC is due without a committee proposal: only ${proposal.length} of 3 members available on ${formatDate(nextDay)}`,
                  `owner: ${who(resp)}`,
                  'next: Supply or assign: committee members',
                ]),
                nextAction: 'Supply or assign: committee members',
                nextEscalationAt: null,
                escalationLevel: it.escalationLevel,
                sortKeys: sort,
              });
            }
          }
          break;
        }
        case 'EVC_REPORT':
          if (overdue) {
            push({
              reasonCode: 'EVC_OVERDUE',
              sourceItemId: it.id.toString(),
              ownerRole: 'COMMITTEE',
              ownerUserId: resp,
              reasonText: compose([`${REASON_LABEL.EVC_OVERDUE} — ${itemName(it)} ${metric(it)}`, `owner: ${who(resp)}`, `waiting ${waiting} days`, 'next: Submit report or reschedule with reason', esc.text]),
              nextAction: 'Submit report or reschedule with reason',
              nextEscalationAt: esc.at,
              escalationLevel: it.escalationLevel,
              sortKeys: sort,
            });
          }
          break;
        case 'VERIFICATION':
          if (overdue) {
            push({
              reasonCode: 'EVIDENCE_PENDING_VERIFICATION',
              sourceItemId: it.id.toString(),
              ownerRole: respRole,
              ownerUserId: resp,
              reasonText: compose([`${REASON_LABEL.EVIDENCE_PENDING_VERIFICATION} — ${itemName(it)} ${metric(it)}`, `owner: ${who(resp)}`, `waiting ${waiting} days`, 'next: Verify or reject with remarks', esc.text]),
              nextAction: 'Verify or reject with remarks',
              nextEscalationAt: esc.at,
              escalationLevel: it.escalationLevel,
              sortKeys: sort,
            });
          }
          break;
        case 'UNDERTAKING':
        case 'DOC_EXPIRY': {
          const isU = it.type === 'UNDERTAKING';
          if (!collegeActs) break;
          const next = isU ? (overdue ? 'Upload evidence; officer to follow up' : 'Upload evidence') : 'Upload renewed document';
          const code: ReasonCode = isU ? (overdue ? 'UNDERTAKING_OVERDUE' : 'UNDERTAKING_DUE_SOON') : overdue ? 'DOC_EXPIRED' : 'DOC_EXPIRING';
          if (!overdue && d > pack.reminders.dueSoonDays) break;
          push({
            reasonCode: code,
            sourceItemId: it.id.toString(),
            ownerRole: 'COLLEGE',
            ownerUserId: null,
            reasonText: compose([
              `${REASON_LABEL[code]} — ${itemName(it)} ${metric(it)}`,
              collegeOwner,
              overdue ? `follow-up: ${who(app.institution.portfolioOfficerId)}` : null,
              `next: ${next}`,
              esc.text,
            ]),
            nextAction: next,
            nextEscalationAt: esc.at,
            escalationLevel: it.escalationLevel,
            sortKeys: sort,
          });
          break;
        }
      }

      // URGENT: any open item due within 3 days or today.
      if (d >= 0 && d <= pack.reminders.urgentDays && collegeActs) {
        const ownerRole: Role = isCompliance ? 'COLLEGE' : it.type === 'EVC_REPORT' ? 'COMMITTEE' : respRole;
        push({
          reasonCode: 'URGENT',
          sourceItemId: it.id.toString(),
          ownerRole,
          ownerUserId: isCompliance ? null : resp,
          reasonText: compose([`${REASON_LABEL.URGENT} — ${itemName(it)} ${metric(it)}`, isCompliance ? collegeOwner : `owner: ${who(resp)}`, 'next: Act now']),
          nextAction: 'Act now',
          nextEscalationAt: null,
          escalationLevel: it.escalationLevel,
          sortKeys: sort,
        });
      }

      // ESCALATED: owned by the level-N manager.
      if (it.escalationLevel >= 1) {
        let target = await managerAtLevel(resp, it.escalationLevel, db);
        if (!target || target === resp) target = await regionHod(app.regionId, db);
        const tp = target ? people.get(target) : undefined;
        push({
          reasonCode: 'ESCALATED',
          sourceItemId: it.id.toString(),
          ownerRole: tp?.role ?? 'HOD',
          ownerUserId: target,
          reasonText: compose([
            `${REASON_LABEL.ESCALATED} · Level ${it.escalationLevel} — ${itemName(it)} ${metric(it)}`,
            `owner: ${who(target)}`,
            `responsible: ${who(resp)}`,
            'next: Review and act',
            esc.text,
          ]),
          nextAction: 'Review and act',
          nextEscalationAt: esc.at,
          escalationLevel: it.escalationLevel,
          sortKeys: sort,
        });
      }
    }

    // WAITING_ON_COLLEGE: returned with a deficiency (clock paused).
    if (app.status === 'RETURNED') {
      const paused = app.deadlineItems.find((i) => i.status === 'PAUSED');
      push({
        reasonCode: 'WAITING_ON_COLLEGE',
        sourceItemId: '',
        ownerRole: 'COLLEGE',
        ownerUserId: null,
        reasonText: compose([
          `${REASON_LABEL.WAITING_ON_COLLEGE} — deficiency reply${paused ? `, scrutiny clock paused with ${paused.pausedRemaining} working days left` : ''}`,
          collegeOwner,
          `returned by: ${who(app.previousOfficerId)}`,
          `waiting ${Math.max(0, workingDaysBetween(toDateOnly(app.lastActionAt), today))} days`,
          'next: College to reply to deficiency',
        ]),
        nextAction: 'College to reply to deficiency',
        nextEscalationAt: null,
        escalationLevel: 0,
        sortKeys: { ...base, escalationLevel: 0, daysOverdue: 0, daysToDue: paused?.pausedRemaining ?? 0 },
      });
    }

    if (app.status === 'IN_STAGE') {
      const stageItems = app.deadlineItems.filter((i) => i.status === 'OPEN' && ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'].includes(i.type));
      // STALLED: no audit action for 10 working days while the SLA has not passed.
      const idle = workingDaysBetween(toDateOnly(app.lastActionAt), today);
      if (idle >= pack.reminders.stalledWorkingDays && stageItems.length && stageItems.every((i) => dtd(i) >= 0)) {
        const holder = app.holderUserId ?? stageItems[0]!.responsibleUserId;
        const it = stageItems[0]!;
        push({
          reasonCode: 'STALLED',
          sourceItemId: '',
          ownerRole: people.get(holder)?.role ?? 'OFFICER',
          ownerUserId: holder,
          reasonText: compose([`${REASON_LABEL.STALLED} — no action for ${idle} working days, ${itemName(it)} ${metric(it)}`, `owner: ${who(holder)}`, `waiting ${daysInStage} days`, 'next: Open case and act']),
          nextAction: 'Open case and act',
          nextEscalationAt: null,
          escalationLevel: 0,
          sortKeys: { ...base, escalationLevel: 0, daysOverdue: 0, daysToDue: dtd(it) },
        });
      }

      // BLOCKED: a critical document needed for the next stage has expired.
      const current = docs.filter((x) => x.applicationId === app.id && !docs.some((y) => y.supersedesId === x.id));
      for (const c of cfgDocs.filter((x) => x.critical && x.hasExpiry)) {
        const doc = current.filter((x) => x.kind === c.kind).pop();
        if (doc?.expiryDate && toDateOnly(doc.expiryDate) < today) {
          const it = stageItems[0];
          push({
            reasonCode: 'BLOCKED',
            sourceItemId: `doc:${c.kind}`,
            ownerRole: 'COLLEGE',
            ownerUserId: null,
            reasonText: compose([`${REASON_LABEL.BLOCKED} — ${c.label} expired on ${formatDate(doc.expiryDate)}; needed for the next stage`, collegeOwner, `next: Supply or assign: renewed ${c.label.toLowerCase()}`]),
            nextAction: `Supply or assign: renewed ${c.label.toLowerCase()}`,
            nextEscalationAt: null,
            escalationLevel: 0,
            sortKeys: { ...base, escalationLevel: 0, daysOverdue: 0, daysToDue: it ? dtd(it) : 0 },
          });
        }
      }
    }

    // BLOCKED (no eligible officer): kept while the task is still unassigned.
    for (const f of app.flags) {
      const src = parseAssignSource(f.sourceItemId);
      if (!src) continue;
      const open = await db.assignment.count({ where: { applicationId: app.id, taskType: src.taskType, taskRefId: src.taskRefId, releasedAt: null } });
      if (open) continue;
      const hod = await regionHod(app.regionId, db);
      push({
        reasonCode: 'BLOCKED',
        sourceItemId: f.sourceItemId,
        ownerRole: 'HOD',
        ownerUserId: hod,
        reasonText: f.reasonText,
        nextAction: `Supply or assign: ${taskLabel(src.taskType).toLowerCase()} officer`,
        nextEscalationAt: null,
        escalationLevel: 0,
        sortKeys: { ...base, escalationLevel: 0, daysOverdue: 0, daysToDue: 0 },
      });
    }
  }
  return out;
}

/** Upsert desired flags; resolve (with an audit row) open flags whose cause is gone. */
export async function buildFlags(today: Date, db: typeof prisma = prisma): Promise<Record<string, number>> {
  const key = (f: { applicationId: string; reasonCode: string; sourceItemId: string }) => `${f.applicationId}|${f.reasonCode}|${f.sourceItemId}`;
  const want = new Map((await buildDesiredFlags(today, db)).map((f) => [key(f), f]));
  const desired = [...want.values()];
  const all = await db.exceptionFlag.findMany();
  const open = all.filter((f) => !f.resolvedAt);
  const existing = new Map(all.map((f) => [key(f), f]));
  const at = clock.now();
  let raised = 0;
  let updated = 0;
  let resolved = 0;

  for (const f of desired) {
    const prev = existing.get(key(f));
    const data = {
      ownerRole: f.ownerRole,
      ownerUserId: f.ownerUserId,
      reasonText: f.reasonText,
      nextAction: f.nextAction,
      nextEscalationAt: f.nextEscalationAt,
      escalationLevel: f.escalationLevel,
      sortKeys: f.sortKeys as unknown as Prisma.InputJsonValue,
    };
    if (!prev) {
      await db.exceptionFlag.create({ data: { applicationId: f.applicationId, reasonCode: f.reasonCode, sourceItemId: f.sourceItemId, ...data, raisedAt: at } });
      raised++;
    } else {
      await db.exceptionFlag.update({ where: { id: prev.id }, data: { ...data, ...(prev.resolvedAt ? { resolvedAt: null, raisedAt: at } : {}) } });
      if (prev.resolvedAt) raised++;
      else updated++;
    }
  }
  for (const f of open) {
    if (want.has(key(f))) continue;
    await db.$transaction(async (tx) => {
      await tx.exceptionFlag.update({ where: { id: f.id }, data: { resolvedAt: at } });
      await appendAudit(tx, {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'FLAG_RESOLVED',
        applicationId: f.applicationId,
        reason: `${REASON_LABEL[f.reasonCode]} resolved`,
        meta: { flagId: f.id, reasonCode: f.reasonCode, sourceItemId: f.sourceItemId },
      });
    });
    resolved++;
  }
  return { flagsRaised: raised, flagsUpdated: updated, flagsResolved: resolved, flagsOpen: desired.length };
}
