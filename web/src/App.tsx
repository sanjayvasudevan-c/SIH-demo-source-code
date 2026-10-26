import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Role } from './api/types';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import { LoginPage } from './pages/Login';
import { NoAccessPage } from './pages/NoAccess';
import { StyleguidePage } from './pages/Styleguide';
import { CollegeHomePage } from './pages/college/CollegeHome';
import { ApplyPage } from './pages/college/Apply';
import { CollegeCasePage } from './pages/college/CollegeCase';
import { OfficerHomePage } from './pages/officer/OfficerHome';
import { CaseViewPage } from './pages/CaseView';
import { AuthorityQueuePage, BureauQueuePage, CommitteeQueuePage, EvcQueuePage } from './pages/Queues';
import { AvailabilityPage } from './pages/Availability';
import { AdminPage } from './pages/admin/Admin';
import { TeamPage } from './pages/manager/Team';
import { WorkforcePage } from './pages/manager/Workforce';
import { CompliancePage } from './pages/college/Compliance';
import { RulesHomePage } from './pages/rules/RulesHome';
import { DiffPage, ImpactPage, ReviewPage, VersionPage } from './pages/rules/VersionPage';
import { NoticesInAppPage, NoticesPage } from './pages/public/Notices';
import { PublicShell } from './components/shell/Shell';
import { PUBLIC_PAGES } from './sitemap';
import {
  AccessibilityPage,
  ContactPage,
  CopyrightPage,
  HelpPage,
  HyperlinkingPage,
  PrivacyPage,
  ProcessPage,
  ScreenReaderPage,
  SitemapPage,
  TermsPage,
  TrackPage,
} from './pages/public/PublicPages';

/** Elements of the public pages, keyed by the paths in sitemap.ts. */
const PUBLIC_ELEMENTS: Record<string, ReactNode> = {
  '/': <LoginPage />,
  '/process': <ProcessPage />,
  '/notices': <NoticesPage />,
  '/track': <TrackPage />,
  '/help': <HelpPage />,
  '/contact': <ContactPage />,
  '/screen-reader': <ScreenReaderPage />,
  '/accessibility': <AccessibilityPage />,
  '/sitemap': <SitemapPage />,
  '/terms': <TermsPage />,
  '/privacy': <PrivacyPage />,
  '/hyperlinking': <HyperlinkingPage />,
  '/copyright': <CopyrightPage />,
};

const MANAGERS: Role[] = ['SENIOR', 'SUPER_SENIOR', 'HOD'];
// Rules Center: editors and approvers work there; admin, HoD and Bureau read it.
const RULES: Role[] = ['RULE_EDITOR', 'RULE_APPROVER', 'ADMIN', 'HOD', 'BUREAU'];

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <NoAccessPage />;
  return <>{children}</>;
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="p-6">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return <Layout />;
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/login" element={<LoginPage />} />
        {PUBLIC_PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={PUBLIC_ELEMENTS[p.path]} />
        ))}
      </Route>
      <Route element={<Protected />}>
        <Route path="/college" element={<RequireRole roles={['COLLEGE']}><CollegeHomePage /></RequireRole>} />
        <Route path="/college/apply" element={<RequireRole roles={['COLLEGE']}><ApplyPage /></RequireRole>} />
        <Route path="/college/applications/:id" element={<RequireRole roles={['COLLEGE']}><CollegeCasePage /></RequireRole>} />
        <Route path="/college/compliance" element={<RequireRole roles={['COLLEGE']}><CompliancePage /></RequireRole>} />
        <Route path="/cases/:id" element={<CaseViewPage />} />
        <Route path="/officer" element={<RequireRole roles={['OFFICER', 'BUREAU']}><OfficerHomePage /></RequireRole>} />
        <Route path="/evc" element={<RequireRole roles={['OFFICER', 'BUREAU']}><EvcQueuePage /></RequireRole>} />
        <Route path="/committee" element={<RequireRole roles={['COMMITTEE']}><CommitteeQueuePage /></RequireRole>} />
        <Route path="/authority" element={<RequireRole roles={['AUTHORITY']}><AuthorityQueuePage /></RequireRole>} />
        <Route path="/bureau" element={<RequireRole roles={['BUREAU']}><BureauQueuePage /></RequireRole>} />
        <Route path="/team" element={<RequireRole roles={MANAGERS}><TeamPage /></RequireRole>} />
        <Route path="/workforce" element={<RequireRole roles={[...MANAGERS, 'BUREAU']}><WorkforcePage /></RequireRole>} />
        <Route path="/availability" element={<RequireRole roles={['OFFICER', 'COMMITTEE', ...MANAGERS]}><AvailabilityPage /></RequireRole>} />
        <Route path="/college/notices" element={<RequireRole roles={['COLLEGE']}><NoticesInAppPage /></RequireRole>} />
        <Route path="/rules" element={<RequireRole roles={RULES}><RulesHomePage /></RequireRole>} />
        <Route path="/rules/versions/:id" element={<RequireRole roles={RULES}><VersionPage /></RequireRole>} />
        <Route path="/rules/versions/:id/diff" element={<RequireRole roles={RULES}><DiffPage /></RequireRole>} />
        <Route path="/rules/versions/:id/impact" element={<RequireRole roles={RULES}><ImpactPage /></RequireRole>} />
        <Route path="/rules/versions/:id/review" element={<RequireRole roles={['RULE_APPROVER']}><ReviewPage /></RequireRole>} />
        <Route path="/admin" element={<RequireRole roles={['ADMIN']}><AdminPage /></RequireRole>} />
        <Route path="/styleguide" element={<RequireRole roles={['ADMIN']}><StyleguidePage /></RequireRole>} />
        <Route path="*" element={<NoAccessPage />} />
      </Route>
    </Routes>
  );
}
