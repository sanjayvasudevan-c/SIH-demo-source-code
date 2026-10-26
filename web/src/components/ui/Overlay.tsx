import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, CheckCircle2 } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/prefs';
import { Button } from './Button';
import { Field, Textarea } from './Form';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

/** Modal dialog: title as the question, focus trapped and returned, Escape closes. */
export function Dialog({ open, title, onClose, children, footer, size = 'md' }: DialogProps) {
  const en = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement;
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      returnTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim p-4 pt-12">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('w-full animate-rise rounded-lg border bg-surface shadow-overlay', size === 'lg' ? 'max-w-dialog-lg' : 'max-w-dialog')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab' && panel.current) {
            const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (els.length === 0) return;
            const first = els[0]!;
            const last = els[els.length - 1]!;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" aria-label={en.common.close} onClick={onClose} className="hit -mr-2 -mt-1 inline-flex h-control-sm w-control-sm items-center justify-center rounded text-secondary hover:bg-subtle">
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-3 border-t px-6 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const en = useT();
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{en.common.cancel}</Button>
          <Button variant={destructive ? 'destructive' : 'primary'} pending={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-secondary">{body}</div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  pending,
  error,
  reasonLabel,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  reasonLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const en = useT();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const missing = reason.trim().length === 0;
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{en.common.cancel}</Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            pending={pending}
            onClick={() => {
              setTouched(true);
              if (!missing) onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-base text-secondary">{body}</div>
        {children}
        <Field label={reasonLabel ?? en.common.reason} hint={en.common.reasonHint} error={touched && missing ? en.common.reasonRequired : null}>
          {({ id, describedBy, invalid }) => (
            <Textarea id={id} data-autofocus aria-describedby={describedBy} invalid={invalid} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} rows={3} />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function Menu({ label, items }: { label: string; items: { label: string; onSelect: () => void; destructive?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative inline-block">
      <Button ref={btn} size="sm" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
      </Button>
      {open ? (
        <ul
          ref={list}
          id={menuId}
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-max animate-rise rounded-lg border bg-surface py-1 shadow-overlay"
          onKeyDown={(e) => {
            const els = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
            const i = els.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              els[(i + 1) % els.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              els[(i - 1 + els.length) % els.length]?.focus();
            } else if (e.key === 'Escape') {
              setOpen(false);
              btn.current?.focus();
            }
          }}
        >
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cx('hit block w-full px-4 py-2 text-left text-base hover:bg-subtle focus-visible:bg-subtle', it.destructive ? 'text-danger' : 'text-primary')}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ToastItem {
  id: number;
  message: string;
}
const ToastCtx = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string) => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="flex max-w-dialog animate-rise items-center gap-2 rounded-lg border bg-surface px-4 py-3 text-base shadow-overlay">
            <CheckCircle2 size={16} strokeWidth={1.75} className="text-success" aria-hidden />
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
