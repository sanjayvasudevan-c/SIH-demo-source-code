// Team roll-up (section 8): work done and pending per direct report, summed over each report's subtree.
// No ranking and no composite score.
import { prisma } from '../lib/db.js';
import * as clock from '../lib/clock.js';
import { addDays, isoDate, toDateOnly } from '../lib/dates.js';
import { workingDaysBetween } from '../lib/workdays.js';
import { getSubtreeUserIds } from '../policy/subtree.js';
import { scopeWhere } from '../policy/scope.js';
import type { AuthUser } from '../auth/middleware.js';
import { REASON_LABEL } from '../engine/flags.js';

const STAGE_TYPES = ['STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT', 'VERIFICATION'] as const;

export interface Metrics {
  received: number;
  completed: number;
  returned: number;
  closed: number;
  heldNow: number;
  ageing: { d0to7: number; d8to15: number; d16plus: number };
  overdueNow: number;
  worstOverdueDays: number;
  slaMet: number;
  slaTotal: number;
  slaMetPct: number | null;
  avgWorkingDaysPerStage: number | null;
  stageCount: number;
  openPoints: number;
  capacity: number;
  utilisation: number | null;
  officers: number;
  availableToday: number;
}

function empty(): Metrics {
  return {
    received: 0,
    completed: 0,
    returned: 0,
    closed: 0,
    heldNow: 0,
    ageing: { d0to7: 0, d8to15: 0, d16plus: 0 },
    overdueNow: 0,
    worstOverdueDays: 0,
    slaMet: 0,
    slaTotal: 0,
    slaMetPct: null,
    avgWorkingDaysPerStage: null,
    stageCount: 0,
    openPoints: 0,
    capacity: 0,
    utilisation: null,
    officers: 0,
    availableToday: 0,
  };
}

/** Metrics for a set of people (officers and Bureau carry the work; managers contribute nothing directly). */
export async function metricsFor(ids: string[], periodDays: number): Promise<Metrics> {
  const m = empty();
  if (ids.length === 0) return m;
  const t = clock.today();
  const from = addDays(t, -periodDays);
  const [received, actions, closedApps, open, items, closedItems, profiles, avail] = await Promise.all([
    prisma.assignment.count({ where: { officerId: { in: ids }, assignedAt: { gte: from } } }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { actorId: { in: ids }, at: { gte: from }, action: { in: ['COMPLETE_STAGE', 'FORWARD_SAC_SHC', 'VERIFY_EVIDENCE', 'VERIFY_RENEWAL', 'RETURN'] } },
      _count: true,
    }),
    prisma.auditLog.findMany({
      where: { action: { in: ['DECIDE', 'CLOSED'] }, at: { gte: from }, applicationId: { not: null } },
      select: { applicationId: true },
    }),
    prisma.assignment.findMany({ where: { officerId: { in: ids }, releasedAt: null }, include: { application: { select: { stageEnteredAt: true, id: true } } } }),
    prisma.deadlineItem.findMany({ where: { responsibleUserId: { in: ids }, status: 'OPEN', type: { in: [...STAGE_TYPES] } } }),
    prisma.deadlineItem.findMany({ where: { responsibleUserId: { in: ids }, status: { in: ['MET', 'MISSED'] }, type: { in: [...STAGE_TYPES] }, closedAt: { gte: from } } }),
    prisma.officerProfile.findMany({ where: { userId: { in: ids } } }),
    prisma.officerAvailability.findMany({ where: { userId: { in: ids }, startsOn: { lte: t }, endsOn: { gte: t } }, select: { userId: true } }),
  ]);
  m.received = received;
  for (const a of actions) {
    if (a.action === 'RETURN') m.returned += a._count;
    else m.completed += a._count;
  }
  const closedIds = [...new Set(closedApps.map((c) => c.applicationId!))];
  if (closedIds.length) {
    m.closed = await prisma.application.count({ where: { id: { in: closedIds }, institution: { portfolioOfficerId: { in: ids } } } });
  }
  const heldApps = new Map<string, Date>();
  for (const a of open) heldApps.set(a.application.id, a.application.stageEnteredAt);
  m.heldNow = open.length;
  for (const entered of heldApps.values()) {
    const d = Math.max(0, workingDaysBetween(toDateOnly(entered), t));
    if (d <= 7) m.ageing.d0to7++;
    else if (d <= 15) m.ageing.d8to15++;
    else m.ageing.d16plus++;
  }
  for (const it of items) {
    const d = workingDaysBetween(t, it.dueDate);
    if (d < 0) {
      m.overdueNow++;
      m.worstOverdueDays = Math.max(m.worstOverdueDays, -d);
    }
  }
  m.slaTotal = closedItems.length;
  m.slaMet = closedItems.filter((i) => i.status === 'MET').length;
  m.slaMetPct = m.slaTotal ? Math.round((m.slaMet / m.slaTotal) * 100) : null;
  const durations = closedItems.filter((i) => i.type === 'STAGE_SLA' && i.closedAt).map((i) => Math.max(0, workingDaysBetween(toDateOnly(i.createdAt), toDateOnly(i.closedAt!))));
  m.stageCount = durations.length;
  m.avgWorkingDaysPerStage = durations.length ? Math.round((durations.reduce((s, x) => s + x, 0) / durations.length) * 10) / 10 : null;
  m.openPoints = Math.round(open.reduce((s, a) => s + Number(a.weight), 0) * 100) / 100;
  m.capacity = profiles.reduce((s, p) => s + Number(p.capacityPoints), 0);
  m.utilisation = m.capacity ? Math.round((m.openPoints / m.capacity) * 100) / 100 : null;
  m.officers = profiles.length;
  const away = new Set(avail.map((a) => a.userId));
  m.availableToday = profiles.filter((p) => !away.has(p.userId)).length;
  return m;
}

export function sumMetrics(list: Metrics[]): Metrics {
  const s = empty();
  for (const m of list) {
    s.received += m.received;
    s.completed += m.completed;
    s.returned += m.returned;
    s.closed += m.closed;
    s.heldNow += m.heldNow;
    s.ageing.d0to7 += m.ageing.d0to7;
    s.ageing.d8to15 += m.ageing.d8to15;
    s.ageing.d16plus += m.ageing.d16plus;
    s.overdueNow += m.overdueNow;
    s.worstOverdueDays = Math.max(s.worstOverdueDays, m.worstOverdueDays);
    s.slaMet += m.slaMet;
    s.slaTotal += m.slaTotal;
    s.openPoints = Math.round((s.openPoints + m.openPoints) * 100) / 100;
    s.capacity += m.capacity;
    s.officers += m.officers;
    s.availableToday += m.availableToday;
    if (m.avgWorkingDaysPerStage !== null) {
      const total = (s.avgWorkingDaysPerStage ?? 0) * s.stageCount + m.avgWorkingDaysPerStage * m.stageCount;
      s.stageCount += m.stageCount;
      s.avgWorkingDaysPerStage = s.stageCount ? Math.round((total / s.stageCount) * 10) / 10 : null;
    }
  }
  s.slaMetPct = s.slaTotal ? Math.round((s.slaMet / s.slaTotal) * 100) : null;
  s.utilisation = s.capacity ? Math.round((s.openPoints / s.capacity) * 100) / 100 : null;
  return s;
}

export async function teamReport(caller: AuthUser, base: { id: string; name: string; role: string }, periodDays: number) {
  const direct = await prisma.user.findMany({
    where: { reportsToId: base.id, active: true },
    select: { id: true, name: true, role: true, title: true },
    orderBy: { name: 'asc' },
  });
  const t = clock.today();
  const rows = [];
  for (const d of direct) {
    const subtree = [d.id, ...(await getSubtreeUserIds(d.id))];
    const metrics = await metricsFor(subtree, periodDays);
    const away = d.role === 'OFFICER' ? await prisma.officerAvailability.findFirst({ where: { userId: d.id, startsOn: { lte: t }, endsOn: { gte: t } }, orderBy: { endsOn: 'desc' } }) : null;
    rows.push({
      user: d,
      hasReports: subtree.length > 1,
      availability: d.role === 'OFFICER' ? (away ? { kind: away.kind, until: isoDate(away.endsOn) } : null) : null,
      metrics,
    });
  }
  const totals = sumMetrics(rows.map((r) => r.metrics));

  // Waiting-on breakdown over the caller's scope (open cases only).
  const scope = await scopeWhere(caller);
  const openApps = await prisma.application.findMany({
    where: { AND: [scope, { status: { in: ['IN_STAGE', 'RETURNED'] } }] },
    select: { holderType: true, stage: true },
  });
  const waitingOn = { officer: 0, college: 0, evcOrCommittee: 0, authority: 0 };
  for (const a of openApps) {
    if (a.holderType === 'COLLEGE') waitingOn.college++;
    else if (a.holderType === 'AUTHORITY') waitingOn.authority++;
    else if (a.stage === 'EVC' || a.holderType === 'COMMITTEE') waitingOn.evcOrCommittee++;
    else waitingOn.officer++;
  }

  const escalated = await prisma.exceptionFlag.findMany({
    where: { resolvedAt: null, reasonCode: 'ESCALATED', ownerUserId: caller.id },
    include: { application: { select: { id: true, applicationNo: true, institution: { select: { name: true } } } } },
    orderBy: { escalationLevel: 'desc' },
  });

  return {
    base,
    periodDays,
    rows,
    totals,
    waitingOn,
    escalatedToMe: escalated.map((f) => ({
      flagId: f.id,
      applicationId: f.application.id,
      applicationNo: f.application.applicationNo,
      institutionName: f.application.institution.name,
      level: f.escalationLevel,
      label: REASON_LABEL[f.reasonCode],
      reasonText: f.reasonText,
    })),
  };
}

export type TeamReport = Awaited<ReturnType<typeof teamReport>>;
