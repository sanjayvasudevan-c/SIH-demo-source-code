// Rule pack types for the Rules Center (mirrors api/src/rules/schema.ts; the API validates everything).
export type Expr = unknown;
export type Source = { amendmentId?: string; ref: string; clause?: string } | null | undefined;

export const APP_TYPES = ['NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION'] as const;
export const AMENDMENT_KINDS = ['APH', 'ADDENDUM', 'CORRIGENDUM', 'PUBLIC_NOTICE', 'REVISED_PUBLIC_NOTICE', 'CIRCULAR', 'ACADEMIC_CALENDAR', 'FEE_NOTIFICATION', 'PROTOTYPE_PLACEHOLDER'] as const;
export const KIND_LABEL: Record<string, string> = {
  APH: 'Approval Process Handbook',
  ADDENDUM: 'Addendum',
  CORRIGENDUM: 'Corrigendum',
  PUBLIC_NOTICE: 'Public notice',
  REVISED_PUBLIC_NOTICE: 'Revised public notice',
  CIRCULAR: 'Circular',
  ACADEMIC_CALENDAR: 'Academic calendar',
  FEE_NOTIFICATION: 'Fee notification',
  PROTOTYPE_PLACEHOLDER: 'Prototype placeholder',
};

export interface Pack {
  meta: { cycle: string; version: number; title: string; baseRef: string; notes?: string; rollbackOfVersionId?: string };
  programmes: { code: string; label: string; level: string; discipline: string; inPurview: Expr; source?: Source }[];
  applicationTypes: { type: string; label: string; category: string; categoryWeight: number; categoryRank: number; eligibility: Expr; route: { stage: string; when?: Expr }[]; channel: string; source?: Source }[];
  documents: { kind: string; label: string; appliesTo: string[]; when?: Expr; critical: boolean; hasExpiry: boolean; minValidityYears?: number; format?: 'PDF'; source?: Source }[];
  norms: { key: string; label: string; unit: string; direction: 'MIN' | 'MAX'; value: number; scope?: { level?: string; discipline?: string }; source?: Source }[];
  formCheckRules: { id: string; label: string; severity: 'HIGH' | 'MEDIUM'; when: Expr; message: string; fields: string[]; valueVar?: string; valueAsPercent?: boolean; source?: Source }[];
  timelines: Record<'SCRUTINY' | 'SAC_SHC' | 'DECISION' | 'EVC_SCHEDULE' | 'EVC_REPORT' | 'VERIFICATION', number>;
  fees: { appliesTo: string[]; programmeLevel?: string; amountInr: number; lateFeeInr?: number; source?: Source }[];
  letters: { deficiency: { subject: string; body: string }; decision: { subject: string; body: string } };
  schedule: { id: string; label: string; kind: string; from: string; to: string; appliesTo: Expr; source?: Source }[];
  reminders: { complianceOffsets: number[]; atRiskPct: number; stalledWorkingDays: number; urgentDays: number; dueSoonDays: number };
  escalation: { thresholds: number[]; stageUnit: string; complianceUnit: string; levelTitles: string[] };
  assignment: {
    stageWeight: Record<string, number>;
    defaultCapacityPoints: number;
    maxUtil: number;
    urgentMaxUtil: number;
    continuityUtilCap: number;
    scoreWeights: { projectedUtil: number; recent: number; mismatch: number };
    recentWorkingDays: number;
    specialisationLookbackDays: number;
    idleBelowTeamAverage: number;
    overloadedAbove: number;
    eligibility: Record<string, { tier: number; role: string; region: string; skill?: string }[]>;
    taskSkill: Record<string, string | null>;
  };
  committees: { committee: string; appointingAuthority: string; size: number; source?: Source }[];
  calendar: { holidays: { date: string; name: string }[] };
  changeNotice: { title: string; summary: string; audience: 'COLLEGE' | 'STAFF'; amendmentId?: string }[];
}

export type SectionId = Exclude<keyof Pack, 'meta'>;
export const SECTION_LIST: { id: SectionId; label: string }[] = [
  { id: 'programmes', label: 'Programmes' },
  { id: 'applicationTypes', label: 'Application types' },
  { id: 'documents', label: 'Documents' },
  { id: 'norms', label: 'Norms' },
  { id: 'formCheckRules', label: 'Form check' },
  { id: 'timelines', label: 'Timelines' },
  { id: 'fees', label: 'Fees' },
  { id: 'letters', label: 'Letters' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'escalation', label: 'Escalation' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'committees', label: 'Committees' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'changeNotice', label: 'Change notice' },
];

export type VersionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'SUPERSEDED' | 'REJECTED';

export interface Amendment {
  id: string;
  kind: string;
  refNo: string;
  issuedOn: string;
  title: string;
  summary: string;
  applyScope: Record<string, 'NEW_CASES' | 'LIVE'>;
  sourceDocId: string | null;
}

export interface VersionDetail {
  id: string;
  cycle: { id: string; code: string; label: string };
  version: number;
  status: VersionStatus;
  content: Pack;
  contentHash: string;
  effectiveFrom: string;
  scheduledPublish: boolean;
  parentVersionId: string | null;
  base: { id: string; version: number; status: VersionStatus } | null;
  amendment: Amendment | null;
  maker: string;
  submittedBy: string | null;
  checker: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  rejectedRemarks: string | null;
  pinnedOpenCases: number;
  cyclePublished: { id: string; version: number } | null;
  errors: { path: string; message: string }[];
  changedBySection: Record<string, number>;
  makers: string[];
  permissions: { canEdit: boolean; canSubmit: boolean; canReview: boolean; reviewBlockedReason: string | null; canPublish: boolean; readOnly: boolean };
  history: { at: string; action: string; actor: string; reason: string | null; meta: Record<string, unknown> }[];
}

export interface DiffChange {
  section: string;
  path: string;
  op: 'add' | 'remove' | 'change';
  old: unknown;
  new: unknown;
  source: Source;
  classification: 'relaxing' | 'tightening' | 'neutral';
  reason: string;
  applyScope: 'NEW_CASES' | 'LIVE';
}

export interface CycleRow {
  id: string;
  code: string;
  label: string;
  baseRef: string;
  published: { id: string; version: number; effectiveFrom: string; publishedAt: string | null } | null;
  pinnedOpenCases: number;
  draftInProgress: { id: string; version: number; status: VersionStatus } | null;
  versions: {
    id: string;
    version: number;
    status: VersionStatus;
    kind: string | null;
    refNo: string | null;
    title: string | null;
    issuedOn: string | null;
    effectiveFrom: string;
    maker: string | null;
    checker: string | null;
    publishedAt: string | null;
    scheduledPublish: boolean;
    pinnedOpenCases: number;
  }[];
}

export interface Impact {
  version: { id: string; version: number; status: VersionStatus };
  against: { id: string; version: number };
  changes: number;
  sentences: string[];
  live: { applies: boolean; pinnedOpenCases: number; moves: { applicationId: string; applicationNo: string; item: string; oldDue: string; newDue: string; pausedDaysAdded: number | null }[] };
  newFilings: {
    sampled: number;
    routeChanges: { type: string; count: number; applications: string[]; sentence: string }[];
    missingDocs: { kind: string; label: string; count: number; applications: string[] }[];
    outsidePurview: { applicationNo: string; reason: string }[];
  };
  formCheck: { samples: number; seeded: number; rules: { rule: string; samplesBefore: number; samplesAfter: number; seededBefore: number; seededAfter: number }[] };
  assignment: { officer: string; openTasks: number; before: number; after: number }[];
  schedule: { group: string; before: boolean; after: boolean }[];
  refusals: { path: string; message: string }[];
  ms: number;
}

export interface PublicNotice {
  versionId: string;
  cycle: string;
  version: number;
  current: boolean;
  kind: string;
  refNo: string;
  issuedOn: string;
  effectiveFrom: string;
  publishedAt: string | null;
  title: string;
  summary: string;
  affectedTypes: string[];
}

export interface PublicScheduleRow {
  cycle: string;
  version: number;
  id: string;
  label: string;
  kind: string;
  from: string;
  to: string;
  scope: string;
}

export const STATUS_TONE: Record<VersionStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'accent',
  APPROVED: 'accent',
  PUBLISHED: 'success',
  SUPERSEDED: 'neutral',
  REJECTED: 'danger',
};
export const STATUS_LABEL: Record<VersionStatus, string> = { DRAFT: 'Draft', IN_REVIEW: 'In review', APPROVED: 'Approved', PUBLISHED: 'Published', SUPERSEDED: 'Superseded', REJECTED: 'Rejected' };

export function sourceText(s: Source): string | null {
  if (!s) return null;
  return [s.ref, s.clause ? `cl. ${s.clause}` : null].filter(Boolean).join(', ');
}

export const cycleLabel = (code: string) => code.replace('-', '–');
