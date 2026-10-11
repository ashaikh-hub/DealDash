import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ApiEnv } from '@dealdash/config';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  Public,
  RequirePermissions,
  ScopeAware,
} from '../common/decorators';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { setSessionCookie } from '../common/session-cookie';
import { FilesService } from '../files/files.service';
import { AuthService } from '../identity/auth.service';
import { SessionService } from '../identity/session.service';
import { TenantService } from '../identity/tenant.service';
import { BranchesService } from '../organizations/branches.service';
import { ApplicationService } from './application.service';
import { ContactVerificationService } from './contact-verification.service';
import {
  AgreementAcceptDto,
  ApplicationDetailResponse,
  BranchStatusDto,
  BranchUpdateDto,
  BusinessDetailsDto,
  CategoryBrandingDto,
  DeactivateDto,
  DocumentAttachDto,
  FileViewResponse,
  InvitationAcceptDto,
  InviteAcceptedResponse,
  InvitePreviewResponse,
  MerchantRegisterDto,
  MobileRequestDto,
  MobileVerifyDto,
  OkResponse,
  OtpSentResponse,
  ProfileUpdateDto,
  RegistrationResponse,
  RepresentativeDto,
  ResendCodeDto,
  RoleChangeDto,
  SettlementDto,
  SubmitApplicationDto,
  TeamInviteDto,
  TeamListResponse,
  UploadIntentDto,
  UploadIntentResponse,
  VerifiedEmailResponse,
  VerifyEmailDto,
} from './dto';
import { TeamService } from './team.service';
import { BranchResponse } from '../common/dto';

/** Public merchant sign-up and invitation acceptance (no session). */
@ApiTags('merchant-onboarding')
@Controller('merchant-signup')
export class MerchantSignupController {
  constructor(
    private readonly app: ApplicationService,
    private readonly team: TeamService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationResponse })
  register(@Body() body: MerchantRegisterDto, @Meta() meta: RequestMeta) {
    return this.app.register(body, meta);
  }

  @Post('resend-code')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: RegistrationResponse })
  resend(@Body() body: ResendCodeDto, @Meta() meta: RequestMeta) {
    return this.app.resendCode(body.email, meta);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: VerifiedEmailResponse })
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, organizationId } = await this.app.verifyEmail(body.email, body.code, meta);
    setSessionCookie(res, this.env, 'merchant', result.token);
    return {
      organizationId,
      login: {
        authenticated: true,
        mfaRequired: result.mfaRequired,
        csrfToken: this.sessions.csrfFor(result.sessionId),
        me: this.auth.toMeView(result.actor),
      },
    };
  }

  @Get('invitations/:token')
  @Public()
  @ApiOkResponse({ type: InvitePreviewResponse })
  previewInvitation(@Param('token') token: string) {
    return this.team.preview(token);
  }

  @Post('invitations/:token/accept')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: InviteAcceptedResponse })
  acceptInvitation(
    @Param('token') token: string,
    @Body() body: InvitationAcceptDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.accept(token, body.password ? { password: body.password } : null, meta);
  }
}

/** Merchant application (onboarding) for the caller's own organisation. Other organisations return 404. */
@ApiTags('merchant-onboarding')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantApplicationController {
  constructor(
    private readonly app: ApplicationService,
    private readonly files: FilesService,
    private readonly tenant: TenantService,
    private readonly mobile: ContactVerificationService,
  ) {}

  private own(actor: Actor, orgId: string) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
  }

  @Get('application')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  detail(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.app.detail(actor, orgId);
  }

  @Put('application/business')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  business(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: BusinessDetailsDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.updateBusiness(actor, orgId, body, meta);
  }

  @Put('application/category')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  category(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CategoryBrandingDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.updateCategory(actor, orgId, body, meta);
  }

  @Put('application/representative')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  representative(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: RepresentativeDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.updateRepresentative(actor, orgId, body, meta);
  }

  @Put('application/settlement')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  settlement(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: SettlementDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.updateSettlement(actor, orgId, body, meta);
  }

  @Post('application/documents')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  attach(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: DocumentAttachDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.attachDocument(actor, orgId, body, meta);
  }

  @Delete('application/documents/:documentId')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  removeDocument(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.removeDocument(actor, orgId, documentId, meta);
  }

  @Post('application/mobile/request')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: OtpSentResponse })
  requestMobile(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: MobileRequestDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.requestMobile(actor, orgId, body.mobile, meta);
  }

  @Post('application/mobile/verify')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  verifyMobile(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: MobileVerifyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.verifyMobile(actor, orgId, body.mobile, body.code, meta);
  }

  @Post('application/email/resend')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: OtpSentResponse })
  async resendEmail(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.own(actor, orgId);
    const d = await this.app.detail(actor, orgId);
    return d.contact.emailVerified
      ? { expiresInSeconds: 0, resendAfterSeconds: 0 }
      : this.mobile.send('EMAIL_VERIFY', d.contact.email, meta);
  }

  @Post('application/agreement/accept')
  @HttpCode(200)
  @RequirePermissions('merchant.agreement.sign')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  accept(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: AgreementAcceptDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.acceptAgreement(actor, orgId, body, meta);
  }

  @Post('application/submit')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: ApplicationDetailResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() _body: SubmitApplicationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.app.submit(actor, orgId, meta);
  }

  // ---- files
  @Post('files/intent')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: UploadIntentResponse })
  async intent(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: UploadIntentDto,
    @CurrentActor() actor: Actor,
  ) {
    this.own(actor, orgId);
    return this.files.createIntent(actor, orgId, body);
  }

  @Post('files/:fileId/complete')
  @HttpCode(200)
  @RequirePermissions('merchant.application.manage')
  async complete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.own(actor, orgId);
    const f = await this.files.complete(actor, orgId, fileId, meta);
    return f;
  }

  @Get('files/:fileId/url')
  @RequirePermissions('merchant.application.manage')
  @ApiOkResponse({ type: FileViewResponse })
  async url(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentActor() actor: Actor,
  ) {
    this.own(actor, orgId);
    return this.files.readUrl(fileId, orgId);
  }

  // ---- profile after activation
  @Patch('profile')
  @RequirePermissions('merchant.profile.write')
  @ApiOkResponse({ type: OkResponse })
  async profile(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ProfileUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.app.updateProfile(actor, orgId, body, meta);
    return { accepted: true };
  }
}

/** Merchant branches (edit, hours, open/close) and team. */
@ApiTags('merchant-team')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantTeamController {
  constructor(
    private readonly team: TeamService,
    private readonly branches: BranchesService,
    private readonly tenant: TenantService,
  ) {}

  @Patch('branches/:branchId')
  @ScopeAware()
  @RequirePermissions('merchant.branch.manage')
  @ApiOkResponse({ type: BranchResponse })
  updateBranch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: BranchUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.branches.update(actor, orgId, branchId, body, meta);
  }

  @Post('branches/:branchId/status')
  @ScopeAware()
  @HttpCode(200)
  @RequirePermissions('merchant.branch.manage')
  @ApiOkResponse({ type: BranchResponse })
  branchStatus(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: BranchStatusDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.branches.setStatus(actor, orgId, branchId, body.status, body.reason, meta);
  }

  @Get('team')
  @RequirePermissions('merchant.users.manage')
  @ApiOkResponse({ type: TeamListResponse })
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.team.list(actor, orgId);
  }

  @Post('team/invitations')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.users.manage')
  invite(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: TeamInviteDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.invite(actor, orgId, body, meta);
  }

  @Delete('team/invitations/:invitationId')
  @RequirePermissions('merchant.users.manage')
  @ApiOkResponse({ type: TeamListResponse })
  revoke(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.revokeInvitation(actor, orgId, invitationId, meta);
  }

  @Patch('team/:membershipId/role')
  @RequirePermissions('merchant.users.manage')
  @ApiOkResponse({ type: TeamListResponse })
  role(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: RoleChangeDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.changeRole(actor, orgId, membershipId, body, meta);
  }

  @Post('team/:membershipId/deactivate')
  @HttpCode(200)
  @RequirePermissions('merchant.users.manage')
  @ApiOkResponse({ type: TeamListResponse })
  deactivate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: DeactivateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.deactivate(actor, orgId, membershipId, body.reason, meta);
  }

  @Post('team/:membershipId/reactivate')
  @HttpCode(200)
  @RequirePermissions('merchant.users.manage')
  @ApiOkResponse({ type: TeamListResponse })
  reactivate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.reactivate(actor, orgId, membershipId, meta);
  }
}
