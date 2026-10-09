import { describe, expect, it } from 'vitest';
import {
  bilingualTextSchema,
  createBranchSchema,
  mobileSchema,
  otpRequestSchema,
  otpVerifySchema,
  paginationQuerySchema,
  passwordLoginSchema,
  sortQuerySchema,
} from './index';

describe('validation schemas', () => {
  it('accepts E.164 mobiles and rejects others', () => {
    expect(mobileSchema.safeParse('+966500000001').success).toBe(true);
    expect(mobileSchema.safeParse('0500000001').success).toBe(false);
    expect(mobileSchema.safeParse('+966 50').success).toBe(false);
  });

  it('validates OTP request/verify', () => {
    expect(
      otpRequestSchema.safeParse({ mobile: '+966500000001', audience: 'customer' }).success,
    ).toBe(true);
    expect(otpRequestSchema.safeParse({ mobile: '+966500000001', audience: 'admin' }).success).toBe(
      false,
    );
    expect(
      otpVerifySchema.safeParse({ mobile: '+966500000001', code: '12345', audience: 'staff' })
        .success,
    ).toBe(false);
    expect(
      otpVerifySchema.safeParse({ mobile: '+966500000001', code: '123456', audience: 'staff' })
        .success,
    ).toBe(true);
  });

  it('normalises email and limits audiences for password login', () => {
    const ok = passwordLoginSchema.parse({
      email: ' Owner@Example.COM ',
      password: 'longenough',
      audience: 'merchant',
    });
    expect(ok.email).toBe('owner@example.com');
    expect(
      passwordLoginSchema.safeParse({
        email: 'a@b.co',
        password: 'longenough',
        audience: 'customer',
      }).success,
    ).toBe(false);
  });

  it('applies pagination defaults and bounds', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(paginationQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('restricts sorting to an allow-list', () => {
    const s = sortQuerySchema(['createdAt', 'nameEn'] as const);
    expect(s.safeParse('createdAt').success).toBe(true);
    expect(s.safeParse('-nameEn').success).toBe(true);
    expect(s.safeParse('password').success).toBe(false);
    expect(s.safeParse(undefined).success).toBe(true);
  });

  it('requires both languages for bilingual text and valid coordinates for branches', () => {
    expect(bilingualTextSchema.safeParse({ en: 'Hi', ar: '' }).success).toBe(false);
    expect(bilingualTextSchema.safeParse({ en: 'Hi', ar: 'مرحبا' }).success).toBe(true);
    const base = {
      nameEn: 'A',
      nameAr: 'أ',
      addressEn: 'X',
      addressAr: 'س',
      city: 'Riyadh',
      latitude: 24.7,
      longitude: 46.7,
    };
    expect(createBranchSchema.safeParse(base).success).toBe(true);
    expect(createBranchSchema.safeParse({ ...base, latitude: 123 }).success).toBe(false);
  });
});
