const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct 2026" from an ISO date or timestamp. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "24 Oct 2026, 14:05" (24-hour, IST for display). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const ist = new Date(d.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hh}:${mm}`;
}

const nf = new Intl.NumberFormat('en-IN');
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function formatNumber(n: number | null | undefined, decimals = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return decimals ? nf2.format(n) : nf.format(n);
}

/** "in 4 working days", "today", "3 days overdue" */
export function relativeDays(days: number | null | undefined, unit: 'WORKING' | 'CALENDAR' = 'WORKING'): string {
  if (days === null || days === undefined) return '';
  const u = unit === 'WORKING' ? 'working day' : 'day';
  if (days === 0) return 'due today';
  if (days > 0) return `in ${days} ${u}${days === 1 ? '' : 's'}`;
  const n = Math.abs(days);
  return `${n} ${u}${n === 1 ? '' : 's'} overdue`;
}

export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    COLLEGE: 'College',
    OFFICER: 'Officer',
    SENIOR: 'Senior officer',
    SUPER_SENIOR: 'Super senior officer',
    HOD: 'Head of department',
    BUREAU: 'Bureau',
    COMMITTEE: 'Committee member',
    AUTHORITY: 'Competent authority',
    ADMIN: 'Administrator',
    RULE_EDITOR: 'Rule editor',
    RULE_APPROVER: 'Rule approver',
  };
  return map[role] ?? role;
}

export function sentence(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
