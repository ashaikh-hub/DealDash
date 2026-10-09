import type { StatusTone } from '@dealdash/ui';

export const appTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_REVIEW: 'info',
  RESUBMITTED: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export const orgTone: Record<string, StatusTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
};

export const docTone: Record<string, StatusTone> = {
  UPLOADED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
};
