// Writes shared/formcheck-samples.json: 50 sample drafts with the rule hits the Node evaluator produces.
// The Python test suite checks that its rules give the same hits (fallback parity).
import fs from 'node:fs';
import path from 'node:path';
import type { AppType } from '@prisma/client';
import { computeFeatures, type FormValues } from '../src/formcheck/features.js';
import { baseRules } from '../src/rules/migrate-from-json.js';
import { ruleHits } from '../src/formcheck/rules.js';
const sharedDir = () => process.env.SHARED_DIR ?? path.resolve(process.cwd(), '../shared');

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function buildSamples() {
  const rules = await baseRules();
  const norms = rules.norms();
  const r = rng(50);
  const today = '2026-06-01';
  const types: AppType[] = ['NEW_INSTITUTION', 'CHANGE_OF_SITE', 'EXTENSION', 'INTAKE_INCREASE'];
  const out = [];
  for (let i = 0; i < 50; i++) {
    const type = types[i % types.length]!;
    const required = rules.criticalKinds(type);
    const courses = Array.from({ length: 1 + (i % 3) }, (_, k) => ({ name: `Course ${k + 1}`, intake: [30, 60, 120, 180][(i + k) % 4]!, years: 4 }));
    const studentYears = courses.reduce((s, c) => s + c.intake * c.years, 0);
    const land = Math.round(8000 + r() * 40000);
    const values: FormValues = {
      landAreaSqm: land,
      builtupAreaSqm: Math.round(land * (i % 7 === 1 ? 1.3 : 0.2 + r() * 0.5)),
      courses,
      facultyCount: Math.max(1, Math.round(studentYears / (i % 5 === 2 ? 60 : 15))),
      labCount: Math.round(courses.length * 5),
      leaseExpiry: i % 6 === 3 ? '2026-01-15' : i % 6 === 4 ? '2026-06-01' : '2031-06-01',
      fillSeconds: i % 8 === 5 ? 40 : 1400,
      ...(i % 9 === 7 ? {} : { documents: i % 4 === 3 ? required.slice(0, 1) : required }),
    };
    if (i % 10 === 9) delete values.landAreaSqm;
    if (i % 11 === 8) values.builtupAreaSqm = Math.round(studentYears * 0.3);
    out.push({ type, values, today, requiredDocs: required, expectedRuleHits: ruleHits(computeFeatures(values, today, required), rules.formCheckRules, norms) });
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('formcheck-samples.ts');
if (isMain) {
  const samples = await buildSamples();
  fs.writeFileSync(path.join(sharedDir(), 'formcheck-samples.json'), JSON.stringify(samples, null, 2) + '\n');
  const hits = samples.flatMap((s) => s.expectedRuleHits);
  console.log(`wrote ${samples.length} samples; rule hits: ${['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => `${id} ${hits.filter((h) => h === id).length}`).join(', ')}`);
}
