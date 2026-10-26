// Portal shell (add-on B2): utility bar, header with the bilingual name block, navy navigation, "What's new"
// strip and footer, in the visual language of GIGW 3.0 portals. Our own name and monogram only: no official
// logo, emblem or flag, and the prototype label on every page.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogOut, Menu as MenuIcon, X } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { usePrefs, useT, type TextSize } from '../../lib/prefs';
import { cx, formatDate, roleLabel } from '../../lib/format';
import { homeFor } from '../../auth/AuthContext';
import type { ClockInfo } from '../../api/types';

declare const __BUILD_DATE__: string;

export function useCurrentRules() {
  return useQuery({ queryKey: ['public', 'current'], queryFn: () => api.get<{ cycle: string; version: number; label: string; effectiveFrom: string }>('/public/current'), staleTime: 60_000 });
}

function usePublicClock() {
  return useQuery({ queryKey: ['public', 'clock'], queryFn: () => api.get<Pick<ClockInfo, 'today' | 'simulated'>>('/public/clock'), refetchInterval: 30_000, retry: false });
}

const cycleText = (c: string) => c.replace('-', '–');

/** Our own monogram: the letters "AP" (Approval Platform) in a 2px-stroke square. */
export function Monogram({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0 text-gov-mark">
      <rect x="1" y="1" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor" fontFamily="'Noto Sans', sans-serif">
        AP
      </text>
    </svg>
  );
}

export function NameBlock({ compact }: { compact?: boolean }) {
  const t = useT();
  if (compact) {
    return (
      <span className="truncate text-lg font-semibold text-primary">
        {t.gov.name} <span className="font-normal text-muted">|</span> <span lang="hi">{t.gov.nameHi}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span lang="hi" className="text-lg font-semibold leading-tight text-primary">
        {t.gov.nameHi}
      </span>
      <span className="text-xl font-bold leading-tight text-primary">{t.gov.name}</span>
      <span className="hidden truncate text-sm text-secondary sm:block">{t.gov.subtitle}</span>
    </span>
  );
}

const SIZES: { id: TextSize; label: string; key: 'textSmaller' | 'textNormal' | 'textLarger' | 'textLargest' }[] = [
  { id: 'sm', label: 'A-', key: 'textSmaller' },
  { id: 'md', label: 'A', key: 'textNormal' },
  { id: 'lg', label: 'A+', key: 'textLarger' },
  { id: 'xl', label: 'A++', key: 'textLargest' },
];

/** Slim dark bar: prototype label; skip link, screen reader access, text size, contrast and language. */
export function UtilityBar({ publicPage }: { publicPage?: boolean }) {
  const width = publicPage ? 'mx-auto max-w-content' : '';
  const t = useT();
  const { textSize, setTextSize, contrast, setContrast, lang, setLang } = usePrefs();
  const sizes = publicPage ? SIZES : SIZES.slice(0, 3);
  const sep = <span aria-hidden className="h-3 w-px bg-gov-ink-muted opacity-60" />;
  const btn = 'hit inline-flex min-h-target items-center rounded px-1.5 text-gov-on-dark hover:underline focus-visible:ring-gov-saffron';
  return (
    <div className="bg-gov-ink text-xs text-gov-ink-muted">
      <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1', width)}>
        <p>{t.gov.prototype}</p>
        <ul aria-label={t.gov.utility} className="flex flex-wrap items-center gap-2">
          <li>
            <a href="#main" className={btn}>
              {t.app.skip}
            </a>
          </li>
          <li>{sep}</li>
          <li>
            <Link to="/screen-reader" className={btn}>
              {t.gov.screenReader}
            </Link>
          </li>
          <li>{sep}</li>
          <li>
            <div className="flex items-center gap-0.5" role="group" aria-label={t.gov.textSize}>
              {sizes.map((s) => (
                <button key={s.id} type="button" className={cx(btn, textSize === s.id && 'font-semibold underline')} aria-pressed={textSize === s.id} title={t.gov[s.key]} onClick={() => setTextSize(s.id)}>
                  {s.label}
                  <span className="sr-only"> ({t.gov[s.key]})</span>
                </button>
              ))}
            </div>
          </li>
          <li>{sep}</li>
          <li>
            <button type="button" className={btn} aria-pressed={contrast} onClick={() => setContrast(!contrast)}>
              {contrast ? t.gov.contrastOff : t.gov.contrast}
            </button>
          </li>
          <li>{sep}</li>
          <li>
            <div className="flex items-center gap-1" role="group" aria-label={t.gov.language}>
            <button type="button" lang="en" className={cx(btn, lang === 'en' && 'font-semibold underline')} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              English
            </button>
            <span aria-hidden>|</span>
            <button type="button" lang="hi" className={cx(btn, lang === 'hi' && 'font-semibold underline')} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>
              हिंदी
            </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}

export function CycleChip() {
  const t = useT();
  const cur = useCurrentRules();
  if (!cur.data) return null;
  return <span className="hidden whitespace-nowrap rounded border border-gov-nav px-2 py-0.5 text-sm font-medium text-gov-nav sm:inline">{t.gov.cycle(cycleText(cur.data.cycle))}</span>;
}

export function SimulatedDate() {
  const t = useT();
  const clock = usePublicClock();
  if (!clock.data?.simulated) return null;
  return (
    <span className="tnum hidden whitespace-nowrap rounded bg-warning-soft px-2 py-0.5 text-sm font-medium text-warning sm:inline">
      {t.app.simulatedDate}: {formatDate(clock.data.today)}
    </span>
  );
}

/** Signed-in user: name, role and sign out. */
export function UserMenu() {
  const t = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className="hit flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-subtle">
        <span className="hidden md:block">
          <span className="block text-base font-medium leading-tight text-primary">{user.name}</span>
          <span className="block text-xs text-secondary">
            {t.roles[user.role] ?? roleLabel(user.role)}
            {user.regionCode ? `, ${user.regionCode === 'SOUTH' ? 'South' : 'West'}` : ''}
          </span>
        </span>
        <span className="md:hidden text-base font-medium">{t.gov.userMenu}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 min-w-content rounded-lg border bg-surface p-1 shadow-overlay">
          <Link to={homeFor(user)} className="hit block rounded px-3 py-2 text-base hover:bg-subtle" onClick={() => setOpen(false)}>
            {t.nav.home}
          </Link>
          <button
            type="button"
            className="hit flex w-full items-center gap-2 rounded px-3 py-2 text-left text-base hover:bg-subtle"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            <LogOut size={16} aria-hidden /> {t.app.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PublicHeader() {
  const t = useT();
  const { user } = useAuth();
  return (
    <div className="border-b border-t-4 border-t-gov-saffron bg-surface">
      <div className="mx-auto flex min-h-[5.5rem] max-w-content items-center justify-between gap-4 px-4 py-2">
        <Link to="/" className="flex min-w-0 items-center gap-3 no-underline">
          <Monogram size={48} />
          <NameBlock />
        </Link>
        <div className="flex items-center gap-3">
          <CycleChip />
          <SimulatedDate />
          {user ? (
            <UserMenu />
          ) : (
            <Link to="/#sign-in" className="hit inline-flex h-control shrink-0 items-center whitespace-nowrap rounded border border-accent bg-accent px-4 text-base font-medium text-on-solid hover:bg-accent-hover">
              {t.gov.signIn}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PublicNav() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = [
    { to: '/', label: t.publicNav.home, end: true },
    { to: '/process', label: t.publicNav.process },
    { to: '/notices', label: t.publicNav.changed },
    { to: '/track', label: t.publicNav.track },
    { to: '/help', label: t.publicNav.help },
  ];
  const link = (it: (typeof items)[number]) => (
    <NavLink
      to={it.to}
      end={it.end}
      className={({ isActive }) => cx('hit flex h-12 items-center border-b-[3px] px-3 text-base font-medium text-gov-on-dark hover:underline focus-visible:ring-gov-saffron', isActive ? 'border-gov-saffron' : 'border-transparent')}
    >
      {it.label}
    </NavLink>
  );
  return (
    <nav aria-label={t.gov.mainNav} className="bg-gov-nav">
      <div className="mx-auto max-w-content px-4">
        <ul className="hidden md:flex">
          {items.map((it) => (
            <li key={it.to}>{link(it)}</li>
          ))}
        </ul>
        <div className="md:hidden">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="hit flex h-12 items-center gap-2 text-base font-medium text-gov-on-dark">
            {open ? <X size={20} aria-hidden /> : <MenuIcon size={20} aria-hidden />} {t.gov.menu}
          </button>
          {open ? (
            <ul className="pb-2">
              {items.map((it) => (
                <li key={it.to}>{link(it)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

interface Notice {
  versionId: string;
  title: string;
  issuedOn: string;
}

/** "What's new": the latest three published notices as links. Static (no scrolling). */
function NoticeStrip() {
  const t = useT();
  const q = useQuery({ queryKey: ['public', 'notices'], queryFn: () => api.get<{ notices: Notice[] }>('/rules/public/notices') });
  const latest = (q.data?.notices ?? []).slice(0, 3);
  return (
    <div className="border-b bg-surface">
      <div className="mx-auto flex min-h-[2.5rem] max-w-content items-stretch gap-3 px-4">
        <span className="flex items-center bg-gov-saffron px-3 text-sm font-semibold text-gov-ink">{t.gov.whatsNew}</span>
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 py-2 text-sm">
          {latest.map((n) => (
            <li key={n.versionId} className="min-w-0">
              <Link to="/notices" className="text-accent underline">
                {n.title}
              </Link>{' '}
              <span className="text-muted">({formatDate(n.issuedOn)})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FooterBar({ fluid }: { fluid?: boolean }) {
  const t = useT();
  const cur = useCurrentRules();
  return (
    <div className="bg-gov-ink text-sm text-gov-ink-muted">
      <div className={cx('flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3', !fluid && 'mx-auto max-w-content')}>
        <span>{t.gov.lastUpdated(formatDate(__BUILD_DATE__))}</span>
        {cur.data ? <span>{t.gov.rulesVersion(`${cycleText(cur.data.cycle)} v${cur.data.version}`)}</span> : null}
        <span>{t.gov.prototypeShort}</span>
      </div>
    </div>
  );
}

function FooterLinks({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-base font-semibold text-gov-on-dark">{title}</h2>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

function Footer() {
  const t = useT();
  const a = (to: string, label: string) => (
    <li>
      <Link to={to} className="text-gov-ink-muted underline hover:text-gov-on-dark">
        {label}
      </Link>
    </li>
  );
  return (
    <footer>
      <div className="bg-gov-ink text-sm text-gov-ink-muted">
        <div className="mx-auto grid max-w-content grid-cols-1 gap-6 border-b border-gov-nav px-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="mb-2 text-base font-semibold text-gov-on-dark">{t.footer.about}</h2>
            <p>{t.footer.aboutText}</p>
            <p className="mt-2">{t.gov.prototype}</p>
          </div>
          <FooterLinks title={t.footer.help}>
            {a('/help', t.footer.help)}
            {a('/screen-reader', t.gov.screenReader)}
            {a('/accessibility', t.footer.accessibility)}
            {a('/sitemap', t.footer.sitemap)}
          </FooterLinks>
          <FooterLinks title={t.footer.policies}>
            {a('/terms', t.footer.terms)}
            {a('/privacy', t.footer.privacy)}
            {a('/hyperlinking', t.footer.hyperlinking)}
            {a('/copyright', t.footer.copyright)}
          </FooterLinks>
          <div>
            <h2 className="mb-2 text-base font-semibold text-gov-on-dark">{t.footer.contact}</h2>
            <p>{t.footer.team}</p>
            <p>{t.footer.institute}</p>
            <p className="mt-2">
              <Link to="/contact" className="text-gov-ink-muted underline hover:text-gov-on-dark">
                {t.footer.contact}
              </Link>
            </p>
          </div>
        </div>
      </div>
      <FooterBar />
    </footer>
  );
}

/** Public pages: home and sign in, notices, track, process, help and the policy pages. */
export function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header>
        <UtilityBar publicPage />
        <PublicHeader />
        <PublicNav />
        <NoticeStrip />
      </header>
      <main id="main" tabIndex={-1} className="public-type flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
