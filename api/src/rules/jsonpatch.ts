// RFC 6902 JSON Patch (add, remove, replace, move, copy, test) on plain JSON, for PATCH /api/rules/versions/:id.
// Pure data manipulation; nothing is executed.
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

export const patchSchema = z
  .array(
    z.object({
      op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
      path: z.string().max(400),
      from: z.string().max(400).optional(),
      value: z.unknown().optional(),
    }),
  )
  .max(500);
export type PatchOp = z.infer<typeof patchSchema>[number];

function tokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw badRequest(`JSON pointer "${pointer}" must start with /`);
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

type Container = Record<string, unknown> | unknown[];

function parentOf(doc: unknown, pointer: string): { parent: Container; key: string } {
  const ts = tokens(pointer);
  if (!ts.length) throw badRequest('The whole document cannot be replaced by a patch.');
  let cur: unknown = doc;
  for (const t of ts.slice(0, -1)) {
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[t];
    else cur = undefined;
    if (cur === undefined) throw badRequest(`Path ${pointer} does not exist.`);
  }
  if (!cur || typeof cur !== 'object') throw badRequest(`Path ${pointer} does not exist.`);
  return { parent: cur as Container, key: ts.at(-1)! };
}

function get(doc: unknown, pointer: string): unknown {
  let cur: unknown = doc;
  for (const t of tokens(pointer)) {
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[t];
    else return undefined;
  }
  return cur;
}

function index(arr: unknown[], key: string, forAdd: boolean): number {
  if (forAdd && key === '-') return arr.length;
  const i = Number(key);
  if (!Number.isInteger(i) || i < 0 || i > arr.length - (forAdd ? 0 : 1)) throw badRequest(`Array index ${key} is out of range.`);
  return i;
}

function add(doc: unknown, pointer: string, value: unknown) {
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) parent.splice(index(parent, key, true), 0, value);
  else parent[key] = value;
}

function remove(doc: unknown, pointer: string): unknown {
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) return parent.splice(index(parent, key, false), 1)[0];
  if (!(key in parent)) throw badRequest(`Path ${pointer} does not exist.`);
  const v = parent[key];
  delete parent[key];
  return v;
}

/** Apply a patch to a deep copy; returns the new document and the changed paths. */
export function applyPatch<T>(doc: T, ops: PatchOp[]): { doc: T; paths: string[] } {
  const out = JSON.parse(JSON.stringify(doc)) as T;
  for (const op of ops) {
    switch (op.op) {
      case 'add':
        add(out, op.path, op.value);
        break;
      case 'remove':
        remove(out, op.path);
        break;
      case 'replace':
        remove(out, op.path);
        add(out, op.path, op.value);
        break;
      case 'move': {
        if (op.from === undefined) throw badRequest('move needs "from".');
        add(out, op.path, remove(out, op.from));
        break;
      }
      case 'copy':
        if (op.from === undefined) throw badRequest('copy needs "from".');
        add(out, op.path, JSON.parse(JSON.stringify(get(out, op.from) ?? null)));
        break;
      case 'test':
        if (JSON.stringify(get(out, op.path)) !== JSON.stringify(op.value)) throw badRequest(`Test failed at ${op.path}.`);
        break;
    }
  }
  return { doc: out, paths: [...new Set(ops.filter((o) => o.op !== 'test').map((o) => o.path))] };
}
