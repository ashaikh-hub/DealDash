import { Injectable } from '@nestjs/common';
import { CONFIG_DEFAULTS, type ConfigKey } from '@dealdash/config';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 10_000;

/** Business parameters live in the database (audited, versioned); defaults mirror the approved initial values. */
@Injectable()
export class SystemConfigService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<T = unknown>(key: ConfigKey | string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const row = await this.prisma.systemConfiguration.findUnique({ where: { key } });
    const value = row ? row.value : (CONFIG_DEFAULTS as Record<string, unknown>)[key];
    this.cache.set(key, { value, at: Date.now() });
    return value as T;
  }

  async getNumber(key: ConfigKey, fallback?: number): Promise<number> {
    const v = await this.get(key);
    return typeof v === 'number' ? v : (fallback ?? 0);
  }

  async getBoolean(key: ConfigKey, fallback = false): Promise<boolean> {
    const v = await this.get(key);
    return typeof v === 'boolean' ? v : fallback;
  }

  invalidate() {
    this.cache.clear();
  }

  async list() {
    return this.prisma.systemConfiguration.findMany({ orderBy: { key: 'asc' } });
  }

  async set(key: string, value: unknown, reason: string, actor: Actor, meta: RequestMeta) {
    if (value === undefined) throw AppError.validation('A value is required', 'value');
    const existing = await this.prisma.systemConfiguration.findUnique({ where: { key } });
    const json = value as Prisma.InputJsonValue;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.systemConfiguration.update({
            where: { key },
            data: { value: json, version: { increment: 1 }, updatedByUserId: actor.userId },
          })
        : await tx.systemConfiguration.create({
            data: { key, value: json, updatedByUserId: actor.userId },
          });
      await this.audit.record(
        {
          action: 'config.updated',
          entityType: 'SystemConfiguration',
          entityId: key,
          reason,
          previousState: existing ? { value: existing.value, version: existing.version } : null,
          newState: { value: row.value, version: row.version },
          actor,
          meta,
        },
        tx,
      );
      return row;
    });
    this.invalidate();
    return saved;
  }
}
