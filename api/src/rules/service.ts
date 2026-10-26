// Rules service (add-on A6): the only way runtime code reads rules.
// - Versions are immutable once out of DRAFT, so the per-process cache is keyed by version id and never goes stale.
// - The "current published version per cycle" map is refreshed on publish: in-process directly, across processes
//   through Postgres NOTIFY rules_published (sent by the guard trigger), with a 30-second poll as the fallback.
import pg from 'pg';
import type { RulePackVersion } from '@prisma/client';
import { prisma, type Db } from '../lib/db.js';
import { isoDate, parseDateOnly, formatDate } from '../lib/dates.js';
import { loadHolidays } from '../lib/workdays.js';
import { ResolvedRules, mergeSections, type EvalContext, type VersionRef } from './resolved.js';
import type { PackContent } from './schema.js';

interface CachedVersion {
  ref: VersionRef;
  status: RulePackVersion['status'];
  content: PackContent;
}

const versions = new Map<string, CachedVersion>();
let published = new Map<string, string>(); // cycleId → versionId
let cycles = new Map<string, { id: string; code: string; label: string }>(); // by id
let loadedAt = 0;
const POLL_MS = Number(process.env.RULES_POLL_MS ?? 30_000);

function toCached(v: RulePackVersion & { cycle: { code: string } }): CachedVersion {
  return {
    ref: { id: v.id, cycleId: v.cycleId, cycleCode: v.cycle.code, version: v.version, effectiveFrom: isoDate(v.effectiveFrom), contentHash: v.contentHash },
    status: v.status,
    content: v.content as unknown as PackContent,
  };
}

/** A version by id. Drafts are never cached (their content can still change). */
export async function getVersion(id: string, db: Db = prisma): Promise<CachedVersion> {
  const hit = versions.get(id);
  if (hit) return hit;
  const row = await db.rulePackVersion.findUniqueOrThrow({ where: { id }, include: { cycle: { select: { code: true } } } });
  const c = toCached(row);
  if (row.status !== 'DRAFT' && row.status !== 'REJECTED') versions.set(id, c);
  return c;
}

/** Re-read the cycles and the published version of each. */
export async function refreshPublished(db: Db = prisma): Promise<void> {
  const [cs, pubs] = await Promise.all([
    db.approvalCycle.findMany({ select: { id: true, code: true, label: true } }),
    db.rulePackVersion.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, cycleId: true } }),
  ]);
  cycles = new Map(cs.map((c) => [c.id, c]));
  published = new Map(pubs.map((p) => [p.cycleId, p.id]));
  loadedAt = performance.now();
}

async function ensureFresh(db: Db): Promise<void> {
  if (performance.now() - loadedAt > POLL_MS || cycles.size === 0) await refreshPublished(db);
}

export async function listCycles(db: Db = prisma) {
  await ensureFresh(db);
  return [...cycles.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export async function cycleByCode(code: string, db: Db = prisma) {
  await ensureFresh(db);
  return [...cycles.values()].find((c) => c.code === code) ?? null;
}

/** The current published version of a cycle. */
export async function currentPublished(cycleId: string, db: Db = prisma): Promise<CachedVersion> {
  await ensureFresh(db);
  let id = published.get(cycleId);
  if (!id) {
    await refreshPublished(db);
    id = published.get(cycleId);
  }
  if (!id) throw new Error(`Cycle ${cycleId} has no published rules`);
  try {
    return await getVersion(id, db);
  } catch (e) {
    // The database was recreated under us (demo reset from the command line): forget the cache and look again.
    if ((e as { code?: string }).code !== 'P2025') throw e;
    clearRulesCache();
    await refreshPublished(db);
    const again = published.get(cycleId);
    if (!again) throw new Error(`Cycle ${cycleId} has no published rules`);
    return getVersion(again, db);
  }
}

/** Rules for a case: pinned sections from its version, operational sections from its cycle's published version. */
export async function forApplication(app: { cycleId: string; rulePackVersionId: string }, db: Db = prisma): Promise<ResolvedRules> {
  const [pinned, current] = await Promise.all([getVersion(app.rulePackVersionId, db), currentPublished(app.cycleId, db)]);
  return new ResolvedRules(pinned.ref, current.ref, mergeSections(pinned.content, current.content));
}

/** Rules of one version on its own (editors, previews, impact): operational sections from the same version. */
export async function forVersion(id: string, db: Db = prisma): Promise<ResolvedRules> {
  const v = await getVersion(id, db);
  return new ResolvedRules(v.ref, v.ref, v.content);
}

/** Rules of a cycle's current published version. */
export async function forCycle(cycleId: string, db: Db = prisma): Promise<ResolvedRules> {
  const v = await currentPublished(cycleId, db);
  return new ResolvedRules(v.ref, v.ref, v.content);
}

/** Every cycle's current published rules, newest cycle first. */
export async function allCurrent(db: Db = prisma): Promise<ResolvedRules[]> {
  const cs = await listCycles(db);
  const out: ResolvedRules[] = [];
  for (const c of [...cs].reverse()) {
    if (published.has(c.id)) out.push(await forCycle(c.id, db));
  }
  return out;
}

export type FilingWindow = { id: string; label: string; kind: string; from: string; to: string };
export type FilingResult =
  | { ok: true; cycleId: string; cycleCode: string; rules: ResolvedRules; window: FilingWindow; lateFeeInr: number | null; ignoredSchedule?: boolean }
  | { ok: false; message: string };

type FilingFacts = Omit<EvalContext, 'programme'> & { programmeCode?: string | null };

const contains = (w: { from: string; to: string }, day: string) => w.from <= day && day <= w.to;

/**
 * The cycle and published version a filing on `date` falls under: the cycle whose APPLICATION_WINDOW (with
 * appliesTo true for this programme and institution) contains the date. A LATE_FEE_WINDOW also allows filing,
 * with the late fee shown. Otherwise a refusal naming the next window.
 */
export async function forNewFiling(date: Date, facts: FilingFacts, opts: { ignoreSchedule?: boolean } = {}, db: Db = prisma): Promise<FilingResult> {
  const day = isoDate(date);
  const all = await allCurrent(db);
  const ctxFor = (r: ResolvedRules): EvalContext => ({ ...facts, programme: r.programme(facts.programmeCode ?? null) });
  const applies = (r: ResolvedRules, kind: string) => r.schedule.filter((s) => s.kind === kind && r.test(s.appliesTo, ctxFor(r)));

  for (const kind of ['APPLICATION_WINDOW', 'LATE_FEE_WINDOW'] as const) {
    for (const r of all) {
      const w = applies(r, kind).find((s) => contains(s, day));
      if (!w) continue;
      const fee = kind === 'LATE_FEE_WINDOW' ? lateFee(r, facts.application?.type) : null;
      return { ok: true, cycleId: r.pinned.cycleId, cycleCode: r.pinned.cycleCode, rules: r, window: windowOf(w), lateFeeInr: fee };
    }
  }
  if (opts.ignoreSchedule && all.length) {
    const r = all[0]!;
    const w = r.schedule.find((s) => s.kind === 'APPLICATION_WINDOW');
    return { ok: true, cycleId: r.pinned.cycleId, cycleCode: r.pinned.cycleCode, rules: r, window: w ? windowOf(w) : { id: '', label: 'No window', kind: 'APPLICATION_WINDOW', from: day, to: day }, lateFeeInr: null, ignoredSchedule: true };
  }
  const next = all
    .flatMap((r) => applies(r, 'APPLICATION_WINDOW').map((w) => ({ r, w })))
    .filter(({ w }) => w.from > day)
    .sort((a, b) => a.w.from.localeCompare(b.w.from))[0];
  if (next) return { ok: false, message: `Applications for ${next.r.pinned.cycleCode.replace('-', '–')} open on ${formatDate(parseDateOnly(next.w.from))}.` };
  return { ok: false, message: 'No application window is open for this programme and institution.' };
}

function windowOf(w: PackContent['schedule'][number]): FilingWindow {
  return { id: w.id, label: w.label, kind: w.kind, from: w.from, to: w.to };
}

function lateFee(r: ResolvedRules, type: string | undefined): number | null {
  const f = r.content.fees.find((x) => type && x.appliesTo.includes(type as never));
  return f?.lateFeeInr ?? null;
}

// ---------------------------------------------------------------- publish notifications

/** Called in-process after a publish commits, and on NOTIFY from another process. */
export async function onPublished(db: Db = prisma): Promise<void> {
  await refreshPublished(db);
  await loadHolidays(db);
}

/** Holiday table = the union of the calendars of every current published version. Runs inside the publish transaction. */
export async function syncHolidays(tx: Db, publishedContents: PackContent[]): Promise<void> {
  const byDate = new Map<string, string>();
  for (const c of publishedContents) for (const h of c.calendar.holidays) if (!byDate.has(h.date)) byDate.set(h.date, h.name);
  await tx.holiday.deleteMany({});
  if (byDate.size) await tx.holiday.createMany({ data: [...byDate].map(([date, name]) => ({ date: parseDateOnly(date), name })) });
}

let listener: pg.Client | null = null;
let poll: NodeJS.Timeout | null = null;

/** API and scheduler: LISTEN rules_published on a dedicated connection, plus the 30-second poll. */
export async function startRulesListener(url = process.env.DATABASE_URL): Promise<void> {
  await refreshPublished();
  poll = setInterval(() => {
    void onPublished().catch((e) => console.error('[rules] poll failed', (e as Error).message));
    if (!listener && url) void connectListener(url);
  }, POLL_MS);
  poll.unref();
  if (url) await connectListener(url);
}

async function connectListener(url: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  c.on('notification', () => void onPublished().catch((e) => console.error('[rules] refresh failed', (e as Error).message)));
  c.on('error', (e) => {
    console.error('[rules] listener lost; reconnecting', e.message);
    if (listener !== c) return;
    listener = null;
    // The usual cause is a demo reset dropping the database: cached version ids may no longer exist, so forget
    // them now rather than serving them until the next poll.
    clearRulesCache();
    if (poll) setTimeout(() => void (listener ? undefined : connectListener(url)), 1000).unref();
  });
  try {
    await c.connect();
    await c.query('LISTEN rules_published');
    listener = c;
    await refreshPublished();
  } catch (e) {
    console.error('[rules] LISTEN unavailable; using the 30 s poll', (e as Error).message);
    await c.end().catch(() => undefined);
  }
}

export async function stopRulesListener(): Promise<void> {
  if (poll) clearInterval(poll);
  poll = null;
  await listener?.end().catch(() => undefined);
  listener = null;
}

/** Tests and demo reset: forget everything. */
export function clearRulesCache(): void {
  versions.clear();
  published = new Map();
  cycles = new Map();
  loadedAt = 0;
}

/** Rules for a case by id (or a row that already carries its pin). */
export async function rulesForApp(appOrId: string | { cycleId: string; rulePackVersionId: string }, db: Db = prisma): Promise<ResolvedRules> {
  const app = typeof appOrId === 'string' ? await db.application.findUniqueOrThrow({ where: { id: appOrId }, select: { cycleId: true, rulePackVersionId: true } }) : appOrId;
  return forApplication(app, db);
}

/** Operational rules not tied to one case (workload report, team views): the newest cycle's published version. */
export async function newestRules(db: Db = prisma): Promise<ResolvedRules> {
  const all = await allCurrent(db);
  if (!all.length) throw new Error('No published rules');
  return all[0]!;
}

/** Type labels for a list of cases, each from its pinned version. */
export async function typeLabels(apps: { id: string; type: string; cycleId: string; rulePackVersionId: string }[], db: Db = prisma): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const a of apps) {
    const r = await forApplication(a, db);
    out.set(a.id, r.hasType(a.type) ? r.type(a.type as never).label : a.type);
  }
  return out;
}
