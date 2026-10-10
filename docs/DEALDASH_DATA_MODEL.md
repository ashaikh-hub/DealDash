# DEALDASH DATA MODEL

Version 0.2 (lean startup revision: Prisma/PostgreSQL, separate product lifecycles; draft for approval) · 2026-10-07
Scope: logical data model for the frozen MVP, as entity and attribute specifications, to be implemented with **Prisma on PostgreSQL (+ PostGIS)** inside the NestJS modular monolith. **No SQL, no code.** Physical design is described at the level needed to build; the Prisma schema and migrations are build-stage artefacts.
Companions: `DEALDASH_TECH_ARCHITECTURE.md`, `DEALDASH_API_ARCHITECTURE.md`, `DEALDASH_BUILD_PLAN.md`.
Inputs: Business Rules (status models section 22, ledger 11A, eligibility, reservations, redemption, rewards, W&E), UX Architecture v0.4, Customer MVP Final v0.2.

---

## 1. CONVENTIONS

| Topic | Rule |
|---|---|
| Database and ORM | **PostgreSQL + PostGIS, accessed through Prisma.** One database; **module ownership is a naming and code-boundary rule**: every model belongs to exactly one NestJS module (see section 1A), module prefixes in table names where helpful, and no module reads another module's tables directly. (A separate PostgreSQL schema per module may be added later if Prisma multi-schema support and tooling are judged worth it; confirm at build start.) |
| Identifiers | `id` is UUIDv7. External references use `public_ref` (short human code, for example `RSV-7K3Q9`) where users see ids |
| Time | `timestamptz` in UTC; `created_at`, `updated_at` on mutable tables; business dates stored as date plus explicit time zone where needed (Riyadh) |
| Money | **Integer halalas** (`bigint`), currency code `SAR`; never floating point. Signed amounts in the ledger |
| Bilingual text | `name_ar`, `name_en` columns for short fields; long content in `i18n_text` (jsonb with keys `ar`, `en`) on content tables. Publication requires both (UXD-06) |
| Enumerations | Stored as constrained text with a reference table or check constraint; values from section 17 |
| Multi-tenancy | Every operational row carries `org_id` (merchant, partner or DealDash) where applicable; access scoped by org (and `branch_id`). Optional row-level security as defence in depth |
| Soft delete | Avoided for transactional data. Use status fields. Personal data deletion follows the privacy workflow (section 18) |
| Append-only | Ledger, audit, reward ledger, view events, redemption attempts, status history: insert-only; privileges prevent update or delete |
| Status history | Every lifecycle entity has a companion `*_status_history` (from, to, actor, reason, at) or writes to audit |
| Snapshots | Dependent configuration values are copied onto the record at creation (hold minutes on reservations, fee rule version on ledger entries, terms version on orders) |
| Idempotency | `idempotency_key` unique per (actor, operation) on money/stock commands; stored with the response hash |
| Optimistic concurrency | `version` integer on mutable aggregates |
| Extensibility | `attributes jsonb` only for non-queried, non-constrained extras; anything filtered or constrained gets a real column |

---

## 1A. PRISMA IMPLEMENTATION NOTES AND MODULE MAP

**Prisma approach (confirm details at build start):**
| Topic | Approach |
|---|---|
| Schema location | `apps/api/prisma` only; never imported by frontends |
| Types | Prisma-generated types stay inside the API; the public contract uses DTO schemas (`packages/validation`) and generated OpenAPI types, not Prisma types |
| Atomic stock | Conditional `updateMany`-style atomic decrement (`available >= qty`) inside an interactive transaction, checking the affected-row count; no application-side read-modify-write |
| Locking | Row locks with skip-locked for expiry sweeps through a small number of raw-SQL repository methods |
| PostGIS | Spatial columns declared as unsupported types in the Prisma schema; all spatial reads and writes through raw SQL repository methods with tests |
| Constraints Prisma cannot express | Partial unique indexes, check constraints (non-negative stock, balanced journals via job/trigger), triggers, text-search and trigram indexes, privileges (insert-only roles for ledger, audit, reward entries): authored as **custom SQL in migrations** and covered by tests |
| Tenancy | A scoped repository base or client extension adds `org_id` / `branch_id` filters; tenant-isolation tests in CI |
| Migrations | Versioned, forward-only in production, expand-then-contract; run on a clean DB and a snapshot in CI |
| JSON | Only for bilingual blocks, rule definitions, targeting definitions and aggregated metrics; validated by shared schemas |

**Module-to-model map (ownership):**
| NestJS module | Owns (tables in this document) |
|---|---|
| Identity | user_account, credential, mobile_identity, otp_challenge, session, device, invitation, role, permission, role_assignment, pending_change, access_review |
| Customer | customer_profile, customer_interest, consent_record, customer_restriction, noshow_event, saved_item, search_history, data_request |
| Merchant | organisation (merchant), merchant_profile, merchant_application, document, agreement_*, bank_account |
| Merchant Branch | branch, branch_hours, city/area, category |
| Merchant Staff | staff_member |
| Partner | partner_profile, partner_data_permission, partner_campaign_proposal, proposal_merchant, change_request, partner_funding_commitment |
| Bank | issuer, card_product, card_tier, bin_range |
| Card Scheme | card_network, scheme_issuer_participation |
| Employer | employer, employer_domain, employer_request |
| Eligibility | eligibility_attribute, employer_verification, segment, customer_segment, eligibility_rule_set, eligibility_condition, eligibility_rule_binding, eligibility_evaluation_log |
| Live Deals | live_deal, live_deal_branch, live_deal_media, live_deal_price_claim, live_deal_status_history, controlled_claim |
| Exclusive Deals | hot_deal, hot_deal_branch_inventory, hot_deal_media, hot_deal_price_claim, hot_deal_status_history |
| Reservations | reservation, reservation_status_history |
| Vouchers | voucher_product, voucher_product_branch, voucher_instance, voucher_status_history, voucher_stock_hold |
| Voucher Purchases | order, order_line |
| Watch & Earn | wande_campaign, wande_prize, qualifying_policy, view_record, view_event, view_cap_counter, campaign_reconciliation |
| Rewards | reward_account, reward_entry, reward_catalogue_item, reward_redemption, reward_adjustment_request, reward_rule |
| Payments | payment, payment_event, saved_payment_method_ref, reconciliation_item |
| Refunds | refund, chargeback |
| Redemptions | code, redemption, redemption_attempt |
| Settlements | settlement_run, statement, statement_line, payout, adjustment_request, negative_balance_carry, statement_dispute |
| Ledger (supporting) | ledger_account, ledger_journal, ledger_entry, fee_rule, accrual_policy |
| Campaign Approval | guardrail_policy, guardrail_decision, review_task, review_reason_template, campaign_control_action |
| Notifications | notification_template, notification_preference, notification_outbox, inapp_notification |
| Reviews | review, review_report |
| Support Cases | case, case_link, case_message, case_attachment, case_event |
| Fraud / Risk | risk_signal, risk_flag, risk_rule, blocklist_entry, risk_decision |
| Reporting | agg_partner_daily, agg_merchant_daily, agg_platform_daily, partner_report_config, partner_export_log |
| Analytics Events (supporting) | event_log |
| Audit | audit_event |
| System Configuration | config_parameter, config_value, feature_flag, retention_policy |
| Content & Localisation (supporting) | i18n_string, legal_document, faq_item, rate_card (shared with W&E), terms_block |
| Media/Files (supporting) | file, media_asset |
| Jobs / Outbox (supporting) | outbox_event |

**Live Deals, Exclusive Deals, Vouchers and Watch & Earn have separate tables and separate status models.** They do not share one "offer" table or one lifecycle; they share only kernel pieces (eligibility binding, guardrail decisions, media, localisation, audit).

---

## 2. IDENTITY AND ACCESS (module Identity)

| Table | Key columns | Notes |
|---|---|---|
| **user_account** | id, user_type (customer, merchant_user, partner_user, admin_user, staff), status, locale, created_at, last_login_at | One row per human actor; type-specific profile in related table |
| **credential** | user_id, kind (password_hash, mfa_totp_secret, ...), data (encrypted), created_at | Portal users only; customers have no password |
| **mobile_identity** | user_id, mobile_e164 (unique), verified_at, status | Customer and staff primary identity; unique verified mobile (FR-01) |
| **otp_challenge** | id, purpose (login, employer_email, delete_account, change_mobile), target_hash, code_hash, expires_at, attempts, max_attempts, status, created_ip, device_id | Hashed codes only; never stores code in clear (AU-22) |
| **session** | id, user_id, device_id, refresh_token_hash, issued_at, expires_at, revoked_at, ip, user_agent | Rotation and revocation |
| **device** | id, user_id, device_fingerprint_hash, platform, app_version, push_token_ref, first_seen, last_seen, risk_flag | Fraud linkage |
| **role** | id, scope_type (merchant, partner, admin, staff), code, name_en, name_ar | Seeded from the frozen role models |
| **permission** | id, code, description | Fine-grained verbs (view, edit, export…) |
| **role_permission** | role_id, permission_id | |
| **role_assignment** | id, user_id, org_id, branch_id (nullable), role_id, status, granted_by, granted_at, revoked_at | Org and branch scope |
| **invitation** | id, org_id, email, role_id, token_hash, status (pending, accepted, expired, revoked), expires_at, invited_by | Portal invitations |
| **access_review** | id, period, reviewer_id, status, decided_at | Privileged access review (approved operating decision) |
| **pending_change** | id, entity_type, entity_id, proposed_payload, proposer_id, approver_id, status, reason, effective_at | Maker-checker for sensitive changes |

Customer profile (modules: identity or customer): see section 4.

---

## 3. ORGANISATIONS, MERCHANTS, BRANCHES, STAFF

| Table | Key columns | Notes |
|---|---|---|
| **organisation** | id, org_type (merchant, partner_bank, partner_scheme, partner_employer, dealdash), name_en, name_ar, status (partner/merchant lifecycle), legal_name, registration_no, address, logo_file_id, created_at | Parent for merchant and partner |
| **merchant_profile** | org_id, category_id, trust_level (new, standard, trusted), kyb_state, risk_tier, settlement_account_id, payout_hold, agreement_version_accepted | MR-03 risk-based KYB; AP-12 trust level |
| **merchant_application** | id, org_id, status (draft, submitted, in_review, changes_requested, resubmitted, approved, rejected), submitted_at, decided_at, reviewer_id, decision_reason | Merchant lifecycle |
| **document** | id, org_id, kind (cr, licence, authorisation, bank_letter…), file_id, status, valid_to, reviewed_by | KYB and partner documents |
| **agreement_version** | id, kind (merchant, partner), version, language, content_ref, effective_from | |
| **agreement_acceptance** | id, org_id, agreement_version_id, signatory_name, signatory_user_id, accepted_at, ip, method | MR-06 audit fields |
| **branch** | id, org_id, name_en, name_ar, address_en, address_ar, location (geography point), city_id, area_id, phone, status (open, closed, suspended), timezone | Per-branch operations |
| **branch_hours** | branch_id, weekday, opens, closes, exception_date, is_closed | |
| **staff_member** | user_id, org_id, branch_id, display_name, status (invited, active, deactivated) | Staff scope is branch |
| **bank_account** | id, org_id, iban_enc, account_name, verified_status, verified_at, changed_at | Payout account; change triggers re-review (ST-10) |
| **category** | id, parent_id, code, name_ar, name_en, sort | Discovery categories |
| **city / area** | id, code, name_ar, name_en, enabled, geometry | Enabled cities (Riyadh pilot); areas for location picker |
| **merchant_user_link** | in role_assignment | Merchant users via identity role_assignment |

---

## 4. CUSTOMERS AND ELIGIBILITY

### 4.1 Customer
| Table | Key columns | Notes |
|---|---|---|
| **customer_profile** | user_id, first_name, last_name, email, dob, gender (nullable, includes prefer_not_to_say), city_id, area_id, language, onboarding_state (phone_verified, profile_in_progress, complete), onboarding_step, created_at, closed_at | Email required, not separately verified (decided); age 18+ validated at onboarding; DOB restricted access |
| **customer_interest** | user_id, category_id | Preferences |
| **consent_record** | id, user_id, consent_type (terms, privacy, location, notifications, marketing), document_version, granted, at, source | Versioned; marketing separate and optional; withdrawals append |
| **customer_restriction** | id, user_id, kind (reservations_paused, rewards_hold, account_restricted), reason_code, starts_at, ends_at, source_case_id | No-show pause, risk restrictions; supports appeals |
| **noshow_event** | id, user_id, reservation_id, at, counted | Strike counting window from config |
| **saved_item** | user_id, object_type, object_id, saved_at | Save (Follow is hidden in MVP; table can add `follow` later) |
| **search_history** | user_id, query, at | Optional, retention-limited |

### 4.2 Eligibility attributes (customer side)
| Table | Key columns | Notes |
|---|---|---|
| **eligibility_attribute** | id, user_id, attr_type (card, employer, geography, segment), value_ref (issuer_id+product_id+tier_id, employer_id, area_id, segment_id), source (self_declared, otp_verified, issuer_verified_future), level (self_declared, otp_verified, issuer_verified), status (pending, verified, reverification_due, expired, failed, revoked), verified_at, expires_at, created_at | **Card attributes are issuer + product + tier only: no PAN, CVV, last-4, first-6.** Status model per section 22 |
| **employer_verification** | id, user_id, employer_id, email_hash, email_enc, domain, otp_challenge_id, status, verified_at, expires_at, grace_until | Work email stored hashed (lookup) and encrypted; masked in UI (EM-05); unique active email link per account (EM-06) |
| **employer_request** | id, user_id, requested_name, email_domain, status | "My employer isn't listed" |
| **segment** | id, code, name_en, name_ar, definition_ref, status | Approved segments only; no sensitive attributes |
| **customer_segment** | user_id, segment_id, as_of | Materialised memberships |

### 4.3 Eligibility rules (one engine shared by all products and partner programmes)
| Table | Key columns | Notes |
|---|---|---|
| **eligibility_rule_set** | id, owner_org_id, name_en, name_ar, status (draft, pending_review, needs_changes, active, paused, retired, rejected), version, effective_from, effective_to, created_by | Partner-created or DealDash-created; versioned |
| **eligibility_condition** | id, rule_set_id, group_no, join_op (all, any, not), attr_type, operator, value_ref, required_level | Normalised conditions; "Public" = empty rule set |
| **eligibility_rule_binding** | id, rule_set_id, object_type (live_deal, hot_deal, voucher_product, partner_campaign, wande_campaign), object_id, locked_visible (computed policy) | Which objects use which rule |
| **eligibility_evaluation_log** | id, user_id, object_type, object_id, result (eligible, locked_unlockable, hidden, ineligible), reason, at, stage (discovery, action, redemption) | Sampled or on disputes (AU-03) |

---

## 5. PARTNER CONFIGURATION

| Table | Key columns | Notes |
|---|---|---|
| **partner_profile** | org_id, partner_type (bank, scheme, employer), status (applied, in_review, approved, configured, activated, suspended, offboarded, rejected), account_manager_id, data_sharing_mode (aggregate_only default) | PR rules |
| **issuer** | id, org_id, name_en, name_ar, status, enabled | Bank/issuer reference list |
| **card_network** | id, code (visa, mastercard, amex, mada…), name_en, name_ar, enabled | Configurable list |
| **card_product** | id, issuer_id, network_id, name_en, name_ar, card_type (credit, debit, prepaid), status, effective_from | Issuer-owned; schemes read-only |
| **card_tier** | id, product_id, name_en, name_ar, rank, status | |
| **bin_range** | id, product_id, tier_id (nullable), leading_digits, status (proposed, verified, active, retired), effective_from, effective_to, proposed_by, verified_by | **Leading digits only, partner-side metadata, DealDash-verified**, overlap-checked (no PAN); not linked to customer data |
| **scheme_issuer_participation** | id, scheme_org_id, issuer_id, status (invited, participating, declined), tier_mapping, updated_at | Scheme module |
| **employer** | id, org_id, display_name_en, display_name_ar, status (active, deactivated), reverify_days, grace_days | EM-01 active partners only |
| **employer_domain** | id, employer_id, domain, include_subdomains, status (pending_proof, verified, disabled), proof_method, proof_file_id, verified_by, verified_at | Domain proof reviewed by Partner Management (EM-10) |
| **partner_data_permission** | id, org_id, scope (customer_level_sharing…), status, legal_basis_ref, granted_by, valid_to | Default none; customer-level sharing not implemented in MVP |
| **partner_campaign_proposal** | id, partner_org_id, status (draft, submitted, needs_changes, approved, scheduled, live, paused, expired, rejected), name_en, name_ar, eligibility_rule_set_id, start_at, end_at, budget_committed, content_i18n, submitted_at, decided_at | Partner proposals; DealDash approves and activates (FDP-01 closed) |
| **proposal_merchant** | proposal_id, merchant_org_id, status (requested, accepted, declined, expired, confirmed) | Merchant participation |
| **change_request** | id, proposal_id, requested_change, reason, affected_fields, attachment_file_id, submitted_by, submitted_at, status (in_review, clarification_requested, approved, rejected), decided_by, decided_at, response | D-P3 "Request a change" |
| **partner_funding_commitment** | id, proposal_id, committed, funded, spent, remaining (derived from ledger) | Where applicable |

---

## 6. CATALOGUE

### 6.1 Live Deals and Exclusive Deals (separate domains)
| Table | Key columns | Notes |
|---|---|---|
| **live_deal** | id, merchant_org_id, mechanic (percent_off, amount_off, bogo, free_item, other), title_ar/en, description_i18n, terms_blocks_i18n, status (Live Deal model, section 17), start_at, end_at, controlled_redemption (bool, default false), eligibility_rule_set_id, guardrail_decision_id, published_at, version | **Frictionless by default (no claim, no QR);** controlled mode adds claims. Own lifecycle |
| **hot_deal** | id, merchant_org_id, mechanic, title_ar/en, description_i18n, terms_blocks_i18n, status (Exclusive Deal model, section 17), kind (reservable, walk_in_time_limited), start_at, end_at, per_customer_limit, hold_minutes_override (within DealDash limits, nullable), eligibility_rule_set_id, guardrail_decision_id, published_at, version | **Own lifecycle** (sold out, inventory, reservation rules); walk-in kind needs no inventory or code (HD-14) |
| **live_deal_branch** | live_deal_id, branch_id, active | Branch applicability |
| **hot_deal_branch_inventory** | id, hot_deal_id, branch_id, total_units, reserved_units, redeemed_units, available_units, scope (branch now; pool later), version | **Per-branch inventory** (HD-07); invariant `reserved + redeemed + available = total`; atomic conditional decrement in the same transaction as the reservation insert; unique (hot_deal_id, branch_id); P2 pooled stock is a new scope, not a redesign |
| **live_deal_media / hot_deal_media** | deal_id, file_id, kind, sort | |
| **live_deal_price_claim / hot_deal_price_claim** | deal_id, original_price, offer_price, percent, evidence_ref | Guardrail price sanity (LD-18) |
| **live_deal_status_history / hot_deal_status_history** | deal_id, from, to, actor, reason_code, at | Separate per product |
| **deal_metric_daily** | deal_type (live, hot, voucher), deal_id, date, impressions, detail_views, saves, direction_clicks, merchant_page_visits, reservations, redemptions | Aggregated from analytics events; discovery signals only for walk-in (LD-60/62); not a source of truth |

### 6.2 Vouchers
| Table | Key columns | Notes |
|---|---|---|
| **voucher_product** | id, merchant_org_id, title_ar/en, description_i18n, terms_blocks_i18n, face_value, selling_price, validity_type (fixed_date, days_from_purchase), validity_value, total_qty, remaining_qty, per_customer_cap, per_day_cap, eligibility_rule_set_id, status, start_at, end_at, guardrail_decision_id, version | VC-01..08 |
| **voucher_product_branch** | product_id, branch_id | Redeemable branches |
| **voucher_stock_hold** | id, product_id, order_id, qty, expires_at, status (held, consumed, released) | Checkout hold (VC-11) |
| **voucher_product_status_history** | | |

### 6.3 Watch & Earn
| Table | Key columns | Notes |
|---|---|---|
| **wande_campaign** | id, merchant_org_id, status (see section 17), title_ar/en, video_file_id, thumbnail_file_id, duration_sec, link_type (merchant, live_deal, hot_deal, voucher, none), link_id, start_at, end_at, targeting (city, time window, eligibility group, interests), frequency_rule, budget_funded, budget_committed, rate_card_id, qualifying_policy_id, moderation_status, prize_id | **Separate product** (UXD-04); CPV and customer reward are separate concepts |
| **wande_budget_account_ref** | campaign_id, ledger_account_id | Links to ledger campaign budget account |
| **wande_prize** | id, campaign_id, name_ar/en, qty, remaining, validity, branches | Merchant-funded prize (WE-05); not points |
| **rate_card** | id, name, rules (per-view charge, tiers), effective_from, version | DealDash-set CPV; no hard-coded value |
| **reward_rule** | id, name, rules (points per qualified view by video length etc.), effective_from, version | Customer reward economics (separate) |
| **qualifying_policy** | id, watch_pct, watch_seconds, still_watching_policy, resume_grace_seconds, device_limit, daily_cap, effective_from | All configuration |

### 6.4 Terms, content and reviews
| Table | Key columns | Notes |
|---|---|---|
| **terms_block** | id, kind, text_i18n, version | Structured terms (LD-16) |
| **review** | id, merchant_org_id, deal_type and deal_id (nullable), customer_id, rating, text, status (visible, hidden, removed), verified_interaction_id (nullable), verified_flag, created_at, edited_at | **Verified only when `verified_interaction_id` points to a DealDash-tracked interaction** (voucher redemption, redeemed Exclusive Deal reservation, controlled-offer redemption). W&E viewing never qualifies |
| **review_report** | id, review_id, reporter_type, reporter_id, reason, status, decided_by | Reports by customers and merchants |

---

## 7. APPROVAL AND GUARDRAILS

| Table | Key columns | Notes |
|---|---|---|
| **guardrail_policy** | id, product (live, hot, voucher, wande), rules (jsonb: max discount, inventory limits, prohibited terms, completeness), version, effective_from, status | Configured; pilot matrix |
| **guardrail_decision** | id, object_type, object_id, policy_version, outcome (auto_publish, manual_review, reject), triggers, trust_level_at_time, evaluated_at | AP-02 |
| **review_task** | id, object_type, object_id, status (queued, in_review, decided), assigned_to, decision (approve, request_changes, reject), reason_code, decided_at, conflict_declared | AP-09/10 |
| **review_reason_template** | id, code, text_ar, text_en | Bilingual reasons |
| **campaign_control_action** | id, object_type, object_id, action (pause, suspend, resume), reason_code, actor_id, at | DealDash emergency pause (AP-07); partners cannot pause |

---

## 8. RESERVATIONS AND REDEMPTION

| Table | Key columns | Notes |
|---|---|---|
| **reservation** | id, public_ref, user_id, hot_deal_id, branch_id, inventory_id (hot_deal_branch_inventory), quantity, status (reserved, redeemed, expired_noshow, cancelled_customer, cancelled_merchant, cancelled_dealdash), hold_minutes_snapshot, reserved_at, expires_at, redeemed_at, cancelled_at, code_id, eligibility_checked_at, version | **Free reservation, no payment fields in MVP.** Hold from config snapshot (default 30 min). Valid at its branch only (RS-12) |
| **reservation_status_history** | | RS-15 events |
| **code** | id, object_type (reservation, voucher, controlled_claim), object_id, code_hash, qr_payload_ref, key_id, status (active, used, voided), issued_at | Non-guessable; no personal data; single-use |
| **controlled_claim** | id, user_id, live_deal_id, status (claimed, redeemed, expired, cancelled), claimed_at, expires_at | Only for controlled Live offers |
| **redemption** | id, object_type, object_id, branch_id, staff_user_id, device_id, result (redeemed, reversed), redeemed_at, reversed_at, reversed_by, reversal_reason, eligibility_recheck_result | One successful redemption per object (unique constraint) |
| **redemption_attempt** | id, code_hash_or_ref, object_id (nullable), branch_id, staff_user_id, result (valid, invalid, expired, already_redeemed, wrong_branch, not_yet_valid, suspended, ineligible), at, detail | Append-only; all outcomes (AU-08) |

---

## 9. ORDERS, PAYMENTS, VOUCHER INSTANCES

| Table | Key columns | Notes |
|---|---|---|
| **order** | id, public_ref, user_id, status (initiated, pending, paid, failed, cancelled, refund_pending, refunded, refund_failed, disputed, partially_refunded_p2), subtotal, tax_amount, total, currency, email_for_receipt, terms_version, refund_terms_accepted_at, hold_expires_at, created_at | Voucher purchase only in MVP |
| **order_line** | id, order_id, voucher_product_id, qty, unit_price, face_value, tax_code, tax_amount | Tax fields present (LG-15) |
| **payment** | id, order_id, psp, psp_reference, method_type, amount, status (initiated, pending, authorised, captured, failed, cancelled, voided), attempt_no, idempotency_key, created_at, updated_at | **No card data.** One row per attempt |
| **payment_event** | id, payment_id, psp_event_id (unique), type, payload_hash, received_at, processed_at, verified_signature | Webhook idempotency; replay safe |
| **refund** | id, payment_id, order_id, amount, status (requested, pending, refunded, failed), reason, requested_by, refunded_at, psp_refund_ref | Full refund MVP; amount column ready for partial (P2) |
| **chargeback** | id, payment_id, status (open, won, lost), amount, opened_at, case_id | Links to support case and merchant payable hold |
| **saved_payment_method_ref** | id, user_id, psp_token_ref, display_brand, display_suffix_psp | PSP-supplied display only; DealDash never collects last-4 (decision pending PSP, FDR-43) |
| **voucher_instance** | id, public_ref, product_id, order_id, owner_user_id, status (pending_payment, active, redeemed, expired, refunded, voided), purchase_price, face_value, activated_at, valid_from, expires_at, redeemed_at, code_id, version | Active only after verified payment (VC-05/12); not transferable in MVP |
| **voucher_status_history** | | |
| **voucher_refund_window** | derived from config snapshot on instance (`refund_window_hours_snapshot`) | |

---

## 10. LEDGER AND SETTLEMENT

### 10.1 Accounts and entries (append-only double-entry)
| Table | Key columns | Notes |
|---|---|---|
| **ledger_account** | id, family (customer_funds_held, merchant_held, merchant_settlement_eligible, merchant_payable_paid, campaign_budget, unused_campaign_balance, platform_revenue, platform_fee_clearing, psp_clearing, tax_payable, adjustments, expired_value), owner_org_id (nullable), campaign_id (nullable), currency | Account families distinguish concepts (LG-12, LG-14) |
| **ledger_journal** | id, journal_type (sale, redemption, refund, reversal, adjustment, fee, campaign_funding, campaign_consumption, campaign_unused, payout, expiry, chargeback), source_object_type, source_object_id, psp_reference, idempotency_key (unique), posted_at, posted_by (system or actor), reason_code, fee_rule_version | One journal per business event; entries balance |
| **ledger_entry** | id, journal_id, account_id, amount (signed halalas), currency, tax_code, tax_amount, memo | Sum of entries per journal = 0 (check job and constraint-style validation); insert-only privileges |
| **fee_rule** | id, scope (merchant, product, category, global), kind (percent, fixed, tiered), parameters, effective_from, effective_to, version, approved_by | Versioned; stamped on journals (LG-01) |
| **accrual_policy** | id, accrual_point (sale, redemption, hybrid), effective_from, version | `payable_accrual_point` configurable (LG-03) |

### 10.2 Settlement
| Table | Key columns | Notes |
|---|---|---|
| **settlement_run** | id, period_start, period_end, status (draft, approved, executed), created_by, approved_by, created_at | Periodic batches (LG-10) |
| **statement** | id, merchant_org_id, run_id, period, status (accrued, included, approved, payout_pending, paid, failed, returned), gross, fees, refunds, adjustments, net_payout, tax_fields, language, issued_at | Bilingual |
| **statement_line** | id, statement_id, journal_id, kind, amount, description | |
| **payout** | id, statement_id, bank_account_id, amount, status (pending, paid, failed, returned), reference, executed_by, executed_at | Manual Finance execution in MVP |
| **adjustment_request** | id, merchant_org_id, direction, amount, reason_code, reference, requested_by, approver_id, status, journal_id | Maker-checker above threshold (ST-05) |
| **negative_balance_carry** | merchant_org_id, amount (derived), since | Carry-forward (LG-07) |
| **reconciliation_item** | id, source (psp, bank, ledger), reference, amount, status (matched, exception, resolved), assigned_to, note, period | Manual-assisted (LG-11) |
| **statement_dispute** | id, statement_id, case_id, opened_at, status | |

---

## 11. REWARDS AND WATCH & EARN EVENTS

### 11.1 Rewards (points, non-cash)
| Table | Key columns | Notes |
|---|---|---|
| **reward_account** | id, user_id, status | One per verified customer |
| **reward_entry** | id, account_id, entry_type (earn, hold, release, redeem, reverse, expire, adjust), points (signed), balance_after, source_type (view, campaign, redemption, adjustment), source_id, reason_code, actor_type (system, user), expires_at, created_at | **Append-only**; balance derived; no SAR value; corrections are counter-entries (RW-04/07) |
| **reward_catalogue_item** | id, name_ar/en, description_i18n, points_cost, stock, funding_source, validity, branches, status | Configurable; empty allowed |
| **reward_redemption** | id, account_id, item_id, points_entry_id, status, redeemed_at, fulfilment_ref | |
| **reward_adjustment_request** | id, account_id, points, reason_code, ticket_ref, requested_by, approver_id, status | RW-10/11 |

### 11.2 Watch & Earn events
| Table | Key columns | Notes |
|---|---|---|
| **view_record** | id, user_id, campaign_id, device_id, token_hash, started_at, state (started, checks_passed, qualified, invalid, capped, billed, credited_back), invalid_reason, qualified_at, charge_amount, reward_entry_id, risk_score | Server-confirmed only (WE-29) |
| **view_event** | id, view_id, type (heartbeat, background, foreground, still_watching_prompt, still_watching_pass, still_watching_fail, complete), position_sec, at | Append-only timeline; high volume; partitioned by date |
| **view_cap_counter** | scope (user/day/campaign/device), key, date, count | Cap enforcement (also checked by transaction) |
| **wande_billing_entry** | link to ledger journal (campaign_consumption) | Merchant charge separate from reward |
| **campaign_reconciliation** | campaign_id, delivered_views, billed, credited_back, unused_balance, status | End-of-campaign (WE lifecycle) |

---

## 12. PHASE 2 / 3 HOOKS (kept out of MVP tables, designed to attach)

| Future capability | MVP-ready hook |
|---|---|
| Exclusive Deal deposit / paid reservation | `reservation` can link an optional `order_id`/`payment`; statuses `pending_payment`, `confirmed` added; ledger journal types already general |
| Pooled multi-branch inventory | `hot_deal_branch_inventory.scope` (branch now; pool later) |
| Partial redemption, bill amount | `redemption.amount`, `voucher_instance.remaining_value` columns reserved nullable; partial refund via `refund.amount` |
| Gifting / transfer | `voucher_instance.owner_user_id` plus `voucher_transfer` table added later; `gifted` status reserved |
| Play & Win | `reward_entry.source_type` extensible; game tables in a new schema |
| Referrals, check-ins, memberships | Reward source types and attribute types extensible |
| Issuer / PSP / token card verification | `eligibility_attribute.level = issuer_verified`, `source` extensible; `verification_ref` column reserved |
| Student eligibility | `attr_type` extension and segment definitions |
| Automated payouts / reconciliation | `payout.execution_method`, `reconciliation_item.auto_matched_by` |
| Partner funding invoicing | `partner_funding_commitment`, ledger family for partner funding |
| Employee pass QR | `code.object_type` extension |
| POS integration | `redemption.source` (staff_app, pos) |
| Merchant Boost / sponsored placement | `placement` table later; `sponsored_flag` on listings |
| Follow merchant / likes | `saved_item.object_type` or separate `follow` table |

---

## 13. FRAUD, SUPPORT, NOTIFICATIONS

| Table | Key columns | Notes |
|---|---|---|
| **risk_signal** | id, subject_type (user, device, merchant, view, order), subject_id, signal_type, score, detail, at | Inputs to rules |
| **risk_flag** | id, subject_type, subject_id, rule_id, severity, status (open, reviewing, cleared, actioned), assigned_to, created_at | Fraud queue |
| **risk_rule** | id, domain, definition, action (flag, hold, block), version, enabled | Configurable (FR) |
| **blocklist_entry** | id, kind (mobile, device, email_domain, ip, identity), value_hash, reason, expires_at | Includes blocked email local parts and domains for employer verification |
| **risk_decision** | id, subject, decision, reason, decided_by, at, appeal_case_id | Appeals (AU-15) |
| **case** | id, public_ref, type (customer, merchant, payment_dispute, voucher_dispute, redemption_dispute, reward_dispute, partner, fraud, complaint, appeal), requester_type, requester_id, org_id, category, priority, status (new, triage, in_progress, waiting, escalated, resolved, closed, reopened), assignee_id, sla_due_at, resolution_code, created_at, closed_at | SP-01..03 |
| **case_link** | case_id, object_type, object_id | Related voucher, reservation, order, reward, campaign |
| **case_message** | id, case_id, author_type, author_id, body, visibility (public, internal), at | Internal notes never exposed to requesters or partners |
| **case_attachment** | id, case_id, file_id, added_by | |
| **case_event** | append-only status and assignment history | |
| **notification_template** | id, code, channel, language, subject, body, version, status | Bilingual |
| **notification_preference** | user_id, category, channel, enabled | Marketing separate |
| **notification_outbox** | id, user_id, template_code, payload, channel, status (queued, sent, delivered, failed), provider_ref, scheduled_at, sent_at | Frequency caps from config |
| **inapp_notification** | id, user_id, template_code, payload, read_at, created_at | Feed |
| **push_token** | via device | |

---

## 14. REPORTING AND ANALYTICS

| Table | Key columns | Notes |
|---|---|---|
| **event_log** | id, event_type, actor_ref (pseudonymous), object_ref, properties, at | Product telemetry; PII-free; partitioned |
| **agg_partner_daily** | partner_org_id, date, dimension (campaign, merchant, area, segment, product), dimension_value, metric, value, cohort_size | Source for partner reports; **cohort_size** drives suppression |
| **partner_report_config** | org_id, cohort_threshold (from config), reach_rounding_rule | Threshold is configuration (pilot 10) |
| **partner_export_log** | id, org_id, user_id, report_type, params, created_at, row_count | Watermark and rate limit evidence |
| **agg_merchant_daily** | merchant_org_id, branch_id, date, metrics… | Merchant Insights (discovery signals vs redemptions) |
| **agg_platform_daily** | date, metrics… | Admin dashboards |

**Suppression is applied at read time** by the reporting service over `agg_partner_daily` using `cohort_size`, with the merged-remainder rule; hidden cells are never returned by the API.

---

## 15. AUDIT, CONFIGURATION, CONTENT, FILES

| Table | Key columns | Notes |
|---|---|---|
| **audit_event** | id, occurred_at, actor_type, actor_id, actor_org_id, role, action, object_type, object_id, before_hash/after_diff, outcome, reason, ip, device_id, correlation_id, category (AU-01..15) | **Append-only, separate store and privileges**; no PAN, CVV, OTP, passwords or tokens (AU-22); read by Super Admin and Compliance/Risk (AU-21) |
| **config_parameter** | key, type, default, min, max, scope (global, city, merchant, partner), description, owner_role | Registry of CFG keys |
| **config_value** | id, key, scope_ref, value, effective_from, effective_to, version, status, proposed_by, approved_by | Effective-dated, versioned, maker-checker for sensitive keys |
| **feature_flag** | key, enabled, rollout_rule, updated_by | Kill switches |
| **i18n_string** | key, ar, en, version | UI and message strings served to clients |
| **legal_document** | id, kind (terms, privacy, refund, merchant_terms…), language, version, effective_from, content_ref | Versioned for consent |
| **faq_item** | id, category, question_i18n, answer_i18n, sort, status | Help centre |
| **file** | id, owner_org_id, kind, mime, size, sha256, storage_key, status (quarantine, clean, rejected), created_by, created_at | Media and documents |
| **media_asset** | file_id, variants (sizes, HLS renditions), cdn_url_ref | |
| **retention_policy** | data_class, period, action, legal_hold_supported | Retention sweeps (VK-15) |
| **data_request** | id, user_id, type (export, deletion), status, requested_at, completed_at, exceptions | VK-11 |
| **outbox_event** | id, aggregate_type, aggregate_id, event_type, payload, created_at, published_at | Transactional outbox |

---

## 16. KEY RELATIONSHIPS (text ERD)

```
organisation 1─* branch                    organisation 1─1 merchant_profile / partner_profile
organisation 1─* role_assignment *─1 user_account *─1 role *─* permission
user_account(customer) 1─1 customer_profile 1─* eligibility_attribute / consent_record / reservation / order / reward_account
merchant 1─* live_deal *─* branch ; merchant 1─* hot_deal 1─* hot_deal_branch_inventory(per branch) ; each deal *─1 eligibility_rule_set
hot_deal(reservable) 1─* reservation *─1 hot_deal_branch_inventory ; reservation 1─1 code ; reservation 1─0..1 redemption
merchant 1─* voucher_product 1─* voucher_instance *─1 order_line *─1 order 1─* payment 1─* payment_event ; order 1─* refund
voucher_instance 1─1 code ; voucher_instance 1─0..1 redemption
redemption → ledger_journal(redemption) ; order/payment → ledger_journal(sale) ; refund → ledger_journal(refund)
ledger_journal 1─* ledger_entry *─1 ledger_account(owner: merchant | campaign | platform | psp)
settlement_run 1─* statement 1─* statement_line *─1 ledger_journal ; statement 1─0..1 payout
wande_campaign 1─* view_record 1─* view_event ; view_record → ledger_journal(campaign_consumption) + reward_entry
reward_account 1─* reward_entry ; reward_catalogue_item 1─* reward_redemption
partner org 1─* issuer/card_product/card_tier/bin_range ; employer 1─* employer_domain ; eligibility_rule_set 1─* condition
partner_campaign_proposal 1─* proposal_merchant ; proposal 1─* change_request
case 1─* case_message / case_link ; any object ─ audit_event
review *─1 merchant ; review 0..1─ verified interaction (redemption / reservation / controlled claim)
```

---

## 17. STATUS ENUMERATIONS (from Business Rules section 22)

| Entity | Values |
|---|---|
| Live Deal | draft, submitted, under_review, changes_requested, approved_scheduled, live, paused, expired, cancelled, suspended, archived |
| Exclusive Deal | draft, auto_published/under_review, live, paused, sold_out, expired, cancelled, suspended, archived |
| Reservation | reserved, redeemed, expired_noshow, cancelled_customer, cancelled_merchant, cancelled_dealdash (P2: pending_payment, confirmed, refunded, forfeited) |
| Voucher product | draft, submitted, under_review, on_sale, paused, sold_out, ended, suspended, archived |
| Voucher instance | pending_payment, active, redeemed, expired, refunded, voided (P2: gifted, transferred) |
| W&E campaign | draft, submitted, moderation, approved, funded, scheduled, live, paused, completed, expired_underdelivered, suspended, cancelled, reconciled, archived |
| View record | started, checks_passed, qualified, invalid, capped, billed, credited_back |
| Reward entry type | earn, hold, release, redeem, reverse, expire, adjust |
| Order / payment | initiated, pending, paid, failed, cancelled, refund_pending, refunded, refund_failed, disputed, won, lost |
| Settlement / statement | accrued, included, approved, payout_pending, paid, failed, returned |
| Eligibility attribute | not_declared, pending, verified, reverification_due, expired, failed, revoked |
| Merchant | draft, submitted, in_review, changes_requested, resubmitted, approved, agreement_accepted, activated, suspended, offboarding, offboarded, rejected |
| Partner | applied, in_review, approved, configured, activated, suspended, offboarded, rejected |
| Partner proposal | draft, submitted, needs_changes, approved, scheduled, live, paused, expired, rejected |
| Change request | in_review, clarification_requested, approved, rejected |
| Eligibility rule set | draft, pending_review, needs_changes, active, paused, retired, rejected |
| Case | new, triage, in_progress, waiting, escalated, resolved, closed, reopened |
| Redemption attempt | valid, redeemed, reversed, invalid, expired, already_redeemed, wrong_branch, not_yet_valid, suspended, ineligible |

Transitions are enforced in the domain layer with a transition table per entity; illegal transitions are rejected and logged.

---

## 18. PERSONAL DATA, RETENTION AND DELETION

| Class | Examples | Handling |
|---|---|---|
| **Restricted** | Password hashes, OTP hashes, session tokens, bank account (IBAN), KYB documents | Encrypted, tight access, access logged, never in logs |
| **Confidential PII** | Mobile, email, DOB, gender, name, work email (hash + encrypted), case content | Encrypted at rest; role-limited; masked in UI; field-level encryption for DOB and work email |
| **Pseudonymous** | Device hash, event_log actor_ref, view events | Linkable only through a restricted mapping |
| **Operational** | Deals, vouchers, branches, orders (non-PII fields) | Standard |
| **Financial records** | Orders, payments, refunds, ledger, statements, audit | **Retained as required by law and finance policy** (period per VK-11/VK-15); on account deletion the customer link is **anonymised/pseudonymised**, records kept |
| **Not stored at all** | PAN, CVV, last-4, first-6, raw PSP card data | Prohibited by design; schema has no such columns |

**Account deletion workflow (VK-11 open):** request with OTP → check blockers (open reservations, active vouchers, refunds in progress, restrictions) → resolve or refund → anonymise profile and identifiers; retain legally required financial and audit records pseudonymously; points forfeited per terms; confirmation. Legal hold flag supported. Retention periods are configuration pending validation.

**Partner data:** partners never get customer-level rows; `agg_partner_daily` contains counts only.

---

## 19. CONSTRAINTS, INDEXES AND PARTITIONING (physical guidance)

| Concern | Guidance |
|---|---|
| **Integrity** | Foreign keys within a schema; cross-schema references by id with validation in services; check constraints for non-negative stock and balanced journals (validated by job and at post time); unique constraints: verified mobile, active employer email link, `redemption(object)` for successful redemption, `payment_event.psp_event_id`, `ledger_journal.idempotency_key`, one active reservation per (user, hot_deal, branch) when configured |
| **Stock** | Conditional update on `hot_deal_branch_inventory` (available ≥ qty) in the same transaction as reservation insert; `voucher_stock_hold` likewise |
| **Geo** | GiST index on `branch.location`; deal search by distance and status (live_deal, hot_deal, voucher_product); area lookups |
| **Search/listing** | Composite indexes on (status, city, start_at/end_at), (category, status), partial indexes on live deals and on-sale vouchers |
| **Reservations** | Index (status, expires_at) for expiry sweeps; (user_id, status) for My Deals |
| **Ledger** | Indexes on (account_id, posted_at), (journal_id); monthly partitions; balances via materialised snapshots plus recomputation checks |
| **View events** | Daily partitions; short retention for raw heartbeats with aggregates kept |
| **Audit** | Monthly partitions; write-once; archival tier |
| **Event log** | Daily partitions; retention-limited |
| **Row-level scope** | `org_id` on operational tables with composite indexes (org_id, …) |
| **JSON** | Used for i18n text, targeting definitions and rule definitions only; validated by schema |

---

## 20. REFERENCE DATA AND SEEDING
Cities and areas (Riyadh pilot areas), categories, card networks (Visa, Mastercard, Amex, mada), issuers (as onboarded), roles and permissions (from frozen role models), notification templates (AR/EN), legal documents versions, guardrail policy (pilot matrix, all products routed to review initially if configured, AP-06), config registry defaults (Business Rules section 26 list), reward rules and rate cards (placeholders, no hard-coded commercial values), feature flags.

## 21. PILOT CAPACITY CHECK AND OPEN ITEMS (do not block)

Sized for the lean pilot (Tech Architecture section 24): well under 1 TB, ledger and audit in the low millions of rows per quarter, view events in the tens of millions per quarter at the upper assumption (partition by day, short raw retention). One PostgreSQL primary with managed HA/replica is sufficient; no sharding.
## 22. OPEN ITEMS

| Item | Handling |
|---|---|
| Saved payment method display (FDR-43, PSP) | `saved_payment_method_ref` stores PSP-supplied display only; may be dropped |
| Final retention periods (VK-15), deletion exceptions (VK-11) | `retention_policy` configuration |
| Voucher refund window and expired value (VK-04) | Config snapshot on instance; `expired_value` account |
| Tax treatment (VK-03) | Tax fields on lines and ledger entries |
| Hosting region (VK-25) | No schema impact |
| Cohort threshold value (VK-12) | Configuration |

*End of Data Model v0.1. No SQL or application code was written.*


---

## Addendum (Oct 2026) — Subscription, licensing & entitlement data model

Migration `20261224000000_subscription_engine` (additive). Detail: `SUBSCRIPTION_LICENSING_ENTITLEMENT.md`.

**Extended**
- `Contract` + `kind`, `market`, `currency`, `billingCadence`, `renewalState`, `version`, `planVersionId`, `pricingVersionKey`,
  `billingLegalEntityId`, `graceDays`, `graceUntil`, `pastDueSince`, `suspendedAt`, `cancelledAt`, `activatedAt`, `nextBillingAt`,
  `nextRenewalAt`, `enforcement` (policy override), `supportLevel`, `accountManager`, `termsVersion`, `developmentFixture`.
  CHECKs on lifecycle, kind, renewal, cadence, version.
- `ContractEntitlement` + `source` (CONTRACT / PLAN / OVERRIDE / ADDON), `sourceRef`, `mode`, `period`, `warnPercents`, `softAction`,
  `overageRateMinor`, `note`.
- `CommercialCase` + `contractId`, `billingModel`, `billingTrigger`.

**New**
| Table | Purpose | Mutability |
| --- | --- | --- |
| `CommercialPlan` | plan template | updatable (names, status) |
| `CommercialPlanVersion` | market / currency / prices / fees / entitlements / add-ons / trial / grace / enforcement | **frozen once published** (trigger `dd_published_version_frozen`) |
| `PriceItem`, `PriceItemVersion` | product price book (fixed, per unit, percent, tiered; indicative / range) | versioned; published frozen |
| `AddOnDefinition` | add-on effect (product / feature / limit per unit), eligibility | — |
| `ContractLegalEntity` | contracting / covered / billing legal entities | — |
| `ContractAmendment` | change event with impact, snapshots, acceptance link | status only |
| `ContractAcceptance` | immutable acceptance evidence | **append-only** |
| `ContractAddOn` | add-on on a contract (dates, quantity, price, cadence, auto-renew, acceptance, pricing version) | status / dates |
| `ContractTrial` | trial with post-trial plan | status |
| `ContractPromotion` | promotion window and post-promotion treatment | status |
| `ContractRate` | negotiated rate / discount / waiver, versioned | new version per change |
| `UsageMeter` | period meter (org, legal entity, metric, period) | conditional increment |
| `UsageEvent` | idempotent usage event | **append-only** |
| `CommercialBillingEvent` | Phase 5 hook (idempotency key, type, revenue category, amount, currency, pricing version, billing legal entity) | only `status` / `consumedAt` (trigger `dd_billing_event_guard`) |
| `CommercialSignal` | Phase 4 outbox, unique per threshold | `consumedAt` |

Data mapping: legacy `ENDED` contracts → `SUPERSEDED` or `CANCELLED`; nothing deleted. Development merchants get unpriced SA
development-fixture agreements; real pilot businesses need explicit assignment.


## Addendum (Oct 2026) — Phase 4 / Phase 5 data model

Migration `20261231000000_phase4_phase5_visibility_finance_ai` (additive; applied to the dev database after a backup, no reset).

**New tables**
- `AnalyticsEvent` (append-only; CHECK on taxonomy and on verified engagement), `AnalyticsWatermark`, `MetricAggregate` (hourly, text
  dimensions default ''), `CampaignTarget`, `AlertRule`, `AlertEvent`, `AlertDelivery`, `NotificationPreference`.
- `InvoiceLine` (immutable once the document is issued; one line per billing event at most), `PaymentAllocation` (never deleted; reversal
  fields), `FxRate` (rate as exact decimal text, maker-checker status).
- `AiInteraction`, `AiAction`, `AiUsageRecord` (append-only), `AiDraft`.

**Extended**
- `BusinessAccount`: isDefault (one default per org + currency), name, country, billingAddress, taxId, financeContact, invoiceContact,
  paymentTermsDays, billingFrequency, billingMethod, contractId, poRequired, lastBilledAt; unique (organizationId, legalEntityId, currency).
- `FinanceDocument`: legalEntityId, contractId, sourceKind, quotationId, period, transaction / settlement / tax currency, fxRateId, fxRate,
  taxAmountInTaxCurrency, purchaseOrderId, externalReference, expiresAt, fileId, approval, sent / overdue / disputed / cancelled /
  written-off fields; new types (PROFORMA_INVOICE, TAX_INVOICE, ADJUSTMENT_NOTE, STATEMENT) and states (PENDING_APPROVAL, SENT,
  PARTIALLY_PAID, OVERDUE, DISPUTED, CANCELLED, CREDITED, WRITTEN_OFF). Trigger `dd_finance_document_guard` freezes issued fields and
  blocks deleting issued documents.
- `FinancePayment`: currency, legalEntityId. `Quotation`: validUntil, rejection and modification-request fields; states REJECTED,
  MODIFICATION_REQUESTED, EXPIRED. `CommercialBillingEvent`: collection, settlementRef, invoiceLineId (set once by Phase 5).
- `NotificationType` + ALERT.

Money stays integer minor units (legacy `*Halalas` names = minor units). The general ledger remains SAR-only (documented constraint).

## Addendum (Oct 2026) — Market / country configuration data model

Migration `20270101000000_market_country_configuration` (additive; dev database backed up and migrated, no reset).
- `CountryConfiguration` extended as the market master: regionCode, isoAlpha3, status, defaultLanguage, supportedCurrencies,
  billing / settlement / tax currency, currencyDecimals, roundingRule, timezone, callingCode, formatting, launchDate, effectiveFrom / To,
  version, approvalStatus + pending lifecycle fields, created / approved by, dealdashLegalEntityId, supportContact (`enabled` kept, derived).
- New: `MarketRegion`, `MarketProduct`, `TaxRule`, `InvoiceConfig`, `SettlementRule`, `MarketProvider`, `MarketPolicy`,
  `MarketValidationItem`. Approved tax / invoice / settlement / policy rows are frozen by trigger (only closing or retiring); validation
  items are never deleted; CHECKs for every vocabulary and for secret references.
- Extended: `CommercialCase.market`, `CommercialBillingEvent.market`, `FinanceDocument.market` + `invoiceConfigId` (frozen once issued),
  `InvoiceLine.taxRuleId` / `taxRuleVersion` / `taxableItem`, `FxRate.isManualOverride` / `overrideReason`.
<!-- stage7-addendum -->
## Addendum (Oct 2026) — Stage 7 data model

Migration `20270102000000_stage7_partner_portal` (additive; test and dev databases migrated, dev backed up first, no drift):
PartnerType + FINANCIAL_INSTITUTION, CORPORATE, STRATEGIC_PARTNER, OTHER_APPROVED_PARTNER; Partner onboarding columns (lifecycle,
registration, contacts, signatory, requested markets, review / approval and pending activation); new PartnerCardProgram (BIN prefixes
CHECK 6–8 digits), PartnerEmployerProgram (work-email domains), LiveDealPartnerBenefit; EligibilityRuleSet.name; MatchCandidate
partner suggestion. Shared commercial inputs gained `creatorOrganizationId` (default null).

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

Migration `20270104000000_stage7_founder_decisions` (additive; test and development databases migrated, development backed up first,
no reset / reseed, no drift): `WatchCampaign.creatorOrganizationId`, `sponsorOrganizationId` (+ index) — FD-S7-1;
`EligibilityAttribute.verificationSource`, `evidenceRef` with CHECKs (allowed sources; a card attribute is ISSUER_VERIFIED only with
source and evidence, NOT VALID for pre-existing rows) — FD-S7-3. FD-S7-4 uses the existing ReferencedOffer / ExternalEntityReference
(publicationRef, publicationConfirmed) with no schema change.
