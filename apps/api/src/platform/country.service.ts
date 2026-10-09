import { Injectable } from '@nestjs/common';
import type { CountryView } from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

type Row = Awaited<ReturnType<PrismaService['countryConfiguration']['findFirstOrThrow']>>;

/**
 * Market configuration. Nothing Saudi-specific is hard-coded in code: currency, tax profile, payment provider, settlement, legal text
 * version, residency and notification providers all live here. KSA is the only enabled market for the pilot; legal and tax content is
 * VALIDATE-KSA and stays as configuration.
 */
@Injectable()
export class CountryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(r: Row): CountryView {
    return {
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      currency: r.currency,
      languages: r.languages,
      enabled: r.enabled,
      taxProfile: r.taxProfile as Record<string, unknown>,
      paymentProvider: r.paymentProvider,
      settlement: r.settlement as Record<string, unknown>,
      legalTextVersion: r.legalTextVersion,
      residency: r.residency as Record<string, unknown>,
      notificationProviders: r.notificationProviders as Record<string, unknown>,
      settings: r.settings as Record<string, unknown>,
    };
  }

  async list(onlyEnabled = false): Promise<CountryView[]> {
    const rows = await this.prisma.countryConfiguration.findMany({
      where: onlyEnabled ? { enabled: true } : {},
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.view(r));
  }

  async get(code: string): Promise<CountryView | null> {
    const r = await this.prisma.countryConfiguration.findUnique({ where: { code } });
    return r ? this.view(r) : null;
  }

  /** The market of a business account: the country of its first legal entity, else the first enabled market. */
  async forOrganization(organizationId: string): Promise<CountryView | null> {
    const le = await this.prisma.legalEntity.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    if (le) return this.get(le.country);
    return (await this.list(true))[0] ?? null;
  }

  async upsert(actor: Actor, code: string, b: Omit<CountryView, 'code'>, meta: RequestMeta): Promise<CountryView> {
    const c = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw AppError.validation('Use a two-letter country code', 'code');
    const before = await this.prisma.countryConfiguration.findUnique({ where: { code: c } });
    const data = {
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      currency: b.currency,
      languages: b.languages,
      enabled: b.enabled,
      taxProfile: b.taxProfile as Prisma.InputJsonValue,
      paymentProvider: b.paymentProvider,
      settlement: b.settlement as Prisma.InputJsonValue,
      legalTextVersion: b.legalTextVersion,
      residency: b.residency as Prisma.InputJsonValue,
      notificationProviders: b.notificationProviders as Prisma.InputJsonValue,
      settings: b.settings as Prisma.InputJsonValue,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.countryConfiguration.upsert({ where: { code: c }, update: data, create: { code: c, ...data } });
      await this.audit.record(
        {
          action: before ? 'COUNTRY_CONFIG_UPDATED' : 'COUNTRY_CONFIG_CREATED',
          entityType: 'CountryConfiguration',
          entityId: c,
          actor,
          previousState: before ? this.view(before) : undefined,
          newState: this.view(r),
          scope: `COUNTRY:${c}`,
          meta,
        },
        tx,
      );
      return r;
    });
    return this.view(row);
  }
}
