'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@dealdash/app-shell';
import { createTranslator, withLocale, type DictionaryKey } from '@dealdash/localization';
import type { VoucherStatus } from '@dealdash/types';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  StatusChip,
  Textarea,
  type StatusTone,
} from '@dealdash/ui';

export const VOUCHER_TONE: Record<VoucherStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  REJECTED: 'danger',
  SCHEDULED: 'info',
  ON_SALE: 'success',
  PAUSED: 'neutral',
  SOLD_OUT: 'warning',
  ENDED: 'neutral',
  SUSPENDED: 'danger',
};

export function VoucherStatusChip({ status }: { status: VoucherStatus }) {
  const { locale } = useAuth();
  return (
    <StatusChip tone={VOUCHER_TONE[status]}>
      {createTranslator(locale)(`vstatus.${status}` as DictionaryKey)}
    </StatusChip>
  );
}

/** Campaigns area: Live Deals, Exclusive Deals and Vouchers share it; this switch moves between the lists. */
export function CampaignTypeSwitch({ current }: { current: 'live' | 'hot' | 'voucher' }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const items = [
    ['live', '/deals', t('mh.tabLive')],
    ['hot', '/deals/hot', t('mh.tabHot')],
    ['voucher', '/vouchers', t('mv.tab')],
  ] as const;
  return (
    <nav className="dd-segment" aria-label={t('nav.campaigns')} data-testid="deals-type-switch">
      {items.map(([k, href, label]) => (
        <Link
          key={k}
          href={withLocale(href, locale)}
          aria-current={current === k ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** SAR text for a halala amount ("80", "125.5") and back; the API only ever sees integer halalas. */
export const halalasToInput = (h: number): string =>
  h === 0
    ? ''
    : (h / 100)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
export const inputToHalalas = (s: string): number => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

/** Which builder step a content field belongs to (for "Fix" links and step badges). */
export function stepOfVoucherField(field: string): number {
  if (
    [
      'categoryId',
      'faceValueHalalas',
      'sellingPriceHalalas',
      'totalQty',
      'perCustomerLimit',
    ].includes(field)
  )
    return 0;
  if (['title', 'shortDescription', 'description', 'redemptionRules', 'media'].includes(field))
    return 1;
  if (field.startsWith('validity') || ['saleStartAt', 'saleEndAt'].includes(field)) return 2;
  if (field === 'branchIds') return 3;
  if (field === 'eligibility' || field.startsWith('terms')) return 4;
  return 0;
}

/** A confirmation with a recorded reason (required unless `optional`). */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  optional,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
  children?: ReactNode;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const ok = optional || reason.trim().length >= 3;
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!ok}
            loading={busy}
            data-testid="confirm-reason"
            onClick={async () => {
              setBusy(true);
              const e = await onConfirm(reason.trim());
              setBusy(false);
              setError(e);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        {body ? <p>{body}</p> : null}
        {children}
        <Field label={`${t('mv.reason')}${optional ? '' : ' *'}`} htmlFor="reason">
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

export { Input };
