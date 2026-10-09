import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deriveFinancialStatus, type FinancialStatusProvider, type FinancialStatusView } from './policy';

/**
 * Default financial status: derived from the contract lifecycle, the grace window and organization-level financial holds.
 * Phase 5 replaces this provider (same interface) with one that also reads receivables and invoices; consumers do not change.
 */
@Injectable()
export class DefaultFinancialStatusProvider implements FinancialStatusProvider {
  constructor(private readonly prisma: PrismaService) {}

  statusFor(organizationId: string, opts: { at?: Date } = {}): Promise<FinancialStatusView> {
    return deriveFinancialStatus(this.prisma, organizationId, opts.at);
  }
}