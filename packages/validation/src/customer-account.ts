import { z } from 'zod';

/**
 * Customer account (Blueprint §5 onboarding; Customer MVP CS-02 profile set-up, CS-05 account settings, CS-06 notifications):
 * personal details, date of birth with the minimum-age check (AU-31), optional gender (never used for targeting, VK-06), city,
 * interests, consents (Terms / Privacy required and versioned; marketing separate and optional per channel, NT-40), notification
 * choices and the mobile-number change by code.
 */
export const CONSENT_KINDS = [
  'TERMS',
  'PRIVACY',
  'MARKETING_PUSH',
  'MARKETING_EMAIL',
  'LOCATION',
  'NOTIFICATIONS',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const GENDERS = ['FEMALE', 'MALE', 'PREFER_NOT_TO_SAY'] as const;
export const UI_LANGUAGES = ['en', 'ar', 'ur'] as const;

/** Wizard order (CS-02). GENDER and INTERESTS are optional and can be skipped (completed later from Profile). */
export const ONBOARDING_STEPS = [
  'DETAILS',
  'BIRTH_DATE',
  'GENDER',
  'CITY',
  'INTERESTS',
  'CONSENTS',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'DETAILS',
  'BIRTH_DATE',
  'CITY',
  'CONSENTS',
];

export const ONBOARDING_STATES = [
  'PHONE_VERIFIED',
  'PROFILE_IN_PROGRESS',
  'COMPLETE',
  'AGE_BLOCKED',
] as const;

const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter the number with its country code, for example +966…');

// ---------------------------------------------------------------- requests
export const customerProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  /** Needed for receipts (FDC-03); not separately verified. */
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  /** YYYY-MM-DD. Set once: read-only after the age check passed. */
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
    .optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  city: z.string().trim().min(1).max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  /** NT-43: the language notifications use. */
  language: z.enum(UI_LANGUAGES).optional(),
});
export type CustomerProfileUpdate = z.infer<typeof customerProfileUpdateSchema>;

export const customerConsentsUpdateSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(CONSENT_KINDS), granted: z.boolean() }))
    .min(1)
    .max(CONSENT_KINDS.length),
  source: z.enum(['ONBOARDING', 'SETTINGS']).default('SETTINGS'),
});
export type CustomerConsentsUpdate = z.infer<typeof customerConsentsUpdateSchema>;

export const OPTIONAL_NOTIFICATION_CATEGORIES = ['REWARDS', 'BENEFITS'] as const;
export const customerNotificationSettingsUpdateSchema = z.object({
  categories: z
    .array(z.object({ category: z.enum(OPTIONAL_NOTIFICATION_CATEGORIES), push: z.boolean() }))
    .max(OPTIONAL_NOTIFICATION_CATEGORIES.length)
    .default([]),
});
export type CustomerNotificationSettingsUpdate = z.infer<
  typeof customerNotificationSettingsUpdateSchema
>;

export const customerMobileStartSchema = z.object({ mobile: e164 });
export const customerMobileVerifySchema = z.object({
  mobile: e164,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// ---------------------------------------------------------------- responses
export const customerConsentViewSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  granted: z.boolean(),
  version: z.string().nullable(),
  at: z.string(),
});

export const customerProfileSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  /** e.g. "+966 •••• 4567": never the full number in lists, the customer knows their own number. */
  mobileMasked: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  ageVerified: z.boolean(),
  gender: z.enum(GENDERS).nullable(),
  city: z.string().nullable(),
  interests: z.array(z.string()),
  language: z.enum(UI_LANGUAGES),
  onboarding: z.object({
    state: z.enum(ONBOARDING_STATES),
    /** Profile complete AND the current Terms / Privacy accepted: reserve, buy, earn and redeem are open. */
    ready: z.boolean(),
    missing: z.array(z.enum(ONBOARDING_STEPS)),
    nextStep: z.enum(ONBOARDING_STEPS).nullable(),
    /** True when Terms or Privacy changed since the customer accepted them. */
    consentsOutdated: z.boolean(),
    minimumAge: z.number().int(),
  }),
  consents: z.array(customerConsentViewSchema),
  documents: z.object({
    termsVersion: z.string(),
    privacyVersion: z.string(),
    termsUrl: z.string().nullable(),
    privacyUrl: z.string().nullable(),
  }),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

export const customerNotificationSettingsSchema = z.object({
  categories: z.array(
    z.object({
      category: z.enum(['ORDERS', 'ACCOUNT', 'REWARDS', 'BENEFITS']),
      /** Transactional: always on (NT-40). */
      required: z.boolean(),
      push: z.boolean(),
    }),
  ),
  /** The NOTIFICATIONS consent: push to this account at all. */
  pushAllowed: z.boolean(),
  marketing: z.object({ push: z.boolean(), email: z.boolean() }),
});
export type CustomerNotificationSettings = z.infer<typeof customerNotificationSettingsSchema>;

export const customerMobileStartResultSchema = z.object({
  sent: z.boolean(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});
