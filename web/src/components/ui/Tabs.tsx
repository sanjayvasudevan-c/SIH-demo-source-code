import { useId, useRef, type ReactNode } from 'react';
import { cx } from '../../lib/format';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({ tabs, value, onChange, label, children }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void; label: string; children?: ReactNode }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-4 border-b">
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`${base}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={children !== undefined ? `${base}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => {
                let j = -1;
                if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
                if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
                if (j >= 0) {
                  e.preventDefault();
                  onChange(tabs[j]!.id);
                  refs.current[j]?.focus();
                }
              }}
              className={cx(
                'hit -mb-px border-b-2 px-1 py-2 text-base transition-colors duration-150 ease-out',
                selected ? 'border-accent font-semibold text-accent' : 'border-transparent font-medium text-secondary hover:text-primary',
              )}
            >
              {t.label}
              {t.count !== undefined ? <span className="tnum ml-2 rounded bg-subtle px-1.5 text-xs text-secondary">{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children !== undefined ? (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="pt-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
