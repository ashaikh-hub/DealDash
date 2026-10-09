import { describe, expect, it } from 'vitest';
import { decryptField, encryptField, hashPassword, safeEqual, verifyPassword } from './crypto';
import { decodeCursor, encodeCursor, parseSort } from './pagination';
import { base32Decode, base32Encode, generateTotpSecret, totpAt, verifyTotp } from './totp';
import { MockPaymentProvider, MockSmsProvider } from '../providers/mocks';

describe('password hashing', () => {
  it('verifies the right password and rejects wrong, empty and missing hashes', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'plaintext')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('field encryption', () => {
  const key = 'k'.repeat(40);
  it('round-trips and detects tampering or the wrong key', () => {
    const enc = encryptField('secret-value', key);
    expect(enc).not.toContain('secret-value');
    expect(decryptField(enc, key)).toBe('secret-value');
    expect(() => decryptField(enc, 'x'.repeat(40))).toThrow();
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptField(parts.join(':'), key)).toThrow();
  });
  it('safeEqual compares in constant time semantics', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC test vectors (6-digit truncation)', () => {
    expect(totpAt(secret, 59_000, 30, 8)).toBe('94287082');
    expect(totpAt(secret, 1_111_111_109_000, 30, 8)).toBe('07081804');
    expect(totpAt(secret, 59_000)).toBe('287082');
  });
  it('base32 round-trips and generates usable secrets', () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(verifyTotp(s, totpAt(s, Date.now()))).toBe(true);
    expect(verifyTotp(s, '000000', Date.now())).toBe(totpAt(s, Date.now()) === '000000');
  });
  it('accepts one step of clock drift but not more', () => {
    const s = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 120_000), now)).toBe(false);
  });
});

describe('pagination helpers', () => {
  it('round-trips cursors and rejects garbage', () => {
    const c = encodeCursor({ v: '2026-01-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor(c)).toEqual({ v: '2026-01-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
  it('parses sort direction', () => {
    expect(parseSort('-createdAt', { field: 'id', dir: 'asc' })).toEqual({
      field: 'createdAt',
      dir: 'desc',
    });
    expect(parseSort('nameEn', { field: 'id', dir: 'asc' })).toEqual({
      field: 'nameEn',
      dir: 'asc',
    });
    expect(parseSort(undefined, { field: 'id', dir: 'asc' })).toEqual({ field: 'id', dir: 'asc' });
  });
});

describe('provider mocks', () => {
  it('SMS mock records messages', async () => {
    const sms = new MockSmsProvider();
    await sms.send({ to: '+966500000001', templateKey: 'auth.otp', body: 'Your code is 123456' });
    expect(sms.lastTo('+966500000001')?.body).toContain('123456');
  });

  it('payment mock is idempotent per key and verifies webhook signatures', async () => {
    const pay = new MockPaymentProvider();
    const a = await pay.initiate({
      orderId: 'o1',
      amountHalalas: 8000,
      currency: 'SAR',
      idempotencyKey: 'key-1',
      returnUrl: 'http://x',
    });
    const b = await pay.initiate({
      orderId: 'o1',
      amountHalalas: 8000,
      currency: 'SAR',
      idempotencyKey: 'key-1',
      returnUrl: 'http://x',
    });
    expect(b.providerReference).toBe(a.providerReference);
    const body = JSON.stringify({
      eventId: 'e1',
      providerReference: a.providerReference,
      status: 'SUCCEEDED',
    });
    expect(pay.parseWebhook(body, MockPaymentProvider.sign(body))?.status).toBe('SUCCEEDED');
    expect(pay.parseWebhook(body, 'bad-signature')).toBeNull();
    expect(
      (
        await pay.refund({
          providerReference: a.providerReference,
          amountHalalas: 8000,
          idempotencyKey: 'r1',
        })
      ).status,
    ).toBe('FAILED');
    pay.settle(a.providerReference, 'SUCCEEDED');
    expect(
      (
        await pay.refund({
          providerReference: a.providerReference,
          amountHalalas: 8000,
          idempotencyKey: 'r2',
        })
      ).status,
    ).toBe('SUCCEEDED');
  });
});
