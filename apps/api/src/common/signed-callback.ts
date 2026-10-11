import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stage 9: provider callbacks DealDash defines (payout status, notification delivery receipts) are signed as
 *   X-DealDash-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 * A callback is accepted only with a valid signature over the exact bytes received, within the freshness window (replay
 * protection); duplicates are harmless because every handler is idempotent. Real vendors that sign differently get an adapter
 * that verifies their scheme and calls the same handlers.
 */
export function signCallback(
  secret: string,
  rawBody: string,
  t = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export function verifyCallback(
  secret: string | undefined,
  rawBody: string | undefined,
  header: string | undefined,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  if (!secret || !rawBody || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=') as [string, string]),
  );
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isFinite(t) || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
