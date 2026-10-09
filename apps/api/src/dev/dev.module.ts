import { Controller, Get, Inject, Module, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ApiEnv } from '@dealdash/config';
import { Public } from '../common/decorators';
import { NearbyBranchesQueryDto } from '../common/dto';
import { decryptField } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { totpAt } from '../common/totp';
import { BranchesService } from '../organizations/branches.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type SmsProvider,
} from '../providers/interfaces';
import { MockEmailProvider, MockSmsProvider } from '../providers/mocks';

/**
 * Development-only helpers (mock SMS inbox, current TOTP code for seeded users, PostGIS proof).
 * Not registered when NODE_ENV=production and excluded from the OpenAPI contract.
 */
@ApiExcludeController()
@Controller('dev')
export class DevController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly prisma: PrismaService,
    private readonly branches: BranchesService,
  ) {}

  private guard() {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
  }

  @Get('last-sms')
  @Public()
  lastSms(@Query('to') to: string) {
    this.guard();
    const m = this.sms instanceof MockSmsProvider ? this.sms.lastTo(to) : undefined;
    return m
      ? { body: m.body, at: m.at.toISOString(), code: /\b(\d{6})\b/.exec(m.body)?.[1] ?? null }
      : null;
  }

  @Get('last-email')
  @Public()
  lastEmail(@Query('to') to: string, @Query('template') template?: string) {
    this.guard();
    const m = this.email instanceof MockEmailProvider ? this.email.lastTo(to, template) : undefined;
    return m
      ? {
          subject: m.subject,
          body: m.body,
          at: m.at.toISOString(),
          code: /\b(\d{6})\b/.exec(m.body)?.[1] ?? null,
          link: /(https?:\/\/\S+)/.exec(m.body)?.[1] ?? null,
        }
      : null;
  }

  @Get('totp')
  @Public()
  async totp(@Query('email') email: string) {
    this.guard();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.mfaSecretEnc) return null;
    return {
      code: totpAt(decryptField(user.mfaSecretEnc, this.env.FIELD_ENCRYPTION_KEY), Date.now()),
    };
  }

  @Get('nearby-branches')
  @Public()
  async nearby(@Query() q: NearbyBranchesQueryDto) {
    this.guard();
    return this.branches.nearby(q.lat, q.lng, q.radiusMeters, q.limit);
  }
}

@Module({ imports: [OrganizationsModule], controllers: [DevController] })
export class DevModule {}
