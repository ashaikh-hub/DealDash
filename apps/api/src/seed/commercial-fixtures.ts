import { AuditService } from '../audit/audit.service';
import { CommercialRegistry } from '../finance/commercial.registry';
import { CommercialService } from '../finance/commercial.service';
import { PricingService } from '../finance/pricing.service';
import type { PrismaClient } from '../generated/prisma/client';
import { CampaignVersionService } from '../platform/campaign-version.service';
import { EntitlementService } from '../platform/entitlement.service';
import { HotCommercialAdapter } from '../hot-deals/hot-commercial.adapter';
import type { TenantService } from '../identity/tenant.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { VoucherCommercialAdapter } from '../vouchers/voucher-commercial.adapter';
import { LedgerService } from '../vouchers/ledger.service';
import { WatchCommercialAdapter } from '../watch/watch-commercial.adapter';

/**
 * Seeded campaigns pre-date the commercial platform. They are NOT grandfathered silently: each non-draft campaign gets a real
 * quotation, acceptance and (mock) funding through the same code path as production, and its case is marked as a DEVELOPMENT
 * FIXTURE so nobody mistakes it for a real commercial agreement. Drafts, rejected and needs-changes campaigns are left alone: they
 * must go through the real flow.
 *
 * The seed runs under tsx (no decorator metadata), so the services are wired by hand instead of through Nest's container.
 */
export async function seedCommercialFixtures(prisma: PrismaClient) {
  const db = prisma as unknown as PrismaService;
  const audit = new AuditService(db);
  const config = new SystemConfigService(db, audit);
  const registry = new CommercialRegistry();
  new HotCommercialAdapter(db, registry).onModuleInit();
  new VoucherCommercialAdapter(db, registry).onModuleInit();
  new WatchCommercialAdapter(db, registry, config).onModuleInit();
  const svc = new CommercialService(
    db,
    audit,
    new LedgerService(db),
    registry,
    new PricingService(db, config),
    {} as TenantService,
    new EntitlementService(db, config),
    new CampaignVersionService(db),
  );
  const versions = new CampaignVersionService(db);
  const approved = {
    EXCLUSIVE: ['SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED'],
    VOUCHER: ['SCHEDULED', 'ON_SALE', 'PAUSED', 'SOLD_OUT', 'ENDED', 'SUSPENDED'],
    WATCH: ['SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'EXPIRED', 'SUSPENDED'],
  } as const;
  const skip = ['DRAFT', 'NEEDS_CHANGES', 'REJECTED'];
  const [hot, vouchers, watch] = await Promise.all([
    prisma.hotDeal.findMany({
      where: { status: { notIn: skip as never[] } },
      select: { id: true, status: true, organizationId: true, content: true },
    }),
    prisma.voucher.findMany({
      where: { status: { notIn: skip as never[] } },
      select: { id: true, status: true, organizationId: true, content: true },
    }),
    prisma.watchCampaign.findMany({
      where: { status: { notIn: skip as never[] } },
      select: { id: true, status: true, organizationId: true, content: true },
    }),
  ]);
  let n = 0;
  for (const [product, rows] of [
    ['EXCLUSIVE', hot],
    ['VOUCHER', vouchers],
    ['WATCH', watch],
  ] as const) {
    for (const r of rows) {
      try {
        await svc.devComplete(product, r.id);
        // campaigns that are already approved get their first version (a pending campaign gets one when it is approved)
        if ((approved[product] as readonly string[]).includes(r.status))
          await prisma.$transaction((tx) =>
            versions.recordLive(tx, {
              product,
              subjectId: r.id,
              organizationId: r.organizationId,
              content: r.content,
              reason: 'APPROVED',
            }),
          );
        n++;
      } catch (e) {
        console.warn(
          `  commercial fixture skipped for ${product} ${r.id}: ${(e as Error).message}`,
        );
      }
    }
  }
  console.log(`  commercial development fixtures: ${n} campaigns`);
}
