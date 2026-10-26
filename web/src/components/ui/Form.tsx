import { forwardRef, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Paperclip } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/prefs';

const control =
  'block w-full rounded border border-input bg-surface px-3 text-base text-primary transition-shadow duration-150 ease-out placeholder:text-muted disabled:bg-subtle disabled:text-muted';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  /** Render the control with the ids it needs. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
  id?: string;
}

/** Label above, hint below, error below in danger with an icon (GOV.UK pattern). */
export function Field({ label, hint, error, optional, children, className, id: idProp }: FieldProps) {
  const en = useT();
  const auto = useId();
  const id = idProp ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-base font-medium text-primary">
        {label} {optional ? <span className="font-normal text-muted">{en.common.optional}</span> : null}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="flex items-center gap-1 text-sm text-danger">
          <AlertCircle size={16} strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Invalid = { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Invalid>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(control, 'h-control', invalid && 'border-danger', className)} {...rest} />;
});

export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Invalid>(function DateInput(props, ref) {
  return <Input ref={ref} type="date" {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Invalid>(function Select({ invalid, className, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cx(control, 'h-control pr-8', invalid && 'border-danger', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid>(function Textarea({ invalid, className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cx(control, 'py-2', invalid && 'border-danger', className)} {...rest} />;
});

export function Checkbox({ label, description, checked, onChange, disabled, id: idProp }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-d` : undefined}
        className="hit mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-accent"
      />
      <div>
        <label htmlFor={id} className="text-base text-primary">
          {label}
        </label>
        {description ? (
          <p id={`${id}-d`} className="text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function FileUpload({
  id,
  accept = '.pdf,.png,.jpg,.jpeg',
  onFile,
  fileName,
  buttonLabel = 'Choose file',
  describedBy,
  invalid,
  disabled,
}: {
  id?: string;
  accept?: string;
  onFile: (f: File | null) => void;
  fileName?: string | null;
  buttonLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const shown = fileName ?? local;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setLocal(f?.name ?? null);
          onFile(f);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={cx('hit inline-flex h-control-sm items-center gap-2 rounded border bg-surface px-3 text-sm font-medium text-primary hover:bg-subtle', invalid ? 'border-danger' : 'border-input')}
      >
        <Paperclip size={16} strokeWidth={1.75} aria-hidden />
        {buttonLabel}
      </button>
      <span className="truncate text-sm text-secondary">{shown ?? 'No file chosen. PDF, PNG or JPEG up to 10 MB.'}</span>
    </div>
  );
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-input bg-surface p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange(options[(i + 1) % options.length]!.value);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange(options[(i - 1 + options.length) % options.length]!.value);
              }
            }}
            className={cx(
              'hit h-control-sm rounded px-3 text-sm font-medium transition-colors duration-150 ease-out',
              selected ? 'bg-accent-soft text-accent' : 'text-secondary hover:text-primary',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Error summary shown at the top of a form after a failed submit; receives focus. */
export const ErrorSummary = forwardRef<HTMLDivElement, { errors: { field: string; message: string }[]; title?: string }>(function ErrorSummary({ errors, title }, ref) {
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-live="polite" className="rounded-lg border border-danger bg-danger-soft p-4">
      <h2 className="text-lg font-semibold text-danger">{title ?? 'There is a problem'}</h2>
      <ul className="mt-2 list-disc pl-6">
        {errors.map((e) => (
          <li key={e.field + e.message}>
            <a href={`#${e.field}`} className="text-danger underline">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});
