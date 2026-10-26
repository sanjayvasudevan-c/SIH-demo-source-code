// proposeCommittee (section 6.2): available members, no conflict, lowest 60-day visit load. Coverage and
// independence rules are phase 5.
import { prisma, type Db } from '../lib/db.js';
import { addDays, formatDate, toDateOnly } from '../lib/dates.js';

export interface CommitteeProposal {
  userId: string;
  name: string;
  load: number;
  visits: number;
  reason: string;
}

export async function proposeCommittee(applicationId: string, visitDate: Date, db: Db = prisma): Promise<{ proposal: CommitteeProposal[]; unavailable: number; conflicted: number }> {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, select: { institutionId: true } });
  const date = toDateOnly(visitDate);
  const members = await db.user.findMany({ where: { role: 'COMMITTEE', active: true }, include: { profile: true }, orderBy: { id: 'asc' } });
  const ids = members.map((m) => m.id);
  const [avail, visits] = await Promise.all([
    db.officerAvailability.findMany({ where: { userId: { in: ids }, startsOn: { lte: date }, endsOn: { gte: date } } }),
    db.evcVisit.findMany({
      where: { applicationId: { not: applicationId }, status: { in: ['SCHEDULED', 'REPORTED'] }, visitDate: { gte: addDays(date, -60), lte: addDays(date, 60) } },
      select: { memberIds: true, mode: true },
    }),
  ]);
  const away = new Set(avail.map((a) => a.userId));
  let unavailable = 0;
  let conflicted = 0;
  const rows: CommitteeProposal[] = [];
  for (const m of members) {
    if (away.has(m.id)) {
      unavailable++;
      continue;
    }
    const barred = (m.profile?.barredInstitutionIds as string[] | undefined) ?? [];
    if (barred.includes(app.institutionId)) {
      conflicted++;
      continue;
    }
    let load = 0;
    let count = 0;
    for (const v of visits) {
      if (((v.memberIds as string[]) ?? []).includes(m.id)) {
        count++;
        load += v.mode === 'PHYSICAL' ? 2 : 1;
      }
    }
    rows.push({
      userId: m.id,
      name: m.name,
      load,
      visits: count,
      reason: `Available on ${formatDate(date)}; ${count} ${count === 1 ? 'visit' : 'visits'} within 60 days (load ${load.toFixed(1)}); no conflict with the institution.`,
    });
  }
  rows.sort((a, b) => a.load - b.load || (a.userId < b.userId ? -1 : 1));
  return { proposal: rows.slice(0, 3), unavailable, conflicted };
}
