import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ApiEnv } from '@dealdash/config';
import { PrismaClient } from '../generated/prisma/client';
import { APP_ENV } from '../common/env';

/** The only place that talks to PostgreSQL. Credentials come from the environment, never from source. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  constructor(@Inject(APP_ENV) env: ApiEnv) {
    // Force the session time zone to UTC: Prisma stores `timestamp` (no zone) values as UTC, and a server whose
    // default zone is local (the Windows installer picks Asia/Riyadh) would otherwise skew raw-SQL comparisons.
    super({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL, options: '-c timezone=UTC' }),
    });
  }

  async onModuleInit() {
    // OpenAPI generation builds the app without a database.
    if (process.env.DD_SKIP_DB_CONNECT === '1') return;
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
