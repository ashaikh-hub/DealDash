import { Controller, Get, Inject, Logger, Module, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { isStagingTestRecipient, stagingTestInboxEnabled, type ApiEnv } from '@dealdash/config';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField } from '../common/crypto';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { MockMessagingOptions } from '../providers/mocks';

/** Messages are kept for one day: long enough for a test session, short enough that the table never grows. */
export const TEST_INBOX_RETENTION_MS = 24 * 3600 * 1000;
const LIST_LIMIT = 50;

/**
 * Launch readiness G-1 — the STAGING test inbox. In staging the SMS and e-mail providers are development adapters (no vendor is
 * contracted), and the development inbox (`/v1/dev/*`) does not exist because staging runs as a production build. Without this,
 * sign-in codes and invitation links would reach nobody.
 *
 * Messages to configured synthetic recipients are kept (body field-encrypted, 24 hours) and shown to administrators who run
 * notification operations. Everything else is never kept. Outside staging the recorder is absent and the endpoint answers 404.
 */
export function testInboxRecorder(
  env: ApiEnv,
  prisma: Pick<PrismaService, 'stagingTestMessage'>,
): MockMessagingOptions['observer'] {
  if (!stagingTestInboxEnabled(env)) return undefined;
  return async (m) => {
    if (!isStagingTestRecipient(env, m.to)) return;
    await prisma.stagingTestMessage.create({
      data: {
        channel: m.channel,
        recipient: m.to.trim().toLowerCase(),
        templateKey: m.templateKey,
        subject: m.subject ?? null,
        bodyEnc: encryptField(m.body, env.FIELD_ENCRYPTION_KEY),
      },
    });
    await prisma.stagingTestMessage.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - TEST_INBOX_RETENTION_MS) } },
    });
  };
}

/** Admin -> Notification operations -> Staging test inbox (staging only). */
@ApiExcludeController()
@Controller('admin/staging/test-inbox')
@Audiences('admin')
export class StagingTestInboxController {
  private readonly logger = new Logger('StagingTestInbox');

  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('admin.notifications.manage')
  async list(
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
    @Query('recipient') recipient?: string,
  ) {
    if (!stagingTestInboxEnabled(this.env)) throw new NotFoundException();
    const r = recipient?.trim().toLowerCase();
    const rows = await this.prisma.stagingTestMessage.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - TEST_INBOX_RETENTION_MS) },
        ...(r ? { recipient: { contains: r } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    // reading sign-in codes is itself audited (who looked, for which filter)
    await this.audit.record({
      action: 'staging.test_inbox.read',
      entityType: 'StagingTestMessage',
      entityId: null,
      reason: r ? `filter: ${r}` : null,
      actor,
      meta,
    });
    return {
      retentionHours: TEST_INBOX_RETENTION_MS / 3600_000,
      items: rows.map((m) => {
        let body = '';
        try {
          body = decryptField(m.bodyEnc, this.env.FIELD_ENCRYPTION_KEY);
        } catch {
          this.logger.warn('A staging test message could not be decrypted');
        }
        return {
          id: m.id,
          channel: m.channel,
          recipient: m.recipient,
          templateKey: m.templateKey,
          subject: m.subject,
          body,
          code: /\b(\d{6})\b/.exec(body)?.[1] ?? null,
          link: /(https?:\/\/\S+)/.exec(body)?.[1] ?? null,
          createdAt: m.createdAt.toISOString(),
        };
      }),
    };
  }
}

@Module({ controllers: [StagingTestInboxController] })
export class StagingTestInboxModule {}
