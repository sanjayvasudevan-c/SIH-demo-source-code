import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/prefs';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  pending?: boolean;
  pendingLabel?: string;
  icon?: ReactNode;
  /** Shown on hover and announced when the button is disabled. */
  disabledReason?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-solid border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-primary border border-input hover:bg-subtle',
  tertiary: 'bg-transparent text-accent border border-transparent hover:bg-accent-soft',
  destructive: 'bg-danger text-on-solid border border-danger hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', pending, pendingLabel, icon, disabledReason, disabled, className, children, type, ...rest },
  ref,
) {
  const en = useT();
  const reasonId = useId();
  const isDisabled = disabled || pending;
  return (
    <>
      <button
        ref={ref}
        type={type ?? 'button'}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
        title={disabled && disabledReason ? disabledReason : undefined}
        className={cx(
          'hit inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap transition-colors duration-150 ease-out',
          size === 'md' ? 'h-control px-4 text-base' : 'h-control-sm px-3 text-sm',
          variants[variant],
          isDisabled && 'cursor-not-allowed opacity-50 hover:opacity-50',
          className,
        )}
        {...rest}
      >
        {pending ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden /> : icon}
        <span>{pending ? pendingLabel ?? en.common.saving : children}</span>
      </button>
      {disabled && disabledReason ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'hit inline-flex h-control-sm w-control-sm items-center justify-center rounded text-secondary transition-colors duration-150 ease-out hover:bg-subtle hover:text-primary',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
