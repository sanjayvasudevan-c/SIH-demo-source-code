// A resolved rule set: the pinned sections of a case's version plus the operational sections of its cycle's
// current published version (add-on A6). Read-only helpers used by every consumer.
import { evaluate, truthy, type Data, type Expr } from './expr.js';
import type { PackContent } from './schema.js';

export type AppTypeName = PackContent['applicationTypes'][number]['type'];
export type StageName = PackContent['applicationTypes'][number]['route'][number]['stage'];
export type TaskName = keyof PackContent['assignment']['stageWeight'];
export type DocRule = PackContent['documents'][number];
export type Programme = PackContent['programmes'][number];

export interface VersionRef {
  id: string;
  cycleId: string;
  cycleCode: string;
  version: number;
  effectiveFrom: string;
  contentHash: string;
}

/** Facts an expression may read (shared/expr-vars.json). */
export interface EvalContext {
  formData?: Record<string, unknown>;
  institution?: { isTechnical?: boolean; kind?: string; regionCode?: string; hasPriorApproval?: boolean };
  application?: { type?: string };
  programme?: { code?: string; level?: string; discipline?: string } | null;
  features?: Record<string, number | null>;
}

export class ResolvedRules {
  constructor(
    /** The version the case is pinned to (pinned sections come from here). */
    readonly pinned: VersionRef,
    /** The current published version of the cycle (operational sections come from here). */
    readonly operational: VersionRef,
    readonly content: PackContent,
  ) {}

  get label(): string {
    return `${this.pinned.cycleCode} v${this.pinned.version}`;
  }

  type(type: AppTypeName) {
    const t = this.content.applicationTypes.find((x) => x.type === type);
    if (!t) throw new Error(`Application type ${type} is not in rules ${this.label}`);
    return t;
  }

  hasType(type: string): boolean {
    return this.content.applicationTypes.some((x) => x.type === type);
  }

  programme(code: string | null | undefined): Programme | null {
    return code ? (this.content.programmes.find((p) => p.code === code) ?? null) : null;
  }

  /** Norm values for a programme: the most specific scope wins (level and discipline, then one, then none). */
  norms(programme?: Pick<Programme, 'level' | 'discipline'> | null): Record<string, number> {
    const best = new Map<string, { score: number; value: number }>();
    for (const n of this.content.norms) {
      const s = n.scope ?? {};
      if (s.level && s.level !== programme?.level) continue;
      if (s.discipline && s.discipline !== programme?.discipline) continue;
      const score = (s.level ? 2 : 0) + (s.discipline ? 1 : 0);
      const cur = best.get(n.key);
      if (!cur || score > cur.score) best.set(n.key, { score, value: n.value });
    }
    return Object.fromEntries([...best].map(([k, v]) => [k, v.value]));
  }

  norm(key: string, programme?: Pick<Programme, 'level' | 'discipline'> | null): number | null {
    return this.norms(programme)[key] ?? null;
  }

  /** The data an expression sees: the context plus norms for its programme. */
  data(ctx: EvalContext = {}): Data {
    const programme = ctx.programme ?? this.programme(ctx.formData?.programme as string | undefined);
    return {
      formData: ctx.formData ?? {},
      institution: ctx.institution ?? {},
      application: ctx.application ?? {},
      programme: programme ? { code: programme.code, level: programme.level, discipline: programme.discipline } : {},
      features: ctx.features ?? {},
      norms: this.norms(programme as Programme | null),
    };
  }

  test(expr: unknown, ctx: EvalContext = {}): boolean {
    return truthy(evaluate(expr as Expr, this.data(ctx)));
  }

  /** Documents for a type; entries with a `when` are included only when it holds for the context. */
  documents(type: AppTypeName, ctx: EvalContext = {}): DocRule[] {
    return this.content.documents.filter((d) => d.appliesTo.includes(type) && (d.when === undefined || this.test(d.when, { ...ctx, application: { type } })));
  }

  document(type: AppTypeName, kind: string, ctx: EvalContext = {}): DocRule | undefined {
    return this.documents(type, ctx).find((d) => d.kind === kind);
  }

  criticalKinds(type: AppTypeName, ctx: EvalContext = {}): string[] {
    return this.documents(type, ctx)
      .filter((d) => d.critical)
      .map((d) => d.kind);
  }

  /** Route stages for a type and its form data. */
  route(type: AppTypeName, ctx: EvalContext = {}): StageName[] {
    return this.type(type)
      .route.filter((r) => r.when === undefined || this.test(r.when, { ...ctx, application: { type } }))
      .map((r) => r.stage);
  }

  get timelines() {
    return this.content.timelines;
  }
  get reminders() {
    return this.content.reminders;
  }
  get escalation() {
    return this.content.escalation;
  }
  get assignment() {
    return this.content.assignment;
  }
  get formCheckRules() {
    return this.content.formCheckRules;
  }
  get committees() {
    return this.content.committees;
  }
  get letters() {
    return this.content.letters;
  }
  get schedule() {
    return this.content.schedule;
  }

  committee(name: PackContent['committees'][number]['committee']) {
    return this.content.committees.find((c) => c.committee === name) ?? null;
  }
}

/** Merge: pinned sections from `pinned`, operational sections from `operational`. */
export function mergeSections(pinned: PackContent, operational: PackContent): PackContent {
  return {
    ...pinned,
    schedule: operational.schedule,
    reminders: operational.reminders,
    escalation: operational.escalation,
    assignment: operational.assignment,
    committees: operational.committees,
    calendar: operational.calendar,
  };
}
