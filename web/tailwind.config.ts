import type { Config } from 'tailwindcss';

// Design tokens (v3 section 11.2, add-on B1). Colours are CSS variables defined in src/index.css so the
// high-contrast theme can swap them; sizes are rem so the A- / A / A+ controls scale the whole layout.
// No raw colour values anywhere else in the client.
const v = (name: string) => `var(--c-${name})`;
const colors = {
  transparent: 'transparent',
  current: 'currentColor',
  white: v('white'),
  page: v('page'),
  surface: v('surface'),
  subtle: v('subtle'),
  line: v('line'),
  input: v('input'),
  primary: v('primary'),
  secondary: v('secondary'),
  muted: v('muted'),
  scrim: v('scrim'),
  'on-solid': v('on-solid'),
  accent: { DEFAULT: v('accent'), hover: v('accent-hover'), soft: v('accent-soft'), contrast: v('accent-contrast') },
  success: { DEFAULT: v('success'), soft: v('success-soft') },
  warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
  danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
  neutral: { DEFAULT: v('neutral'), soft: v('neutral-soft') },
  gov: { ink: v('gov-ink'), 'ink-muted': v('gov-ink-muted'), nav: v('gov-nav'), saffron: v('gov-saffron'), 'on-dark': v('gov-on-dark'), mark: v('gov-mark') },
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
    colors,
    borderColor: { ...colors, DEFAULT: colors.line },
    textColor: colors,
    backgroundColor: colors,
    ringColor: colors,
    fontFamily: {
      sans: ['"Noto Sans"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
    },
    fontSize: {
      xs: ['0.75rem', '1rem'],
      sm: ['0.8125rem', '1.125rem'],
      base: ['0.875rem', '1.25rem'],
      lg: ['1rem', '1.5rem'],
      xl: ['1.25rem', '1.75rem'],
      '2xl': ['1.5rem', '2rem'],
      '3xl': ['1.75rem', '2.25rem'],
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    spacing: {
      0: '0px',
      px: '1px',
      0.5: '0.125rem',
      1: '0.25rem',
      1.5: '0.375rem',
      2: '0.5rem',
      3: '0.75rem',
      4: '1rem',
      6: '1.5rem',
      8: '2rem',
      12: '3rem',
      topbar: '3.5rem',
      sidebar: '15rem',
    },
    borderRadius: { none: '0px', DEFAULT: '4px', lg: '6px', full: '9999px' },
    boxShadow: { none: 'none', overlay: '0 4px 16px rgba(16,24,40,0.08)' },
    extend: {
      width: { num: '6rem', sidebar: '15rem', dialog: '30rem', 'dialog-lg': '40rem', control: '2.25rem', 'control-sm': '2rem' },
      height: { chart: '17.5rem', table: '70vh', topbar: '3.5rem', row: '2.75rem', control: '2.25rem', 'control-sm': '2rem', bar: '0.5rem' },
      minHeight: { control: '2.25rem', touch: '2.75rem', target: '1.5rem' },
      minWidth: { reason: '22.5rem', content: '12.5rem', control: '2.25rem', touch: '2.75rem', target: '1.5rem' },
      maxHeight: { table: '70vh' },
      maxWidth: { md: '28rem', viewport: 'calc(100vw - 32px)', content: '80rem', dialog: '30rem', 'dialog-lg': '40rem', prose: '40rem' },
      transitionDuration: { 150: '150ms', 200: '200ms' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: { rise: 'rise 200ms ease-out' },
    },
  },
  plugins: [],
} satisfies Config;
