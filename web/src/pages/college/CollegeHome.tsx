import { Link } from 'react-router-dom';
import { FilePlus2 } from 'lucide-react';
import { useApplications } from '../../api/hooks';
import { CaseTable } from '../../components/CaseTable';
import { PageHeader } from '../../components/ui';
import { useTitle } from '../../lib/useTitle';
import { NeedsFromYou } from './NeedsFromYou';
import { NoticesBanner } from '../public/Notices';

export function CollegeHomePage() {
  useTitle('My applications');
  const q = useApplications();
  return (
    <div className="flex flex-col gap-6">
      <NoticesBanner />
      <PageHeader
        title="My applications"
        description="Your institution's applications, where each one is, and what AICTE needs from you."
        actions={
          <Link to="/college/apply" className="hit inline-flex h-control items-center gap-2 rounded border border-accent bg-accent px-4 text-base font-medium text-on-solid hover:bg-accent-hover">
            <FilePlus2 size={16} strokeWidth={1.75} aria-hidden />
            Start a new application
          </Link>
        }
      />
      <NeedsFromYou rows={q.data?.rows} />
      <CaseTable
        caption="My applications"
        rows={q.data?.rows}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        onRetry={() => q.refetch()}
        cols={['no', 'type', 'tracker', 'status', 'holder', 'submitted']}
        emptyMessage="You have not submitted any applications yet."
        linkBase="/college/applications"
      />
    </div>
  );
}

