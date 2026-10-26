export type Role = 'COLLEGE' | 'OFFICER' | 'SENIOR' | 'SUPER_SENIOR' | 'HOD' | 'BUREAU' | 'COMMITTEE' | 'AUTHORITY' | 'ADMIN' | 'RULE_EDITOR' | 'RULE_APPROVER';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  regionId: string | null;
  regionCode: string | null;
  regionName: string | null;
  institutionId: string | null;
  institutionName: string | null;
  skills: string[];
}

export interface DemoUser {
  name: string;
  email: string;
  role: Role;
  title: string | null;
  region: string | null;
  institution: string | null;
}

export interface ClockInfo {
  now: string;
  today: string;
  offsetDays: number;
  simulated: boolean;
}

export interface NotificationItem {
  id: string;
  kind: string;
  message: string;
  read: boolean;
  createdAt: string;
  applicationId: string | null;
  applicationNo: string | null;
}

export type Stage = 'SCRUTINY' | 'EVC' | 'SAC_SHC' | 'DECISION';
export type Status = 'IN_STAGE' | 'RETURNED' | 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED' | 'CLOSED';
export type AppType = 'NEW_INSTITUTION' | 'EXTENSION' | 'NAME_CHANGE' | 'INTAKE_INCREASE' | 'CHANGE_OF_SITE' | 'VERIFICATION_VISIT' | 'RESTORATION';
export type CaseAction = 'COMPLETE_STAGE' | 'RETURN' | 'REPLY' | 'SCHEDULE_EVC' | 'SUBMIT_EVC_REPORT' | 'FORWARD_SAC_SHC' | 'SUBMIT_RECOMMENDATION' | 'REVERT' | 'DECIDE';

export interface RouteStep {
  stage: string;
  label: string;
  state: 'done' | 'current' | 'upcoming' | 'returned' | 'overdue';
  enteredAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
}

export interface ListRow {
  id: string;
  applicationNo: string;
  institutionName: string;
  permanentId: string;
  type: AppType;
  typeLabel: string;
  category: string;
  stage: Stage;
  stageLabel: string;
  status: Status;
  holderType: string;
  holderLabel: string;
  daysInStage: number;
  submittedAt: string;
  routeSteps: RouteStep[];
  dueDate: string | null;
  daysToDue: number | null;
  currentTask: { taskType: string; label: string; officerName: string; reasonText: string; mine: boolean } | null;
  flags?: { reasonCode: string; escalationLevel: number }[];
  daysWaiting?: number;
  visitDate?: string | null;
  mode?: string | null;
  reportDue?: boolean;
}

export interface DocCfg {
  kind: string;
  label: string;
  critical: boolean;
  hasExpiry: boolean;
}

export interface CaseDocument {
  id: string;
  kind: string;
  label: string;
  critical: boolean;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  expiryDate: string | null;
  verified: boolean;
  verifiedAt: string | null;
  supersedesId: string | null;
  current: boolean;
}

export interface DeadlineItemView {
  id: string;
  type: string;
  sourceId: string;
  status: string;
  dueDate: string;
  unit: 'WORKING' | 'CALENDAR';
  totalDays: number | null;
  pausedRemaining: number | null;
  escalationLevel: number;
  daysToDue: number | null;
  overdue: boolean;
  responsibleUserId: string;
  responsibleName: string | null;
}

export interface FlagView {
  id: string;
  reasonCode: string;
  reasonText: string;
  nextAction: string;
  ownerRole: string;
  escalationLevel: number;
  nextEscalationAt: string | null;
}

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

export interface FormCheckView {
  id: string;
  modelVersion: string;
  modelAvailable: boolean;
  score: number | null;
  threshold: number | null;
  severity: 'NONE' | 'MEDIUM' | 'HIGH';
  warnings: Warning[];
  justification: string | null;
  officerLabels: Record<string, { useful: boolean; byName: string; at: string; modelVersion: string }>;
  createdAt: string;
}

export interface CaseDetail {
  application: {
    id: string;
    applicationNo: string;
    type: AppType;
    typeLabel: string;
    category: string;
    stage: Stage;
    stageLabel: string;
    status: Status;
    holderType: string;
    holderUserId: string | null;
    holderLabel: string;
    evcScheduled: boolean;
    sacForwarded: boolean;
    submittedAt: string;
    stageEnteredAt: string;
    lastActionAt: string;
    formData: Record<string, unknown>;
    route: Stage[];
    daysInStage: number;
  };
  institution: { id: string; name: string; permanentId: string; regionCode: string; regionName: string; portfolioOfficer: { id: string; name: string } | null };
  routeSteps: RouteStep[];
  requiredDocuments: DocCfg[];
  rules?: RulesRef;
  ruleDefaults?: { undertakingDueDate: string };
  documents: CaseDocument[];
  deficiencies: { id: string; items: string[]; reason: string; raisedBy: string | null; raisedAt: string; resolvedAt: string | null; replyNote: string | null; replyDocumentIds: string[] }[];
  evcVisit: {
    status: string;
    visitDate: string | null;
    mode: string | null;
    members: { id: string; name: string | null }[];
    proposed: { id: string; name: string | null }[];
    checklist: Record<string, boolean> | null;
    recommendation: string | null;
    reportText: string | null;
    reportedAt: string | null;
  } | null;
  recommendations: { id: string; text: string; by: string | null; at: string }[];
  decision: { outcome: string; reason: string; by: string | null; at: string } | null;
  undertakings: { id: string; condition: string; dueDate: string; daysToDue: number; status: string; evidenceDocId: string | null; verifiedAt: string | null; remarks: string | null }[];
  deadlineItems: DeadlineItemView[];
  flags: FlagView[];
  currentAssignment: { id: string; taskType: string; label: string; officer: { id: string; name: string; role: string; region: string | null }; reasonText: string; assignedAt: string; tier: number } | null;
  assignments: { id: string; taskType: string; label: string; officerName: string; reasonText: string; assignedAt: string; releasedAt: string | null; releasedReason: string | null; tier: number }[];
  formChecks: FormCheckView[];
  history: { id: string; at: string; action: string; actorName: string | null; actorRole: string; reason: string | null; fromState: unknown; toState: unknown }[];
  permittedActions: CaseAction[];
  verifyTasks: { kind: 'EVIDENCE' | 'RENEWAL'; refId: string; title: string; documentId: string | null; detail: string; reasonText: string }[];
}

export interface ValidateResponse {
  id: string;
  modelVersion: string;
  modelAvailable: boolean;
  severity: 'NONE' | 'MEDIUM' | 'HIGH';
  score: number | null;
  threshold: number | null;
  warnings: Warning[];
  requiredMissing: { field: string; message: string }[];
  canSubmit: true;
  justificationRequired: boolean;
}

export interface ACRow {
  applicationId: string;
  applicationNo: string;
  institutionName: string;
  typeLabel: string;
  stage: Stage;
  stageLabel: string;
  status: Status;
  daysInStage: number;
  ageing: '0-7' | '8-15' | '16+';
  task: { label: string; reasonText: string; officerName: string } | null;
  primary: { reasonCode: string; label: string; reasonText: string; nextAction: string; escalationLevel: number; ownerRole: string };
  reasons: string[];
  escalationLevel: number;
  nextEscalationAt: string | null;
}

export interface ACSummary {
  held: number;
  dueThisWeek: number;
  overdue: number;
  waitingOnCollege: number;
  escalatedToMe: number;
  openPoints: number;
  capacity: number;
}

export interface Metrics {
  received: number;
  completed: number;
  returned: number;
  closed: number;
  heldNow: number;
  ageing: { d0to7: number; d8to15: number; d16plus: number };
  overdueNow: number;
  worstOverdueDays: number;
  slaMet: number;
  slaTotal: number;
  slaMetPct: number | null;
  avgWorkingDaysPerStage: number | null;
  openPoints: number;
  capacity: number;
  utilisation: number | null;
  officers: number;
  availableToday: number;
}

export interface TeamReport {
  base: { id: string; name: string; role: string };
  periodDays: number;
  rows: { user: { id: string; name: string; role: string; title: string | null }; hasReports: boolean; availability: { kind: string; until: string } | null; metrics: Metrics }[];
  totals: Metrics;
  waitingOn: { officer: number; college: number; evcOrCommittee: number; authority: number };
  escalatedToMe: { flagId: string; applicationId: string; applicationNo: string; institutionName: string; level: number; label: string; reasonText: string }[];
}

export interface WorkloadRow {
  id: string;
  name: string;
  role: string;
  region: string | null;
  senior: { id: string; name: string } | null;
  capacity: number;
  openPoints: number;
  utilisation: number;
  availability: { kind: string; until: string; reason: string } | null;
  openTasks: { assignmentId: string; applicationId: string; applicationNo: string; institutionName: string; stage: string; taskType: string; taskLabel: string; weight: number; assignedAt: string; reasonText: string }[];
  portfolio: { id: string; name: string; permanentId: string }[];
  portfolioSize: number;
  flag: 'OK' | 'OVERLOADED' | 'IDLE';
  teamAverage: number;
}

export interface UnassignedRow {
  flagId: string;
  applicationId: string;
  applicationNo: string;
  institutionName: string;
  region: string;
  stage: string;
  taskType: string;
  taskLabel: string;
  taskRefId: string;
  since: string;
  reasonText: string;
}

export interface ComplianceView {
  undertakings: { id: string; applicationId: string; applicationNo: string; condition: string; dueDate: string; daysToDue: number; status: string; remarks: string | null }[];
  documents: { id: string; applicationId: string; applicationNo: string; kind: string; label: string; fileName: string; expiryDate: string; daysToExpiry: number; renewalPending: { id: string; expiryDate: string } | null }[];
}

export interface RulesRef {
  versionId: string;
  cycle: string;
  version: number;
  label: string;
  effectiveFrom: string;
  contentHash?: string;
}

export interface FilingContext {
  open: boolean;
  message: string | null;
  window: { id: string; label: string; kind: string; from: string; to: string } | null;
  lateFeeInr: number | null;
  rules: RulesRef;
  programmes: { code: string; label: string; level: string; discipline: string; inPurview: boolean }[];
  types: { type: AppType; label: string; category: string; channel: string; eligible: boolean; route: string[]; documents: DocCfg[] }[];
}
