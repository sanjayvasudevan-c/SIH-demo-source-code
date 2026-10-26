// Node evaluation of the case's form check rules (the pack's formCheckRules, expressions over features and norms).
// Used when the form check service is down; the Python service evaluates the same rules with expr.py.
import { evaluate, truthy, getPath, type Expr } from '../rules/expr.js';
import type { PackContent } from '../rules/schema.js';
import { FIELD_LABEL, type Features } from './features.js';

export interface Warning {
  source: 'rule' | 'model';
  ruleId?: string;
  field: string;
  value: number | null;
  typical?: number | null;
  z?: number | null;
  message: string;
  severity: 'HIGH' | 'MEDIUM';
}

export type FormCheckRules = PackContent['formCheckRules'];

const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export function evaluateRules(f: Features, rules: FormCheckRules, norms: Record<string, number>): Warning[] {
  const data = { features: f, norms };
  const out: Warning[] = [];
  for (const r of rules) {
    if (!truthy(evaluate(r.when as Expr, data))) continue;
    const raw = r.valueVar ? getPath(data, r.valueVar) : null;
    const v = typeof raw === 'number' ? raw : null;
    const shown = v === null ? null : r.valueAsPercent ? Math.round(v * 100) : round(v);
    const field = r.fields[0]!;
    out.push({ source: 'rule', ruleId: r.id, field: FIELD_LABEL[field] ?? field, value: shown, message: r.message, severity: r.severity });
  }
  return out;
}

export function ruleHits(f: Features, rules: FormCheckRules, norms: Record<string, number>): string[] {
  return evaluateRules(f, rules, norms).map((w) => w.ruleId!);
}
