// Deadline engine cycle (section 7.1): reminders, at-risk, overdue, escalation, availability starts,
// Action Center flags, daily digests. Idempotent: every alert is guarded by AlertLog's unique key.
import crypto from 'node:crypto';
import pg from 'pg';
import type { DeadlineItem, ItemType } from '@prisma/client';
import { prisma, TX_OPTIONS, type Tx } from '../lib/db.js';
import * as clock from '../lib/clock.js';
import { addDays, calendarDaysBetween, formatDate, isoDate, toDateOnly } from '../lib/dates.js';
import { loadHolidays, nextWorkingDayFrom, workingDaysBetween } from '../lib/workdays.js';
import { appendAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { refreshPublished, rulesForApp } from '../rules/service.js';
import { publishScheduled } from '../rules/versions.js';
import { getSubtreeUserIds, managerAtLevel, regionAuthority, regionHod } from '../policy/subtree.js';
import { isTaskUrgent, releaseForAvailability } from '../assignment/engine.js';
import { buildFlags } from './flags.js';

export type CycleResult = Record<string, number | string>;

export const CYCLE_LOCK_ID = 727002;
const COMPLIANCE: ItemType[] = ['UNDERTAKING', 'DOC_EXPIRY'];

export const ITEM_LABEL: Record<ItemType, string> = {
  STAGE_SLA: 'stage deadline',
  EVC_SCHEDULE: 'EVC scheduling',
  EVC_REPORT: 'EVC report',
  VERIFICATION: 'evidence verification',
  UNDERTAKING: 'undertaking',
  DOC_EXPIRY: 'document expiry',
};

export function daysToDueOf(item: Pick<DeadlineItem, 'dueDate' | 'unit'>, today: Date): number {
  return item.unit === 'WORKING' ? workingDaysBetween(today, item.dueDate) : calendarDaysBetween(today, item.dueDate);
}

/** Insert an AlertLog row; true only when it was new (the alert must be sent). */
async function alertOnce(tx: Tx, itemId: bigint, kind: string, offsetOrLevel: number, triggerDate: Date, late: boolean): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    INSERT INTO "AlertLog" ("itemId", kind, "offsetOrLevel", "triggerDate", late, "createdAt")
    VALUES (${itemId}, ${kind}, ${offsetOrLevel}, ${triggerDate}::date, ${late}, ${clock.now()})
    ON CONFLICT ("itemId", kind, "offsetOrLevel") DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/** Stable negative bigint per user for digest dedupe rows (real item ids are positive). */
function userKey(userId: string): bigint {
  return -BigInt('0x' + crypto.createHash('sha256').update(userId).digest('hex').slice(0, 15));
}

type ItemWithApp = DeadlineItem & {
  application: { id: string; applicationNo: string; regionId: string; institutionId: string; cycleId: string; rulePackVersionId: string; institution: { name: string } };
};

async function itemSubject(tx: Tx, it: ItemWithApp): Promise<string> {
  if (it.type === 'UNDERTAKING') {
    const u = await tx.undertaking.findUnique({ where: { id: it.sourceId } });
    return u ? `undertaking "${u.condition}"` : 'undertaking';
  }
  if (it.type === 'DOC_EXPIRY') {
    const d = await tx.document.findUnique({ where: { id: it.sourceId } });
    const label = d ? (await rulesForApp(it.application, tx)).content.documents.find((x) => x.kind === d.kind)?.label : null;
    return `${(label ?? d?.kind ?? 'document').toLowerCase()} expiry`;
  }
  return ITEM_LABEL[it.type];
}

async function collegeUsers(tx: Tx, institutionId: string): Promise<string[]> {
  return (await tx.user.findMany({ where: { institutionId, role: 'COLLEGE', active: true }, select: { id: true } })).map((u) => u.id);
}

/** The manager N levels up the reportsTo chain from the responsible user; region HoD when the chain ends. */
export async function escalationTarget(tx: Tx, responsibleUserId: string, level: number, regionId: string): Promise<string | null> {
  const m = await managerAtLevel(responsibleUserId, level, tx);
  if (m && m !== responsibleUserId) return m;
  return regionHod(regionId, tx);
}

interface Counters {
  reminders: number;
  lateReminders: number;
  atRisk: number;
  overdue: number;
  escalations: number;
  released: number;
  digests: number;
  notifications: number;
}

async function processItem(it: ItemWithApp, today: Date, c: Counters): Promise<void> {
  const d = daysToDueOf(it, today);
  const isCompliance = COMPLIANCE.includes(it.type);
  // Reminders and escalation are operational: read from the cycle's current published version each cycle.
  const r = await rulesForApp(it.application);
  await prisma.$transaction(async (tx) => {
    const subject = await itemSubject(tx, it);
    const no = it.application.applicationNo;

    // Reminders (compliance) at 30/15/7/0 calendar days before due; late when the offset's date passed more than a day ago.
    if (isCompliance) {
      for (const offset of r.reminders.complianceOffsets) {
        if (d > offset) continue;
        const trigger = addDays(it.dueDate, -offset);
        const late = calendarDaysBetween(trigger, today) > 1;
        if (await alertOnce(tx, it.id, 'REMINDER', offset, trigger, late)) {
          c.reminders++;
          if (late) c.lateReminders++;
          const when = d < 0 ? `was due on ${formatDate(it.dueDate)}` : d === 0 ? 'is due today' : `is due on ${formatDate(it.dueDate)} (in ${d} days)`;
          c.notifications += await notify(tx, await collegeUsers(tx, it.application.institutionId), {
            applicationId: it.applicationId,
            kind: 'REMINDER',
            message: `Reminder (${offset === 0 ? 'due date' : `${offset} days`}): the ${subject} for ${no} ${when}.`,
          });
        }
      }
    } else if (it.totalDays) {
      // At risk: 80% of a stage SLA used, not yet overdue.
      const used = it.totalDays - d;
      if (d >= 0 && used / it.totalDays >= r.reminders.atRiskPct / 100) {
        if (await alertOnce(tx, it.id, 'AT_RISK', r.reminders.atRiskPct, today, false)) {
          c.atRisk++;
          c.notifications += await notify(tx, [it.responsibleUserId], {
            applicationId: it.applicationId,
            kind: 'AT_RISK',
            message: `At risk: ${subject} for ${no} (${it.application.institution.name}) is due on ${formatDate(it.dueDate)}, ${d} working ${d === 1 ? 'day' : 'days'} left.`,
          });
        }
      }
    }

    if (d >= 0) return;
    const overdueBy = -d;
    const unit = it.unit === 'WORKING' ? 'working days' : 'days';

    if (await alertOnce(tx, it.id, 'OVERDUE', 0, it.dueDate, false)) {
      c.overdue++;
      c.notifications += await notify(tx, [it.responsibleUserId], {
        applicationId: it.applicationId,
        kind: 'OVERDUE',
        message: `Overdue: ${subject} for ${no} (${it.application.institution.name}) was due on ${formatDate(it.dueDate)}.`,
      });
    }

    // Escalation: overdue by ≥ 3 / 7 / 14 → level 1 / 2 / 3, each level once, in order.
    const thresholds = r.escalation.thresholds;
    let level = it.escalationLevel;
    for (let n = 1; n <= thresholds.length; n++) {
      if (overdueBy < thresholds[n - 1]! || n <= level) continue;
      if (!(await alertOnce(tx, it.id, 'ESCALATION', n, it.dueDate, false))) {
        level = Math.max(level, n);
        continue;
      }
      level = n;
      const target = await escalationTarget(tx, it.responsibleUserId, n, it.application.regionId);
      const notified = new Set<string>(target ? [target] : []);
      if (n === 3) {
        const authority = await regionAuthority(it.application.regionId, tx);
        if (authority) notified.add(authority);
      }
      const responsible = await tx.user.findUnique({ where: { id: it.responsibleUserId }, select: { name: true } });
      c.escalations++;
      c.notifications += await notify(tx, [...notified], {
        applicationId: it.applicationId,
        kind: 'ESCALATION',
        message: `Escalated to you (level ${n}): ${subject} for ${no} (${it.application.institution.name}) is ${overdueBy} ${unit} overdue; responsible: ${responsible?.name ?? 'unknown'}.`,
      });
      await tx.deadlineItem.update({ where: { id: it.id }, data: { escalationLevel: n } });
      await appendAudit(tx, {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'ESCALATED',
        applicationId: it.applicationId,
        reason: `Level ${n}: ${subject} ${overdueBy} ${unit} overdue`,
        meta: { itemId: it.id.toString(), itemType: it.type, level: n, overdueBy, notifiedUserIds: [...notified], responsibleUserId: it.responsibleUserId },
      });
    }
  }, TX_OPTIONS);
}

/** Availability that has begun: release tasks the officer can no longer hold (horizon rule as in assignment). */
async function availabilityStarts(today: Date, c: Counters): Promise<void> {
  const nextDay = nextWorkingDayFrom(addDays(today, 1));
  const periods = await prisma.officerAvailability.findMany({ where: { startsOn: { lte: today }, endsOn: { gte: today } } });
  const users = [...new Set(periods.map((p) => p.userId))];
  for (const userId of users) {
    const open = await prisma.assignment.findMany({ where: { officerId: userId, releasedAt: null } });
    if (open.length === 0) continue;
    const awayTomorrow = periods.some((p) => p.userId === userId && toDateOnly(p.endsOn) >= nextDay);
    const toRelease: string[] = [];
    for (const a of open) {
      if (awayTomorrow || (await isTaskUrgent(prisma, a.applicationId, a.taskType, a.taskRefId))) toRelease.push(a.id);
    }
    if (toRelease.length === 0) continue;
    await prisma.$transaction(async (tx) => {
      const moved = await releaseForAvailability(tx, userId, null, (a) => toRelease.includes(a.id));
      c.released += moved.length;
    }, TX_OPTIONS);
  }
}

/** Daily digest per senior, super senior and HoD (once per day, only when there is something to say). */
async function digests(today: Date, c: Counters): Promise<void> {
  const managers = await prisma.user.findMany({ where: { role: { in: ['SENIOR', 'SUPER_SENIOR', 'HOD'] }, active: true }, select: { id: true, role: true, regionId: true } });
  const since = new Date(clock.now().getTime() - 86_400_000);
  const day = Number(isoDate(today).replace(/-/g, ''));
  const overdueAlerts = await prisma.alertLog.findMany({ where: { kind: 'OVERDUE', createdAt: { gte: since } }, select: { itemId: true } });
  const overdueItems = await prisma.deadlineItem.findMany({ where: { id: { in: overdueAlerts.map((a) => a.itemId) } }, select: { responsibleUserId: true } });
  const escalations = await prisma.auditLog.findMany({ where: { action: 'ESCALATED', at: { gte: since } }, select: { meta: true } });
  const stalled = await stalledApplications(today);

  for (const m of managers) {
    const team = new Set(await getSubtreeUserIds(m.id));
    const x = overdueItems.filter((i) => team.has(i.responsibleUserId)).length;
    const y = escalations.filter((e) => ((e.meta as { notifiedUserIds?: string[] }).notifiedUserIds ?? []).includes(m.id)).length;
    const z = stalled.filter((s) => s.holderUserId && team.has(s.holderUserId)).length;
    if (x + y + z === 0) continue;
    await prisma.$transaction(async (tx) => {
      if (!(await alertOnce(tx, userKey(m.id), 'DIGEST', day, today, false))) return;
      c.digests++;
      c.notifications += await notify(tx, [m.id], {
        kind: 'DIGEST',
        message: `Daily digest: ${x} new overdue in your team, ${y} escalated to you, ${z} stalled.`,
      });
    });
  }
}

/** IN_STAGE cases with no audit action for 10 working days while the stage SLA has not passed. */
export async function stalledApplications(today: Date) {
  const apps = await prisma.application.findMany({
    where: { status: 'IN_STAGE' },
    select: { id: true, cycleId: true, rulePackVersionId: true, lastActionAt: true, holderUserId: true, deadlineItems: { where: { status: 'OPEN', type: { in: ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT'] } } } },
  });
  const out: typeof apps = [];
  for (const a of apps) {
    const r = await rulesForApp(a);
    if (workingDaysBetween(toDateOnly(a.lastActionAt), today) < r.reminders.stalledWorkingDays) continue;
    if (a.deadlineItems.length > 0 && a.deadlineItems.every((i) => daysToDueOf(i, today) >= 0)) out.push(a);
  }
  return out;
}

/** One full cycle. Callers hold the cycle lock (runCycleWithLock). */
export async function runEngineCycle(meta: Record<string, string> = {}, opts: { flags?: boolean; digests?: boolean } = {}): Promise<CycleResult> {
  await clock.refresh().catch(() => undefined);
  // Fresh rules each cycle; versions scheduled for publication take effect first.
  await refreshPublished();
  const published = await publishScheduled();
  await loadHolidays(prisma);
  const today = clock.today();
  const c: Counters = { reminders: 0, lateReminders: 0, atRisk: 0, overdue: 0, escalations: 0, released: 0, digests: 0, notifications: 0 };

  const items = (await prisma.deadlineItem.findMany({
    where: { status: 'OPEN' },
    include: { application: { select: { id: true, applicationNo: true, regionId: true, institutionId: true, cycleId: true, rulePackVersionId: true, institution: { select: { name: true } } } } },
    orderBy: { id: 'asc' },
  })) as ItemWithApp[];
  for (const it of items) await processItem(it, today, c);

  await availabilityStarts(today, c);
  const flags = opts.flags === false ? {} : await buildFlags(today);
  if (opts.digests !== false) await digests(today, c);

  const sent = c.reminders + c.atRisk + c.overdue + c.escalations + c.digests;
  if (sent > 0 || c.released > 0) {
    await prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'ALERTS_SENT',
        meta: { ...c, ...meta, today: isoDate(today), itemsChecked: items.length },
      }),
    );
  }
  return { ...c, itemsChecked: items.length, rulesPublished: published, ...flags, today: isoDate(today) };
}

/**
 * Run a cycle under the cycle lock on a dedicated connection, waiting up to `waitMs` for it.
 * Used by the scheduler leader every minute and by the API after time travel.
 */
export async function runCycleWithLock(meta: Record<string, string> = {}, waitMs = 10_000): Promise<CycleResult> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Hosted (serverless): an instance can be frozen mid-cycle with this connection still open, and a session
  // lock would then be held for ever. An idle session is closed by the server after two minutes, which
  // releases the lock; a cycle takes seconds, so a live one is never cut off.
  if (process.env.HOSTED) await client.query(`SET idle_session_timeout = '120s'`);
  try {
    const deadline = performance.now() + waitMs;
    for (;;) {
      const r = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [CYCLE_LOCK_ID]);
      if (r.rows[0]?.ok) break;
      if (performance.now() > deadline) throw new Error('Another engine cycle is running. Try again in a few seconds.');
      await new Promise((res) => setTimeout(res, 250));
    }
    try {
      return await runEngineCycle(meta);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [CYCLE_LOCK_ID]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
