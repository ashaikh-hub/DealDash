import { createZodDto } from 'nestjs-zod';
import {
  acceptedSchema,
  auditLogViewSchema,
  auditQuerySchema,
  branchViewSchema,
  configViewSchema,
  createBranchSchema,
  customerViewSchema,
  enqueueDemoJobSchema,
  envelope,
  healthSchema,
  jobViewSchema,
  loginResultSchema,
  meResponseSchema,
  merchantViewSchema,
  mfaVerifySchema,
  nearbyBranchesQuerySchema,
  nearbyBranchViewSchema,
  organizationViewSchema,
  organizationsQuerySchema,
  otpRequestResultSchema,
  otpRequestSchema,
  otpVerifySchema,
  paginationQuerySchema,
  partnerViewSchema,
  passwordLoginSchema,
  switchMembershipSchema,
  updateConfigSchema,
} from '@dealdash/validation';
import { analyticsBatchSchema } from '@dealdash/analytics';
import { z } from 'zod';

// Request DTOs (validation + OpenAPI come from the same shared Zod schemas).
export class OtpRequestDto extends createZodDto(otpRequestSchema) {}
export class OtpVerifyDto extends createZodDto(otpVerifySchema) {}
export class PasswordLoginDto extends createZodDto(passwordLoginSchema) {}
export class MfaVerifyDto extends createZodDto(mfaVerifySchema) {}
export class SwitchMembershipDto extends createZodDto(switchMembershipSchema) {}
export class CreateBranchDto extends createZodDto(createBranchSchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}
export class AuditQueryDto extends createZodDto(auditQuerySchema) {}
export class OrganizationsQueryDto extends createZodDto(organizationsQuerySchema) {}
export class NearbyBranchesQueryDto extends createZodDto(nearbyBranchesQuerySchema) {}
export class UpdateConfigDto extends createZodDto(updateConfigSchema) {}
export class EnqueueDemoJobDto extends createZodDto(enqueueDemoJobSchema) {}
export class AnalyticsBatchDto extends createZodDto(analyticsBatchSchema) {}

// Response DTOs (envelope-wrapped, documented in OpenAPI and used to generate the typed client).
export class MeResponse extends createZodDto(envelope(meResponseSchema)) {}
export class LoginResponse extends createZodDto(envelope(loginResultSchema)) {}
export class OtpRequestResponse extends createZodDto(envelope(otpRequestResultSchema)) {}
export class AcceptedResponse extends createZodDto(envelope(acceptedSchema)) {}
export class HealthResponse extends createZodDto(envelope(healthSchema)) {}
export class MerchantResponse extends createZodDto(envelope(merchantViewSchema)) {}
export class PartnerResponse extends createZodDto(envelope(partnerViewSchema)) {}
export class BranchResponse extends createZodDto(envelope(branchViewSchema)) {}
export class BranchListResponse extends createZodDto(envelope(z.array(branchViewSchema))) {}
export class NearbyBranchListResponse extends createZodDto(
  envelope(z.array(nearbyBranchViewSchema)),
) {}
export class OrganizationListResponse extends createZodDto(
  envelope(z.array(organizationViewSchema)),
) {}
export class OrganizationResponse extends createZodDto(envelope(organizationViewSchema)) {}
export class CustomerResponse extends createZodDto(envelope(customerViewSchema)) {}
export class AuditListResponse extends createZodDto(envelope(z.array(auditLogViewSchema))) {}
export class ConfigListResponse extends createZodDto(envelope(z.array(configViewSchema))) {}
export class ConfigResponse extends createZodDto(envelope(configViewSchema)) {}
export class JobResponse extends createZodDto(envelope(jobViewSchema)) {}
export class JobListResponse extends createZodDto(envelope(z.array(jobViewSchema))) {}
