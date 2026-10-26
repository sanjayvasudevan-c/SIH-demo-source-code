import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTitle } from '../lib/useTitle';
import { usePrefs } from '../lib/prefs';
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DateInput,
  Dialog,
  EmptyState,
  ErrorState,
  ErrorSummary,
  Field,
  FileUpload,
  IconButton,
  Input,
  Menu,
  PageHeader,
  ReasonDialog,
  SegmentedControl,
  Select,
  Skeleton,
  StatTile,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  Tracker,
  UtilisationBar,
  WarningList,
  useToast,
} from '../components/ui';
import { X } from 'lucide-react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="rounded-lg border bg-surface p-4">{children}</div>
    </section>
  );
}

interface Row {
  no: string;
  institution: string;
  stage: string;
  days: number;
}
const rows: Row[] = [
  { no: 'S-2026-0101', institution: 'ABC Engineering College', stage: 'Scrutiny', days: 4 },
  { no: 'S-2026-0102', institution: 'Madurai Institute of Technology', stage: 'EVC', days: 12 },
  { no: 'S-2026-0103', institution: 'Salem College of Engineering', stage: 'Decision', days: 2 },
];

export function StyleguidePage() {
  useTitle('Style guide');
  const prefs = usePrefs();
  const toast = useToast();
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one');
  const [seg, setSeg] = useState<'online' | 'physical'>('online');
  const [checked, setChecked] = useState(true);
  const [dialog, setDialog] = useState<'none' | 'plain' | 'confirm' | 'reason'>('none');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Style guide" description="Every shared component in every state. Screens are composed only from these." breadcrumb={[{ label: 'Administration', to: '/admin' }, { label: 'Style guide' }]} />

      <Section title="Themes, languages and text sizes">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl label="Text size" value={prefs.textSize} options={[{ value: 'sm', label: 'A- (87.5%)' }, { value: 'md', label: 'A (100%)' }, { value: 'lg', label: 'A+ (112.5%)' }, { value: 'xl', label: 'A++ (125%)' }]} onChange={prefs.setTextSize} />
          <SegmentedControl label="Language" value={prefs.lang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिंदी' }]} onChange={prefs.setLang} />
          <Checkbox label="High contrast" checked={prefs.contrast} onChange={prefs.setContrast} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(['standard', 'contrast'] as const).map((theme) => (
            <div key={theme} data-theme={theme === 'contrast' ? 'contrast' : undefined} className="flex flex-col gap-3 rounded-lg border bg-page p-4 text-primary">
              <p className="text-sm font-semibold">{theme === 'contrast' ? 'High contrast' : 'Standard'}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Primary</Button>
                <Button>Secondary</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="done" />
                <StatusBadge kind="waitingOnCollege" />
                <StatusBadge kind="overdue" />
                <StatusBadge kind="escalated" level={2} />
              </div>
              <p className="text-base">
                AICTE Approval and Operations Compliance Platform · <span lang="hi">एआईसीटीई अनुमोदन एवं संचालन अनुपालन प्लेटफ़ॉर्म — कार्यप्रवाह, समय-सीमाएँ, अनुपालन और अलर्ट</span> · <a href="#top" className="text-accent underline">A link</a>
              </p>
              <div className="flex h-8 overflow-hidden rounded">
                <span className="flex-1 bg-gov-ink" title="gov-ink" />
                <span className="flex-1 bg-gov-nav" title="gov-nav" />
                <span className="flex-1 bg-gov-saffron" title="gov-saffron (non-text only)" />
                <span className="flex-1 bg-accent" title="accent" />
                <span className="flex-1 bg-accent-soft" title="accent-soft" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Complete scrutiny</Button>
          <Button>Download letter</Button>
          <Button variant="tertiary">View history</Button>
          <Button variant="destructive">Return to college</Button>
          <Button variant="primary" pending>
            Complete scrutiny
          </Button>
          <Button disabled disabledReason="Attach the land lease first">
            Submit application
          </Button>
          <Button size="sm">Reassign</Button>
          <IconButton label="Close" icon={<X size={16} aria-hidden />} />
        </div>
      </Section>

      <Section title="Badges and status">
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="done" />
          <StatusBadge kind="inProgress" />
          <StatusBadge kind="waitingOnCollege" />
          <StatusBadge kind="atRisk" />
          <StatusBadge kind="overdue" />
          <StatusBadge kind="escalated" level={2} />
          <StatusBadge kind="upcoming" />
          <StatusBadge kind="closed" />
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success" icon={<Check size={12} aria-hidden />}>
            Verified
          </Badge>
        </div>
      </Section>

      <Section title="Stat tiles, cards and utilisation">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Held now" value={14} hint="Across 3 stages" />
          <StatTile label="Due this week" value={5} />
          <StatTile label="Overdue" value={2} emphasis="danger" hint="Oldest 6 working days" />
          <StatTile label="Waiting on college" value={3} emphasis="warning" />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <UtilisationBar used={6.2} capacity={10} />
          <UtilisationBar used={10.8} capacity={10} />
          <div className="flex items-center gap-2">
            <Avatar name="Priya Raman" />
            <Avatar name="Dr. Rajesh Menon" size="sm" />
          </div>
          <Card title="Card with title">
            <p className="text-base text-secondary">Cards hold stat tiles and side panels only.</p>
          </Card>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="flex max-w-prose flex-col gap-4">
          <ErrorSummary errors={[{ field: 'sg-land', message: 'Enter the land area in square metres' }]} />
          <Field id="sg-land" label="Land area (square metres)" hint="As stated on the lease or title deed." error="Enter the land area in square metres">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} inputMode="decimal" />}
          </Field>
          <Field label="Built-up area (square metres)" hint="Total floor area of all buildings.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} defaultValue="12500" />}
          </Field>
          <Field label="Application type">
            {({ id }) => (
              <Select id={id} defaultValue="NEW_INSTITUTION">
                <option value="NEW_INSTITUTION">New institution</option>
                <option value="EXTENSION">Extension of approval</option>
              </Select>
            )}
          </Field>
          <Field label="Note to the officer" optional>
            {({ id }) => <Textarea id={id} rows={3} />}
          </Field>
          <Field label="Lease expiry date">{({ id }) => <DateInput id={id} />}</Field>
          <Field label="Land lease">{({ id }) => <FileUpload id={id} onFile={() => undefined} />}</Field>
          <Field label="Disabled input">{({ id }) => <Input id={id} disabled value="Read only" readOnly />}</Field>
          <Checkbox label="Land lease or title deed" description="Critical document" checked={checked} onChange={setChecked} />
          <SegmentedControl
            label="Visit mode"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'online', label: 'Online' },
              { value: 'physical', label: 'Physical' },
            ]}
          />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          label="Example tabs"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'one', label: 'Overview' },
            { id: 'two', label: 'Deadlines', count: 3 },
            { id: 'three', label: 'History' },
          ]}
        >
          <p className="text-base text-secondary">Panel for {tab}.</p>
        </Tabs>
      </Section>

      <Section title="Table">
        <div className="flex flex-col gap-4">
          <Table
            caption="Example applications"
            columns={[
              { key: 'no', header: 'Application no', render: (r: Row) => <span className="id-text">{r.no}</span>, sortValue: (r) => r.no },
              { key: 'inst', header: 'Institution', render: (r) => r.institution, title: (r) => r.institution, sortValue: (r) => r.institution },
              { key: 'stage', header: 'Stage', render: (r) => r.stage },
              { key: 'days', header: 'Days in stage', align: 'right', render: (r) => r.days, sortValue: (r) => r.days },
            ]}
            rows={rows}
            rowKey={(r) => r.no}
            onRowClick={(r) => toast(`Opened ${r.no}`)}
            rowLabel={(r) => `Open ${r.no}`}
            emptyMessage="No applications."
            toolbar={<span className="text-sm text-secondary">Toolbar slot for filters</span>}
          />
          <Table caption="Loading" columns={[{ key: 'a', header: 'Loading state', render: () => null }]} rows={undefined} rowKey={() => 'x'} loading emptyMessage="" />
          <Table caption="Empty" columns={[{ key: 'a', header: 'Empty state', render: () => null }]} rows={[]} rowKey={() => 'x'} emptyMessage="No applications match these filters." />
          <Table caption="Error" columns={[{ key: 'a', header: 'Error state', render: () => null }]} rows={[]} rowKey={() => 'x'} error="The server did not respond." onRetry={() => undefined} emptyMessage="" />
        </div>
      </Section>

      <Section title="Tracker">
        <div className="flex flex-col gap-6">
          <Tracker
            steps={[
              { label: 'Submitted', state: 'done', date: '2026-10-01' },
              { label: 'Scrutiny', state: 'returned', date: '2026-10-09' },
              { label: 'EVC', state: 'upcoming' },
              { label: 'Decision', state: 'upcoming' },
            ]}
          />
          <Tracker
            steps={[
              { label: 'Submitted', state: 'done', date: '2026-09-01' },
              { label: 'Scrutiny', state: 'done', date: '2026-09-15' },
              { label: 'EVC', state: 'overdue', date: '2026-10-02' },
              { label: 'Decision', state: 'upcoming' },
            ]}
          />
          <Tracker
            compact
            steps={[
              { label: 'Scrutiny', state: 'done' },
              { label: 'EVC', state: 'current' },
              { label: 'Decision', state: 'upcoming' },
            ]}
          />
        </div>
      </Section>

      <Section title="Warnings (Check my entries)">
        <WarningList
          warnings={[
            { source: 'rule', field: 'Built-up area', value: 14000, message: 'Built-up area is larger than the plot. Check both values and their units.', severity: 'HIGH' },
            { source: 'model', field: 'Square metres per student', value: 3.1, typical: 9.4, message: 'This value is unusual compared with similar applications.', severity: 'MEDIUM' },
          ]}
        />
      </Section>

      <Section title="Dialogs, menu and toast">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setDialog('plain')}>Open dialog</Button>
          <Button onClick={() => setDialog('confirm')}>Open confirm dialog</Button>
          <Button onClick={() => setDialog('reason')}>Open reason dialog</Button>
          <Button onClick={() => toast('Scrutiny completed for S-2026-0101')}>Show toast</Button>
          <Menu label="More actions" items={[{ label: 'Download letter', onSelect: () => undefined }, { label: 'Return to college', onSelect: () => undefined, destructive: true }]} />
        </div>
        <Dialog open={dialog === 'plain'} title="Schedule the EVC visit?" onClose={() => setDialog('none')} footer={<Button onClick={() => setDialog('none')}>Close</Button>}>
          <p className="text-base text-secondary">Dialog body states the consequence of the action.</p>
        </Dialog>
        <ConfirmDialog
          open={dialog === 'confirm'}
          title="Reset the demo?"
          body="All changes since the seed are discarded. This cannot be undone."
          confirmLabel="Reset demo"
          destructive
          onConfirm={() => setDialog('none')}
          onClose={() => setDialog('none')}
        />
        <ReasonDialog
          open={dialog === 'reason'}
          title="Return this application to the college?"
          body="The scrutiny clock pauses until the college replies."
          confirmLabel="Return to college"
          destructive
          onConfirm={() => setDialog('none')}
          onClose={() => setDialog('none')}
        />
      </Section>

      <Section title="Loading, empty and error">
        <div className="flex flex-col gap-4">
          <Skeleton lines={3} />
          <EmptyState message="You have no open tasks." />
          <ErrorState message="The server did not respond." onRetry={() => undefined} />
        </div>
      </Section>

      <Section title="Breadcrumb and page header">
        <Breadcrumb items={[{ label: 'Action Center', to: '/officer' }, { label: 'S-2026-0101' }]} />
      </Section>
    </div>
  );
}
