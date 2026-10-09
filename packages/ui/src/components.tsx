import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ------------------------------------------------------------------ Button
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block,
    loading,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'dd-btn',
        `dd-btn--${variant}`,
        size === 'sm' && 'dd-btn--sm',
        block && 'dd-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="dd-spinner" aria-hidden="true" style={{ inlineSize: 16, blockSize: 16 }} />
      ) : null}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Field wrapper
export interface FieldProps {
  label: string;
  htmlFor?: string;
  help?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, help, error, children }: FieldProps) {
  return (
    <div className="dd-field">
      <label className="dd-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="dd-error" role="alert">
          {error}
        </span>
      ) : help ? (
        <span className="dd-help">{help}</span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Input, Select, Checkbox
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('dd-input', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx('dd-select', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className={cx('dd-checkbox', className)}>
      <input ref={ref} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
});

// ------------------------------------------------------------------ OTP input (digits stay LTR in RTL)
export interface OtpInputProps {
  length?: number;
  value?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
}

export function OtpInput({
  length = 6,
  value: controlled,
  onChange,
  onComplete,
  disabled,
  invalid,
  'aria-label': ariaLabel = 'Verification code',
}: OtpInputProps) {
  const [internal, setInternal] = useState('');
  const [focused, setFocused] = useState(false);
  const value = controlled ?? internal;
  const input = useRef<HTMLInputElement | null>(null);

  // ONE real input carries focus, paste, SMS autofill, backspace and screen-reader semantics; the boxes only draw it.
  const update = useCallback(
    (next: string) => {
      const clean = next.replace(/\D/g, '').slice(0, length);
      if (controlled === undefined) setInternal(clean);
      onChange?.(clean);
      if (clean.length === length) onComplete?.(clean);
    },
    [controlled, length, onChange, onComplete],
  );

  const active = Math.min(value.length, length - 1);
  return (
    <div
      className="dd-otp"
      dir="ltr"
      data-invalid={invalid || undefined}
      onClick={() => input.current?.focus()}
    >
      <input
        ref={input}
        className="dd-otp__input"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(e) => update(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
          e.preventDefault();
          update(e.clipboardData.getData('text'));
        }}
      />
      <div className="dd-otp__boxes" aria-hidden="true">
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cx(
              'dd-otp__box',
              focused && i === active && 'dd-otp__box--active',
              value[i] && 'dd-otp__box--filled',
            )}
          >
            {value[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Card, StatusChip, Alert
export function Card({
  children,
  flat,
  className,
  ...rest
}: {
  children: ReactNode;
  flat?: boolean;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('dd-card', flat && 'dd-card--flat', className)} {...rest}>
      {children}
    </div>
  );
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export function StatusChip({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={cx('dd-chip', `dd-chip--${tone}`)}>{children}</span>;
}

export interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
}
export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div
      className={cx('dd-alert', `dd-alert--${tone}`)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Modal and Drawer
interface DialogBaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}

function useDialogBehaviour(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The latest onClose is kept in a ref so a parent re-render (a new inline callback on every keystroke in a form)
  // never re-runs the effect, which would steal focus back to the dialog container.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Close',
}: DialogBaseProps) {
  const ref = useDialogBehaviour(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="dd-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="dd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dd-dialog-header">
          <h2 className="dd-title" id={titleId}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
            ×
          </Button>
        </div>
        {children}
        {footer ? <div className="dd-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Mobile bottom sheet: dialog semantics, Escape + focus return, backdrop tap closes unless `locked` (while submitting). */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Close',
  locked,
  testId,
}: DialogBaseProps & { locked?: boolean; testId?: string }) {
  const ref = useDialogBehaviour(open, () => {
    if (!locked) onClose();
  });
  const titleId = useId();
  if (!open) return null;
  return (
    <div
      className="dd-sheet-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}
    >
      <div
        ref={ref}
        className="dd-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={locked || undefined}
        tabIndex={-1}
        data-testid={testId}
      >
        <div className="dd-sheet__head">
          <h2 className="dd-title" id={titleId}>
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={closeLabel}
            disabled={locked}
          >
            ×
          </Button>
        </div>
        {children}
        {footer ? (
          <div className="dd-stack" style={{ gap: 10 }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Slides in from the inline-end edge (right in LTR, left in RTL) using flex direction, not physical sides. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Close',
}: DialogBaseProps) {
  const ref = useDialogBehaviour(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div
      className="dd-overlay dd-overlay--drawer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className="dd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dd-dialog-header">
          <h2 className="dd-title" id={titleId}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
            ×
          </Button>
        </div>
        {children}
        {footer ? <div className="dd-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs
export interface TabItem {
  id: string;
  label: string;
}
export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === value);
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight') onChange(tabs[(idx + dir + tabs.length) % tabs.length]!.id);
    if (e.key === 'ArrowLeft') onChange(tabs[(idx - dir + tabs.length) % tabs.length]!.id);
  };
  return (
    <div className="dd-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          className="dd-tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Table foundation
export interface TableColumn<Row> {
  key: string;
  header: string;
  /** Right-aligned in LTR, left-aligned in RTL, digits kept left-to-right. */
  numeric?: boolean;
  render?: (row: Row) => ReactNode;
}
export function Table<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
}: {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption?: string;
  empty?: ReactNode;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="dd-table-wrap">
      <table className="dd-table">
        {caption ? (
          <caption className="dd-caption" style={{ padding: 8 }}>
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'dd-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'dd-num' : undefined}>
                  {c.render ? c.render(row) : (row[c.key] as ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ States
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="dd-state" role="status">
      <div className="dd-state__title">{title}</div>
      {description ? <div>{description}</div> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="dd-state" role="status" aria-live="polite">
      <div className="dd-spinner" aria-hidden="true" />
      <div>{label}</div>
    </div>
  );
}

export function Skeleton({
  width = '100%',
  height = 14,
}: {
  width?: number | string;
  height?: number | string;
}) {
  return (
    <div
      className="dd-skeleton"
      aria-hidden="true"
      style={{ inlineSize: width, blockSize: height }}
    />
  );
}

export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="dd-state" role="alert">
      <div className="dd-state__title">{title}</div>
      {description ? <div>{description}</div> : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel ?? 'Try again'}
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Textarea
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx('dd-input', 'dd-textarea', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

// ------------------------------------------------------------------ Stepper (onboarding progress)
export interface StepItem {
  id: string;
  label: string;
  state: 'done' | 'current' | 'todo' | 'attention';
  hint?: string;
}
export function Stepper({
  steps,
  onSelect,
  label,
}: {
  steps: StepItem[];
  onSelect?: (id: string) => void;
  label: string;
}) {
  return (
    <ol className="dd-stepper" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.id} className={cx('dd-step', `dd-step--${s.state}`)}>
          <button
            type="button"
            className="dd-step__btn"
            aria-current={s.state === 'current' ? 'step' : undefined}
            onClick={() => onSelect?.(s.id)}
          >
            <span className="dd-step__dot" aria-hidden="true">
              {s.state === 'done' ? '✓' : s.state === 'attention' ? '!' : i + 1}
            </span>
            <span className="dd-step__text">
              <span className="dd-step__label">{s.label}</span>
              {s.hint ? <span className="dd-caption">{s.hint}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ Timeline (decision history, audit)
export interface TimelineItem {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  tone?: StatusTone;
}
export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol className="dd-timeline" aria-label={label}>
      {items.map((it) => (
        <li
          key={it.id}
          className={cx('dd-timeline__item', `dd-timeline__item--${it.tone ?? 'neutral'}`)}
        >
          <div className="dd-timeline__title">{it.title}</div>
          {it.meta ? <div className="dd-caption">{it.meta}</div> : null}
          {it.body ? <div className="dd-timeline__body">{it.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ Key / value list
export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="dd-kv">
      {items.map((it) => (
        <div key={it.label} className="dd-kv__row">
          <dt>{it.label}</dt>
          <dd>{it.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ File chooser (native input, styled as a button)
export interface FileFieldProps {
  id: string;
  label: string;
  accept: string;
  onFile: (file: File) => void;
  busy?: boolean;
  disabled?: boolean;
  fileName?: string | null;
  invalid?: boolean;
}
export function FileField({
  id,
  label,
  accept,
  onFile,
  busy,
  disabled,
  fileName,
  invalid,
}: FileFieldProps) {
  return (
    <div className="dd-file">
      <label
        htmlFor={id}
        className={cx(
          'dd-btn',
          'dd-btn--outline',
          'dd-btn--sm',
          (busy || disabled) && 'dd-file__disabled',
        )}
      >
        {busy ? (
          <span
            className="dd-spinner"
            aria-hidden="true"
            style={{ inlineSize: 16, blockSize: 16 }}
          />
        ) : null}
        {label}
      </label>
      <input
        id={id}
        className="dd-file__input"
        type="file"
        accept={accept}
        disabled={disabled || busy}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      {fileName ? <span className="dd-file__name dd-ltr">{fileName}</span> : null}
    </div>
  );
}
// ------------------------------------------------------------------ Brand
export function Wordmark() {
  return (
    <span className="dd-wordmark" aria-label="DealDash">
      Deal<i>Dash</i>
    </span>
  );
}
