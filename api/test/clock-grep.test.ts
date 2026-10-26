import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('one source of today', () => {
  it('never calls new Date() or Date.now() outside lib/clock.ts', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      if (file.endsWith(path.join('lib', 'clock.ts'))) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/new Date\(\s*\)|Date\.now\(\s*\)/.test(line)) offenders.push(`${path.relative(srcDir, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
