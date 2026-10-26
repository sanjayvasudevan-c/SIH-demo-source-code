import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate, validateExpr, type Expr } from '../src/rules/expr.js';

const shared = process.env.SHARED_DIR!;
const conf = JSON.parse(fs.readFileSync(path.join(shared, 'expr-conformance.json'), 'utf8')) as {
  cases: { name: string; expr: Expr; data: Record<string, unknown>; expected: unknown }[];
  invalid: { name: string; expr: unknown; error: string }[];
};
const vars = JSON.parse(fs.readFileSync(path.join(shared, 'expr-vars.json'), 'utf8')) as { vars: Record<string, string>; prefixes: Record<string, string> };
const known = (p: string) => p in vars.vars || Object.keys(vars.prefixes).some((pre) => p.startsWith(pre));

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-12;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

describe('expressions (Node) against shared/expr-conformance.json', () => {
  it('has at least 60 cases', () => expect(conf.cases.length).toBeGreaterThanOrEqual(60));
  for (const c of conf.cases) {
    it(c.name, () => {
      const got = evaluate(c.expr, c.data);
      expect(same(got, c.expected), `${JSON.stringify(got)} vs ${JSON.stringify(c.expected)}`).toBe(true);
    });
  }
  for (const c of conf.invalid) {
    it(`refuses: ${c.name}`, () => {
      const errors = validateExpr(c.expr, known);
      expect(errors.some((e) => e.message.includes(c.error)), JSON.stringify(errors)).toBe(true);
    });
  }
});
