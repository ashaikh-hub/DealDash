import { z } from 'zod';
import {
  APPLICATION_SECTIONS,
  APPLICATION_STATUSES,
  DOCUMENT_STATUSES,
  FILE_KINDS,
  INVITATION_STATUSES,
  MERCHANT_INVITABLE_ROLES,
  ORGANIZATION_STATUSES,
  RISK_TIERS,
  ROLE_CODES,
  TRUST_LEVELS,
  WEEKDAYS,
} from '@dealdash/types';

// ------------------------------------------------------------------ helpers
const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(254);
const mobile = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Mobile number must be in international format, for example +966500000001',
  );
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));

/**
 * IBAN structure check: SA + 22 digits (24 characters) and the ISO 13616 mod-97 checksum.
 * This validates FORMAT only. Account ownership/verification remains a Finance process (VALIDATE-KSA / FDR-48).
 */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}
export function isValidSaudiIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^SA\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}
export const maskIban = (value: string): string => {
  const iban = normalizeIban(value);
  return iban.length < 8 ? '****' : `${iban.slice(0, 4)} **** **** **** ${iban.slice(-4)}`;
};

export const passwordPolicySchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a digit');

// ------------------------------------------------------------------ opening hours
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24-hour)');
const interval = z.object({ open: time, close: time });
const day = z.union([
  z.object({ closed: z.literal(true) }),
  z.object({ closed: z.literal(false).optional(), intervals: z.array(interval).min(1).max(3) }),
]);
export const weeklyHoursSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, day])) as Record<
    (typeof WEEKDAYS)[number],
    typeof day
  >,
);
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

const toMinutes = (t: string) =>
  t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Returns a list of problems (empty when valid): open < close, no overlaps within a day. */
export function hoursProblems(hours: WeeklyHours): string[] {
  const problems: string[] = [];
  for (const d of WEEKDAYS) {
    const entry = hours[d];
    if ('closed' in entry && entry.closed === true) continue;
    const intervals = 'intervals' in entry ? entry.intervals : [];
    const sorted = [...intervals].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    sorted.forEach((i, idx) => {
      if (toMinutes(i.open) >= toMinutes(i.close))
        problems.push(`${d}: closing time must be after opening time`);
      const prev = sorted[idx - 1];
      if (prev && toMinutes(i.open) < toMinutes(prev.close))
        problems.push(`${d}: opening intervals overlap`);
    });
  }
  return problems;
}
export const hoursSchema = weeklyHoursSchema.superRefine((h, ctx) => {
  for (const p of hoursProblems(h)) ctx.addIssue({ code: 'custom', message: p });
});

const holidayHoursSchema = z
  .array(
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      closed: z.boolean(),
      open: time.optional(),
      close: time.optional(),
      note: optionalText(120),
    }),
  )
  .max(30);

// ------------------------------------------------------------------ branches
export const branchInputSchema = z.object({
  nameEn: text(120),
  nameAr: text(120),
  addressEn: text(300),
  addressAr: text(300),
  city: text(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: optionalText(30),
  hours: hoursSchema.optional(),
  holidayHours: holidayHoursSchema.optional(),
});
export const branchUpdateSchema = branchInputSchema.partial();
export const branchStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED']),
  reason: optionalText(300),
});

// ------------------------------------------------------------------ registration and verification
export const merchantRegisterSchema = z.object({
  email,
  password: passwordPolicySchema,
  tradeNameEn: text(120),
  tradeNameAr: optionalText(120),
});
export const verifyEmailSchema = z.object({ email, code: z.string().regex(/^\d{6}$/) });
export const resendCodeSchema = z.object({ email });
export const mobileRequestSchema = z.object({ mobile });
export const mobileVerifySchema = z.object({ mobile, code: z.string().regex(/^\d{6}$/) });

// ------------------------------------------------------------------ application sections
export const businessDetailsSchema = z.object({
  legalNameEn: text(160),
  legalNameAr: text(160),
  tradeNameEn: text(120),
  tradeNameAr: text(120),
  commercialRegistrationNumber: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[A-Za-z0-9\-/ ]+$/, 'Use letters, digits, spaces, - or /'),
  taxNumber: optionalText(30),
  businessType: optionalText(80),
  registeredAddress: text(300),
  businessPhone: optionalText(30),
  businessEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const categoryBrandingSchema = z.object({
  categoryCode: text(40),
  subCategory: optionalText(80),
  descriptionEn: text(1000),
  descriptionAr: text(1000),
  logoFileId: uuid.nullable().optional(),
  coverFileId: uuid.nullable().optional(),
  galleryFileIds: z.array(uuid).max(8).optional(),
});

export const representativeSchema = z.object({
  fullName: text(120),
  role: text(80),
  idReference: z
    .string()
    .trim()
    .min(5)
    .max(20)
    .regex(/^[A-Za-z0-9]+$/, 'Letters and digits only'),
  mobile,
  email,
  isSignatory: z.boolean(),
});

export const settlementSchema = z.object({
  bankName: text(120),
  iban: z.string().trim().refine(isValidSaudiIban, 'Enter a valid Saudi IBAN (SA + 22 digits)'),
  accountHolderName: text(160),
});

export const uploadIntentSchema = z.object({
  kind: z.enum(FILE_KINDS),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().min(1),
});
export const documentAttachSchema = z.object({
  requirementCode: text(40),
  fileId: uuid,
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const agreementAcceptSchema = z.object({
  signatureName: text(160),
  accept: z.literal(true),
});
export const submitApplicationSchema = z.object({ declaration: z.literal(true) });

// ------------------------------------------------------------------ team
export const teamInviteSchema = z
  .object({
    name: text(120),
    email: email.optional(),
    mobile: mobile.optional(),
    roleCode: z.enum(MERCHANT_INVITABLE_ROLES),
    branchId: uuid.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.roleCode === 'MERCHANT_STAFF') {
      if (!v.mobile)
        ctx.addIssue({
          code: 'custom',
          path: ['mobile'],
          message: 'Staff sign in with a mobile number',
        });
      if (!v.branchId)
        ctx.addIssue({
          code: 'custom',
          path: ['branchId'],
          message: 'Choose the branch for this staff member',
        });
    } else if (!v.email)
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'An email address is required' });
  });
export const roleChangeSchema = z.object({
  roleCode: z.enum([...MERCHANT_INVITABLE_ROLES, 'MERCHANT_OWNER'] as const),
  branchId: uuid.optional(),
});
export const deactivateSchema = z.object({ reason: text(300) });
export const invitationAcceptSchema = z.object({ password: passwordPolicySchema });

// ------------------------------------------------------------------ admin decisions
export const requestChangesSchema = z.object({
  sections: z.array(z.enum(APPLICATION_SECTIONS)).min(1),
  documentIds: z.array(uuid).max(20).default([]),
  message: text(2000),
  messageAr: optionalText(2000),
});
export const rejectSchema = z.object({
  reason: text(2000),
  reasonAr: optionalText(2000),
  appealable: z.boolean().default(true),
});
export const approveSchema = z.object({ note: optionalText(1000) });
export const riskTierSchema = z.object({ tier: z.enum(RISK_TIERS), reason: text(500) });
export const trustLevelSchema = z.object({ level: z.enum(TRUST_LEVELS), reason: text(500) });
export const suspendSchema = z.object({ reason: text(1000) });
export const reactivateSchema = z.object({ reason: text(1000) });
export const documentReviewSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  note: optionalText(1000),
});
export const reviewNoteSchema = z.object({ body: text(2000) });
export const bankVerifySchema = z.object({ note: optionalText(500) });

export const merchantListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  trust: z.enum(TRUST_LEVELS).optional(),
  risk: z.enum(RISK_TIERS).optional(),
  q: z.string().trim().max(80).optional(),
});
export const applicationQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  risk: z.enum(RISK_TIERS).optional(),
  assigned: z.enum(['me', 'unassigned']).optional(),
});

// ------------------------------------------------------------------ views (responses)
const iso = z.string();
export const completenessItemSchema = z.object({
  section: z.enum([...APPLICATION_SECTIONS, 'VERIFICATION'] as const),
  complete: z.boolean(),
  issues: z.array(z.string()),
});
export const documentRequirementViewSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  required: z.boolean(),
  expiryRequired: z.boolean(),
  placeholder: z.boolean(),
});
export const documentViewSchema = z.object({
  id: uuid,
  requirementCode: z.string(),
  fileId: uuid,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  expiryDate: z.string().nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  reviewerNote: z.string().nullable(),
  uploadedAt: iso,
});
export const requestedChangesViewSchema = z.object({
  sections: z.array(z.enum(APPLICATION_SECTIONS)),
  documentIds: z.array(uuid),
  message: z.string(),
  messageAr: z.string().nullable(),
  at: iso,
});
export const applicationViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  version: z.number().int(),
  submittedAt: iso.nullable(),
  decidedAt: iso.nullable(),
  riskTier: z.enum(RISK_TIERS),
  awaitingSecondReview: z.boolean(),
  rejectionReason: z.string().nullable(),
  rejectionReasonAr: z.string().nullable(),
  appealable: z.boolean(),
  requestedChanges: requestedChangesViewSchema.nullable(),
});
export const businessViewSchema = z.object({
  legalNameEn: z.string().nullable(),
  legalNameAr: z.string().nullable(),
  tradeNameEn: z.string().nullable(),
  tradeNameAr: z.string().nullable(),
  commercialRegistrationNumber: z.string().nullable(),
  taxNumber: z.string().nullable(),
  businessType: z.string().nullable(),
  registeredAddress: z.string().nullable(),
  businessPhone: z.string().nullable(),
  businessEmail: z.string().nullable(),
  categoryCode: z.string().nullable(),
  subCategory: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  logoFileId: uuid.nullable(),
  coverFileId: uuid.nullable(),
  galleryFileIds: z.array(uuid),
  logoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export const representativeViewSchema = z.object({
  fullName: z.string(),
  role: z.string(),
  idReferenceMasked: z.string(),
  mobile: z.string(),
  email: z.string(),
  isSignatory: z.boolean(),
});
export const settlementViewSchema = z.object({
  bankName: z.string(),
  ibanMasked: z.string(),
  accountHolderName: z.string(),
  nameMatches: z.boolean(),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED']),
  payoutHold: z.boolean(),
});
export const agreementViewSchema = z.object({
  id: uuid,
  version: z.string(),
  titleEn: z.string(),
  titleAr: z.string(),
  bodyEn: z.string(),
  bodyAr: z.string(),
  placeholder: z.boolean(),
});
export const acceptanceViewSchema = z.object({
  id: uuid,
  agreementVersion: z.string(),
  signatoryName: z.string(),
  signatoryRole: z.string(),
  entityLegalName: z.string(),
  acceptedAt: iso,
  status: z.enum(['ACCEPTED', 'SUPERSEDED', 'REVOKED']),
  method: z.string(),
});
export const branchSummaryViewSchema = z.object({
  id: uuid,
  nameEn: z.string(),
  nameAr: z.string(),
  addressEn: z.string(),
  addressAr: z.string(),
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  phone: z.string().nullable(),
  status: z.string(),
  hours: z.unknown().nullable(),
  holidayHours: z.unknown().nullable(),
});
export const categoryViewSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
});

export const merchantApplicationDetailSchema = z.object({
  organizationId: uuid,
  organizationStatus: z.enum(ORGANIZATION_STATUSES),
  editable: z.boolean(),
  application: applicationViewSchema,
  business: businessViewSchema,
  representative: representativeViewSchema.nullable(),
  settlement: settlementViewSchema.nullable(),
  documents: z.array(documentViewSchema),
  requirements: z.array(documentRequirementViewSchema),
  categories: z.array(categoryViewSchema),
  branches: z.array(branchSummaryViewSchema),
  agreement: z.object({
    current: agreementViewSchema,
    acceptance: acceptanceViewSchema.nullable(),
  }),
  contact: z.object({
    email: z.string(),
    emailVerified: z.boolean(),
    mobile: z.string().nullable(),
    mobileVerified: z.boolean(),
  }),
  completeness: z.array(completenessItemSchema),
  ready: z.boolean(),
  trustLevel: z.enum(TRUST_LEVELS),
});

export const registrationResultSchema = z.object({
  organizationId: uuid,
  emailCodeSent: z.boolean(),
  expiresInSeconds: z.number().int(),
});
export const uploadIntentResultSchema = z.object({
  fileId: uuid,
  method: z.literal('PUT'),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: iso,
});
export const fileViewSchema = z.object({
  fileId: uuid,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
  expiresAt: iso,
});

export const teamUserViewSchema = z.object({
  membershipId: uuid,
  userId: uuid,
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  roleCode: z.enum(ROLE_CODES),
  branchId: uuid.nullable(),
  branchName: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INVITED', 'DEACTIVATED']),
  lastActiveAt: iso.nullable(),
});
export const invitationViewSchema = z.object({
  id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  roleCode: z.enum(ROLE_CODES),
  branchId: uuid.nullable(),
  status: z.enum(INVITATION_STATUSES),
  expiresAt: iso,
});

// admin
export const adminMerchantRowSchema = z.object({
  organizationId: uuid,
  tradeNameEn: z.string(),
  tradeNameAr: z.string(),
  status: z.enum(ORGANIZATION_STATUSES),
  trustLevel: z.enum(TRUST_LEVELS),
  riskTier: z.enum(RISK_TIERS),
  applicationStatus: z.enum(APPLICATION_STATUSES).nullable(),
  reference: z.string().nullable(),
  branches: z.number().int(),
  submittedAt: iso.nullable(),
  assignedTo: z.string().nullable(),
  createdAt: iso,
});
export const decisionViewSchema = z.object({
  id: uuid,
  decision: z.string(),
  message: z.string().nullable(),
  messageAr: z.string().nullable(),
  sections: z.array(z.string()),
  decidedBy: z.string(),
  at: iso,
});
export const reviewNoteViewSchema = z.object({
  id: uuid,
  body: z.string(),
  author: z.string(),
  at: iso,
});
export const riskSuggestionSchema = z.object({
  suggestedTier: z.enum(RISK_TIERS),
  reasons: z.array(z.string()),
});
export const adminDocumentViewSchema = documentViewSchema.extend({ url: z.string() });
export const adminAuditRowSchema = z.object({
  id: uuid,
  occurredAt: iso,
  action: z.string(),
  actorRole: z.string().nullable(),
  actorUserId: uuid.nullable(),
  reason: z.string().nullable(),
  entityType: z.string(),
});
export const adminMerchantDetailSchema = z.object({
  organizationId: uuid,
  organizationStatus: z.enum(ORGANIZATION_STATUSES),
  trustLevel: z.enum(TRUST_LEVELS),
  suspendedReason: z.string().nullable(),
  application: applicationViewSchema.extend({
    assignedTo: z.string().nullable(),
    assignedToUserId: uuid.nullable(),
    firstApproverUserId: uuid.nullable(),
  }),
  business: businessViewSchema,
  category: categoryViewSchema.nullable(),
  representative: representativeViewSchema.nullable(),
  settlement: settlementViewSchema.nullable(),
  documents: z.array(adminDocumentViewSchema),
  requirements: z.array(documentRequirementViewSchema),
  branches: z.array(branchSummaryViewSchema),
  users: z.array(teamUserViewSchema),
  acceptances: z.array(acceptanceViewSchema),
  currentAgreementVersion: z.string(),
  completeness: z.array(completenessItemSchema),
  decisions: z.array(decisionViewSchema),
  notes: z.array(reviewNoteViewSchema),
  riskSuggestion: riskSuggestionSchema,
  changedSinceLastSubmission: z.array(z.string()),
  duplicateRegistrationNumber: z.boolean(),
  audit: z.array(adminAuditRowSchema),
});

export type MerchantApplicationDetail = z.infer<typeof merchantApplicationDetailSchema>;
export type AdminMerchantDetail = z.infer<typeof adminMerchantDetailSchema>;
export type AdminMerchantRow = z.infer<typeof adminMerchantRowSchema>;
export type TeamUserView = z.infer<typeof teamUserViewSchema>;
export type InvitationView = z.infer<typeof invitationViewSchema>;
export type BranchSummaryView = z.infer<typeof branchSummaryViewSchema>;
export type DocumentRequirementView = z.infer<typeof documentRequirementViewSchema>;
export type BusinessDetails = z.infer<typeof businessDetailsSchema>;
