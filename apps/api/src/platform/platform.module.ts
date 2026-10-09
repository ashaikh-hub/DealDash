import { Global, Module } from '@nestjs/common';
import { ReceivablesFinancialStatusProvider } from '../billing/financial-status.provider';
import { FINANCIAL_STATUS_PROVIDER } from '../subscription/policy';
import { AccessScopeService } from './access-scope.service';
import { CampaignVersionService } from './campaign-version.service';
import { ContractService } from './contract.service';
import { CountryService } from './country.service';
import { DelegationService } from './delegation.service';
import { EntitlementService } from './entitlement.service';
import { HierarchyService } from './hierarchy.service';
import { AdminPlatformController, OrgStructureController } from './platform.controllers';
import { ScopeService } from './scope.service';

/**
 * Shared platform foundation: business account structure (legal entities, organization units), scoped role assignments with
 * delegation, one scope-checking service, contracts and entitlements, and market configuration. Global because every product
 * module depends on scope and entitlement checks.
 */
@Global()
@Module({
  controllers: [OrgStructureController, AdminPlatformController],
  providers: [
    ScopeService,
    AccessScopeService,
    HierarchyService,
    DelegationService,
    EntitlementService,
    ContractService,
    CountryService,
    CampaignVersionService,
    // the financial state the entitlement engine reads: contract lifecycle + holds + receivables (Phase 5)
    { provide: FINANCIAL_STATUS_PROVIDER, useClass: ReceivablesFinancialStatusProvider },
  ],
  exports: [
    FINANCIAL_STATUS_PROVIDER,
    ScopeService,
    AccessScopeService,
    HierarchyService,
    DelegationService,
    EntitlementService,
    ContractService,
    CountryService,
    CampaignVersionService,
  ],
})
export class PlatformModule {}
