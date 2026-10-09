import { createZodDto } from 'nestjs-zod';
import {
  adminMerchantDetailSchema,
  adminMerchantRowSchema,
  adminAuditRowSchema,
  agreementAcceptSchema,
  applicationQueueQuerySchema,
  approveSchema,
  bankVerifySchema,
  branchStatusSchema,
  branchUpdateSchema,
  businessDetailsSchema,
  categoryBrandingSchema,
  deactivateSchema,
  documentAttachSchema,
  documentReviewSchema,
  envelope,
  fileViewSchema,
  invitationViewSchema,
  merchantApplicationDetailSchema,
  merchantListQuerySchema,
  merchantRegisterSchema,
  mobileRequestSchema,
  mobileVerifySchema,
  reactivateSchema,
  registrationResultSchema,
  rejectSchema,
  representativeSchema,
  requestChangesSchema,
  resendCodeSchema,
  reviewNoteSchema,
  riskTierSchema,
  roleChangeSchema,
  settlementSchema,
  submitApplicationSchema,
  suspendSchema,
  teamInviteSchema,
  teamUserViewSchema,
  trustLevelSchema,
  uploadIntentResultSchema,
  uploadIntentSchema,
  verifyEmailSchema,
  loginResultSchema,
  acceptedSchema,
  paginationQuerySchema,
  passwordPolicySchema,
} from '@dealdash/validation';
import { z } from 'zod';

// ---- requests
export class MerchantRegisterDto extends createZodDto(merchantRegisterSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
export class ResendCodeDto extends createZodDto(resendCodeSchema) {}
export class MobileRequestDto extends createZodDto(mobileRequestSchema) {}
export class MobileVerifyDto extends createZodDto(mobileVerifySchema) {}
export class BusinessDetailsDto extends createZodDto(businessDetailsSchema) {}
export class CategoryBrandingDto extends createZodDto(categoryBrandingSchema) {}
export class RepresentativeDto extends createZodDto(representativeSchema) {}
export class SettlementDto extends createZodDto(settlementSchema) {}
export class UploadIntentDto extends createZodDto(uploadIntentSchema) {}
export class DocumentAttachDto extends createZodDto(documentAttachSchema) {}
export class AgreementAcceptDto extends createZodDto(agreementAcceptSchema) {}
export class SubmitApplicationDto extends createZodDto(submitApplicationSchema) {}
export class TeamInviteDto extends createZodDto(teamInviteSchema) {}
export class RoleChangeDto extends createZodDto(roleChangeSchema) {}
export class DeactivateDto extends createZodDto(deactivateSchema) {}
export class InvitationAcceptDto extends createZodDto(
  z.object({ password: passwordPolicySchema.optional() }),
) {}
export class BranchUpdateDto extends createZodDto(branchUpdateSchema) {}
export class BranchStatusDto extends createZodDto(branchStatusSchema) {}
export class ProfileUpdateDto extends createZodDto(
  z.object({
    tradeNameEn: z.string().trim().min(1).max(120).optional(),
    tradeNameAr: z.string().trim().min(1).max(120).optional(),
    descriptionEn: z.string().trim().min(1).max(1000).optional(),
    descriptionAr: z.string().trim().min(1).max(1000).optional(),
    businessPhone: z.string().trim().max(30).optional(),
    businessEmail: z.string().trim().email().max(254).optional(),
    subCategory: z.string().trim().max(80).optional(),
  }),
) {}
export class RequestChangesDto extends createZodDto(requestChangesSchema) {}
export class RejectDto extends createZodDto(rejectSchema) {}
export class ApproveDto extends createZodDto(approveSchema) {}
export class RiskTierDto extends createZodDto(riskTierSchema) {}
export class TrustLevelDto extends createZodDto(trustLevelSchema) {}
export class SuspendDto extends createZodDto(suspendSchema) {}
export class ReactivateDto extends createZodDto(reactivateSchema) {}
export class DocumentReviewDto extends createZodDto(documentReviewSchema) {}
export class ReviewNoteDto extends createZodDto(reviewNoteSchema) {}
export class BankVerifyDto extends createZodDto(bankVerifySchema) {}
export class MerchantListQueryDto extends createZodDto(merchantListQuerySchema) {}
export class ApplicationQueueQueryDto extends createZodDto(applicationQueueQuerySchema) {}
export class AuditPageQueryDto extends createZodDto(paginationQuerySchema) {}

// ---- responses
const teamListSchema = z.object({
  users: z.array(teamUserViewSchema),
  invitations: z.array(invitationViewSchema),
});
const invitePreviewSchema = z.object({
  name: z.string(),
  organizationName: z.string(),
  roleCode: z.string(),
  signInWith: z.enum(['EMAIL', 'MOBILE']),
});
const inviteAcceptedSchema = z.object({
  userId: z.string(),
  role: z.string(),
  signInWith: z.enum(['EMAIL', 'MOBILE']),
});
const verifiedEmailSchema = z.object({
  organizationId: z.string().nullable(),
  login: loginResultSchema,
});

export class RegistrationResponse extends createZodDto(envelope(registrationResultSchema)) {}
export class VerifiedEmailResponse extends createZodDto(envelope(verifiedEmailSchema)) {}
export class ApplicationDetailResponse extends createZodDto(
  envelope(merchantApplicationDetailSchema),
) {}
export class UploadIntentResponse extends createZodDto(envelope(uploadIntentResultSchema)) {}
export class FileViewResponse extends createZodDto(envelope(fileViewSchema)) {}
export class OtpSentResponse extends createZodDto(
  envelope(z.object({ expiresInSeconds: z.number(), resendAfterSeconds: z.number() })),
) {}
export class TeamListResponse extends createZodDto(envelope(teamListSchema)) {}
export class InvitationResponse extends createZodDto(envelope(invitationViewSchema)) {}
export class InvitePreviewResponse extends createZodDto(envelope(invitePreviewSchema)) {}
export class InviteAcceptedResponse extends createZodDto(envelope(inviteAcceptedSchema)) {}
export class MerchantRowListResponse extends createZodDto(
  envelope(z.array(adminMerchantRowSchema)),
) {}
export class AdminMerchantDetailResponse extends createZodDto(
  envelope(adminMerchantDetailSchema),
) {}
export class AdminAuditListResponse extends createZodDto(envelope(z.array(adminAuditRowSchema))) {}
export class OkResponse extends createZodDto(envelope(acceptedSchema)) {}
