import type { Tx } from '../lib/db.js';
import { advisoryXactLock } from '../lib/locks.js';
import { now } from '../lib/clock.js';

/** S-2026-0001 / W-2026-0001: region letter, year, running number. */
export async function nextApplicationNo(tx: Tx, regionId: string): Promise<string> {
  await advisoryXactLock(tx, `appno:${regionId}`);
  const region = await tx.region.findUniqueOrThrow({ where: { id: regionId } });
  const year = now().getUTCFullYear();
  const prefix = `${region.code.charAt(0)}-${year}-`;
  const last = await tx.application.findFirst({ where: { applicationNo: { startsWith: prefix } }, orderBy: { applicationNo: 'desc' } });
  const n = last ? Number(last.applicationNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}
