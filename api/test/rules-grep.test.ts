import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = /(?<![\w-])rules\.json|assignment-policy\.json|formcheck-rules\.json/;
// Seed input only: the seed and the JSON migration may read them.
const ALLOWED = [/^api\/prisma\/seed/, /^api\/src\/rules\/migrate/];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', '__pycache__', 'dist'].includes(e.name) ? [] : walk(p);
    return /\.(ts|tsx|py)$/.test(e.name) ? [p] : [];
  });
}

describe('rules come from the rules service', () => {
  it('no runtime code reads shared rules.json, assignment-policy.json or formcheck-rules.json', () => {
    const offenders: string[] = [];
    for (const root of ['api/src', 'api/scripts', 'web/src', 'formcheck/app']) {
      for (const file of walk(path.join(repo, root))) {
        const rel = path.relative(repo, file).split(path.sep).join('/');
        if (ALLOWED.some((a) => a.test(rel))) continue;
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => FILES.test(line) && offenders.push(`${rel}:${i + 1}`));
      }
    }
    expect(offenders).toEqual([]);
  });
});
