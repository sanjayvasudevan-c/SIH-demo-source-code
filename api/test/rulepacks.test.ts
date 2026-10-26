import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { appendAudit } from '../src/lib/audit.js';
import { approveVersion, createDraft, publishVersion, rejectVersion, saveDraft, submitVersion } from '../src/rules/versions.js';
import { forNewFiling, forVersion } from '../src/rules/service.js';
import type { PackContent } from '../src/rules/schema.js';
import { resetDb, userByEmail } from './helpers.js';
import * as clock from '../src/lib/clock.js';
import { parseDateOnly } from '../src/lib/dates.js';

const amendment = { kind: 'CIRCULAR' as const, refNo: 'TEST/1', issuedOn: '2026-11-01', title: 'Test circular', summary: 'A test change.' };

async function cycle(code: string) {
  return prisma.approvalCycle.findUniqueOrThrow({ where: { code }, include: { versions: { orderBy: { version: 'asc' } } } });
}

describe('rule packs: seed, guard and maker-checker', () => {
  beforeEach(resetDb);

  it('seeds 2026-27 v1–v3 and 2027-28 v1 with one PUBLISHED version per cycle', async () => {
    const a = await cycle('2026-27');
    expect(a.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['1:SUPERSEDED', '2:SUPERSEDED', '3:PUBLISHED']);
    const b = await cycle('2027-28');
    expect(b.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['1:PUBLISHED']);
    const v2 = await forVersion(a.versions[1]!.id);
    expect(v2.criticalKinds('EXTENSION')).toContain('NIL_DEFICIENCY_DISCLOSURE');
    expect(v2.norm('foreignSupernumeraryPct', { level: 'PG', discipline: 'ENGINEERING' })).toBe(25);
    expect(v2.norm('foreignSupernumeraryPct', { level: 'UG', discipline: 'ENGINEERING' })).toBe(15);
  });

  it('refuses content changes, illegal transitions and deletes outside DRAFT in the database itself', async () => {
    const v = (await cycle('2026-27')).versions[0]!;
    await expect(prisma.rulePackVersion.update({ where: { id: v.id }, data: { content: {} } })).rejects.toThrow(/content cannot change/);
    await expect(prisma.rulePackVersion.update({ where: { id: v.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/cannot move/);
    await expect(prisma.rulePackVersion.delete({ where: { id: v.id } })).rejects.toThrow(/only drafts/);
    const b = (await cycle('2027-28')).versions[0]!;
    await expect(prisma.$executeRawUnsafe(`UPDATE "RulePackVersion" SET status = 'PUBLISHED' WHERE id = $1`, v.id)).rejects.toThrow();
    expect(b.status).toBe('PUBLISHED');
  });

  it('keeps the approver separate from the maker and anyone who edited', async () => {
    const editor = await userByEmail('rules.editor@demo.in');
    const approver = await userByEmail('rules.approver@demo.in');
    const parent = (await cycle('2027-28')).versions[0]!;
    const d = await createDraft(editor, { parentVersionId: parent.id, amendment, effectiveFrom: '2026-11-02' });
    const content = d.content as unknown as PackContent;
    content.timelines.SCRUTINY = 20;
    expect((await saveDraft(editor, d.id, { content, paths: ['timelines.SCRUTINY'] })).errors).toEqual([]);
    await expect(approveVersion(approver, d.id)).rejects.toThrow(/not in review/);
    await submitVersion(editor, d.id);
    await expect(saveDraft(editor, d.id, { content })).rejects.toThrow(/cannot change/);
    await expect(approveVersion(editor, d.id)).rejects.toThrow(/approver role/);

    // An approver who edited the version may not check it.
    await prisma.$transaction((tx) => appendAudit(tx, { chainKey: 'rules', actorId: approver.id, actorRole: 'RULE_APPROVER', action: 'RULES_EDITED', meta: { versionId: d.id } }));
    await expect(approveVersion(approver, d.id)).rejects.toThrow(/edited this version/);
  });

  it('rejects back to the maker, then publishes; the old version is superseded', async () => {
    const editor = await userByEmail('rules.editor@demo.in');
    const approver = await userByEmail('rules.approver@demo.in');
    const parent = (await cycle('2027-28')).versions[0]!;
    const d = await createDraft(editor, { parentVersionId: parent.id, amendment, effectiveFrom: '2026-11-02' });
    await submitVersion(editor, d.id);
    await rejectVersion(approver, d.id, 'Cite the circular clause.');
    const content = d.content as unknown as PackContent;
    content.timelines.SCRUTINY = 20;
    await saveDraft(editor, d.id, { content });
    await submitVersion(editor, d.id);
    await approveVersion(approver, d.id);
    await publishVersion(approver, d.id);
    const c = await cycle('2027-28');
    expect(c.versions.map((v) => v.status)).toEqual(['SUPERSEDED', 'PUBLISHED']);
    const audit = await prisma.auditLog.findMany({ where: { chainKey: 'rules', meta: { path: ['versionId'], equals: d.id } }, orderBy: { id: 'asc' } });
    expect(audit.map((r) => r.action)).toEqual(['RULES_DRAFTED', 'RULES_SUBMITTED', 'RULES_REJECTED', 'RULES_EDITED', 'RULES_SUBMITTED', 'RULES_APPROVED', 'RULES_PUBLISHED']);
  });

  it('refuses invalid content at submit and future publication unless scheduled', async () => {
    const editor = await userByEmail('rules.editor@demo.in');
    const approver = await userByEmail('rules.approver@demo.in');
    const parent = (await cycle('2027-28')).versions[0]!;
    const d = await createDraft(editor, { parentVersionId: parent.id, amendment, effectiveFrom: '2026-12-15' });
    const content = d.content as unknown as PackContent;
    content.assignment.scoreWeights.recent = 0.9;
    expect((await saveDraft(editor, d.id, { content })).errors[0]!.path).toBe('assignment.scoreWeights');
    await expect(submitVersion(editor, d.id)).rejects.toThrow(/Fix the errors/);
    content.assignment.scoreWeights.recent = 0.2;
    await saveDraft(editor, d.id, { content });
    await submitVersion(editor, d.id);
    await approveVersion(approver, d.id);
    await expect(publishVersion(approver, d.id)).rejects.toThrow(/takes effect on 2026-12-15/);
    expect((await publishVersion(approver, d.id, { scheduled: true })).scheduled).toBe(true);
  });

  it('picks the cycle by application window and names the next window otherwise', async () => {
    const r = await forNewFiling(clock.now(), { institution: { isTechnical: true } });
    expect(r.ok && r.cycleCode).toBe('2027-28');
    const before = await forNewFiling(parseDateOnly('2026-08-01'), { institution: { isTechnical: true } });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.message).toMatch(/Applications for 2027–28 open on/);
    const bba = await forNewFiling(parseDateOnly('2026-02-20'), { programmeCode: 'BBA', institution: { isTechnical: true } });
    expect(bba.ok && `${bba.cycleCode} ${bba.window.id}`).toBe('2026-27 window-bba-bca-bms');
    const btech = await forNewFiling(parseDateOnly('2026-02-20'), { programmeCode: 'BTECH', institution: { isTechnical: true } });
    expect(btech.ok).toBe(false);
  });
});
