import type { Stage } from '@prisma/client';

// Routes are resolved at submission from the pinned rule pack (rules/resolved.ts) and stored on the case.

export function nextStage(route: Stage[], current: Stage): Stage | null {
  const i = route.indexOf(current);
  return i >= 0 && i + 1 < route.length ? route[i + 1]! : null;
}

export const STAGE_LABEL: Record<Stage, string> = {
  SCRUTINY: 'Scrutiny',
  EVC: 'EVC',
  SAC_SHC: 'SAC/SHC',
  DECISION: 'Decision',
};
