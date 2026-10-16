import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { mockProviderPagesEnabled, type ApiEnv } from '@dealdash/config';
import {
  SOCIAL_PROVIDERS,
  envelope,
  linkedIdentitiesSchema,
  socialCallbackResultSchema,
  socialCallbackSchema,
  socialCompleteResultSchema,
  socialCompleteSchema,
  socialStartResultSchema,
  socialStartSchema,
  type SocialProvider,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Meta,
  OptionalActor,
  Public,
  RequirePermissions,
} from '../common/decorators';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { SOCIAL_AUTH_PROVIDER, type SocialAuthProvider } from '../providers/interfaces';
import { MockSocialAuthProvider } from '../providers/mocks';
import { setSessionCookie } from './auth.controller';
import { SessionService } from './session.service';
import { SocialAuthService } from './social-auth.service';

class SocialStartDto extends createZodDto(socialStartSchema) {}
class SocialCallbackDto extends createZodDto(socialCallbackSchema) {}
class SocialCompleteDto extends createZodDto(socialCompleteSchema) {}
class SocialStartResponse extends createZodDto(envelope(socialStartResultSchema)) {}
class SocialCallbackResponse extends createZodDto(envelope(socialCallbackResultSchema)) {}
class SocialCompleteResponse extends createZodDto(envelope(socialCompleteResultSchema)) {}
class IdentitiesResponse extends createZodDto(envelope(linkedIdentitiesSchema)) {}

/** Google / Apple sign-in for customers (the provider's own page in production; the development page until credentials exist). */
@ApiTags('auth')
@Controller('auth/social')
export class SocialAuthController {
  constructor(
    private readonly social: SocialAuthService,
    private readonly sessions: SessionService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('start')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SocialStartResponse })
  start(@Body() b: SocialStartDto, @Meta() meta: RequestMeta, @OptionalActor() actor?: Actor) {
    return this.social.start(b, actor, meta);
  }

  @Post('callback')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SocialCallbackResponse })
  async callback(
    @Body() b: SocialCallbackDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
    @OptionalActor() actor?: Actor,
  ) {
    const { result, session } = await this.social.callback(b, actor, meta);
    if (session) setSessionCookie(this.env, res, 'customer', session.token);
    return { ...result, csrfToken: session ? this.sessions.csrfFor(session.sessionId) : null };
  }

  @Post('complete')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SocialCompleteResponse })
  async complete(
    @Body() b: SocialCompleteDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, session } = await this.social.complete(b, meta);
    setSessionCookie(this.env, res, 'customer', session.token);
    return { ...result, csrfToken: this.sessions.csrfFor(session.sessionId) };
  }
}

const providerParam = z.enum(SOCIAL_PROVIDERS);

/** The customer's linked Google / Apple accounts (Account settings). */
@ApiTags('customer-account')
@Controller('app/me/identities')
@Audiences('customer')
export class CustomerIdentitiesController {
  constructor(private readonly social: SocialAuthService) {}

  @Get()
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: IdentitiesResponse })
  list(@CurrentActor() actor: Actor) {
    return this.social.identities(actor.userId);
  }

  @Delete(':provider')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: IdentitiesResponse })
  unlink(
    @Param('provider') provider: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const p = providerParam.safeParse(provider);
    if (!p.success) throw new NotFoundException();
    return this.social.unlink(actor, p.data as SocialProvider, meta);
  }
}

const devApproveSchema = z.object({
  state: z.string().min(16).max(200),
  provider: z.enum(SOCIAL_PROVIDERS),
  /** The test account chosen on the development provider page. */
  subject: z.string().trim().min(3).max(100),
  email: z.string().trim().email().max(254).nullable(),
  name: z.string().trim().max(120).nullable(),
});
class DevApproveDto extends createZodDto(devApproveSchema) {}

/**
 * Development-only stand-in for the Google / Apple consent screen: turns the chosen test account into a single-use authorization code
 * the callback then exchanges, exactly like the real provider. Refused in production and whenever the real provider is wired.
 */
@ApiExcludeController()
@Controller('dev/social')
export class DevSocialController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Inject(SOCIAL_AUTH_PROVIDER) private readonly provider: SocialAuthProvider,
  ) {}

  @Post('approve')
  @Public()
  @HttpCode(200)
  approve(@Body() b: DevApproveDto) {
    if (!mockProviderPagesEnabled(this.env) || !(this.provider instanceof MockSocialAuthProvider))
      throw new NotFoundException();
    const code = this.provider.approve(b.provider, {
      subject: `${b.provider.toLowerCase()}-${b.subject}`,
      email: b.email,
      emailVerified: !!b.email,
      name: b.name,
    });
    return { code };
  }
}
