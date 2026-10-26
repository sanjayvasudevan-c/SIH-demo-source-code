import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validatePack, type PackContent } from '../src/rules/schema.js';

const policy = JSON.parse(fs.readFileSync(path.join(process.env.SHARED_DIR!, 'seed', 'assignment-policy.json'), 'utf8'));
delete policy.version;
delete policy.note;

function pack(): PackContent {
  return {
    meta: { cycle: '2026-27', version: 1, title: 'Test pack', baseRef: 'Approval Process Handbook (placeholder)' },
    programmes: [{ code: 'BTECH', label: 'B.Tech', level: 'UG', discipline: 'ENGINEERING', inPurview: true }],
    applicationTypes: [
      {
        type: 'NEW_INSTITUTION', label: 'New institution', category: 'NEW', categoryWeight: 1.5, categoryRank: 0,
        eligibility: { '==': [{ var: 'institution.hasPriorApproval' }, false] },
        route: [{ stage: 'SCRUTINY' }, { stage: 'EVC' }, { stage: 'DECISION' }], channel: 'PORTAL',
      },
    ],
    documents: [{ kind: 'LAND_DOCS', label: 'Land documents', appliesTo: ['NEW_INSTITUTION'], critical: true, hasExpiry: false }],
    norms: [{ key: 'minLandAreaSqm', label: 'Minimum land', unit: 'sq m', direction: 'MIN', value: 10000 }],
    formCheckRules: [
      { id: 'R1', label: 'Land', severity: 'HIGH', when: { '<': [{ var: 'formData.landAreaSqm' }, { var: 'norms.minLandAreaSqm' }] }, message: 'Land below norm', fields: ['landAreaSqm'] },
    ],
    timelines: { SCRUTINY: 10, SAC_SHC: 5, DECISION: 5, EVC_SCHEDULE: 7, EVC_REPORT: 3, VERIFICATION: 5 },
    fees: [{ appliesTo: ['NEW_INSTITUTION'], amountInr: 100000 }],
    letters: { deficiency: { subject: 'Deficiency {{application.no}}', body: 'Items: {{deficiency.items}}' }, decision: { subject: 'Decision', body: '{{decision.outcome}}' } },
    schedule: [{ id: 'window', label: 'Application window', kind: 'APPLICATION_WINDOW', from: '2026-01-01', to: '2026-02-28', appliesTo: true }],
    reminders: { complianceOffsets: [7, 3, 1], atRiskPct: 80, stalledWorkingDays: 5, urgentDays: 2, dueSoonDays: 5 },
    escalation: { thresholds: [1, 3, 5], stageUnit: 'WORKING', complianceUnit: 'CALENDAR', levelTitles: ['Senior', 'Super senior', 'HoD'] },
    assignment: policy,
    committees: [],
    calendar: { holidays: [{ date: '2026-01-26', name: 'Republic Day' }] },
    changeNotice: [],
  };
}

describe('rule pack schema', () => {
  it('accepts a well-formed pack', () => {
    const r = validatePack(pack());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('reports shape errors with a path', () => {
    const p = pack() as unknown as { timelines: Record<string, unknown> };
    p.timelines.SCRUTINY = -1;
    const r = validatePack(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe('timelines.SCRUTINY');
  });

  it('reports cross-field errors', () => {
    const p = pack();
    p.documents[0]!.appliesTo = ['EXTENSION'];
    p.schedule[0]!.to = '2025-12-01';
    p.assignment.scoreWeights.recent = 0.5;
    p.calendar.holidays.push({ date: '2030-01-01', name: 'Far away' });
    p.formCheckRules[0]!.when = { '<': [{ var: 'norms.missingNorm' }, 1] };
    p.letters.decision.body = '{{secret.token}}';
    p.applicationTypes[0]!.route = [{ stage: 'SCRUTINY' }, { stage: 'SCRUTINY' }];
    const r = validatePack(p);
    expect(r.ok).toBe(false);
    const paths = r.ok ? [] : r.errors.map((e) => e.path);
    for (const want of ['documents[0].appliesTo[0]', 'schedule[0].to', 'assignment.scoreWeights', 'calendar.holidays[1].date', 'letters.decision', 'applicationTypes[0].route']) {
      expect(paths).toContain(want);
    }
    expect(paths.some((x) => x.startsWith('formCheckRules[0].when'))).toBe(true);
  });

  it('exported JSON Schema is current', () => {
    const file = JSON.parse(fs.readFileSync(path.join(process.env.SHARED_DIR!, 'rulepack.schema.json'), 'utf8'));
    expect(file.definitions.RulePack.required).toContain('formCheckRules');
  });
});
