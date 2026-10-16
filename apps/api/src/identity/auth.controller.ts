import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ApiEnv } from '@dealdash/config';
import { AUDIENCE_DEFINITIONS, type Audience } from '@dealdash/types';
import { AllowPreMfa, Audiences, CurrentActor, Meta, Public } from '../common/decorators';
import {
  AcceptedResponse,
  LoginResponse,
  MeResponse,
  MfaVerifyDto,
  OtpRequestDto,
  OtpRequestResponse,
  OtpVerifyDto,
  PasswordLoginDto,
  SwitchMembershipDto,
} from '../common/dto';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { AuthService, type AuthResult } from './auth.service';
import { SessionService } from './session.service';

/** The session cookie every sign-in sets (phone, password, and Google / Apple). */
export function setSessionCookie(env: ApiEnv, res: Response, audience: Audience, token: string) {
  const def = AUDIENCE_DEFINITIONS[audience];
  res.cookie(def.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 3600 * 1000,
  });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private setSessionCookie(res: Response, audience: Audience, token: string) {
    setSessionCookie(this.env, res, audience, token);
  }

  private result(r: AuthResult) {
    return {
      authenticated: true,
      mfaRequired: r.mfaRequired,
      csrfToken: this.sessions.csrfFor(r.sessionId),
      me: this.auth.toMeView(r.actor),
    };
  }

  @Post('otp/request')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: OtpRequestResponse })
  requestOtp(@Body() body: OtpRequestDto, @Meta() meta: RequestMeta) {
    return this.auth.requestOtp(body.mobile, body.audience, meta);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponse })
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.verifyOtp(body.mobile, body.code, body.audience, meta);
    this.setSessionCookie(res, body.audience, r.token);
    return this.result(r);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponse })
  async login(
    @Body() body: PasswordLoginDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.passwordLogin(body.email, body.password, body.audience, meta);
    this.setSessionCookie(res, body.audience, r.token);
    return this.result(r);
  }

  @Post('mfa/verify')
  @AllowPreMfa()
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponse })
  async verifyMfa(
    @Body() body: MfaVerifyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.auth.verifyMfa(actor, body.code, meta);
    return { accepted: true };
  }

  @Get('me')
  @AllowPreMfa()
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentActor() actor: Actor) {
    return { ...this.auth.toMeView(actor), csrfToken: this.sessions.csrfFor(actor.sessionId) };
  }

  @Post('memberships/switch')
  @HttpCode(200)
  @Audiences('merchant', 'partner', 'admin', 'staff')
  @ApiOkResponse({ type: AcceptedResponse })
  async switchMembership(@Body() body: SwitchMembershipDto, @CurrentActor() actor: Actor) {
    await this.auth.switchMembership(actor, body.organizationId, body.branchId);
    return { accepted: true };
  }

  @Post('logout')
  @AllowPreMfa()
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponse })
  async logout(
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(actor, meta);
    res.clearCookie(AUDIENCE_DEFINITIONS[actor.audience].cookieName, { path: '/' });
    return { accepted: true };
  }
}
