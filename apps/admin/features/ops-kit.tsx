'use client';

import { useState, type ReactNode } from 'react';
import { errorMessage, useApi, useAuth, useResource, type Resource } from '@dealdash/app-shell';
import {
  createTranslator,
  dictionaries,
  formatAmount,
  type DictionaryKey,
} from '@dealdash/localization';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  Textarea,
  type StatusTone,
} from '@dealdash/ui';

/**
 * Stage 8 admin operations kit: the states every operations screen shows (loading, empty, error, access denied), a command runner
 * that reports the translated result, money, translated codes with a safe fallback, and the reason field every decision needs.
 */
export const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
export const has = (key: string): key is DictionaryKey => key in dictionaries.en;

export function useT() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  /** A translated code, or the code itself when no copy exists yet (never a blank). */
  const code = (prefix: string, v: string | null | undefined) =>
    v ? (has(`${prefix}.${v}`) ? t(k(prefix, v)) : v) : '-';
  return { t, locale, code };
}

export const usePerms = () => useAuth().me?.permissions ?? [];

export const OPS_TONE: Record<string, StatusTone> = {
  // shared
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  APPLIED: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  ACTIVE: 'danger',
  LIFTED: 'neutral',
  EXPIRED: 'neutral',
  // settlement
  PENDING: 'neutral',
  ELIGIBLE: 'info',
  HELD: 'warning',
  DISPUTE_HOLD: 'warning',
  PARTIALLY_PAID: 'info',
  COMPLETED: 'success',
  REVERSED: 'danger',
  // reconciliation
  MATCHED: 'success',
  PARTIAL_MATCH: 'warning',
  MISSING_INTERNAL: 'danger',
  MISSING_EXTERNAL: 'danger',
  AMOUNT_MISMATCH: 'danger',
  DUPLICATE: 'danger',
  TIMING_DIFFERENCE: 'warning',
  MANUAL_REVIEW: 'warning',
  RESOLVED: 'success',
  // risk
  OPEN: 'warning',
  IN_REVIEW: 'info',
  CLEARED: 'success',
  CONFIRMED: 'danger',
  // moderation / reviews
  PENDING_REVIEW: 'warning',
  REPORTED: 'warning',
  HIDDEN: 'danger',
  RESTORED: 'success',
  PUBLISHED: 'success',
  REMOVED: 'neutral',
  // notifications
  QUEUED: 'neutral',
  SENT: 'info',
  DELIVERED: 'success',
  RETRYING: 'warning',
  SUPPRESSED: 'neutral',
  // SLA
  ON_TRACK: 'success',
  WARNING: 'warning',
  BREACHED: 'danger',
  MET: 'neutral',
  // data requests
  REQUESTED: 'info',
};

/** Runs a POST / PUT, shows the translated outcome and refreshes what changed. */
export function useOpsCommand() {
  const { call } = useApi();
  const { locale } = useAuth();
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(
    path: string,
    body: unknown,
    ok: string,
    after?: (d: T | null) => void | Promise<void>,
    method: 'POST' | 'PUT' = 'POST',
  ) => {
    setBusy(true);
    const r = await call<T>(method, path, { body, idempotent: true });
    setBusy(false);
    if (!r.ok) {
      setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
      return null;
    }
    setBanner({ tone: 'success', text: ok });
    await after?.(r.data);
    return r.data ?? ({} as T);
  };
  const node = banner ? (
    <div data-testid="ops-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: node };
}

/** Loading, access denied, error and empty states for one resource, then the content. */
export function OpsStates<T>({
  res,
  empty,
  emptyTitle,
  children,
}: {
  res: Resource<T>;
  empty?: (d: T) => boolean;
  emptyTitle?: string;
  children: (d: T) => ReactNode;
}) {
  const { t, locale } = useT();
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  if (res.errors.length) {
    const denied = res.errors.some(
      (e) => e.code === 'FORBIDDEN' || e.code === 'SCOPE_FORBIDDEN' || e.code === 'UNAUTHORIZED',
    );
    return (
      <div data-testid={denied ? 'ops-denied' : 'ops-error'}>
        {denied ? (
          <Alert tone="warning">{t('s8.state.denied')}</Alert>
        ) : (
          <ErrorState
            title={t('s8.state.error')}
            description={errorMessage(locale, res.errors)}
            retryLabel={t('s8.state.retry')}
            onRetry={() => void res.reload()}
          />
        )}
      </div>
    );
  }
  if (!res.data) return null;
  if (empty?.(res.data))
    return (
      <div data-testid="ops-empty">
        <EmptyState title={emptyTitle ?? t('s8.state.empty')} />
      </div>
    );
  return <>{children(res.data)}</>;
}

export function Money({
  minor,
  currency,
}: {
  minor: number | null | undefined;
  currency?: string | null;
}) {
  const { locale } = useT();
  if (minor === null || minor === undefined) return <span>-</span>;
  return <span className="dd-ltr">{formatAmount(locale, minor, currency || 'SAR')}</span>;
}

/** A reason every decision records (3 characters or more); the button stays disabled until it is given. */
export function ReasonField({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { t } = useT();
  return (
    <Field label={label ?? t('s8.reason')} htmlFor={id} help={t('s8.reasonHelp')}>
      <Textarea
        id={id}
        rows={2}
        value={value}
        maxLength={1000}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export const reasonOk = (v: string) => v.trim().length >= 3;

type ReasonList = Array<{ code: string; en: string; ar: string }>;
/** A reason code chosen from the configured list (operations.reasons.<kind>). */
export function ReasonCodePicker({
  id,
  kind,
  value,
  onChange,
}: {
  id: string;
  kind: 'refund' | 'dispute' | 'adjustment' | 'hold' | 'moderation';
  value: string;
  onChange: (v: string) => void;
}) {
  const { t, locale } = useT();
  const res = useResource<Record<string, ReasonList>>('/v1/admin/ops/reasons');
  const list = res.data?.[kind] ?? [];
  return (
    <Field label={t('s8.reasonCode')} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('s8.choose')}</option>
        {list.map((r) => (
          <option key={r.code} value={r.code}>
            {locale === 'ar' ? r.ar : r.en}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Header of an operations page: title, a short description and optional actions. */
export function OpsHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="dd-row"
      style={{
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <h1 className="dd-title-xl">{title}</h1>
        {intro ? (
          <p className="dd-muted" style={{ margin: 0, maxWidth: 760 }}>
            {intro}
          </p>
        ) : null}
      </div>
      {actions ? <div className="dd-row">{actions}</div> : null}
    </div>
  );
}

/** A second-person decision: approve / reject with a reason. Hidden from the requester (the server refuses them anyway). */
export function DecisionBar({
  id,
  canDecide,
  onDecide,
  busy,
  waitingNote,
}: {
  id: string;
  canDecide: boolean;
  onDecide: (approve: boolean, reason: string) => void;
  busy: boolean;
  waitingNote?: string;
}) {
  const { t } = useT();
  const [reason, setReason] = useState('');
  if (!canDecide)
    return (
      <p className="dd-caption" data-testid={`ops-awaiting-${id}`}>
        {waitingNote ?? t('s8.awaitingOther')}
      </p>
    );
  return (
    <div className="dd-stack" style={{ gap: 6 }}>
      <ReasonField id={`dec-${id}`} value={reason} onChange={setReason} />
      <div className="dd-row">
        <Button
          size="sm"
          disabled={!reasonOk(reason) || busy}
          onClick={() => onDecide(true, reason)}
          data-testid={`ops-approve-${id}`}
        >
          {t('s8.approve')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!reasonOk(reason) || busy}
          onClick={() => onDecide(false, reason)}
          data-testid={`ops-reject-${id}`}
        >
          {t('s8.reject')}
        </Button>
      </div>
    </div>
  );
}
