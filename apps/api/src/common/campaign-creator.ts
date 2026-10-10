import { AppError } from './errors';
import type { Actor } from './request-context';

/**
 * Stage 7: the Campaign Creator of a partner-created campaign (`content.commercial.creatorOrganizationId`).
 *
 *  - Only the partner portal (an actor carrying an in-process `partnerContext`) sets it, and only to its own partner organization.
 *  - A merchant's edit can never set, change or remove it: a missing value keeps the existing creator (the merchant's own builder
 *    does not know the field), any other value is refused.
 *
 * Returns the creator the saved content must carry.
 */
export function campaignCreator(
  actor: Actor | null,
  previous: string | null | undefined,
  next: string | null | undefined,
): string | null {
  const prev = previous ?? null;
  const nx = next ?? null;
  if (actor?.partnerContext) {
    const own = actor.partnerContext.partnerOrganizationId;
    if (prev !== null && prev !== own) throw AppError.notFound();
    return own;
  }
  if (nx === null || nx === prev) return prev;
  throw AppError.validation(
    'The partner that created this campaign cannot be changed',
    'commercial.creatorOrganizationId',
  );
}
