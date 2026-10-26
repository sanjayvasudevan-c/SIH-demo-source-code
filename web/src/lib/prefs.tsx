// Viewer preferences (add-on B3): text size, high contrast and language. Applied to <html> and remembered in
// localStorage (every access wrapped, so a blocked store only loses the memory, never the page).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Strings } from '../strings/en';
import { hi } from '../strings/hi';

export type TextSize = 'sm' | 'md' | 'lg' | 'xl';
export type Lang = 'en' | 'hi';

interface Prefs {
  textSize: TextSize;
  contrast: boolean;
  lang: Lang;
  setTextSize: (s: TextSize) => void;
  setContrast: (c: boolean) => void;
  setLang: (l: Lang) => void;
  t: Strings;
}

const KEY = 'approvalsetu.prefs';

function load(): Partial<Pick<Prefs, 'textSize' | 'contrast' | 'lang'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const warned = new Set<string>();

/** Hindi with English fallback for any missing key (logged once per key in development). */
function merge<T extends object>(base: T, over: unknown, path = ''): T {
  if (!over || typeof over !== 'object') {
    if (import.meta.env.DEV && path && !warned.has(path)) {
      warned.add(path);
      console.info(`[i18n] hi: missing ${path}, using English`);
    }
    return base;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    const o = (over as Record<string, unknown>)[k];
    if (v && typeof v === 'object') out[k] = merge(v as object, o, `${path}${k}.`);
    else if (o === undefined) {
      if (import.meta.env.DEV && !warned.has(path + k)) {
        warned.add(path + k);
        console.info(`[i18n] hi: missing ${path}${k}, using English`);
      }
      out[k] = v;
    } else out[k] = o;
  }
  return out as T;
}

const hiStrings = merge(en, hi);

const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [textSize, setTextSizeState] = useState<TextSize>(initial.textSize ?? 'md');
  const [contrast, setContrastState] = useState<boolean>(initial.contrast ?? false);
  const [lang, setLangState] = useState<Lang>(initial.lang ?? 'en');

  useEffect(() => {
    const html = document.documentElement;
    if (textSize === 'md') html.removeAttribute('data-text-size');
    else html.setAttribute('data-text-size', textSize);
    if (contrast) html.setAttribute('data-theme', 'contrast');
    else html.removeAttribute('data-theme');
    html.lang = lang;
    try {
      localStorage.setItem(KEY, JSON.stringify({ textSize, contrast, lang }));
    } catch {
      /* storage unavailable */
    }
  }, [textSize, contrast, lang]);

  const setTextSize = useCallback((s: TextSize) => setTextSizeState(s), []);
  const setContrast = useCallback((c: boolean) => setContrastState(c), []);
  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const value = useMemo(() => ({ textSize, contrast, lang, setTextSize, setContrast, setLang, t: lang === 'hi' ? hiStrings : en }), [textSize, contrast, lang, setTextSize, setContrast, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}

/** The strings for the current language. */
export function useT(): Strings {
  return usePrefs().t;
}
