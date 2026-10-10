# Stage 8 — Operational Gap Closure & Admin Operations

Status: **FOUNDER APPROVED AND FROZEN (2026-10-10)**. Changes to this stage now need founder approval. Stage 9 has not started. B8 is CLOSED (its narrow Stage 7 compatibility fix is part of the frozen Stage 7 baseline); B9 is a monitored reliability item, not a regression (reopen only if it reproduces consistently). The class B items stay OPEN for Stage 9 / pilot readiness and must not be deferred beyond the pilot; the class C VALIDATE-market items stay central and no legal or regulatory conclusion is drawn here. Frozen Stages 1–7, Phases 1–5, the subscription /
licensing / entitlement engine, the Market / Country configuration and the Stage 7 Partner Portal were consumed, not redesigned.

Stage 8 closes the operational gaps between "the products work" and "DealDash can run them every day": one exception / case
framework, a support workspace, refund, adjustment, settlement and reconciliation operations, fraud / risk operations,
restrictions and holds, reviews and moderation, notification delivery, SLA / escalation, versioned rules and controls, operational
reporting, audit completeness, privacy requests and an operations copilot — on the shared engines, with maker-checker everywhere money
or rights move.

Code: API `apps/api/src/ops` (new module) plus extensions of `apps/api/src/operations` (cases), `audit`, `finance`, `vouchers`,
`hot-deals` (notifications), `visibility`, `ai`; vocabulary `packages/types/src/operations.ts`; configuration
`packages/config/src/operations.ts` (`operations` key); migration `20270105000000_stage8_operations`; Admin screens
`apps/admin/features/ops-*.tsx`; merchant `apps/merchant/features/settlements-reviews.tsx`; customer `apps/customer/features/care.tsx`;
copy `packages/localization/src/dictionaries.stage8.ts`.

## 1. Operations Command Centre
New **Exceptions** tab in Admin → Command Centre (`GET /v1/admin/ops/exceptions`): 15 areas — payment issues, redemption failures
(24 h), voucher exceptions, Watch & Earn exceptions, loyalty exceptions, import failures (7 days), integration failures, settlement
exceptions, reconciliation exceptions, open cases, fraud flags, overdue work, approval backlog, notification failures, unresolved
support. Drill-down Global → Market → Legal Entity → Business Account → Brand → City → Branch → Product → Campaign (query filters, any
combination); a transaction is reached through the case / reconciliation item that carries its reference. Open cases and SLA breaches
by market, and the businesses with most open cases (click to drill). Each area links to the screen that resolves it.

## 2. Shared exception / case framework
`DisputeCase` (Phase 3) is the one case record, extended (no second case model). 16 types: PAYMENT_EXCEPTION, REFUND_EXCEPTION,
VOUCHER_EXCEPTION, EXCLUSIVE_REDEMPTION_EXCEPTION, LIVE_BENEFIT_EXCEPTION, WATCH_EARN_EXCEPTION, LOYALTY_EXCEPTION,
SETTLEMENT_EXCEPTION, RECONCILIATION_EXCEPTION, BILLING_EXCEPTION, MERCHANT_DATA_EXCEPTION, PARTNER_DATA_EXCEPTION,
INTEGRATION_EXCEPTION, FRAUD_REVIEW, CUSTOMER_COMPLAINT, OTHER_OPERATIONAL_EXCEPTION (the 10 Phase 3 types stay valid for existing
cases). Fields: reference, type, market, legal entity, business account, organization, customer, product, related record, source
event + id, transaction reference, title, description, priority, severity, team, queue, owner, reason code, financial impact +
currency, proposed resolution, approval (requested by / decided by / reason / state), SLA due / warn / state, escalation level,
resolution, notes (kind NOTE / CONTACT / ESCALATION / SYSTEM; visibility INTERNAL / SHARED; append-only), attachments (evidence),
customer-notified time. Statuses OPEN, INVESTIGATING, AWAITING_CUSTOMER / MERCHANT / PARTNER / FINANCE, AWAITING_APPROVAL, RESOLVED,
CLOSED, REJECTED (IN_REVIEW / WAITING kept). **The lifecycle is configuration** (`operations.caseLifecycle`): allowed moves per
status; routing (team, severity) per type (`operations.caseTypes`); SLA per priority. A business reply on AWAITING_MERCHANT /
AWAITING_PARTNER moves the case back to INVESTIGATING. Business views never show internal notes, routing or approval details; the
customer sees only shared DealDash notes (`GET /v1/app/me/cases`, FRAUD_REVIEW never listed).

Resolution with a financial impact above `caseApprovalAboveMinor` (default 0) needs **approval by a different person**; a finance
approver (`admin.finance.approve`) when money is involved. The case raiser cannot resolve their own raised case (Phase 3 rule kept).

## 3. Customer support workspace (Admin → Support)
Tabs by permission: support requests (Stage 5 `SupportCase`, escalated into the case framework with the link kept both ways),
customer summary (first name, masked mobile, city, status, open cases / requests / refunds, active vouchers, points, active
restrictions), the customer timeline (Phase 4, now with ELIGIBILITY, REVIEW, RESTRICTION and CONTACT kinds), refunds, privacy
requests. Role + scope apply (scoped admins see only their markets). **Corrections are never edits**: Original → reversal / refund /
adjustment (a new linked record with its own approval and audit) → corrected state.

## 4. Refund operations
The Stage 5 refund engine is reused (idempotent, provider call, ledger, customer notice). Added: refund eligibility view
(`GET /v1/admin/ops/refunds/eligibility`: amount, window from `voucher.refundPolicy`, blockers, the market refund policy and its open
validation items — **refund law is never decided in code**), order-level exceptional refunds (DUPLICATE_PAYMENT, FAILED_ISSUANCE; a
PAYMENT_REVERSAL is refused because no money moves back through DealDash — it is a case) with key `order-refund:<paymentId>` and
`approvals.orderRefund` (default ALWAYS: a second person approves through the Stage 5 approve route), customer-request refunds may
need a checker above `refundReviewCheckerAboveMinor` (default off), refund ↔ case link, refund queue. Loyalty fix: purchase points
are reversed only when no active / redeemed / expired instance remains, and never for duplicate / late payment refunds.

## 5. Financial adjustments (append-only)
`AdjustmentRequest`: INVOICE_CORRECTION, CREDIT_NOTE, DEBIT_NOTE, SETTLEMENT_ADJUSTMENT, RECONCILIATION_ADJUSTMENT,
POINTS_ADJUSTMENT, REWARD_REVERSAL, FUNDING_ADJUSTMENT, CAMPAIGN_UTILIZATION_CORRECTION, ADMIN_ADJUSTMENT. Reason codes from
`operations.reasons.adjustment` (validated). Approval per kind (`approvals.adjustments`: ALWAYS / NEVER / ABOVE_THRESHOLD); requester
never approves. Applied through the owning engine: notes → Phase 5 invoicing (credit / debit note), settlement → voucher payable
adjustment event, reconciliation → ledger journal ADJUSTMENT (PSP clearing / adjustments), points → approved RewardAdjustment +
reward ledger, funding / utilisation / admin → commercial finance adjustment. A failed application is FAILED and can be retried
(idempotent). The older direct adjustment endpoints (`POST admin/finance/adjustments`, `POST admin/commercial/adjustments`) are now
capped at `directAdjustmentMaxMinor` (default 1,000 SAR; above → APPROVAL_REQUIRED: use the adjustment workflow).

## 6. Settlement operations
`Settlement` + `SettlementItem` (append-only) + `SettlementPayout` (append-only). A run needs an **APPROVED market settlement rule**
(`MarketConfigService.resolveSettlement`); without one → `SETTLEMENT_RULE_MISSING` (**no cycle is invented**). Gross (eligible
redemptions) − reversals + adjustments − fees (+ informational tax on fees until the market tax rule is validated) + carried-forward
balance; below the rule minimum the balance carries forward. Statuses PENDING, ELIGIBLE, HELD, DISPUTE_HOLD, PARTIALLY_PAID,
COMPLETED, FAILED, REVERSED. Holds come from a financial hold restriction, missing / unverified payout account, payout hold or an open
case with financial impact (DISPUTE_HOLD). Release needs a different finance person and the cause gone. Payout records the bank
reference (partial needs `admin.finance.approve`) and posts SETTLEMENT_PAYOUT (merchant eligible +, PSP clearing −); reversal
(finance approver) posts SETTLEMENT_REVERSAL and frees the events. Merchant view: Finance → Settlement statements.

## 7. Reconciliation
Statement import (PAYMENT_GATEWAY, REFUND, SETTLEMENT, RECEIPT) classified MATCHED, PARTIAL_MATCH, MISSING_INTERNAL,
MISSING_EXTERNAL, AMOUNT_MISMATCH, DUPLICATE, TIMING_DIFFERENCE, MANUAL_REVIEW → RESOLVED. Internal consistency checks: voucher
purchases vs sale journals, voucher redemptions vs payable events, Watch & Earn, sponsor and loyalty funding, invoices, merchant
payable ledger vs events − payouts + reversals. Items are assigned, reviewed, resolved with a reason (money moves only through an
adjustment) or turned into a case.

## 8. Fraud / risk operations
Rule-based (`operations.risk.rules`: threshold, window, decision ALLOW / FLAG / BLOCK, on / off): REPEATED_CODE_ATTEMPTS,
SUSPICIOUS_REDEMPTION, REPEATED_REFUND_ATTEMPTS, SUSPICIOUS_BRANCH_ACTIVITY, LOYALTY_ABUSE, UNUSUAL_CUSTOMER_ACTIVITY,
MERCHANT_REFUND_ANOMALY, DUPLICATE_QUALIFIED_VIEWS. Flags (shared `RiskFlag`, domain ≠ WATCH; Stage 6 Watch flags keep their screen)
are deduplicated, raise FRAUD_FLAG_RAISED and **never punish anyone by themselves**: a person CLEARs or CONFIRMs with a reason and may
request a restriction (which follows its own approval). AI never decides or restricts.

## 9. Restrictions and holds
`OperationalRestriction`: CUSTOMER_RESTRICTION (NEW_RESERVATIONS / NEW_PURCHASES / NEW_VIEWS), MERCHANT_CAMPAIGN_HOLD,
BRANCH_REDEMPTION_HOLD, USER_SUSPENSION (sessions revoked), INTEGRATION_SUSPENSION (connection PAUSED), FINANCIAL_HOLD (payouts
held). Reason codes `operations.reasons.hold`, max days per kind, approval per kind (default ALWAYS, integration suspension NEVER),
the subject is told (customer notice ACCOUNT_RESTRICTION; business alert RESTRICTION_PLACED / LIFTED). **They stop new actions
only**: `RestrictionCheckService` is called where new exposure starts (reservation, purchase, Watch start, staff redemption at a held
branch); vouchers, reservations and points already issued stay valid. Restrictions expire on their end date, except financial holds,
which never release on their own (a HOLD_REVIEW_DUE task asks a person).

## 10. Reviews and content moderation (MR-52 / FDC-05)
Signed-in customers review a merchant (one per configured period, minimum length, no card numbers). **Verified** only with DealDash
evidence of a tracked merchant interaction (voucher redemption, redeemed Exclusive Deal; controlled offer when enabled) — **Watch &
Earn viewing never counts**. Policy PUBLISH_THEN_MODERATE (configurable); reports from customers and merchants; auto-hide after N
reports; merchants report but never edit or remove. Moderators decide reviews and reported campaigns / merchant profiles / media
(APPROVE, REJECT, HIDE, RESTORE) with a configured reason; hiding a campaign uses the owning engine's suspension (needs
`admin.campaigns.control`).

## 11. Notification operations
`NotificationDelivery` per channel: QUEUED, SENT, DELIVERED, FAILED, RETRYING, SUPPRESSED (preference off, inactive account,
channel without provider). Template code + version and channels per notification type from configuration; retries on
`notifications.retryMinutes` up to `maxAttempts`; failures raise NOTIFICATION_FAILURE; operations retry by hand. Providers stay
mocks (VALIDATE: real email / SMS / push providers and consent rules per market).

## 12. SLA / escalation
Per area (cases, approvals, refunds, adjustments, reconciliation, settlement, fraud, integration, restrictions, moderation, data
requests) and priority: target hours, warning at a percentage, escalation levels after the breach (approval task SLA_ESCALATION to
the configured roles, escalation note, level on the case). Job every 5 minutes; SLA_WARNING / SLA_BREACHED alerts; Admin → SLA.

## 13. Admin configuration
Admin → Configuration (`/configuration`, "Rules and controls"): the whole `operations` configuration, validated by
`operationsConfigSchema`, saved as a new version with a reason (SystemConfiguration versioning + audit), history shown.
`admin.config.manage` to change; read-only otherwise. Country rules (refund law, tax, retention, payout cycles) are not set here.

## 14. Maker-checker gap review
| Action | Before Stage 8 | Now |
|---|---|---|
| Case resolution with money | single person | second person, finance approver |
| Financial adjustments | direct endpoints, single person | workflow per kind; direct endpoints capped |
| Order-level refunds | n/a | maker + checker (Stage 5 approve) |
| Customer refund review | Stage 5 threshold | + configurable checker |
| Restrictions / holds | n/a | second person per kind |
| Settlement release / reversal / partial payout | n/a | different finance person / finance approver |
| Data requests (export / deletion) | n/a | second person (`admin.privacy.approve`) |
| Rules and controls | n/a | versioned with reason (`admin.config.manage`) |
| AI drafts | Phase 5 approval | unchanged; executed as the approver |

## 15. Cross-portal workflows
Merchant: cases waiting for it are marked "Waiting for you" (inbox CASE_RESPONSE_REQUIRED); settlement statements; reviews
(report). Partner: the same case view through the shared panel. Customer: My requests, My data, reviews, restriction notice, case
updates (CASE_UPDATED) open "My requests".

## 16. Operational reporting
Admin → Operational reports (`/ops-reports`, CSV): open cases by type / status, aging buckets, SLA breaches, refunds, adjustments,
settlements, reconciliation, fraud, redemption and payment failures, voucher issues, Watch issues, loyalty adjustments, notification
delivery, integration failures, data conflicts / duplicates. Aggregates only.

## 17. Audit completeness
`AuditLog` gains market and legal entity; Stage 8 writes record actor, role, scope (subject organization), market, legal entity,
previous and new state, reason, approval reference, timestamp, request / correlation id and source. Audit list filters by entity,
correlation id and market and returns the full record.

## 18. Market validation
No market rule was added. Refund policy, settlement rules, tax on fees, retention, consent and payout cycles are read from Market /
Country configuration and shown with their VALIDATE items (VALIDATE-KSA / UAE / QATAR / PAKISTAN unchanged).

## 19. AI Operations Copilot
OPERATIONS_SUPPORT agent: CASE_SUMMARY (case facts, notes, SLA), RECON_VARIANCE (explains variances, suggests next steps),
QUEUE_PRIORITY (orders the queue by SLA and severity). Drafts CUSTOMER_RESPONSE (executed after approval as a shared case note) and
MERCHANT_REQUEST (executed after approval as a move to AWAITING_MERCHANT / PARTNER). It explains, recommends and drafts; it never
executes without a human approval, and executes as the approver.

## 20. Privacy and least privilege
New permissions: `admin.restrictions.manage/approve`, `admin.reconciliation.manage`, `admin.notifications.manage`,
`admin.privacy.manage/approve`, `customer.reviews.manage`; grants per role (Operations, Support, Finance, Risk). Navigation follows
the permissions; analysts see none of the operations screens. Data requests: EXPORT (JSON of the customer's own data) and DELETION
(anonymises the account — email `<anon>@deleted.invalid`, personal fields cleared — keeps financial and audit records; refused while
active vouchers, held reservations, open refunds or open cases exist). Retention periods are VALIDATE items.

## 21. UI / UX
Admin: Cases, Support, Financial adjustments, Settlements, Reconciliation, Fraud review, Restrictions and holds, Moderation,
Notification delivery, SLA and escalation, Operational reports, Configuration, Command Centre → Exceptions. Merchant: Reviews,
Finance → Settlement statements. Customer: merchant page → Reviews, Profile → My requests / My data. English and Arabic (RTL,
established terms قضية / شاهد واكسب), states: loading, empty, error, access denied, awaiting approval, financial hold, resolved, SLA
breached; phone width checked.

## 22. Figma handoff
`docs/STAGE8_FIGMA_HANDOFF.md`; screenshots `docs/screenshots/stage8`.

## 23. Tests
API e2e `apps/api/test/stage8-operations.e2e.test.ts` (21) + `src/ops/ops.unit.test.ts` (2); Admin `features/ops.test.tsx` (16);
merchant `features/settlements-reviews.test.tsx` (5); customer `features/care.test.tsx` (5); auth navigation; localization coverage
(Stage 8 vocabulary, every error code, every notification type). Browser `tooling/e2e/stage8-browser.mjs` (48 checks). Results in the
Build Plan "Stage 8 status".

## 24. Database
Migration `20270105000000_stage8_operations`: DisputeCase / CaseNote / AuditLog / Refund / RiskFlag columns; NotificationType,
LedgerJournalType values; AdjustmentRequest, Settlement, SettlementItem, SettlementPayout, ReconciliationRun, ReconciliationItem,
OperationalRestriction, Review, ReviewReport, ModerationItem, NotificationDelivery, DataRequest; CHECK constraints (frozen ones
widened for the new values); append-only triggers on SettlementItem and SettlementPayout. Development database: backed up
(`dealdash_dev-pre-stage8-migration-20261010-172003.dump`), migrated with `migrate deploy`, permissions synced with the new
`pnpm --filter @dealdash/api db:catalog:sync` (no seed, no password reset; users unchanged), no drift.

## 25. Gap audit
Class A — must fix before Stage 9: **none open**. Fixed in Stage 8 (were defects): UUIDs mistaken for card numbers by the PAN check
(Stage 7; refused valid eligibility rules at random), five error codes and seven customer notification types without copy (raw keys
on screen), notification links for non-reservation notices, adjustment reason codes not validated, uncapped direct adjustment
endpoints, purchase-point reversal on partial / duplicate refunds, a moderation RESTORE on auto-hidden reviews, an applied adjustment reference rendered as an object (Admin page crash), and one inbox item per SLA escalation level for the same case (duplicate rows; now one item per escalated record).

Class B — must fix before pilot:
- B1 KSA settlement rule: no APPROVED rule exists, so settlements cannot run (by design) — approve one through Markets.
- B2 Real payout / bank file and PSP statement feeds (payouts are recorded by reference; statements imported as lines).
- B3 Real notification providers (email, SMS, push) behind the delivery tracker.
- B4 Proportional points reversal for partial refunds (today: all-or-nothing by remaining instances).
- B5 Native Arabic review of Stage 8 copy (terminology aligned to قضية / شاهد واكسب).
- B6 Customer replies to a case inside the app (today: shared notes are read-only; the customer uses a support request).
- B7 Structured editor for Rules and controls (today: validated JSON with versioning and reason).
- B8 **CLOSED (founder-approved Stage 7 compatibility fix, 2026-10-10).** Root cause: the partner "Add a merchant" form took the country from the market list, which loads asynchronously, and could be submitted before it arrived (no country → VALIDATION_FAILED). Fix (UI only, `apps/partner/features/network.tsx`): Add stays disabled with a "Loading your markets…" state until the list has loaded and a valid market is set; "no market available" explains itself; English and Arabic. No API, ingestion, entitlement, RBAC, market, contract or validation rule changed. Regression test `apps/partner/features/network-add.test.tsx` holds the market response back and proves nothing is submitted.
- B9 MONITORED (not a regression): the Watch & Earn "still watching?" browser check failed once on timing (88/88 on rerun); no Stage 8 change touches qualification. Treated as a regression only if it reproduces consistently.

Class C — VALIDATE-market (KSA / UAE / Qatar / Pakistan): refund law and windows; data retention and deletion; tax on platform fees
in settlements; payout cycles and minimums; notification consent and quiet hours; lawful exceptions to telling a restricted subject;
review / takedown obligations; merchant payout KYC.

Class D — deferred post-MVP: ML fraud scoring; bulk case operations; business-hours SLA calendars; automated statement ingestion
(SFTP / API); merchant public responses to reviews.

No MVP-critical defect is deferred silently.

## Founder approval (2026-10-10): APPROVED AND FROZEN
Stage 8 approved and frozen. B8 CLOSED (Stage 7 compatibility fix approved into the frozen Stage 7 baseline). B9 MONITORED (not a regression).
Open for pilot readiness (class B, not to be deferred beyond the pilot): B1 approved KSA settlement rule; B2 real payout / bank statement
feeds; B3 real email / SMS / push providers; B4 proportional points reversal for partial refunds; B5 native Arabic review; B6 customer
in-app case replies; B7 structured rules / controls editor. Class C VALIDATE-market items preserved as listed in section 25.
Stage 9 not started.
