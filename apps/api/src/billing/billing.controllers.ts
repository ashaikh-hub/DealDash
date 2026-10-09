import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { BillingAccountStatus } from '@dealdash/types';
import {
  billingAccountPatchSchema,
  billingAccountStatusSchema,
  billingPaymentSchema,
  billingRunSchema,
  disputeResolutionSchema,
  documentReasonSchema,
  financeDocumentQuerySchema,
  financeNoteSchema,
  fxRateSchema,
  invoiceDisputeSchema,
  paymentAllocationSchema,
  proformaSchema,
  purchaseOrderSchema,
  quotationDeclineSchema,
  receivablesQuerySchema,
  reconciliationQuerySchema,
  statementQuerySchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
} from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { BillingAccountsService } from './billing-accounts.service';
import { FinanceAccessService } from './finance-access.service';
import { InvoicingService } from './invoicing.service';
import { ReceivablesService } from './receivables.service';
import { ReconciliationService, type ReconDimension } from './reconciliation.service';

class DeclineDto extends createZodDto(quotationDeclineSchema) {}
class AccountPatchDto extends createZodDto(billingAccountPatchSchema) {}
class AccountStatusDto extends createZodDto(billingAccountStatusSchema) {}
class PoDto extends createZodDto(purchaseOrderSchema) {}
class FxDto extends createZodDto(fxRateSchema) {}
class RunDto extends createZodDto(billingRunSchema) {}
class NoteDto extends createZodDto(financeNoteSchema) {}
class PaymentDto extends createZodDto(billingPaymentSchema) {}
class AllocationDto extends createZodDto(paymentAllocationSchema) {}
class DisputeDto extends createZodDto(invoiceDisputeSchema) {}
class ResolveDto extends createZodDto(disputeResolutionSchema) {}
class ReasonDto extends createZodDto(documentReasonSchema) {}
class ProformaDto extends createZodDto(proformaSchema) {}
class StatementDto extends createZodDto(statementQuerySchema) {}
class DocQueryDto extends createZodDto(financeDocumentQuerySchema) {}
class ReconDto extends createZodDto(reconciliationQuerySchema) {}
class ArQueryDto extends createZodDto(receivablesQuerySchema) {}

/**
 * The business's billing: billing accounts per legal entity, invoices and notes, statements, purchase orders, receivables and
 * reconciliation. Access = finance permission + scope (a scoped member sees only its legal entities; branch access never).
 */
@ApiTags('billing')
@Controller('orgs/:orgId/billing')
@Audiences('merchant', 'partner')
export class OrgBillingController {
  constructor(
    private readonly access: FinanceAccessService,
    private readonly accounts: BillingAccountsService,
    private readonly invoicing: InvoicingService,
    private readonly ar: ReceivablesService,
    private readonly recon: ReconciliationService,
    private readonly commercial: CommercialService,
  ) {}

  @Get('accounts')
  async listAccounts(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.accounts.list(await this.access.resolve(actor, orgId, 'read'));
  }

  @Get('accounts/:id')
  async account(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.accounts.get(await this.access.resolve(actor, orgId, 'read'), id);
  }

  @Put('accounts/:id')
  async updateAccount(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AccountPatchDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.accounts.update(
      actor,
      await this.access.resolve(actor, orgId, 'manage'),
      id,
      b,
      meta,
    );
  }

  @Get('accounts/:id/statement')
  async statement(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.ar.statement(
      await this.access.resolve(actor, orgId, 'read'),
      id,
      new Date(q.from),
      new Date(q.to),
    );
  }

  @Get('documents')
  async documents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: DocQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.invoicing.list(await this.access.resolve(actor, orgId, 'read'), q);
  }

  @Get('documents/:id')
  async document(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.invoicing.view(id, await this.access.resolve(actor, orgId, 'read'));
  }

  @Post('documents/:id/dispute')
  @Idempotent()
  async dispute(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DisputeDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.ar.dispute(
      actor,
      await this.access.resolve(actor, orgId, 'manage'),
      id,
      b.reason,
      meta,
    );
  }

  @Get('receivables')
  async receivables(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.ar.receivables(await this.access.resolve(actor, orgId, 'read'));
  }

  @Get('purchase-orders')
  async purchaseOrders(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.accounts.purchaseOrders(await this.access.resolve(actor, orgId, 'read'), {});
  }

  @Post('purchase-orders')
  @Idempotent()
  async createPo(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: PoDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const id = await this.accounts.createPurchaseOrder(
      actor,
      await this.access.resolve(actor, orgId, 'manage'),
      { ...b, organizationId: orgId },
      meta,
    );
    return { id };
  }

  @Get('reconciliation')
  async reconciliation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: ReconDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.access.resolve(actor, orgId, 'read');
    return this.recon.report(a, {
      by: q.by as ReconDimension,
      currency: q.currency,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
  }

  /** A required party rejects a quotation or asks for a change (acceptance itself stays on the commercial routes). */
  @Post('quotations/:caseId/decline')
  @Idempotent()
  @HttpCode(200)
  async decline(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() b: DeclineDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const m = actor.membership;
    if (!m || m.organizationId !== orgId) throw AppError.notFound();
    if (m.branchId) throw AppError.forbidden();
    const perm =
      m.organizationType === 'PARTNER' ? 'partner.finance.manage' : 'merchant.commercial.accept';
    if (!actor.permissions.has(perm)) throw AppError.forbidden();
    await this.commercial.decline(actor, orgId, caseId, b.quotationId, b.decision, b.reason, meta);
    return { ok: true as const };
  }
}

/** DealDash finance: every billing account, document, receivable, PO, exchange rate and reconciliation across businesses. */
@ApiTags('admin-billing')
@Controller('admin/billing')
@Audiences('admin')
export class AdminBillingController {
  constructor(
    private readonly access: FinanceAccessService,
    private readonly accounts: BillingAccountsService,
    private readonly invoicing: InvoicingService,
    private readonly ar: ReceivablesService,
    private readonly recon: ReconciliationService,
  ) {}

  private read(actor: Actor, orgId?: string) {
    return this.access.resolve(actor, orgId ?? null, 'read');
  }
  private manage(actor: Actor) {
    return this.access.resolve(actor, null, 'manage');
  }

  @Get('accounts')
  @RequirePermissions('admin.finance.read')
  async accountsList(@Query() q: ArQueryDto, @CurrentActor() actor: Actor) {
    return this.accounts.list(await this.read(actor), q.organizationId);
  }

  @Get('accounts/:id')
  @RequirePermissions('admin.finance.read')
  async account(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.accounts.get(await this.read(actor), id);
  }

  @Put('accounts/:id')
  @RequirePermissions('admin.finance.manage')
  async updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AccountPatchDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.accounts.update(actor, await this.manage(actor), id, b, meta);
  }

  @Post('accounts/:id/status')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async accountStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AccountStatusDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.accounts.setStatus(actor, id, b.status as BillingAccountStatus, b.reason, meta);
    return this.accounts.get(await this.read(actor), id);
  }

  @Get('accounts/:id/statement')
  @RequirePermissions('admin.finance.read')
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.ar.statement(await this.read(actor), id, new Date(q.from), new Date(q.to));
  }

  @Post('accounts/:id/statement')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async issueStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() q: StatementDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.ar.issueStatement(
      actor,
      await this.read(actor),
      id,
      new Date(q.from),
      new Date(q.to),
      meta,
    );
  }

  @Post('run')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async run(@Body() b: RunDto, @CurrentActor() actor: Actor) {
    return this.invoicing.run(actor, { organizationId: b.organizationId, force: b.force });
  }

  @Get('documents')
  @RequirePermissions('admin.finance.read')
  async documents(@Query() q: DocQueryDto, @CurrentActor() actor: Actor) {
    return this.invoicing.list(await this.read(actor), q);
  }

  @Get('documents/:id')
  @RequirePermissions('admin.finance.read')
  async document(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.view(id);
  }

  @Post('documents/:id/issue')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.invoicing.issue(actor, id, meta);
  }

  @Post('documents/:id/send')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.invoicing.send(actor, id, meta);
  }

  @Post('documents/:id/cancel')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.invoicing.cancelDraft(actor, id, b.reason, meta);
  }

  @Post('documents/:id/notes')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async note(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: NoteDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.invoicing.note(actor, id, b, meta);
  }

  @Post('documents/:id/write-off')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.approve')
  async writeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.invoicing.writeOff(actor, id, b.reason, meta);
  }

  @Post('documents/:id/dispute/resolve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ResolveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.ar.resolveDispute(actor, id, b, meta);
  }

  @Post('proforma')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async proforma(@Body() b: ProformaDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.invoicing.proforma(actor, b, meta);
  }

  @Post('payments')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async payment(@Body() b: PaymentDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.ar.recordPayment(actor, b, meta);
  }

  @Post('payments/:id/allocate')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  async allocate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AllocationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.ar.allocate(actor, id, b.documentId, b.amountMinor, meta);
    return { ok: true as const };
  }

  @Get('receivables')
  @RequirePermissions('admin.finance.read')
  async receivables(@Query() q: ArQueryDto, @CurrentActor() actor: Actor) {
    return this.ar.receivables(await this.read(actor), q);
  }

  @Get('purchase-orders')
  @RequirePermissions('admin.finance.read')
  async purchaseOrders(@Query() q: ArQueryDto, @CurrentActor() actor: Actor) {
    return this.accounts.purchaseOrders(await this.read(actor), q);
  }

  @Post('purchase-orders')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async createPo(@Body() b: PoDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    if (!b.organizationId) throw AppError.validation('The business is required', 'organizationId');
    const id = await this.accounts.createPurchaseOrder(
      actor,
      await this.manage(actor),
      { ...b, organizationId: b.organizationId },
      meta,
    );
    return { id };
  }

  @Get('fx-rates')
  @RequirePermissions('admin.finance.read')
  async rates() {
    return this.accounts.listRates();
  }

  @Post('fx-rates')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  async proposeRate(@Body() b: FxDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.accounts.proposeRate(actor, b, meta);
  }

  @Post('fx-rates/:id/:decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.approve')
  async decideRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (decision !== 'approve' && decision !== 'reject') throw AppError.notFound();
    await this.accounts.decideRate(actor, id, decision === 'approve', meta);
    return { ok: true as const };
  }

  @Get('reconciliation')
  @RequirePermissions('admin.finance.read')
  async reconciliation(@Query() q: ReconDto, @CurrentActor() actor: Actor) {
    return this.recon.report(await this.read(actor), {
      by: q.by as ReconDimension,
      organizationId: q.organizationId,
      currency: q.currency,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
  }
}
