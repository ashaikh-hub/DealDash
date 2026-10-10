# Commercial Governance and Finance (shared platform)

Status: built and verified, waiting for approval. This is the source of truth for how DealDash prices, discloses, accepts, funds, tracks and reconciles the commercial side of every campaign product. Product behaviour (what customers see and do) stays in `docs/STAGE3.md` to `docs/STAGE6.md`.

Not in this change: Partner Portal functionality, Play & Win, Stage 7. Statutory invoice formats, e-invoicing, tax treatment and accounting recognition are **VALIDATE-KSA** and are configuration, never a hard-coded rule.

## The principle (applies to every product)

Any action that creates a DealDash charge, a sponsor or merchant funding obligation, an inventory commitment, a customer-benefit commitment, a financial liability or a reimbursement obligation must:

1. calculate the economics (server side, from configuration and the campaign, never typed by the merchant);
2. show them to the responsible business before it submits;
3. identify who owes and who commits what;
4. obtain the required approval (configurable);
5. obtain explicit acknowledgement from every required party;
6. keep the accepted version permanently;
7. prevent silent increases (a change after acceptance is an amendment that must be accepted again);
8. feed Finance (ledger, documents, payments, credit, holds);
9. track actual utilisation from verified events;
10. reconcile at closure.

It is implemented once and adopted by **Exclusive Deals**, **Vouchers** and **Watch & Earn**. Live Deals carry the hook (`LIVE_BENEFIT` product) for a future DealDash member benefit that has funding, a commitment or a charge; no such benefit entity exists yet, so nothing is built for it beyond the vocabulary.

## Closed founder decisions (and where each is implemented)

| # | Decision | Implementation |
|---|---|---|
| 1 | Finance MVP is real: quotation, acceptance, sub-ledger, funding commitment, payments, invoice, receipt, PO, credit limit, financial hold, adjustments, credit and debit notes, settlement, reconciliation, RBAC, audit. Statutory formats configurable, VALIDATE-KSA | `apps/api/src/finance/*`, migration `20261215000000_commercial_finance_platform`, `FinanceDocument.statutory` is an open JSON field |
| 2 | Hybrid funding, prepaid by default; approved enterprise credit or postpaid | `BusinessAccount.fundingMode`, `FundingCommitment.mode` PREPAID or CREDIT; credit is used only when the account has an active facility with room for the **whole** commitment |
| 3 | Credit only by Admin or Finance approval; configurable maker-checker; exposure never above available credit | `admin.finance.credit.manage` requests, `admin.finance.credit.approve` decides; `CommercialApprovalRule` scope CREDIT adds the two-person rule; exposure is computed, never stored |
| 4 | No forced maker-checker for small merchants; workflows configurable; no hard-coded thresholds | `CommercialApprovalRule` (data). With no matching rule no extra step is required |
| 5 | A third-party merchant may be drafted but cannot go live until onboarded and it explicitly approves its obligations. Admin may act on behalf only with an auditable authorisation, and **never** for a fulfilment merchant | gate blocker `FULFILMENT_NOT_ONBOARDED` and `ACCEPTANCE_MISSING`; `AdminAuthorization`; the on-behalf API accepts only roles OWNER or SPONSOR |
| 6 | Unused sponsor funding is agreement-driven and blocks activation if not configured | `PricingAgreementVersion.unusedTreatment`; no default exists; blocker `UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED` |
| 7 | Non-cash merchant benefit reconciles separately | quote line kind `MERCHANT_BENEFIT` (`cash: false`); reconciliation `merchantBenefit` block with `note: non_cash_unused_commitment`; never added to cash totals |
| 8 | No legacy grandfathering of real campaigns; fixtures may be regenerated or marked development | a live campaign without a case cannot grow (amendment gate); seeded and test campaigns are walked through the real flow and the case is marked `developmentFixture` |
| 9 | A future live-campaign material change means amendment, recalculation, re-acceptance | `Quotation.delta`, `COMMERCIAL_AMENDMENT_REQUIRED` on stock or quantity increases |
| 10 | A Live Deal member benefit with funding, commitment or charge follows the same principle | `LIVE_BENEFIT` product value reserved; adapter to be added when the benefit exists |

## Architecture

```
product module (Exclusive / Voucher / Watch)         shared finance module (apps/api/src/finance)
  CommercialAdapter (load, economics, inventory) --> CommercialRegistry
  submit  ------------------------------------------> CommercialService.assertCanSubmit
  approve / auto-publish ---------------------------> CommercialService.assertCanActivate (+ earnUpfront in the transaction)
  stock or quantity increase -----------------------> CommercialService.requireCoverage  (amendment)
  verified redemption  -----------------------------> CommercialService.recordUtilization (same transaction)
  redemption reversal ------------------------------> CommercialService.reverseUtilization
                                                      PricingService, FinanceAdminService, LedgerService (shared with Stage 5/6)
```

The finance module imports no product module. Each product registers an adapter, so product rules stay in the product and the finance components are shared.

### Quotation calculator (`quote.calculator.ts`, pure and unit tested)

Inputs: the campaign economics (units, prices, customer saving, sponsors, merchant cash, media spend) and a **pricing context** (components, tax in basis points or `null`). Output: lines and totals.

* `DEALDASH_CHARGE`: fixed, per unit, or a percentage of selling price, face value, media spend or benefit value; each has a trigger (upfront, verified redemption, sale) and a collection (CASH or NETTED against the payout). A minimum charge is supported.
* `TAX`: only from configuration. With no configured tax the line is 0 and the totals say `NOT_CONFIGURED` (VALIDATE-KSA); no rate is ever invented.
* `SPONSOR_FUNDING`: one line per sponsor, its own cash obligation, **never DealDash revenue**.
* `MERCHANT_CASH_CONTRIBUTION`: netted from the payout.
* `MERCHANT_BENEFIT`: the saving the merchant honours (saving minus sponsor minus cash contribution), non-cash.
* Issues: `UNBOUNDED_*` (unlimited units with a per-unit charge or benefit) and `FUNDING_EXCEEDS_BENEFIT` block activation.

### Data model (additive migration, nothing existing changed)

`LegalEntity`, `BusinessAccount`, `PricingAgreement` + `PricingAgreementVersion`, `CommercialApprovalRule`, `CommercialCase` (one per campaign, commercial status separate from the campaign status), `Quotation` (versions, lines, totals, pricing snapshot, required parties, amendment delta), `CommercialAcceptance` (**append-only by database trigger**), `CommercialApproval`, `FundingCommitment` (CHECK constraints: utilised never above the maximum, earned never above upfront), `UtilizationEvent` (unique per commitment and source: idempotent), `FinancePayment`, `FinanceDocument`, `FinanceSequence`, `CreditFacility` (one open per account, partial unique index), `FinancialHold` (one active per case or business), `FinanceAdjustment`, `CaseReconciliation`, `AdminAuthorization`. New ledger families `CAMPAIGN_FUNDS_HELD`, `RECEIVABLE`, `FUNDING_UTILIZED` and journal types `FUNDING_RECEIVED`, `FUNDING_UTILIZED`, `FUNDING_RELEASED`, `DOCUMENT_ADJUSTMENT`.

### Ledger entries (all balanced, idempotent, append-only)

| Event | Lines |
|---|---|
| prepaid funds received | PSP clearing (debit) / campaign funds held, business (credit) |
| credit payment received | PSP clearing (debit) / receivable, business (credit) |
| charge earned (prepaid) | campaign funds held (debit) / platform revenue (credit) |
| charge earned (credit) | receivable (debit) / platform revenue (credit) |
| sponsor funding utilised | held or receivable (debit) / funding utilised (credit) |
| reversal | exact opposite journal; the utilisation event is marked reversed |
| refund, non-refundable release | held (debit) / PSP clearing or platform revenue (credit) |
| manual adjustment | adjustments / held, signed by direction |

Revenue recognition timing is VALIDATE-KSA.

## Activation gate (what blocks going live)

Evaluated by the server on every approval and every guardrail auto-publish; a campaign with open blockers is routed to manual review instead of auto-publishing, and an Admin approval is refused with `ACTIVATION_BLOCKED`.

`NO_QUOTATION`, `UNBOUNDED_LIABILITY`, `ACCEPTANCE_MISSING` (per party), `AMENDMENT_NOT_ACCEPTED`, `FULFILMENT_NOT_ONBOARDED`, `APPROVAL_PENDING` or `APPROVAL_REJECTED`, `UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED`, `FUNDING_MISSING`, `CREDIT_NOT_ACTIVE`, `CREDIT_LIMIT_EXCEEDED`, `FINANCIAL_HOLD`.

Submission itself needs only the owner's acceptance (`COMMERCIAL_ACCEPTANCE_REQUIRED`); the merchant app keeps the Submit button disabled until then.

## Acceptance (explicit acknowledgement)

Seven acknowledgements exist; the server lists the ones each party must tick: reviewed the summary, understand the charges, confirm funding, confirm the benefit, confirm quantity and limits, will honour redemptions, accept the terms. Each acceptance stores the user, role, legal entity, language, text version, the amounts shown, IP address, user agent and a unique reference (`AC-000123`). It cannot be updated or deleted. A new accepted version never overwrites an earlier one.

## Pricing

Pricing agreements are data with versions, scopes (global, organisation) and a priority. The most specific active agreement wins; otherwise the Admin default (`commercial.default_pricing`, all MOCK values). A new agreement version re-prices **new** quotations; an accepted quotation keeps the version it was priced with. Finance can apply the agreement's treatment of unused funding to an already accepted case, but can never choose one.

## Roles and permissions

| Permission | Granted to |
|---|---|
| `merchant.commercial.read` | Owner, Admin, Finance, Campaign Manager |
| `merchant.commercial.prepare` | Campaign Manager |
| `merchant.commercial.accept` | Owner, Admin |
| `merchant.commercial.approve_internal` | Owner, Admin |
| `merchant.commercial.approve_finance` | Merchant Finance, Owner (not Admin: the signatory and Finance hold the money controls) |
| `admin.finance.read` | Operations, Finance, Super Admin |
| `admin.finance.manage` | Finance, Super Admin (payments, documents, adjustments, holds, authorisations, close, on-behalf acceptance) |
| `admin.finance.pricing.manage` | Finance, Super Admin |
| `admin.finance.credit.manage` | Finance, Super Admin (request) |
| `admin.finance.credit.approve` | Finance, Super Admin (decide; the maker cannot approve when a credit rule requires two people) |

Two-person control: the person who accepted a quotation cannot approve it, and one person cannot decide two steps. Sponsors see only their own lines.

## Interfaces

Merchant: `/v1/merchants/:orgId/commercial/{preview,case,cases,cases/:id,cases/:id/accept,cases/:id/approvals/:step,cases/:id/pay}`. Admin: `/v1/admin/commercial/{overview,cases,cases/:id,cases/:id/reconciliation,cases/:id/close,cases/:id/apply-agreement,cases/:id/accept-on-behalf,pricing,approval-rules,authorizations,credit,holds,payments,documents,adjustments}`. (`/v1/admin/finance/*` remains the Stage 5 voucher finance.)

UI: a shared commercial summary, acknowledgement and funding panel (`packages/app-shell/src/commercial`) in the Exclusive Deal, Voucher and Watch & Earn builders and detail pages; "Commercial terms" page for every party (`/commercial` in the merchant app); the "Commercial finance" workspace in the admin app (`/commercial`). Copy: `dictionaries.commercial.ts` (EN and AR, Arabic needs native review).

## Product integration

* **Exclusive Deals:** DealDash redemption fee (per verified redemption, configurable), optional fixed fees, sponsors, merchant cash contribution, third-party fulfilment merchant. Stock increases are amendments. A walk-in deal needs a stated maximum redemption count so the cost is bounded.
* **Vouchers:** the platform commission is a percentage charge **netted** from the payout (no prepayment); the saving (face minus price) is the merchant's non-cash commitment; optional sponsors. Quantity increases are amendments. The existing Stage 5 fee rule and settlement figures are unchanged.
* **Watch & Earn:** media spend (paid views x rate card) is the DealDash charge. The pre-funded budget stays owned by Watch & Earn (hard cap by conditional SQL); the commercial commitment is "adapter-managed" and reads required and funded from the campaign. Acceptance, approvals and the unused-budget agreement rule now gate going live. The existing `watch.unused_budget_treatment` stays recorded as UNDECIDED; the agreement is what decides.

## Reconciliation and closure

`GET .../reconciliation` shows inventory (configured, issued, redeemed, unused, cancelled), per party committed, received, utilised, outstanding and unused amounts, the merchant benefit apart, and exceptions (over-funding, over-draw, redeemed above issued). Closure needs the campaign to have ended, applies the agreement's treatment (refund, credit to account, carry forward, transfer to another campaign, non-refundable), issues an invoice for earned charges and marks the case CLOSED. Refunds and non-refundable release are ledger journals.

## Remaining VALIDATE-KSA items

Tax rate and treatment of each charge; e-invoicing and tax invoice format and numbering; revenue recognition timing; legal wording of the acknowledgements and the sponsor, merchant and credit agreements; the real payment provider and bank-transfer reconciliation; statutory retention of documents and the acceptance record; treatment of unused funding by default product category; credit policy and collections.

## Tests

* `quote.calculator.unit.test.ts`: pricing, minimums, tax never invented, sponsor separation, non-cash benefit, unbounded cost, hash and amendment delta.
* `commercial.e2e.test.ts` and `commercial-products.e2e.test.ts`: preview, acknowledgement, permanent record (database trigger), prepaid gate, utilisation and reversal, sponsors and on-behalf authorisation, third-party fulfilment merchant, maker-checker, credit and exposure, holds, reconciliation and closure, permissions, Vouchers and Watch & Earn adoption, no grandfathering.
* UI: `apps/merchant/features/commercial.test.tsx`, `apps/admin/features/commercial.test.tsx`, localization test.


## Phase 5 extension (Oct 2026)

The commercial finance platform above is extended, not replaced, by Phase 5 (`docs/PHASE5_BILLING_FINANCE.md`): legal-entity billing
accounts and finance scope; billing events collected exactly once (invoice, prepaid draw-down, netted from payable, campaign case);
draft-only billing runs with maker-checker issue; issued documents immutable (database trigger) with credit / debit / adjustment notes;
partial payments and unallocated credit; aging, disputes and statements; purchase orders; credit exposure including open receivables;
approved-rate-only multi-currency; reconciliation by business account, legal entity, product, campaign, funding party, merchant, sponsor
and currency; quotation expiry, rejection and modification requests; a receivables-aware financial status (overdue drives PAST_DUE only
when switched on). Case closure invoices continue to work as before.

## Market extension (Oct 2026)

Campaign pricing and tax are now market-aware (see `docs/MARKET_COUNTRY_CONFIGURATION.md`): the commercial case records its market, the
quotation snapshot records the market and the tax rule version, market-neutral / default pricing applies only in approved markets, and the
campaign funding ledger accepts SAR only (other currencies are refused, never converted).
<!-- stage7-addendum -->
## Stage 7 (Oct 2026)

Partners are now parties in their own right: a partner-created campaign's case names the partner OWNER (DealDash charges), its
SPONSOR funding and the merchant FULFILMENT_MERCHANT; partners accept, approve (maker-checker with partner roles) and pay their own
obligations; Admin on-behalf acceptance remains for exceptional cases and still never for the fulfilment merchant.

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

FD-S7-1: a partner-owned Watch & Earn budget is a commercial case with the partner as OWNER (media spend) and the merchant as
FULFILMENT_MERCHANT; the budget is funded by the partner and its ledger lines (CAMPAIGN_BUDGET / CAMPAIGN_UNUSED) carry the partner.
Pricing version, funding model and credit / PO / prepaid / postpaid controls are the shared ones.

## Stage 8 (Oct 2026)
Financial adjustments now run through `AdjustmentRequest` (per-kind maker-checker) and apply through this platform's adjustment for
FUNDING_ADJUSTMENT, CAMPAIGN_UTILIZATION_CORRECTION and ADMIN_ADJUSTMENT. `POST admin/commercial/adjustments` is capped at
`operations.approvals.directAdjustmentMaxMinor`. Restrictions (financial holds) feed `assertCustomerExposureAllowed` and settlement holds.