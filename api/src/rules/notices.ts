// "What changed this cycle" (add-on A9): published amendments of the current cycles and their windows. Public data.
import { prisma } from '../lib/db.js';
import { isoDate } from '../lib/dates.js';
import { diffPacks } from './diff.js';
import { allCurrent } from './service.js';
import type { PackContent } from './schema.js';
import { APP_TYPES } from './schema.js';

/** Application types a change touches, from the diff against the previous version. */
function affectedTypes(prev: PackContent | null, cur: PackContent): string[] {
  if (!prev) return [...APP_TYPES];
  const specific = new Set<string>();
  let general = false;
  for (const d of diffPacks(prev, cur)) {
    if (d.section === 'documents' || d.section === 'applicationTypes' || d.section === 'fees') {
      // Keys name the types: "KIND@TYPE+TYPE" for documents and fees, the type itself for applicationTypes.
      const key = d.path.split('.')[1] ?? '';
      for (const t of APP_TYPES) if (key === t || key.split('@').pop()!.split('+').includes(t) || key.split('@')[0]!.split('+').includes(t)) specific.add(t);
    } else if (['programmes', 'norms', 'schedule', 'timelines', 'formCheckRules', 'letters'].includes(d.section)) general = true;
  }
  // Specific document or type changes name their types; otherwise a general change affects every type.
  return specific.size ? [...specific] : general ? [...APP_TYPES] : [];
}

export async function publicNotices() {
  const current = await allCurrent();
  const cycleIds = current.map((r) => r.pinned.cycleId);
  const versions = await prisma.rulePackVersion.findMany({
    where: { cycleId: { in: cycleIds }, status: { in: ['PUBLISHED', 'SUPERSEDED'] } },
    include: { amendment: true, cycle: true },
    orderBy: [{ publishedAt: 'desc' }],
  });
  const byId = new Map(versions.map((v) => [v.id, v]));
  const typeLabel = new Map(current[0]?.content.applicationTypes.map((t) => [t.type, t.label]) ?? []);
  const notices = versions
    .filter((v) => v.amendment)
    .map((v) => {
      const content = v.content as unknown as PackContent;
      const parent = v.parentVersionId ? byId.get(v.parentVersionId) : undefined;
      const a = v.amendment!;
      const college = content.changeNotice.filter((n) => n.audience === 'COLLEGE' && (!n.amendmentId || n.amendmentId === a.id));
      return {
        versionId: v.id,
        cycle: v.cycle.code,
        version: v.version,
        current: v.status === 'PUBLISHED',
        kind: a.kind,
        refNo: a.refNo,
        issuedOn: isoDate(a.issuedOn),
        effectiveFrom: isoDate(v.effectiveFrom),
        publishedAt: v.publishedAt?.toISOString() ?? null,
        title: a.title,
        summary: college.find((n) => n.amendmentId === a.id)?.summary ?? a.summary,
        affectedTypes: affectedTypes(parent ? (parent.content as unknown as PackContent) : null, content).map((t) => typeLabel.get(t as never) ?? t),
      };
    });
  return { notices, schedule: await publicSchedule() };
}

export async function publicSchedule() {
  const current = await allCurrent();
  return current.flatMap((r) =>
    r.schedule.map((s) => ({
      cycle: r.pinned.cycleCode,
      version: r.pinned.version,
      id: s.id,
      label: s.label,
      kind: s.kind,
      from: s.from,
      to: s.to,
      scope: s.appliesTo === true ? 'All programmes and institutions' : scopeWords(s.appliesTo, r.content.programmes),
    })),
  );
}

/** Plain words for a schedule scope, for the common "programme.code in [...]" form. */
function scopeWords(expr: unknown, programmes: PackContent['programmes']): string {
  const e = expr as { in?: [{ var?: string }, unknown[]] };
  if (e?.in && e.in[0]?.var === 'programme.code' && Array.isArray(e.in[1])) {
    return `Only ${e.in[1].map((c) => programmes.find((p) => p.code === c)?.label ?? String(c)).join(', ')}`;
  }
  return 'Some programmes or institutions (see the rules)';
}
