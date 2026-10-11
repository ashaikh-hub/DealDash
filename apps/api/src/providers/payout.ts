import { createHash } from 'node:crypto';
import type { PayoutInstruction, PayoutProvider, PayoutStatus } from './interfaces';

/**
 * Stage 9 (B2) payout adapters. No bank / payout vendor is selected yet (EXTERNAL PROVIDER DEPENDENCY): a real adapter implements the
 * same interface (instruction + status, signed status callbacks to /v1/webhooks/payouts). The MVP default is MANUAL.
 */

/** Manual payouts: finance pays from the bank and records the bank reference in DealDash (no instruction leaves DealDash). */
export class ManualPayoutProvider implements PayoutProvider {
  readonly name = 'manual';
  readonly sendsInstructions = false;
  instruct(): Promise<{ providerRef: string; status: PayoutStatus }> {
    return Promise.reject(
      new Error('PROVIDER_NOT_CONFIGURED: payouts are manual; record the bank reference instead'),
    );
  }
  getStatus(): Promise<{ status: PayoutStatus }> {
    return Promise.reject(new Error('PROVIDER_NOT_CONFIGURED'));
  }
}

/** Development adapter: accepts instructions (PENDING) and lets tests decide the outcome. Refused in production by the boot check. */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock';
  readonly sendsInstructions = true;
  private readonly outcomes = new Map<
    string,
    { status: PayoutStatus; failureReason?: string; bankRef?: string }
  >();
  /** Test hook: the next instructions fail at once (e.g. the bank rejects the destination). */
  failNext = 0;

  instruct(input: PayoutInstruction) {
    // deterministic reference per idempotency key: a retried call never creates a second payout at the provider
    const providerRef = `MPO-${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16).toUpperCase()}`;
    if (this.failNext > 0) {
      this.failNext--;
      this.outcomes.set(providerRef, { status: 'FAILED', failureReason: 'DESTINATION_REJECTED' });
      return Promise.resolve({
        providerRef,
        status: 'FAILED' as const,
        failureReason: 'DESTINATION_REJECTED',
      });
    }
    if (!this.outcomes.has(providerRef)) this.outcomes.set(providerRef, { status: 'PENDING' });
    return Promise.resolve({ providerRef, status: 'PENDING' as const });
  }

  getStatus(providerRef: string) {
    return Promise.resolve(
      this.outcomes.get(providerRef) ?? {
        status: 'FAILED' as const,
        failureReason: 'UNKNOWN_REFERENCE',
      },
    );
  }

  /** Test hook: the bank confirmed or rejected the payout. */
  settle(providerRef: string, status: 'PAID' | 'FAILED', bankRef?: string) {
    this.outcomes.set(providerRef, {
      status,
      bankRef,
      failureReason: status === 'FAILED' ? 'BANK_REJECTED' : undefined,
    });
  }
}
