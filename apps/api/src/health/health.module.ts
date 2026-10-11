import { Controller, Get, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HealthResponse } from '../common/dto';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

function migrationsDir(): string | null {
  for (const c of [
    resolve(process.cwd(), 'prisma/migrations'),
    resolve(__dirname, '../../prisma/migrations'),
  ]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Health check for local development and monitoring. Reports connectivity, migration state and PostGIS.
 * Never returns connection strings or credentials.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: HealthResponse })
  async check() {
    const time = new Date().toISOString();
    let connected = false;
    let pending = 0;
    let migrationsCurrent = false;
    let postgis = { available: false, enabled: false, version: null as string | null };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      connected = true;
    } catch {
      return {
        status: 'down' as const,
        time,
        database: { connected, migrationsCurrent, pendingMigrations: pending },
        postgis,
      };
    }

    try {
      const dir = migrationsDir();
      const onDisk = dir
        ? readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
        : [];
      const applied = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const appliedSet = new Set(applied.map((a) => a.migration_name));
      pending = onDisk.filter((m) => !appliedSet.has(m)).length;
      migrationsCurrent = dir !== null && pending === 0;
    } catch {
      migrationsCurrent = false;
      pending = -1;
    }

    try {
      const available = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_available_extensions WHERE name = 'postgis'`;
      postgis.available = (available[0]?.count ?? 0) > 0;
      const enabled = await this.prisma.$queryRaw<Array<{ extversion: string }>>`
        SELECT extversion FROM pg_extension WHERE extname = 'postgis'`;
      postgis.enabled = enabled.length > 0;
      postgis.version = enabled[0]?.extversion ?? null;
    } catch {
      postgis = { available: false, enabled: false, version: null };
    }

    const status = migrationsCurrent && postgis.enabled ? ('ok' as const) : ('degraded' as const);
    return {
      status,
      time,
      database: { connected, migrationsCurrent, pendingMigrations: Math.max(pending, 0) },
      postgis,
    };
  }

  /** Stage 9: liveness for the orchestrator (the process answers; no dependency checks, so a slow database never restarts it). */
  @Get('live')
  @Public()
  live() {
    return { status: 'ok' as const, time: new Date().toISOString() };
  }

  /**
   * Stage 9: readiness for the load balancer. 200 only when the database answers, every migration is applied and PostGIS is on;
   * otherwise 503 so traffic goes elsewhere. Background jobs report failures through monitoring, not readiness.
   */
  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) res: Response) {
    const h = await this.check();
    const ok = h.status === 'ok';
    res.status(ok ? 200 : 503);
    const failedJobs = ok
      ? await this.prisma.job
          .count({
            where: {
              status: { in: ['FAILED', 'DEAD'] },
              updatedAt: { gte: new Date(Date.now() - 3_600_000) },
            },
          })
          .catch(() => -1)
      : -1;
    return {
      status: ok ? ('ready' as const) : ('not_ready' as const),
      time: h.time,
      database: h.database,
      postgis: { enabled: h.postgis.enabled },
      failedJobsLastHour: failedJobs,
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
