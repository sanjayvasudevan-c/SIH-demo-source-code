// Home and sign in (add-on B2): the current cycle's schedule, recent changes and quick links on the left; the
// sign-in card with the demo user picker on the right. No hero banner, carousel or stock photos.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, LifeBuoy, ListChecks, Search } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { DemoUser, Role } from '../api/types';
import { homeFor, useAuth } from '../auth/AuthContext';
import { useT } from '../lib/prefs';
import { formatDate, roleLabel } from '../lib/format';
import { useTitle } from '../lib/useTitle';
import { Button, ErrorSummary, Field, Input } from '../components/ui';
import { useCurrentRules } from '../components/shell/Shell';
import { KIND_LABEL, type PublicNotice, type PublicScheduleRow } from './rules/types';

const ROLE_ORDER: Role[] = ['COLLEGE', 'OFFICER', 'SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU', 'COMMITTEE', 'AUTHORITY', 'ADMIN', 'RULE_EDITOR', 'RULE_APPROVER'];
const cycleText = (c: string) => c.replace('-', '–');

function LoginCard() {
  const t = useT();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const [pending, setPending] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const demo = useQuery({ queryKey: ['demo-users'], queryFn: () => api.get<{ users: DemoUser[] }>('/auth/demo-users'), retry: false });

  useEffect(() => {
    if (errors.length) summary.current?.focus();
  }, [errors]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: { field: string; message: string }[] = [];
    if (!email.trim()) errs.push({ field: 'email', message: t.login.emailRequired });
    if (!password) errs.push({ field: 'password', message: t.login.passwordRequired });
    setErrors(errs);
    if (errs.length) return;
    setPending(true);
    try {
      const u = await login(email.trim(), password);
      navigate(homeFor(u), { replace: true });
    } catch (err) {
      setErrors([{ field: 'email', message: err instanceof ApiError ? err.message : 'Sign-in failed. Try again.' }]);
    } finally {
      setPending(false);
    }
  }

  const groups = ROLE_ORDER.map((r) => ({ role: r, users: (demo.data?.users ?? []).filter((u) => u.role === r) })).filter((g) => g.users.length);
  const fieldError = (f: string) => errors.find((e) => e.field === f)?.message ?? null;

  return (
    <section id="sign-in" aria-labelledby="sign-in-title" className="rounded-lg border bg-surface p-6">
      <h2 id="sign-in-title" className="text-2xl font-semibold">
        {t.login.title}
      </h2>
      <p className="mt-1 text-base text-secondary">{t.login.description}</p>
      <form className="mt-4 flex flex-col gap-4" onSubmit={submit} noValidate>
        <ErrorSummary ref={summary} errors={errors} title={t.login.errorSummary} />
        <Field id="email" label={t.login.email} error={fieldError('email')}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={describedBy} invalid={invalid} />}
        </Field>
        <Field id="password" label={t.login.password} error={fieldError('password')}>
          {({ id, describedBy, invalid }) => (
            <Input ref={passwordRef} id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={describedBy} invalid={invalid} />
          )}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" pending={pending} pendingLabel={t.login.signingIn}>
            {t.login.signIn}
          </Button>
        </div>
      </form>
      <p className="mt-4 border-t pt-3 text-sm text-secondary">{t.gov.prototype}</p>
      {groups.length ? (
        <div className="mt-4 border-t pt-4">
          <h3 className="text-lg font-semibold">{t.login.demoUsers}</h3>
          <p className="mt-1 text-sm text-secondary">{t.login.demoHint}</p>
          <div className="mt-3 flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.role}>
                <h4 className="text-xs font-semibold text-secondary">{t.roles[g.role] ?? roleLabel(g.role)}</h4>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {g.users.map((u) => (
                    <li key={u.email}>
                      <button
                        type="button"
                        onClick={() => {
                          setEmail(u.email);
                          setPassword('demo1234');
                          passwordRef.current?.focus();
                        }}
                        className="hit rounded border border-input bg-surface px-3 py-1 text-left text-sm hover:border-accent"
                      >
                        <span className="block font-medium text-primary">{u.institution ?? u.name}</span>
                        <span className="block text-xs text-muted">{u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SignedInCard() {
  const t = useT();
  const { user } = useAuth();
  return (
    <section className="rounded-lg border bg-surface p-6">
      <h2 className="text-2xl font-semibold">{user!.name}</h2>
      <p className="mt-1 text-base text-secondary">{t.roles[user!.role] ?? roleLabel(user!.role)}</p>
      <Link to={homeFor(user!)} className="hit mt-4 inline-flex h-control items-center rounded border border-accent bg-accent px-4 text-base font-medium text-on-solid hover:bg-accent-hover">
        {t.app.backHome}
      </Link>
    </section>
  );
}

function Tile({ to, icon, label, desc }: { to: string; icon: ReactNode; label: string; desc: string }) {
  return (
    <Link to={to} className="hit flex flex-col gap-1 rounded-lg border bg-surface p-4 no-underline hover:border-accent">
      <span className="text-accent">{icon}</span>
      <span className="text-base font-semibold text-primary">{label}</span>
      <span className="text-sm text-secondary">{desc}</span>
    </Link>
  );
}

export function LoginPage() {
  const t = useT();
  useTitle(t.publicNav.home);
  const { user } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const cur = useCurrentRules();
  const schedule = useQuery({ queryKey: ['public', 'schedule'], queryFn: () => api.get<{ schedule: PublicScheduleRow[] }>('/rules/public/schedule') });
  const notices = useQuery({ queryKey: ['public', 'notices'], queryFn: () => api.get<{ notices: PublicNotice[] }>('/rules/public/notices') });

  // /login sends a signed-in user to their work; the home page shows them a link instead.
  useEffect(() => {
    if (user && loc.pathname === '/login') navigate(homeFor(user), { replace: true });
  }, [user, loc.pathname, navigate]);

  const current = cur.data?.cycle;
  const rows = (schedule.data?.schedule ?? []).filter((s) => !current || s.cycle === current);
  return (
    <div className="mx-auto grid max-w-content grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-7">
        <section aria-labelledby="cycle" className="rounded-lg border bg-surface p-4">
          <h1 id="cycle" className="text-2xl font-semibold">
            {current ? t.home.cycleTitle(cycleText(current)) : t.publicNav.home}
          </h1>
          <p className="mt-1 text-base text-secondary">{t.home.cycleIntro}</p>
          <div className="mt-3 overflow-x-auto" role="region" aria-label={t.notices.schedule} tabIndex={0}>
            <table className="w-full text-left text-base">
              <caption className="sr-only">{t.notices.schedule}</caption>
              <thead className="border-b text-sm text-secondary">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t.home.window}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t.home.from}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t.home.to}</th>
                  <th scope="col" className="py-2 font-medium">{t.home.appliesTo}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">{s.label}</td>
                    <td className="tnum whitespace-nowrap py-2 pr-3">{formatDate(s.from)}</td>
                    <td className="tnum whitespace-nowrap py-2 pr-3">{formatDate(s.to)}</td>
                    <td className="py-2">{s.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="recent" className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 id="recent" className="text-xl font-semibold">
              {t.home.recent}
            </h2>
            <Link to="/notices" className="text-base text-accent underline">
              {t.home.allChanges}
            </Link>
          </div>
          <ul className="mt-2 divide-y">
            {(notices.data?.notices ?? []).slice(0, 3).map((n) => (
              <li key={n.versionId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className="block text-base font-medium">{n.title}</span>
                  <span className="block text-sm text-secondary">
                    {KIND_LABEL[n.kind] ?? n.kind} · {n.refNo} · {formatDate(n.issuedOn)}
                  </span>
                </span>
                <Link to="/notices" className="text-base text-accent underline">
                  {t.common.read}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="quick">
          <h2 id="quick" className="mb-2 text-xl font-semibold">
            {t.home.quickLinks}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile to="/process" icon={<ListChecks size={20} aria-hidden />} label={t.publicNav.process} desc={t.home.processDesc} />
            <Tile to="/notices" icon={<BookOpen size={20} aria-hidden />} label={t.publicNav.changed} desc={t.home.changedDesc} />
            <Tile to="/track" icon={<Search size={20} aria-hidden />} label={t.publicNav.track} desc={t.home.trackDesc} />
            <Tile to="/help" icon={<LifeBuoy size={20} aria-hidden />} label={t.publicNav.help} desc={t.home.helpDesc} />
          </div>
        </section>
      </div>
      <div className="lg:col-span-5">{user ? <SignedInCard /> : <LoginCard />}</div>
    </div>
  );
}
