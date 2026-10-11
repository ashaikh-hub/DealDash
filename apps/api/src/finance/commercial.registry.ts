import { Injectable } from '@nestjs/common';
import type { CommercialProduct } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Economics } from './quote.calculator';

export interface CommercialSubject {
  id: string;
  organizationId: string;
  title: { en: string; ar: string };
  /** The product's own operational status. */
  status: string;
  /** True once the campaign has ended / closed (reconciliation can run). */
  finished: boolean;
  content: unknown;
}

/**
 * One adapter per product. The shared commercial platform never imports product code: each product module registers an
 * adapter that loads its campaigns and derives their economics. Product rules stay in the product; the finance components
 * (quotation, acceptance, funding, ledger, documents, reconciliation) are shared.
 */
export interface CommercialAdapter {
  product: CommercialProduct;
  /** How the product's prepaid media / budget line is held: a DealDash charge (default) or a sponsor's funding (loyalty points). */
  fundingKind?: 'CHARGE' | 'SPONSOR_FUNDING';
  load(subjectId: string): Promise<CommercialSubject>;
  /** Economics from a content object (an unsaved builder draft or the stored campaign). */
  economics(organizationId: string, content: unknown, subjectId: string | null): Promise<Economics>;
  /** Products that hold the funds themselves (Watch & Earn budget) report required / funded here. */
  managedFunding?(
    subjectId: string,
  ): Promise<{ requiredHalalas: number; fundedHalalas: number; spentHalalas: number }>;
  /** Inventory figures for closure reconciliation. */
  inventory(subjectId: string): Promise<{
    configured: number;
    issued: number;
    redeemed: number;
    expiredOrUnused: number;
    invalidOrCancelled: number;
  }>;
}

@Injectable()
export class CommercialRegistry {
  private readonly adapters = new Map<CommercialProduct, CommercialAdapter>();

  register(adapter: CommercialAdapter) {
    this.adapters.set(adapter.product, adapter);
  }

  get(product: CommercialProduct): CommercialAdapter {
    const a = this.adapters.get(product);
    if (!a) throw AppError.validation(`No commercial adapter for ${product}`);
    return a;
  }

  has(product: CommercialProduct) {
    return this.adapters.has(product);
  }
}
