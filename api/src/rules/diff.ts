// Structural diff between two rule pack versions, with each change classified as relaxing, tightening or neutral
// (add-on A4). Keyed arrays are matched by their key, so a reordered list is not a change.
import type { PackContent } from './schema.js';
import { canonicalJSON } from '../lib/audit.js';
import { PINNED_SECTIONS } from './schema.js';

export type Classification = 'relaxing' | 'tightening' | 'neutral';

export interface DiffEntry {
  section: string;
  path: string;
  op: 'add' | 'remove' | 'change';
  old: unknown;
  new: unknown;
  source: unknown;
  classification: Classification;
  /** Plain words: what changed and why it is classed so. */
  reason: string;
}

/** Proves that a changed condition only widens (no open case or seeded institution goes from true to false). */
export type WideningProof = (kind: 'programme' | 'eligibility' | 'schedule', key: string, oldExpr: unknown, newExpr: unknown) => boolean;

type Item = Record<string, unknown>;

const KEYS: Record<string, (x: Item) => string> = {
  programmes: (x) => String(x.code),
  applicationTypes: (x) => String(x.type),
  documents: (x) => `${x.kind}@${[...(x.appliesTo as string[])].sort().join('+')}`,
  norms: (x) => {
    const s = (x.scope ?? {}) as { level?: string; discipline?: string };
    return [x.key, s.level, s.discipline].filter(Boolean).join('@');
  },
  formCheckRules: (x) => String(x.id),
  fees: (x) => `${[...(x.appliesTo as string[])].sort().join('+')}${x.programmeLevel ? `@${x.programmeLevel}` : ''}`,
  schedule: (x) => String(x.id),
  committees: (x) => String(x.committee),
  changeNotice: (x) => String(x.title),
};

const same = (a: unknown, b: unknown) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
const isObj = (v: unknown): v is Item => typeof v === 'object' && v !== null && !Array.isArray(v);
const STAGE: Record<string, string> = { SCRUTINY: 'SCRUTINY', SAC_SHC: 'SAC/SHC', DECISION: 'DECISION', EVC_SCHEDULE: 'EVC scheduling', EVC_REPORT: 'EVC report', VERIFICATION: 'verification' };

export function isPinnedSection(section: string): boolean {
  return (PINNED_SECTIONS as readonly string[]).includes(section);
}

export function diffPacks(a: PackContent, b: PackContent, proof?: WideningProof): DiffEntry[] {
  const out: DiffEntry[] = [];
  const push = (e: Omit<DiffEntry, 'classification' | 'reason'>, cls: [Classification, string]) => out.push({ ...e, classification: cls[0], reason: cls[1] });

  for (const section of Object.keys(b) as (keyof PackContent)[]) {
    if (section === 'meta') continue;
    const av = a[section] as unknown;
    const bv = b[section] as unknown;
    if (same(av, bv)) continue;
    const keyOf = KEYS[section];
    if (keyOf && Array.isArray(av) && Array.isArray(bv)) {
      const am = new Map((av as Item[]).map((x) => [keyOf(x), x]));
      const bm = new Map((bv as Item[]).map((x) => [keyOf(x), x]));
      for (const [k, x] of bm) {
        const old = am.get(k);
        const path = `${section}.${k}`;
        if (!old) {
          push({ section, path, op: 'add', old: null, new: x, source: x.source ?? null }, classifyAdd(section, x));
          continue;
        }
        for (const f of new Set([...Object.keys(old), ...Object.keys(x)])) {
          if (f === 'source' || same(old[f], x[f])) continue;
          push({ section, path: `${path}.${f}`, op: 'change', old: old[f] ?? null, new: x[f] ?? null, source: x.source ?? null }, classifyField(section, k, f, old, x, proof));
        }
      }
      for (const [k, x] of am) {
        if (!bm.has(k)) push({ section, path: `${section}.${k}`, op: 'remove', old: x, new: null, source: x.source ?? null }, classifyRemove(section, x));
      }
      continue;
    }
    if (section === 'calendar') {
      const ah = new Map(a.calendar.holidays.map((h) => [h.date, h.name]));
      const bh = new Map(b.calendar.holidays.map((h) => [h.date, h.name]));
      for (const [d, n] of bh) if (ah.get(d) !== n) push({ section, path: `calendar.holidays.${d}`, op: ah.has(d) ? 'change' : 'add', old: ah.get(d) ?? null, new: n, source: null }, ['neutral', 'Holiday calendar']);
      for (const [d, n] of ah) if (!bh.has(d)) push({ section, path: `calendar.holidays.${d}`, op: 'remove', old: n, new: null, source: null }, ['neutral', 'Holiday calendar']);
      continue;
    }
    // Object sections: leaf paths.
    leafDiff(section, av, bv, section, (path, old, nu) => push({ section, path, op: old === undefined ? 'add' : nu === undefined ? 'remove' : 'change', old: old ?? null, new: nu ?? null, source: null }, classifyLeaf(section, path, old, nu)));
  }
  return out;
}

function leafDiff(section: string, a: unknown, b: unknown, path: string, emit: (path: string, old: unknown, nu: unknown) => void) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) leafDiff(section, a[k], b[k], `${path}.${k}`, emit);
    return;
  }
  emit(path, a, b);
}

function classifyAdd(section: string, x: Item): [Classification, string] {
  switch (section) {
    case 'documents':
      return x.critical ? ['tightening', `Adds the critical document "${x.label}"`] : ['neutral', `Adds the supporting document "${x.label}"`];
    case 'schedule':
      return x.kind === 'APPLICATION_WINDOW' || x.kind === 'LATE_FEE_WINDOW' ? ['relaxing', `Opens "${x.label}" (${x.from} to ${x.to})`] : ['neutral', `Adds "${x.label}"`];
    case 'programmes':
      return ['relaxing', `Adds the programme ${x.label}`];
    case 'applicationTypes':
      return ['relaxing', `Adds the application type ${x.label}`];
    default:
      return ['neutral', `Adds ${section} item ${String(x.label ?? x.key ?? x.id ?? x.title ?? '')}`.trim()];
  }
}

function classifyRemove(section: string, x: Item): [Classification, string] {
  switch (section) {
    case 'documents':
      return ['relaxing', `Removes the document "${x.label}"`];
    case 'schedule':
      return x.kind === 'APPLICATION_WINDOW' || x.kind === 'LATE_FEE_WINDOW' ? ['tightening', `Removes "${x.label}"`] : ['neutral', `Removes "${x.label}"`];
    case 'programmes':
    case 'applicationTypes':
      return ['tightening', `Removes ${x.label}`];
    default:
      return ['neutral', `Removes ${section} item`];
  }
}

function later(a: unknown, b: unknown): number {
  return String(b).localeCompare(String(a));
}

function classifyField(section: string, key: string, f: string, old: Item, x: Item, proof?: WideningProof): [Classification, string] {
  const label = String(x.label ?? key);
  switch (section) {
    case 'documents':
      if (f === 'critical') return x.critical ? ['tightening', `Makes "${label}" critical`] : ['relaxing', `Makes "${label}" supporting instead of critical`];
      if (f === 'hasExpiry') return x.hasExpiry ? ['tightening', `"${label}" now needs an expiry date`] : ['relaxing', `"${label}" no longer needs an expiry date`];
      if (f === 'minValidityYears') return Number(x.minValidityYears ?? 0) < Number(old.minValidityYears ?? 0) ? ['relaxing', `Lowers the minimum validity of "${label}"`] : ['tightening', `Raises the minimum validity of "${label}"`];
      if (f === 'label' || f === 'format') return ['neutral', `Renames or reformats "${label}"`];
      return ['tightening', `Changes when "${label}" is required`];
    case 'norms': {
      if (f === 'value') {
        const down = Number(x.value) < Number(old.value);
        const relax = x.direction === 'MIN' ? down : !down;
        return relax ? ['relaxing', `${down ? 'Lowers' : 'Raises'} the ${x.direction === 'MIN' ? 'minimum' : 'maximum'} "${label}" from ${old.value} to ${x.value}`] : ['tightening', `${down ? 'Lowers' : 'Raises'} the ${x.direction === 'MIN' ? 'minimum' : 'maximum'} "${label}" from ${old.value} to ${x.value}`];
      }
      if (f === 'label' || f === 'unit') return ['neutral', `Relabels "${label}"`];
      return ['tightening', `Changes how "${label}" applies`];
    }
    case 'schedule': {
      if (f === 'to') return later(old.to, x.to) > 0 ? ['relaxing', `Extends "${label}" to ${x.to}`] : ['tightening', `Shortens "${label}" to ${x.to}`];
      if (f === 'from') return later(old.from, x.from) < 0 ? ['relaxing', `Opens "${label}" earlier, on ${x.from}`] : ['tightening', `Opens "${label}" later, on ${x.from}`];
      if (f === 'appliesTo') return proof?.('schedule', key, old.appliesTo, x.appliesTo) ? ['relaxing', `Widens who "${label}" applies to`] : ['tightening', `Changes who "${label}" applies to (not proven to only widen)`];
      return ['neutral', `Changes "${label}"`];
    }
    case 'programmes':
      if (f === 'inPurview') return proof?.('programme', key, old.inPurview, x.inPurview) ? ['relaxing', `Widens the purview of ${label}`] : ['tightening', `Narrows or changes the purview of ${label}`];
      return ['neutral', `Changes ${label}`];
    case 'applicationTypes':
      if (f === 'eligibility') return proof?.('eligibility', key, old.eligibility, x.eligibility) ? ['relaxing', `Widens eligibility for ${label}`] : ['tightening', `Narrows or changes eligibility for ${label}`];
      if (f === 'route') return ['tightening', `Changes the route of ${label}`];
      return ['neutral', `Changes ${label} (${f})`];
    case 'fees':
      if (f === 'amountInr' || f === 'lateFeeInr') return Number(x[f] ?? 0) < Number(old[f] ?? 0) ? ['relaxing', `Lowers a fee`] : ['tightening', `Raises a fee`];
      return ['neutral', 'Changes a fee'];
    default:
      return ['neutral', `Changes ${section} ${key} (${f})`];
  }
}

function classifyLeaf(section: string, path: string, old: unknown, nu: unknown): [Classification, string] {
  if (section === 'timelines' && typeof old === 'number' && typeof nu === 'number') {
    const name = STAGE[path.split('.')[1]!] ?? path;
    return nu > old ? ['relaxing', `Lengthens the ${name} SLA from ${old} to ${nu} working days`] : ['tightening', `Shortens ${name} SLA from ${old} to ${nu} working days`];
  }
  return ['neutral', `Changes ${path}`];
}

// ---------------------------------------------------------------- apply scope

export type ApplyScope = Record<string, 'NEW_CASES' | 'LIVE'>;

/** Diff entries covered by an apply-scope path (the path itself or anything under it). */
export function covered(diff: DiffEntry[], path: string): DiffEntry[] {
  return diff.filter((d) => d.path === path || d.path.startsWith(`${path}.`));
}

/**
 * Checks an amendment's apply scope against its diff: a path marked LIVE must exist and every change under it must
 * be relaxing. Changes to pinned sections are either all live or all new-cases-only, because a case has one pin.
 */
export function checkApplyScope(diff: DiffEntry[], scope: ApplyScope): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const live = Object.entries(scope).filter(([, v]) => v === 'LIVE').map(([p]) => p);
  for (const p of live) {
    const hits = covered(diff, p);
    if (!hits.length) {
      errors.push({ path: p, message: `Nothing changes at ${p}.` });
      continue;
    }
    for (const d of hits.filter((h) => h.classification !== 'relaxing')) {
      errors.push({ path: d.path, message: `${d.reason}; can only apply to new cases.` });
    }
  }
  const pinned = diff.filter((d) => isPinnedSection(d.section));
  const pinnedLive = pinned.filter((d) => live.some((p) => d.path === p || d.path.startsWith(`${p}.`)));
  if (pinnedLive.length && pinnedLive.length !== pinned.length) {
    const rest = pinned.find((d) => !pinnedLive.includes(d))!;
    errors.push({ path: rest.path, message: 'Live changes and new-case changes to pinned sections must be separate amendments: a case can be pinned to only one version.' });
  }
  return errors;
}

/** Any path marked live. */
export function isLiveAmendment(scope: ApplyScope): boolean {
  return Object.values(scope).includes('LIVE');
}

/**
 * A version rebases open cases on publish only when a change to a pinned section is marked live. Operational
 * sections (schedule, reminders, escalation, assignment, committees, calendar) reach every case anyway.
 */
export function rebasesLiveCases(diff: DiffEntry[], scope: ApplyScope): boolean {
  const live = Object.entries(scope).filter(([, v]) => v === 'LIVE').map(([p]) => p);
  return diff.some((d) => isPinnedSection(d.section) && live.some((p) => d.path === p || d.path.startsWith(`${p}.`)));
}
