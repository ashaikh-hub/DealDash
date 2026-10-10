import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  PARTNER_INGESTION_FEATURES,
  PARTNER_MODULE_ENTITLEMENT,
  PARTNER_MODULES,
  PARTNER_OPERATING_STATES,
  type PartnerLifecycle,
  type PartnerModule,
  type PartnerTypeProfile,
  type PermissionCode,
} from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from '../platform/entitlement.service';
import { MarketService } from '../platform/markets/market.service';
import { ScopeService } from '../platform/scope.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface PartnerRow {
  organizationId: string;
  partnerType: string;
  lifecycle: PartnerLifecycle;
  nameEn: string;
  nameAr: string;
  orgStatus: string;
}

interface PartnersConfig {
  typeProfiles: Record<string, PartnerTypeProfile>;
  inviteTtlHours: number;
}

/**
 * The single place that answers "may this partner user do this here?" for the portal. Everything it uses is shared platform:
 * tenant isolation (TenantService), scoped roles (ScopeService), the contract (EntitlementService) and markets (MarketService).
 * Partner types only decide what is OFFERED (configuration); the contract decides what is ENTITLED; the market decides WHERE.
 */
@Injectable()
export class PartnerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly scope: ScopeService,
    private readonly entitlements: EntitlementService,
    private readonly markets: MarketService,
    private readonly config: SystemConfigService,
  ) {}

  async settings(): Promise<PartnersConfig> {
    return ((await this.config.get<PartnersConfig>(CONFIG_KEYS.PARTNERS)) ?? {
      typeProfiles: {},
      inviteTtlHours: 72,
    }) as PartnersConfig;
  }

  async profileOf(partnerType: string): Promise<PartnerTypeProfile> {
    const p = (await this.settings()).typeProfiles[partnerType];
    return (
      p ?? {
        modules: [],
        eligibilityAttributes: [],
        ingestionMethods: [],
        contractKinds: [],
        reporting: 'AGGREGATE',
      }
    );
  }

  /** Own partner organization only (404 for any other tenant); returns the partner record. */
  async requirePartner(actor: Actor, organizationId: string): Promise<PartnerRow> {
    this.tenant.requireOwnOrganization(actor, organizationId, 'PARTNER');
    return this.load(organizationId);
  }

  async load(organizationId: string): Promise<PartnerRow> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, type: 'PARTNER' },
      include: { partner: true },
    });
    if (!org?.partner) throw AppError.notFound();
    return {
      organizationId: org.id,
      partnerType: org.partner.partnerType,
      lifecycle: org.partner.lifecycle as PartnerLifecycle,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      orgStatus: org.status,
    };
  }

  /** A scoped partner member needs an organization-wide grant for organization-level work (same rule as merchants). */
  async requireOrgWide(actor: Actor, permission: PermissionCode) {
    if (!actor.membership?.scoped) return;
    await this.scope.require(actor, permission, {
      organizationId: actor.membership.organizationId,
    });
  }

  /** New exposure (campaigns, benefits, sponsorship) only once the partner is ACTIVE. */
  requireOperating(p: PartnerRow) {
    if (!PARTNER_OPERATING_STATES.includes(p.lifecycle) || p.orgStatus !== 'ACTIVE')
      throw new AppError(
        'PARTNER_NOT_ACTIVE',
        'This partner account is not active yet. Complete onboarding first.',
        409,
      );
  }

  /** The modules this partner sees: offered to its type AND entitled by its contract. */
  async modules(
    p: PartnerRow,
  ): Promise<Array<{ module: PartnerModule; offered: boolean; entitled: boolean }>> {
    const profile = await this.profileOf(p.partnerType);
    const e = await this.entitlements.effective(p.organizationId);
    return PARTNER_MODULES.map((m) => {
      const need = PARTNER_MODULE_ENTITLEMENT[m];
      const entitled =
        !need ||
        ((!need.product || e.products.includes(need.product)) &&
          (!need.anyFeature || need.anyFeature.some((f) => e.features.includes(f))));
      return { module: m, offered: profile.modules.includes(m), entitled };
    });
  }

  async requireModule(p: PartnerRow, m: PartnerModule) {
    const row = (await this.modules(p)).find((x) => x.module === m)!;
    if (!row.offered)
      throw new AppError(
        'PARTNER_CAPABILITY_UNAVAILABLE',
        'This capability is not part of this partner type',
        403,
      );
    if (!row.entitled)
      throw new AppError(
        'ENTITLEMENT_REQUIRED',
        'Your contract does not include this capability',
        403,
      );
  }

  /**
   * A merchant-network ingestion method: offered to the partner type, at least one qualifying contract feature (more than one can
   * authorize the same method) AND every shared capability the method runs on (BULK_IMPORT / API_ACCESS).
   */
  async requireIngestion(p: PartnerRow, method: 'MANUAL' | 'BULK' | 'API') {
    const profile = await this.profileOf(p.partnerType);
    if (!profile.ingestionMethods.includes(method))
      throw new AppError(
        'PARTNER_CAPABILITY_UNAVAILABLE',
        'This onboarding method is not offered to this partner type',
        403,
      );
    const e = await this.entitlements.effective(p.organizationId);
    const rule = PARTNER_INGESTION_FEATURES[method];
    const missing = [
      ...(rule.anyOf.some((f) => e.features.includes(f)) ? [] : [rule.anyOf.join(' or ')]),
      ...rule.allOf.filter((f) => !e.features.includes(f)),
    ];
    if (missing.length)
      throw new AppError(
        'ENTITLEMENT_REQUIRED',
        `Your contract does not include ${missing.join(', ')}`,
        403,
      );
  }

  /** Markets the partner operates in (legal entities + contract market), narrowed to the member's COUNTRY scope. */
  async authorizedMarkets(
    actor: Actor,
    p: PartnerRow,
    permission: PermissionCode = 'partner.profile.read',
  ): Promise<string[]> {
    const ms = (await this.markets.forOrganization(p.organizationId)).map((m) => m.code);
    if (!actor.membership?.scoped) return ms;
    const out: string[] = [];
    for (const c of ms)
      if (await this.scope.can(actor, permission, { organizationId: p.organizationId, country: c }))
        out.push(c);
    return out;
  }

  async requireMarket(
    actor: Actor,
    p: PartnerRow,
    market: string,
    permission: PermissionCode = 'partner.campaigns.manage',
  ) {
    if (!(await this.authorizedMarkets(actor, p, permission)).includes(market))
      throw new AppError(
        'PARTNER_MARKET_NOT_AUTHORIZED',
        `You are not authorized for ${market}`,
        403,
      );
  }

  /** The source-system name of the partner's own records (manual entries; keeps provenance per partner). */
  sourceSystemOf(organizationId: string) {
    return `PARTNER-PORTAL:${organizationId.slice(0, 8)}`;
  }
}
