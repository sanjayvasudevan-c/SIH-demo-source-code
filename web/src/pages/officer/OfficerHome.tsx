import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { useApplications } from '../../api/hooks';
import type { ACRow, ACSummary } from '../../api/types';
import { ActionCenterTable } from '../../components/ActionCenterTable';
import { CaseTable } from '../../components/CaseTable';
import { Card, Field, PageHeader, SegmentedControl, Select, StatTile, Tabs, UtilisationBar } from '../../components/ui';
import { REASON_LABEL } from '../../lib/labels';
import { useTitle } from '../../lib/useTitle';

type Filter = 'mine' | 'waitingOnCollege' | 'escalatedToMe';

export function OfficerHomePage() {
  const [tab, setTab] = useState<'ac' | 'tasks'>('ac');
  useTitle(tab === 'ac' ? 'Action Center' : 'My tasks');
  const [filter, setFilter] = useState<Filter>('mine');
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState('');
  const [ageing, setAgeing] = useState('');
  const summary = useQuery({ queryKey: ['ac-summary'], queryFn: () => api.get<ACSummary>('/action-center/summary') });
  const ac = useQuery({ queryKey: ['ac', filter, reason, stage, ageing], queryFn: () => api.get<{ rows: ACRow[] }>(`/action-center${qs({ filter, reason, stage, ageing })}`) });
  const tasks = useApplications({ mine: 'true' });
  const s = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Action Center" description="What needs you, in a fixed order: escalation, days overdue, category, days to due, filing date. Every row says why." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Held now" value={s?.held ?? '—'} hint="Open tasks assigned to you" />
        <StatTile label="Due this week" value={s?.dueThisWeek ?? '—'} hint="Within 5 working days" />
        <StatTile label="Overdue" value={s?.overdue ?? '—'} emphasis={s && s.overdue > 0 ? 'danger' : undefined} hint="Owned by you; college-owned items are excluded" />
        <StatTile label="Waiting on college" value={s?.waitingOnCollege ?? '—'} emphasis={s && s.waitingOnCollege > 0 ? 'warning' : undefined} hint="Clock paused or college action due" />
      </div>
      {s ? (
        <Card>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-secondary">Your load</p>
            <UtilisationBar used={s.openPoints} capacity={s.capacity} />
          </div>
        </Card>
      ) : null}
      <Tabs
        label="Work views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'ac', label: 'Action Center', count: ac.data?.rows.length },
          { id: 'tasks', label: 'My tasks', count: tasks.data?.rows.length },
        ]}
      >
        {tab === 'ac' ? (
          <ActionCenterTable
            rows={ac.data?.rows}
            loading={ac.isLoading}
            error={ac.error ? (ac.error as Error).message : null}
            onRetry={() => ac.refetch()}
            emptyMessage={filter === 'mine' ? 'Nothing needs your action right now.' : filter === 'waitingOnCollege' ? 'Nothing is waiting on a college.' : 'Nothing has been escalated to you.'}
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <SegmentedControl
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'mine', label: 'Mine' },
                    { value: 'waitingOnCollege', label: 'Waiting on college' },
                    { value: 'escalatedToMe', label: 'Escalated to me' },
                  ]}
                />
                <Field label="Reason">
                  {({ id }) => (
                    <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
                      <option value="">All reasons</option>
                      {Object.entries(REASON_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Stage">
                  {({ id }) => (
                    <Select id={id} value={stage} onChange={(e) => setStage(e.target.value)}>
                      <option value="">All stages</option>
                      <option value="SCRUTINY">Scrutiny</option>
                      <option value="EVC">EVC</option>
                      <option value="SAC_SHC">SAC/SHC</option>
                      <option value="DECISION">Decision</option>
                    </Select>
                  )}
                </Field>
                <Field label="Days in stage">
                  {({ id }) => (
                    <Select id={id} value={ageing} onChange={(e) => setAgeing(e.target.value)}>
                      <option value="">Any</option>
                      <option value="0-7">0 to 7</option>
                      <option value="8-15">8 to 15</option>
                      <option value="16+">16 or more</option>
                    </Select>
                  )}
                </Field>
              </div>
            }
          />
        ) : (
          <CaseTable
            caption="My tasks"
            rows={tasks.data?.rows}
            loading={tasks.isLoading}
            error={tasks.error ? (tasks.error as Error).message : null}
            onRetry={() => tasks.refetch()}
            cols={['no', 'institution', 'task', 'stage', 'days', 'status', 'reason']}
            emptyMessage="You have no open tasks."
          />
        )}
      </Tabs>
    </div>
  );
}
