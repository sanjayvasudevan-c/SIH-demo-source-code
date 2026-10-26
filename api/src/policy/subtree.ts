import { prisma, type Db } from '../lib/db.js';

/** Every user reachable downward through reportsToId (excluding the user). */
export async function getSubtreeUserIds(userId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE t AS (
      SELECT id FROM "User" WHERE "reportsToId" = ${userId}
      UNION
      SELECT u.id FROM "User" u JOIN t ON u."reportsToId" = t.id
    )
    SELECT id FROM t`;
  return rows.map((r) => r.id);
}

/** Walk reportsTo upward n steps; null when the chain ends first. */
export async function managerAtLevel(userId: string, n: number, db: Db = prisma): Promise<string | null> {
  let cur: string | null = userId;
  for (let i = 0; i < n && cur; i++) {
    const u: { reportsToId: string | null } | null = await db.user.findUnique({
      where: { id: cur },
      select: { reportsToId: true },
    });
    cur = u?.reportsToId ?? null;
  }
  return cur;
}

export async function isInSubtree(managerId: string, userId: string, db: Db = prisma): Promise<boolean> {
  return (await getSubtreeUserIds(managerId, db)).includes(userId);
}

export async function regionHod(regionId: string, db: Db = prisma): Promise<string | null> {
  const u = await db.user.findFirst({ where: { role: 'HOD', regionId, active: true }, orderBy: { id: 'asc' } });
  return u?.id ?? null;
}

export async function regionAuthority(regionId: string, db: Db = prisma): Promise<string | null> {
  const u = await db.user.findFirst({ where: { role: 'AUTHORITY', regionId, active: true }, orderBy: { id: 'asc' } });
  return u?.id ?? null;
}
