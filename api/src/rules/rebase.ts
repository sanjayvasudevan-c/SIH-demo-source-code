// Live rebase (add-on A4): when a version whose amendment is marked live is published, every open case pinned to
// the previous version of that cycle moves forward, one transaction per case. Affected open deadline items may
// move later, never earlier. Also the widening proof used to classify condition changes.
import type { DeadlineItem, ItemType, RulePackVersion } from '@prisma/client';
import { prisma, TX_OPTIONS, type Db } from '../lib/db.js';
import { appendAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { isoDate, toDateOnly } from '../lib/dates.js';
import { addWorkingDays } from '../lib/workdays.js';
import { evaluate, truthy, type Expr } from './expr.js';
import { diffPacks, isLiveAmendment, rebasesLiveCases, type ApplyScope, type DiffEntry, type WideningProof } from './diff.js';
import type { PackContent } from './schema.js';

const OPEN_STATUSES = ['IN_STAGE', 'RETURNED'] as const;

/** Facts of every seeded institution and open case, for proving that a condition only widens. */
export async function wideningProof(db: Db, cycleId: string, content: PackContent): Promise<WideningProof> {
  const [insts, priorApproved, open] = await Promise.all([
    db.institution.findMany({ select: { id: true, isTechnical: true, kind: true, region: { select: { code: true } } } }),
    db.application.groupBy({ by: ['institutionId'], where: { status: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'CLOSED'] } } }),
    db.application.findMany({ where: { cycleId, status: { in: [...OPEN_STATUSES] } }, select: { type: true, formData: true, institutionId: true } }),
  ]);
  const prior = new Set(priorApproved.map((p) => p.institutionId));
  const facts = new Map(insts.map((i) => [i.id, { isTechnical: i.isTechnical, kind: i.kind, regionCode: i.region.code, hasPriorApproval: prior.has(i.id) }]));
  const programmes = content.programmes;
  const contexts = (filter: (p: (typeof programmes)[number]) => boolean, type?: string) => {
    const out: Record<string, unknown>[] = [];
    for (const inst of facts.values()) {
      for (const p of programmes.filter(filter)) out.push({ institution: inst, programme: { code: p.code, level: p.level, discipline: p.discipline }, application: type ? { type } : {}, formData: { programme: p.code } });
    }
    for (const a of open) {
      const fd = a.formData as Record<string, unknown>;
      const p = programmes.find((x) => x.code === fd.programme);
      if (p && !filter(p)) continue;
      out.push({ institution: facts.get(a.institutionId) ?? {}, programme: p ? { code: p.code, level: p.level, discipline: p.discipline } : {}, application: { type: a.type }, formData: fd });
    }
    return out;
  };
  // Norms are not inputs to purview, eligibility or schedule scope in practice; evaluate with the pack's defaults.
  return (kind, key, oldExpr, newExpr) => {
    const ctxs = kind === 'programme' ? contexts((p) => p.code === key) : kind === 'eligibility' ? contexts(() => true, key) : contexts(() => true);
    return ctxs.every((c) => !truthy(evaluate(oldExpr as Expr, c)) || truthy(evaluate(newExpr as Expr, c)));
  };
}

/** Deadline item types each timeline drives. */
const TIMELINE_ITEMS: Record<string, { type: ItemType; sourceId?: string }> = {
  SCRUTINY: { type: 'STAGE_SLA', sourceId: 'SCRUTINY' },
  SAC_SHC: { type: 'STAGE_SLA', sourceId: 'SAC_SHC' },
  DECISION: { type: 'STAGE_SLA', sourceId: 'DECISION' },
  EVC_SCHEDULE: { type: 'EVC_SCHEDULE' },
  EVC_REPORT: { type: 'EVC_REPORT' },
  VERIFICATION: { type: 'VERIFICATION' },
};

export interface PlannedMove {
  itemId: string;
  type: ItemType;
  oldDue: string;
  newDue: string;
  oldPausedRemaining?: number | null;
  newPausedRemaining?: number | null;
  addDays: number;
}

/** How a case's open items move under the relaxing timeline changes of a diff (later only). */
export function plannedMoves(diff: DiffEntry[], items: Pick<DeadlineItem, 'id' | 'type' | 'sourceId' | 'status' | 'dueDate' | 'unit' | 'pausedRemaining'>[]): PlannedMove[] {
  const out: PlannedMove[] = [];
  for (const d of diff) {
    if (d.section !== 'timelines' || d.classification !== 'relaxing') continue;
    const key = d.path.split('.')[1]!;
    const target = TIMELINE_ITEMS[key];
    const delta = Number(d.new) - Number(d.old);
    if (!target || !(delta > 0)) continue;
    for (const it of items) {
      if (it.type !== target.type || (target.sourceId && it.sourceId !== target.sourceId)) continue;
      if (it.status === 'OPEN' && it.unit === 'WORKING') {
        const next = addWorkingDays(toDateOnly(it.dueDate), delta);
        if (next > toDateOnly(it.dueDate)) out.push({ itemId: it.id.toString(), type: it.type, oldDue: isoDate(it.dueDate), newDue: isoDate(next), addDays: delta });
      } else if (it.status === 'PAUSED' && it.pausedRemaining !== null) {
        out.push({ itemId: it.id.toString(), type: it.type, oldDue: isoDate(it.dueDate), newDue: isoDate(it.dueDate), oldPausedRemaining: it.pausedRemaining, newPausedRemaining: it.pausedRemaining + delta, addDays: delta });
      }
    }
  }
  return out;
}

/** Diff of a version against the one it replaces, with the widening proof for its cycle. */
export async function diffForPublish(db: Db, from: Pick<RulePackVersion, 'content' | 'cycleId'>, to: Pick<RulePackVersion, 'content'>): Promise<DiffEntry[]> {
  const a = from.content as unknown as PackContent;
  const b = to.content as unknown as PackContent;
  return diffPacks(a, b, await wideningProof(db, from.cycleId, b));
}

/** After a live version is published: move each open case pinned to the previous version, one transaction per case. */
export async function rebaseAfterPublish(actor: { id: string; role: string }, published: RulePackVersion, previous: RulePackVersion | null): Promise<{ rebased: number; movedItems: number }> {
  if (!previous) return { rebased: 0, movedItems: 0 };
  const amendment = await prisma.amendment.findUnique({ where: { versionId: published.id } });
  if (!amendment || !isLiveAmendment(amendment.applyScope as ApplyScope)) return { rebased: 0, movedItems: 0 };
  const diff = await diffForPublish(prisma, previous, published);
  if (!rebasesLiveCases(diff, amendment.applyScope as ApplyScope)) return { rebased: 0, movedItems: 0 };
  const changes = diff.map((d) => d.path);
  const apps = await prisma.application.findMany({ where: { rulePackVersionId: previous.id, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
  let movedItems = 0;
  for (const { id } of apps) {
    movedItems += await prisma.$transaction(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({ where: { id }, include: { deadlineItems: { where: { status: { in: ['OPEN', 'PAUSED'] } } } } });
      if (app.rulePackVersionId !== previous.id) return 0;
      await tx.application.update({ where: { id }, data: { rulePackVersionId: published.id } });
      const moves = plannedMoves(diff, app.deadlineItems);
      for (const m of moves) {
        const it = app.deadlineItems.find((x) => x.id.toString() === m.itemId)!;
        await tx.deadlineItem.update({
          where: { id: it.id },
          data: it.status === 'PAUSED' ? { pausedRemaining: m.newPausedRemaining, totalDays: (it.totalDays ?? 0) + m.addDays } : { dueDate: new Date(`${m.newDue}T00:00:00Z`), totalDays: (it.totalDays ?? 0) + m.addDays },
        });
      }
      const from = `${(previous.content as unknown as PackContent).meta.cycle} v${previous.version}`;
      const to = `${(published.content as unknown as PackContent).meta.cycle} v${published.version}`;
      await appendAudit(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'RULES_REBASED',
        applicationId: id,
        reason: `${amendment.title} applies to live cases`,
        meta: { from: previous.id, to: published.id, fromLabel: from, toLabel: to, changes, moved: moves },
      });
      const holders = app.holderType === 'USER' && app.holderUserId ? [app.holderUserId] : (await tx.user.findMany({ where: { institutionId: app.institutionId, role: 'COLLEGE', active: true }, select: { id: true } })).map((u) => u.id);
      await notify(tx, holders, {
        applicationId: id,
        kind: 'RULES_REBASED',
        message: `${app.applicationNo} now follows rules ${to} (${amendment.title}).${moves.length ? ` ${moves.length} deadline${moves.length === 1 ? '' : 's'} moved later.` : ''}`,
      });
      return moves.length;
    }, TX_OPTIONS);
  }
  return { rebased: apps.length, movedItems };
}
