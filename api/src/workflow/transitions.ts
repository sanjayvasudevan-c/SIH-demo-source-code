// Transition table (section 2.4). Pure data plus small predicates; policy/can.ts adds holder and scope checks.
import type { Application, Role } from '@prisma/client';

export const CASE_ACTIONS = [
  'COMPLETE_STAGE',
  'RETURN',
  'REPLY',
  'SCHEDULE_EVC',
  'SUBMIT_EVC_REPORT',
  'FORWARD_SAC_SHC',
  'SUBMIT_RECOMMENDATION',
  'REVERT',
  'DECIDE',
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

export interface Transition {
  action: CaseAction;
  roles: Role[];
  from: (app: Pick<Application, 'stage' | 'status' | 'evcScheduled' | 'sacForwarded'>) => boolean;
  label: string;
}

export const TRANSITIONS: Transition[] = [
  { action: 'COMPLETE_STAGE', roles: ['OFFICER', 'BUREAU'], from: (a) => a.stage === 'SCRUTINY' && a.status === 'IN_STAGE', label: 'Complete scrutiny' },
  { action: 'RETURN', roles: ['OFFICER', 'BUREAU'], from: (a) => a.stage === 'SCRUTINY' && a.status === 'IN_STAGE', label: 'Return to college' },
  { action: 'REPLY', roles: ['COLLEGE'], from: (a) => a.stage === 'SCRUTINY' && a.status === 'RETURNED', label: 'Reply to deficiency' },
  { action: 'SCHEDULE_EVC', roles: ['OFFICER', 'BUREAU'], from: (a) => a.stage === 'EVC' && a.status === 'IN_STAGE' && !a.evcScheduled, label: 'Schedule EVC visit' },
  { action: 'SUBMIT_EVC_REPORT', roles: ['COMMITTEE'], from: (a) => a.stage === 'EVC' && a.status === 'IN_STAGE' && a.evcScheduled, label: 'Submit EVC report' },
  { action: 'FORWARD_SAC_SHC', roles: ['BUREAU'], from: (a) => a.stage === 'SAC_SHC' && a.status === 'IN_STAGE' && !a.sacForwarded, label: 'Forward to SAC/SHC' },
  { action: 'SUBMIT_RECOMMENDATION', roles: ['COMMITTEE'], from: (a) => a.stage === 'SAC_SHC' && a.status === 'IN_STAGE' && a.sacForwarded, label: 'Submit recommendation' },
  { action: 'REVERT', roles: ['OFFICER', 'SENIOR'], from: (a) => (a.stage === 'EVC' || a.stage === 'SAC_SHC') && a.status === 'IN_STAGE', label: 'Revert to scrutiny' },
  { action: 'DECIDE', roles: ['AUTHORITY'], from: (a) => a.stage === 'DECISION' && a.status === 'IN_STAGE', label: 'Record decision' },
];

export function transitionFor(action: CaseAction): Transition {
  return TRANSITIONS.find((t) => t.action === action)!;
}
