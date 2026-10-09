# Phase 5: Billing and Finance on the shared finance platform

Status: built and verified 2026-10-09; FOUNDER APPROVED AND FROZEN 2026-10-09. Decisions: `docs/PHASE4_PHASE5_IMPACT.md` (D5-1 .. D5-10).
It **extends** the commercial finance platform (`docs/COMMERCIAL_FINANCE.md`). It is not a second finance system: the same documents, payments, holds, credit facilities, ledger and audit are used.

## 1. Legal-entity finance scope and billing accounts

- The billed party is always a **legal entity**, never a brand or branch. A billing account (`BusinessAccount`) is one per (organization, legal entity, currency); one default per currency (partial unique index).
- Fields: business account, legal entity, country, currency, billing address, tax ID, finance and invoice contacts, payment terms, billing frequency (PER_EVENT, MONTHLY, QUARTERLY, ANNUAL, ON_DEMAND), method, contract, PO requirement, credit facility, status (ACTIVE, CREDIT_HOLD, FINANCIAL_HOLD, SUSPENDED, CLOSED).
- **Access = role + scope** (`FinanceAccessService`): `merchant|partner.finance.read/manage`; a scoped member sees only the legal entities their assignments cover; branch-bound access never sees finance; another organization gets 404. Businesses edit contacts and address; terms, frequency, method, contract and the PO rule are DealDash decisions (`admin.finance.manage`).
- Setting FINANCIAL_HOLD on an account places an organization-level financial hold (existing mechanism); releasing it releases the hold. Both are audited.

## 2. Billing models and collection (no double billing)

Billing models are configuration (`BILLING_MODELS`, 20 options); none is hard-coded. Every `CommercialBillingEvent` is collected **exactly once**:

| Collection | Events | Settled by |
|---|---|---|
| INVOICE_DUE | subscriptions, licences, setup / integration / API fees, add-ons, premium services, overage | invoice line on a periodic invoice |
| PREPAID_DRAWDOWN | Watch & Earn qualified views; prepaid campaign usage | the campaign's prepaid funding |
| NETTED_FROM_PAYABLE | voucher transaction commission | netted from the merchant payable |
| CAMPAIGN_CASE | credit-mode Exclusive Deal usage | the commercial case closure invoice |
| NOT_BILLABLE | events with no amount | — |

The billing run (`InvoicingService.run`, job `billing.daily`, also `POST /v1/admin/billing/run`) consumes non-invoice collections with their settlement reference and drafts invoices for due accounts. **Drafts are never issued automatically.**

## 3. Quotations and commercial acceptance

Existing case / quotation / acceptance flow, plus: quotation `validUntil` (`finance.billing.quotationValidityDays`, default 14); accepting an expired quotation fails with `QUOTATION_EXPIRED` and marks it EXPIRED; a required party may **reject** or **request modification** (`POST /v1/orgs/:orgId/billing/quotations/:caseId/decline`); expired, rejected or modification-requested quotations are never reused: the same economics are re-quoted as a new version. Amendments that raise exposure still need re-acceptance (unchanged).

## 4. Invoicing

Document kinds: Proforma invoice, Tax invoice, Invoice, Credit note, Debit note, Payment receipt, Adjustment note, Purchase order, Statement. States: Draft, Pending approval, Issued, Sent, Partially paid, Paid, Overdue, Disputed, Cancelled, Credited, Written off, Void.

- **Immutability** (database trigger): after DRAFT / PENDING_APPROVAL the number, party, amounts, lines, dates, currency, FX, PO and quotation of a document cannot change, and issued documents cannot be deleted. Corrections are credit / debit notes; only drafts can be cancelled.
- **Maker-checker**: at or above `issueApprovalThresholdMinor` (SAR 100,000 / PKR 500,000 by default) issuing needs a second finance person with `admin.finance.approve`.
- **Tax**: per country configuration (`CountryConfiguration.taxProfile`). When not configured the document says so (`TAX_NOT_CONFIGURED_VALIDATE`); tax is never invented (VALIDATE-KSA).
- Lines are bilingual and carry product, campaign, contract, pricing version, quantity, unit price and collection.
- **Proforma** is a request for payment, never a receivable. **Write-off** is disabled until the statutory treatment is confirmed (`writeOffAllowed: false`).

## 5. Receivables, payments, PO and credit

- Payments are recorded in the account currency only, allocated oldest-first (or explicitly); any excess stays as **unallocated credit**; over-allocation is refused (`OVERPAYMENT`). Each payment issues a receipt.
- AR per account with aging buckets (current, 1–30, 31–60, 61–90, 90+), overdue, disputed and unallocated credit. Overdue marking runs daily.
- **Disputes** open a dispute case and set the invoice DISPUTED; DealDash resolves it (rejected, or upheld with a credit note).
- **Statements** of account (opening, movements, running balance); a numbered copy can be issued.
- **Purchase orders**: when an account requires one, issuing needs a valid PO with enough remaining value (`PO_REQUIRED` / `PO_INSUFFICIENT`). PO usage and remaining value are shown.
- **Credit exposure** now includes open receivables billed outside campaign cases, so no new exposure is accepted above the credit limit.
- **Financial status** (`ReceivablesFinancialStatusProvider`, swapped in `platform.module.ts`): contract lifecycle + holds + receivables. Overdue invoices are always reported (GRACE with a reason); they turn the status PAST_DUE only when `finance.billing.overdueDrivesPastDue` is switched on (default off: enforcement stays a Finance decision). Customer rights, redemptions and records are never affected.

## 6. Multi-currency

Transaction, billing (settlement) and tax currency are recorded per document. A legal entity is invoiced in its own currency; conversion uses only an **approved** FX rate (`FxRate`: pair, rate as exact decimal text, source, date; maker-checker approval). Without one the run reports `FX_RATE_REQUIRED` and the events wait. Nothing converts silently. The general ledger stays SAR (documented constraint).

## 7. Reconciliation

`GET …/billing/reconciliation?by=` BUSINESS_ACCOUNT, LEGAL_ENTITY, PRODUCT, CAMPAIGN, FUNDING_PARTY, MERCHANT, SPONSOR or CURRENCY: billed, prepaid draw-down, netted, campaign case, pending, invoiced, paid, funding received / used, merchant payable / settled, with MATCHED / DIFFERENCE. Integrity check: invoiceable events without an invoice line. Product flow checks: Watch (funding records = budgets; spend within funding), Exclusive (billed redemptions within utilisation), Voucher (commission billed ≤ retained), Loyalty (points outstanding reported, no cash value). DealDash, merchant and sponsor dimensions are DealDash-only.

## 8. Subscription and enterprise billing

Subscription / licence / plan-change / add-on / overage billing events (from the subscription engine) are INVOICE_DUE and are invoiced to the contract's billing legal entity in its currency.

## 9. API and screens

Business: `/v1/orgs/:orgId/billing/` `accounts`, `accounts/:id` (GET/PUT), `accounts/:id/statement`, `documents`, `documents/:id`, `documents/:id/dispute`, `receivables`, `purchase-orders` (GET/POST), `reconciliation`, `quotations/:caseId/decline`.
DealDash: `/v1/admin/billing/` accounts (+ status, statement issue), `run`, documents (+ issue, send, cancel, notes, write-off, dispute/resolve), `proforma`, `payments` (+ allocate), `receivables`, `purchase-orders`, `fx-rates` (+ approve / reject), `reconciliation`.
Screens: merchant `/billing`; admin `/billing` (`packages/app-shell/src/billing/billing-views.tsx`).

## 10. Verification

API: `apps/api/test/billing.e2e.test.ts` (19 tests: run and collections, drafts hidden, issue and event linkage, immutability, maker-checker, LE scope, contacts vs DealDash terms, partial payment and credit, notes, dispute, overdue and financial status, statements, write-off disabled, PO, FX, proforma, reconciliation, quotation decline / expiry, financial hold). Components and browser: see Phase 4 doc §9.

## Market extension (Oct 2026)

Invoicing now uses the billed party's market: tax from that market's approved, effective-dated tax rules (rule id + version on every line;
no fallback to another country; otherwise "not configured" with the market's validation code) and, at issue, the market / legal-entity
invoice configuration in force (number prefix and sequence, required fields, QR / e-invoicing settings recorded on the document). Documents
keep their market and configuration for ever. FX manual overrides need a reason. Details: `docs/MARKET_COUNTRY_CONFIGURATION.md`.