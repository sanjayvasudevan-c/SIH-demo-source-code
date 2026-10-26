// Chart colours: the design tokens from tailwind.config.ts (Recharts needs raw values, so they are resolved here once).
import resolveConfig from 'tailwindcss/resolveConfig';
import config from '../../tailwind.config';

const theme = resolveConfig(config).theme as unknown as { colors: Record<string, string | Record<string, string>> };
const c = theme.colors;
const pick = (v: string | Record<string, string> | undefined) => (typeof v === 'string' ? v : v?.DEFAULT ?? '');

export default {
  neutral: pick(c.neutral),
  warning: pick(c.warning),
  danger: pick(c.danger),
  accent: pick(c.accent),
  grid: pick(c.line),
  axis: pick(c.muted),
  cursor: pick(c.subtle),
};
