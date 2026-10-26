// A small, safe JSON-logic subset (add-on A3). Written twice, here and in formcheck/app/expr.py; both must pass
// shared/expr-conformance.json. No string building, no regex, no loops, no eval.
//
// Semantics (identical in Python):
// - {"var": "a.b"} or {"var": ["a.b", default]} reads a whitelisted path; missing → null (or the default).
// - No type coercion: == / != compare type and value; < <= > >= need two numbers, otherwise false.
// - Arithmetic needs numbers, otherwise null; division by zero → null. min / max need numbers, otherwise null.
// - Truthy: anything except false, null, 0, "" and [].
// - in: [needle, array] by strict equality; anything else → false.
// - if: [c1, v1, (c2, v2, …), else?].

export type Expr = null | boolean | number | string | Expr[] | { [op: string]: Expr };
export type Data = Record<string, unknown>;

export const OPERATORS = ['var', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', '!', 'in', 'if', '+', '-', '*', '/', 'min', 'max'] as const;
const OPS = new Set<string>(OPERATORS);
export const MAX_DEPTH = 8;
export const MAX_BYTES = 2048;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function truthy(v: unknown): boolean {
  if (v === false || v === null || v === undefined || v === 0 || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function strictEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => strictEqual(x, b[i]));
  return a === b;
}

export function getPath(data: Data, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (!isObj(cur) || !(part in cur)) return null;
    cur = cur[part];
  }
  return cur === undefined ? null : cur;
}

export function evaluate(expr: Expr, data: Data): unknown {
  if (Array.isArray(expr)) return expr.map((e) => evaluate(e, data));
  if (!isObj(expr)) return expr;
  const keys = Object.keys(expr);
  if (keys.length !== 1) throw new Error('An expression object must have exactly one operator');
  const op = keys[0]!;
  const raw = expr[op] as Expr;
  if (op === 'var') {
    const [path, dflt] = Array.isArray(raw) ? raw : [raw, null];
    const v = getPath(data, String(path));
    return v === null ? (dflt === undefined ? null : dflt) : v;
  }
  const args: Expr[] = Array.isArray(raw) ? raw : [raw];
  switch (op) {
    case 'if': {
      let i = 0;
      for (; i + 1 < args.length; i += 2) if (truthy(evaluate(args[i]!, data))) return evaluate(args[i + 1]!, data);
      return i < args.length ? evaluate(args[i]!, data) : null;
    }
    case 'and': {
      for (const a of args) if (!truthy(evaluate(a, data))) return false;
      return true;
    }
    case 'or': {
      for (const a of args) if (truthy(evaluate(a, data))) return true;
      return false;
    }
  }
  const v = args.map((a) => evaluate(a, data));
  switch (op) {
    case '==':
      return strictEqual(v[0], v[1]);
    case '!=':
      return !strictEqual(v[0], v[1]);
    case '<':
      return isNum(v[0]) && isNum(v[1]) && v[0] < v[1];
    case '<=':
      return isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];
    case '>':
      return isNum(v[0]) && isNum(v[1]) && v[0] > v[1];
    case '>=':
      return isNum(v[0]) && isNum(v[1]) && v[0] >= v[1];
    case '!':
      return !truthy(v[0]);
    case 'in':
      return Array.isArray(v[1]) && v[1].some((x) => strictEqual(x, v[0]));
    case '+':
      return v.every(isNum) ? (v as number[]).reduce((s, x) => s + x, 0) : null;
    case '*':
      return v.every(isNum) ? (v as number[]).reduce((s, x) => s * x, 1) : null;
    case '-':
      if (!v.every(isNum)) return null;
      return v.length === 1 ? -(v[0] as number) : (v[0] as number) - (v[1] as number);
    case '/':
      return isNum(v[0]) && isNum(v[1]) && v[1] !== 0 ? v[0] / v[1] : null;
    case 'min':
      return v.length && v.every(isNum) ? Math.min(...(v as number[])) : null;
    case 'max':
      return v.length && v.every(isNum) ? Math.max(...(v as number[])) : null;
  }
  throw new Error(`Unknown operator ${op}`);
}

export interface ExprError {
  path: string;
  message: string;
}

const ARITY: Record<string, [number, number]> = {
  '==': [2, 2],
  '!=': [2, 2],
  '<': [2, 2],
  '<=': [2, 2],
  '>': [2, 2],
  '>=': [2, 2],
  '!': [1, 1],
  in: [2, 2],
  '-': [1, 2],
  '/': [2, 2],
  and: [1, 20],
  or: [1, 20],
  if: [2, 21],
  '+': [1, 20],
  '*': [1, 20],
  min: [1, 20],
  max: [1, 20],
};

/** Validate structure, size, depth and variables. `knownVar` decides whether a path is whitelisted. */
export function validateExpr(expr: unknown, knownVar: (path: string) => boolean, at = ''): ExprError[] {
  const errors: ExprError[] = [];
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(expr ?? null));
  } catch {
    return [{ path: at, message: 'The expression is not valid JSON.' }];
  }
  if (size > MAX_BYTES) errors.push({ path: at, message: `The expression is ${size} bytes; the limit is ${MAX_BYTES}.` });
  const walk = (e: unknown, depth: number, p: string) => {
    if (depth > MAX_DEPTH) {
      errors.push({ path: p, message: `The expression is nested more than ${MAX_DEPTH} levels deep.` });
      return;
    }
    if (Array.isArray(e)) {
      e.forEach((x, i) => walk(x, depth, `${p}[${i}]`));
      return;
    }
    if (!isObj(e)) {
      if (typeof e === 'number' && !Number.isFinite(e)) errors.push({ path: p, message: 'Numbers must be finite.' });
      return;
    }
    const keys = Object.keys(e);
    if (keys.length !== 1) {
      errors.push({ path: p, message: 'An expression object must have exactly one operator.' });
      return;
    }
    const op = keys[0]!;
    if (!OPS.has(op)) {
      errors.push({ path: p, message: `Operator "${op}" is not allowed.` });
      return;
    }
    const raw = e[op];
    if (op === 'var') {
      const path = Array.isArray(raw) ? raw[0] : raw;
      if (typeof path !== 'string' || !path) errors.push({ path: p, message: 'var needs a path.' });
      else if (!knownVar(path)) errors.push({ path: p, message: `Unknown variable "${path}".` });
      return;
    }
    const args = Array.isArray(raw) ? raw : [raw];
    const [lo, hi] = ARITY[op]!;
    if (args.length < lo || args.length > hi) errors.push({ path: p, message: `"${op}" takes ${lo === hi ? lo : `${lo} to ${hi}`} arguments.` });
    args.forEach((a, i) => walk(a, depth + 1, `${p}.${op}[${i}]`));
  };
  walk(expr, 1, at);
  return errors;
}

/** Variables an expression reads (for impact analysis). */
export function varsOf(expr: unknown): string[] {
  const out = new Set<string>();
  const walk = (e: unknown) => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (!isObj(e)) return;
    for (const [op, raw] of Object.entries(e)) {
      if (op === 'var') out.add(String(Array.isArray(raw) ? raw[0] : raw));
      else walk(raw);
    }
  };
  walk(expr);
  return [...out];
}
