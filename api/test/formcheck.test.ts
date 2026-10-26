import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AppType } from '@prisma/client';
import { computeFeatures, type FormValues } from '../src/formcheck/features.js';
import { ruleHits } from '../src/formcheck/rules.js';
import { forVersion } from '../src/rules/service.js';
import { prisma } from '../src/lib/db.js';

const sharedDir = () => process.env.SHARED_DIR!;

describe('form check rules (Node)', () => {
  it('match the expected rule hits in shared/formcheck-samples.json (parity with Python), using pack rules', async () => {
    const v1 = await prisma.rulePackVersion.findFirstOrThrow({ where: { cycle: { code: '2026-27' }, version: 1 } });
    const pack = await forVersion(v1.id);
    const samples = JSON.parse(fs.readFileSync(path.join(sharedDir(), 'formcheck-samples.json'), 'utf8')) as {
      type: AppType;
      values: FormValues;
      today: string;
      requiredDocs: string[];
      expectedRuleHits: string[];
    }[];
    expect(samples).toHaveLength(50);
    for (const s of samples) expect(ruleHits(computeFeatures(s.values, s.today, s.requiredDocs), pack.formCheckRules, pack.norms())).toEqual(s.expectedRuleHits);
    const all = new Set(samples.flatMap((s) => s.expectedRuleHits));
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5']) expect(all.has(id), id).toBe(true);
  });
});
