# DEALDASH BUSINESS RULES CATALOGUE

Version 0.2 (founder decisions applied; draft for approval) · 2026-10-07
Source of truth: `DEALDASH_MASTER_BLUEPRINT.md` v0.2.2 (approved v0.2.1 + founder decisions below). No approved decision is reopened here.

## FOUNDER DECISIONS APPLIED IN v0.2 (these supersede any older wording below)

| # | Decision | Effect |
|---|---|---|
| 1 | **Exclusive Deals:** MVP = free reservation only; paid deposit/partial payment = Phase 2; inventory is **per branch** in MVP; pooled multi-branch inventory = Phase 2. | HD-07, HD-20/21, RS-04, RD-55 updated; FDR-05, FDR-06 closed |
| 2 | **Vouchers:** sale recorded immediately; merchant amount becomes **settlement-eligible on successful redemption** (MVP); ledger stays flexible for later change after Saudi legal/PSP validation; **full refund before redemption** supported, window configurable + VALIDATE-KSA; partial redemption and partial refund = Phase 2; treatment of **expired voucher value not decided** (configurable + VALIDATE-KSA). | VC-32/33/36/40, ST-02, PY-09 updated; FDR-11, FDR-15 closed; FDR-12/13 reclassified |
| 3 | **Watch & Earn:** campaigns **pre-funded**; cannot consume more paid qualifying views than funded; merchant CPV charge and customer reward economics are **separate configurable concepts** (no CPV/margin hard-coded); DealDash controls reward economics; qualified view = completion under platform rules + fraud checks; thresholds, still-watching checks, frequency caps configurable; unused budget **separately identifiable in the ledger**; final refund/credit of unused budget = VALIDATE-KSA. | WE-02/13/21/30/51/54 updated; FDR-20, FDR-21–23, FDR-25 closed; FDR-26 deferred to VK-08 |
| 4 | **Rewards:** non-cash, non-withdrawable, non-transferable; **no fixed SAR value per point**; catalogue, valuation and expiry are configurable founder settings. | RW-06/07/08 updated; FDR-52/53/54 become configuration |
| 5 | **Authentication:** mobile OTP is the primary (only) customer sign-in method in MVP; **Google and Apple sign-in = Phase 2**. | New rule AU-30; FDR-72 closed; C-07 resolved |
| 6 | **Card eligibility:** **no last-4 collection in MVP** unless a later approved integration requires it; never PAN/CVV; safe combination of issuer/card-product selection + limited BIN/IIN metadata; **never label a card "verified"** without a real verification mechanism; card-payment-required offers state it clearly; architecture supports future PSP/issuer/token verification. | BC-02/04/09/10 updated, new BC-16; FDR-34 closed; C-05/C-06 resolved |
| 7 | **Card schemes/networks:** list is configurable; MVP architecture supports **Visa, Mastercard, Amex, mada**; brand/technical/regulatory use VALIDATE-KSA. | BC-08 updated; FDR-35 closed |
| 8 | **Partner reporting:** aggregated by default; no customer-level PII by default; **configurable small-cohort suppression; initial pilot product setting = 10 customers (not a legal conclusion)**; final threshold subject to privacy validation. | PR-08 updated; FDR-33 closed (value 10 = pilot setting); VK-12 remains |
| 9 | **Merchant structure:** one legal entity with multiple branches in MVP; multi-legal-entity groups/chains = Phase 2. | MR-11 updated; FDR-61 closed |
| 10 | **Merchant suspension/offboarding:** suspension immediately blocks new campaigns, sales and reservations; purchased vouchers and confirmed reservations are **not** automatically removed; outstanding customer obligations enter an **admin-controlled resolution workflow**; fraud/emergency may use explicit admin override with audit log. | HD-33, VC-39, MR-40, MR-50, EM-23 updated; FDR-07, FDR-14 closed |
| 11 | **Employer eligibility:** work-email OTP remains MVP method; supports expiry and periodic reverification; period configurable. | EM-20 updated; FDR-28 closed as configurable |
| 12 | **Reviews:** remain in MVP (already designed) with **report/moderation controls**; advanced reputation management = Phase 2. | MR-52 updated; FDR-65 closed |
| 13 | **Age:** Riyadh pilot is **18+**; date of birth enforces it; any minor/youth proposition is outside MVP and needs separate legal/product review. | New rule AU-31; FDR-27 closed; C-19 resolved |
| 14 | **Live Deals:** public/unlimited remain frictionless (no claim/reservation/QR by default); controlled redemption optional, never defaulted for attribution. | Already LD-02/03; reaffirmed |
| 15 | **Design conflicts recorded for UX Architecture:** Exclusive Deal SAR 15 deposit screen → free reservation for MVP; card UI first 6 + last 4 → revise to approved model; gift checkout stays Phase 2; Play & Win stays Phase 2; existing Play & Win and gifting designs are **preserved as future-phase references, not deleted**. | Section 23 C-01..C-05 marked resolved-pending-UX; new section 23A |

**v0.2.3 additions (UX decisions):** employee pass QR Phase 2 (EM-26); Boost Phase 2; student eligibility Phase 2 (engine extensible); streaks/milestones Phase 2; staff = mobile-first PWA with OTP login, assigned to merchant and branch; reversal by Merchant Manager/DealDash Admin only, never frontline staff (RD-40/41/50); eligibility recheck only where offer rules require, paid vouchers stay valid (RD-30). Closes FDR-26, 40, 41, 62.

**v0.2.1 additions:** (16) risk-based merchant KYB/onboarding with enhanced review for higher-risk merchants (MR-03/03a/03b); (17) electronic merchant agreement acceptance/signature with version, signatory, entity, timestamp, status, audit and stored executed document (MR-06); (18) financial ledger architecture confirmed (section 11A, LG-01 to LG-15). Closes FDR-59, FDR-60, and structurally FDR-16, FDR-46, FDR-47.

All Saudi regulatory, VAT, Merchant-of-Record, voucher-fund, privacy, payment-licensing, data-retention and advertising conclusions remain **VALIDATE-KSA**.
Design reference: `Figma Files\` (63 screens), used only where it informs rules. Detailed screen audit is deferred to UX Architecture.
No application code exists.

## How to read this document

- Rule IDs: `LD-` Live Deals, `HD-` Exclusive Deals, `VC-` Vouchers, `WE-` Watch & Earn, `EL-` Eligibility, `EM-` Employer, `BC-` Bank/Card/Scheme, `RS-` Reservations, `RD-` Redemption, `PY-` Payments, `ST-` Settlement, `RW-` Rewards, `AP-` Approval, `MR-` Merchant, `PR-` Partner, `FR-` Fraud, `NT-` Notifications, `SP-` Support, `AU-` Audit.
- Phase column: **MVP**, **P2** (Phase 2), **P3** (Phase 3).
- **FDR** = FOUNDER DECISION REQUIRED (numbered `FDR-nn`, collected in section 24). A rule marked FDR states the *structure* but not the policy value; value is not invented.
- **VK** = VALIDATE-KSA (Saudi legal, regulatory, privacy, VAT or payment-provider validation required; numbered `VK-nn`, collected in section 25). No regulatory conclusion is made.
- **CFG** = may remain a configurable parameter during development (section 26).
- Rules say "the platform shall". Where a value is given in brackets as `[CFG: …]` it is a parameter name, never a decided number.

Global definitions: **Customer**, **Merchant** (organisation), **Branch**, **Staff**, **Partner** (bank, scheme, employer), **Internal user**. **Qualified view**: a completed Watch & Earn view meeting platform standards (section 4). **Guardrails**: DealDash policy set per product evaluated at publish and during run. **Trust level**: merchant attribute (new / standard / trusted).

---

## 1. LIVE DEALS

A Live Deal is a promotion belonging to the Offer domain (Blueprint 18.1A).

### 1.1 Types

| ID | Rule | Phase |
|---|---|---|
| LD-01 | Two modes exist: **General** (default) and **Controlled** (opt-in). | MVP |
| LD-02 | **General Live Deal**: no claim, no reservation, no QR/barcode, no forced redemption event. Customer discovers the offer and visits the merchant. The platform shall never default a deal to Controlled for attribution purposes (approval clarification 1). | MVP |
| LD-03 | **Controlled Live Deal**: merchant/campaign explicitly enables one or more of: redemption code, per-customer limit enforced by claim, claim-before-visit. Enabling is a merchant choice per deal; DealDash may restrict which merchants/categories may enable it. | MVP |
| LD-04 | A Controlled deal that uses a redemption code follows the Redemption rules (section 9). | MVP |

### 1.2 Structure and content

| ID | Rule | Phase |
|---|---|---|
| LD-10 | A Live Deal belongs to exactly one approved, active merchant. | MVP |
| LD-11 | A deal applies to one or more branches of that merchant; at least one active branch is required. Branch assignment can change while live (see editing). | MVP |
| LD-12 | Mandatory fields: title (AR and EN), description (AR and EN), mechanic, at least one image, branches, start date, terms, eligibility (default Public). Arabic/English completeness policy (both required vs one required and the other machine/assisted): **FDR-01**. | MVP |
| LD-13 | Supported mechanics: percentage discount, fixed-amount discount, BOGO, bundle, meal deal, service offer, everyday promotion. Free-text "other" mechanic requires manual review. | MVP |
| LD-14 | End date is optional (open-ended "ongoing" deals allowed) but a maximum live duration without merchant re-confirmation applies `[CFG: live_deal_reconfirm_days]`. | MVP |
| LD-15 | Start in the future → status Scheduled; deal is not discoverable until start. Date/time uses Riyadh local time (Asia/Riyadh) for display; stored in UTC. | MVP |
| LD-16 | Terms are structured blocks plus free text: valid on full-price items, exclusions, minimum spend, days/hours, other offers not combinable. Terms are shown on the offer detail screen and are part of the audit snapshot at publish. | MVP |
| LD-17 | Stacking: a Live Deal cannot be combined with other DealDash offers unless the merchant states otherwise in terms. DealDash does not enforce stacking at the till for General deals. Platform-level stacking policy for Controlled/Hot/Voucher: **FDR-02**. | MVP |
| LD-18 | Discounts shown must be truthful: displayed "original price"/percentage must pass guardrail price sanity checks. Rules for savings-claim substantiation: **VK-01**. | MVP |

### 1.3 Eligibility and geography

| ID | Rule | Phase |
|---|---|---|
| LD-20 | Each deal carries an eligibility rule set (section 5). Default is Public. | MVP |
| LD-21 | Visibility of deals the customer is not eligible for: shown locked with the requirement vs hidden. **FDR-03**. Screens show "Open to everyone" / card / employer banners, so the display pattern exists. | MVP |
| LD-22 | Geography: a deal is discoverable by its branches' locations, plus optional city targeting. MVP launch geography is Riyadh only `[CFG: enabled_cities]`. | MVP |
| LD-23 | Deal appears in "nearby" by distance from customer location (if permission) or selected city/area. | MVP |

### 1.4 Customer limits

| ID | Rule | Phase |
|---|---|---|
| LD-30 | General deals have no per-customer limit enforced by DealDash (there is no claim). Merchant may state a limit in terms; it is not platform-enforced. | MVP |
| LD-31 | Controlled deals support per-customer limits (per day, per period, lifetime) enforced via claim/redemption records. | MVP |

### 1.5 Editing

| ID | Rule | Phase |
|---|---|---|
| LD-40 | Draft deals are freely editable. | MVP |
| LD-41 | **Editing a live Live Deal (final):** **minor non-commercial edits** (typo, formatting, translation corrections, other non-material descriptive corrections) **publish immediately with a full audit trail**. **Material edits require DealDash review or a revised version**: discount/value, core proposition, eligibility, participating branches, campaign dates where material, important terms and conditions, anything that materially changes what the customer receives. The material-field list is configuration `[CFG: material_fields_live_deal]`. **DealDash may tighten this rule for merchants or content flagged by risk controls.** | MVP |
| LD-42 | A material edit that would worsen the offer for customers who already saved it triggers notification to savers `[CFG]`. | P2 |
| LD-43 | Every edit stores before/after snapshot, actor, timestamp (audit, section 19). | MVP |

### 1.6 Pause, expiry, suspension, end

| ID | Rule | Phase |
|---|---|---|
| LD-50 | Merchant may **pause** a live deal at any time (immediately hidden from discovery, saved items show "paused"). Merchant may resume unless suspended. | MVP |
| LD-51 | Deal **expires** automatically at end date/time. | MVP |
| LD-52 | **DealDash may suspend** any deal with reason code; the merchant cannot resume a suspended deal; the merchant is notified. | MVP |
| LD-53 | Merchant may **cancel** (end early). Controlled deals with issued claims: existing claims remain valid until their own expiry unless suspended for fraud. | MVP |
| LD-54 | When a merchant is suspended, all its live deals are hidden immediately; on reactivation they return to prior status unless expired. | MVP |
| LD-55 | When a branch is closed/deactivated, deals assigned only to that branch are paused. | MVP |

### 1.7 Analytics

| ID | Rule | Phase |
|---|---|---|
| LD-60 | The platform shall record, per deal and branch, with customer-pseudonymous and anonymous-session attribution: **impressions**, **detail views**, **saves/unsaves**, **directions/location clicks**, **merchant page visits**. Call/website clicks if present. | MVP |
| LD-61 | Impression = card rendered ≥ `[CFG: impression_min_visible_ms]` and ≥ `[CFG: impression_min_visible_pct]` in viewport; deduplicated per customer/deal/session window. | MVP |
| LD-62 | Metrics are discovery signals, not proof of purchase or visit. UI and reports must label them accordingly. | MVP |
| LD-63 | Funnel: impression → detail view → save → directions click. Conversion for General deals is limited to this funnel. | MVP |
| LD-64 | Visit verification (geofence/check-in) is not part of the MVP. | P2 (FDR-04: whether to pursue) |
| LD-65 | Merchant reports show aggregates only (no customer identities) except for Controlled-redemption records for their own redemptions. | MVP |

---

## 2. EXCLUSIVE DEALS

An Exclusive Deal is a promotion in the Offer domain intended to create immediate demand (Blueprint 18.1A, 23).

### 2.1 Types and structure

| ID | Rule | Phase |
|---|---|---|
| HD-01 | An Exclusive Deal is **time-limited**, **quantity-limited**, or **both**. At least one limit is mandatory. | MVP |
| HD-02 | Time-limited: absolute end time or duration from launch (e.g. 2 hours). Max duration `[CFG: hot_deal_max_hours]`. Countdown shown to customers. | MVP |
| HD-03 | Quantity-limited: total units set by merchant; remaining count is shown to customers `[CFG: show_remaining_threshold]` (design shows "120 left"). | MVP |
| HD-04 | Time + quantity: the deal ends when either limit is reached first. | MVP |
| HD-05 | Fields from Live Deal (LD-10 to LD-18) apply: merchant, branches, bilingual content, mechanic, terms, eligibility. | MVP |
| HD-06 | **Merchant inventory:** merchant declares total units and optional per-branch allocation. Inventory can be increased while live (guardrails apply) but not decreased below units already reserved/redeemed. | MVP |
| HD-07 | **Branch availability: inventory is allocated per branch in MVP.** Each branch has its own unit count; a reservation draws only from its branch's stock and is valid only at that branch. A deal covering several branches carries one allocation per branch. **Pooled multi-branch inventory is Phase 2** (the model should not block it: inventory is held in a per-branch allocation structure). | MVP / P2 (pooled) |
| HD-08 | **Customer limit:** per-customer cap per deal (design shows "up to 2 per customer"); merchant sets within platform max `[CFG: hot_deal_max_per_customer]`. Enforced at reservation. | MVP |
| HD-09 | **Eligibility:** same engine as section 5; Public by default. | MVP |

### 2.2 Reservation behaviour (free reservation in MVP)

| ID | Rule | Phase |
|---|---|---|
| HD-10 | **Free reservation is supported in MVP.** A reservation holds one or more units for the customer without payment. | MVP |
| HD-11 | **Inventory blocking:** on reservation creation, units are decremented from available stock atomically (no over-reservation under concurrency). | MVP |
| HD-12 | A reservation produces a one-time code/QR used at the venue (Redemption, section 9). | MVP |
| HD-13 | Reservation hold period, expiry, cancellation, no-show: see section 8. | MVP |
| HD-14 | Deals that do not need inventory control may be published as Exclusive Deals without reservation (time-limited only, walk-in), following the General Live Deal rules for the customer journey. | MVP |

### 2.3 Deposit / partial payment

| ID | Rule | Phase |
|---|---|---|
| HD-20 | Deposit / partial payment on reservation is **Phase 2** unless specifically approved for MVP for a given pilot. The data model, ledger and payment hooks must allow a reservation to carry an optional payment (architecture-ready). | P2 |
| HD-21 | When enabled (Phase 2), deposit amount, application to the bill, forfeiture on no-show, and refund on cancellation follow `PY-` rules; deposit rule values and legal nature remain **FOUNDER DECISION REQUIRED (P2)** and **VALIDATE-KSA (VK-02)**. | P2 |

> **DECIDED (founder, v0.2):** MVP reservation is **free only**. The designed Hot screens (20 "Hot limited reserve", 26 "Reserve sheet") show "Pay SAR 15 and reserve" (SAR 15 token credited to the bill). That screen **must be changed to free reservation for MVP** during UX Architecture; the paid-token design is preserved as a Phase 2 reference. See section 23A.

### 2.4 Lifecycle, ending, pause

| ID | Rule | Phase |
|---|---|---|
| HD-30 | Statuses: Draft → (Auto-published \| Under Review) → Live → Paused ↔ Live → Sold Out \| Expired \| Suspended \| Cancelled → Archived. Full model section 22. | MVP |
| HD-31 | **Campaign ending:** at end time or zero inventory the deal stops accepting new reservations. Existing reservations stay valid until their own expiry (RS rules). | MVP |
| HD-32 | **Merchant pause:** new reservations stop immediately; existing reservations remain valid unless the merchant cancels the deal with reason (then see HD-34). | MVP |
| HD-33 | **Suspension by DealDash:** new reservations stop immediately. **Confirmed reservations do not automatically disappear**; outstanding reservations enter the admin-controlled resolution workflow (MR-42). Fraud/emergency cases may be cancelled via explicit admin override with audit log. | MVP |
| HD-34 | **Merchant cancellation of a deal with live reservations:** customers are notified; impacted customers get reservation cancelled with no penalty; repeated cancellations affect merchant trust level `[CFG]`. Merchant penalties: **FDR-08**. | MVP |
| HD-35 | Exclusive Deals are the first candidates for auto-publish within guardrails (section 13). | MVP |
| HD-36 | Notifications near end: "ending soon" push to savers/nearby opted-in customers `[CFG: hot_ending_notice_minutes]`, subject to frequency caps. | MVP |
| HD-37 | Analytics: same as LD-60 plus reservations created, reservation conversion, sell-through rate, time-to-sell-out, no-show rate. | MVP |

---

## 3. VOUCHERS

Voucher domain (Blueprint 18.1B, 22). A voucher is a commerce/financial product.

### 3.1 Product creation

| ID | Rule | Phase |
|---|---|---|
| VC-01 | A **voucher product** defines: merchant, branches, title/description (AR/EN), **face value** (what the voucher is worth at the merchant), **selling price** (what the customer pays, ≤ face value unless approved), inventory quantity, validity rule, terms, eligibility, images. | MVP |
| VC-02 | Amounts are SAR integers in halalas (minor units). Rounding rules for percentages: round half up at line level `[CFG]`. VAT presentation: **VK-03**. | MVP |
| VC-03 | Inventory: finite quantity; optional per-day cap; optional per-customer cap `[CFG: voucher_max_per_customer]`. Unlimited inventory is not allowed in MVP. | MVP |
| VC-04 | Validity rule: either fixed expiry date or **N days from purchase** (design shows validity windows). Minimum validity set by platform `[CFG: voucher_min_validity_days]`. Minimum legal validity: **VK-04**. | MVP |
| VC-05 | Activation: a voucher becomes **Active** when payment is confirmed (not on purchase attempt). Optional "valid from" date (not usable before) `[CFG]`. | MVP |
| VC-06 | Discount ceiling and price sanity are guardrail rules; large inventory or high face value triggers review (section 13). | MVP |
| VC-07 | Voucher products can be Draft, Under Review, On Sale, Paused, Sold Out, Ended, Suspended (section 22). | MVP |
| VC-08 | Merchant may not reduce face value, raise selling price or shorten validity of a product with existing sold vouchers; only affects new sales. | MVP |

### 3.2 Purchase, payment, ownership

| ID | Rule | Phase |
|---|---|---|
| VC-10 | Purchase requires a verified, logged-in customer and eligibility (if the voucher is restricted). | MVP |
| VC-11 | On checkout start, requested units are **held** from inventory for `[CFG: voucher_checkout_hold_minutes]`; hold released on timeout/failure/cancel. | MVP |
| VC-12 | Payment is executed through the PSP (section 10). A voucher instance is created in `Pending Payment` and moves to `Active` only on confirmed payment. | MVP |
| VC-13 | **Ownership:** a voucher belongs to the purchasing customer account. Not transferable in MVP. Gifting and transfer are Phase 2; the design already shows gift checkout (screens 29–30). Scope of gifting: **FDR-09**. | P2 |
| VC-14 | Per-purchase quantity limit and per-customer limit enforced at checkout. | MVP |
| VC-15 | Promo codes/discounts at checkout: design shows a promo field. Promo funding, rules and stacking: **FDR-10**. | P2 (FDR-10 to confirm) |
| VC-16 | Receipt issued for each order. Tax invoice format: **VK-03**. | MVP |

### 3.3 Code and QR

| ID | Rule | Phase |
|---|---|---|
| VC-20 | Each voucher instance has a unique, non-guessable code and a signed QR payload tied to voucher id. Codes carry no personal data. | MVP |
| VC-21 | Code is single-use. Codes are generated server-side only. | MVP |
| VC-22 | Screenshot sharing risk is accepted at MVP; mitigations in FR rules (rotating QR is P2). | MVP / P2 |

### 3.4 Redemption, expiry, cancellation, refund

| ID | Rule | Phase |
|---|---|---|
| VC-30 | Redemption follows section 9. A voucher is redeemable only at its listed branches, within validity, in `Active` state. | MVP |
| VC-31 | Duplicate redemption is blocked atomically; the second attempt returns "Already redeemed" with time/branch. | MVP |
| VC-32 | Full-value redemption is the MVP rule: the whole voucher is redeemed in one event. **Partial redemption / bill-amount entry and partial refund are Phase 2.** | MVP / P2 |
| VC-33 | **Expiry:** at expiry the voucher moves to `Expired` and can no longer be redeemed. **Treatment of expired unredeemed value is NOT decided**: it is configurable (`[CFG: expired_value_policy]`, e.g. retain / refund / extend / credit) and **VALIDATE-KSA (VK-04)**. The ledger must record expiry as its own event and keep the value separately identifiable. | MVP structure |
| VC-34 | Expiry reminders to customers before expiry `[CFG: voucher_expiry_reminder_days]`. | MVP |
| VC-35 | **Cancellation before payment** completes: hold released, nothing issued. | MVP |
| VC-36 | **Full refund before redemption is supported in MVP.** The refund window is configurable (`[CFG: voucher_refund_window_hours]`) and **VALIDATE-KSA (VK-04)**. Other refund triggers handled as cases: merchant cannot honour / suspended, duplicate charge, fraud void. Refund after expiry follows VC-33 (undecided, VK-04). **Partial refund is Phase 2.** | MVP (full) / P2 (partial) |
| VC-37 | Refund to original payment method via PSP (PY rules); platform fee and merchant payable reversed accordingly (ST rules). | MVP |
| VC-38 | A redeemed voucher cannot be refunded except through a redemption reversal approved under RD rules. | MVP |
| VC-39 | If a merchant is suspended or offboarded, **already purchased vouchers do not automatically disappear**. New sales stop immediately; outstanding vouchers enter the admin-controlled resolution workflow (MR-42: e.g. continue to honour, honour at another branch, refund, extend). Fraud/emergency cases may use explicit admin override with audit log. | MVP |

### 3.5 Merchant payable, settlement, fee, fraud, audit

| ID | Rule | Phase |
|---|---|---|
| VC-40 | **The customer purchase/sale is recorded immediately** as a ledger event. **For MVP the merchant amount becomes settlement-eligible upon successful redemption** (a redemption event moves the amount from "held for merchant" to "settlement-eligible"). The ledger architecture stays flexible so accrual/settlement treatment can change later after Saudi legal/PSP validation (`[CFG: payable_accrual_point]`, VK-05, VK-16). | MVP |
| VC-41 | Platform fee on vouchers is computed from configurable fee rules `[CFG: voucher_fee_rule]`: percentage, fixed, or both; applied at the accrual point. Exact values: **FDR-16**. | MVP structure |
| VC-42 | Treatment of voucher funds held between sale and settlement (who holds, segregation, escrow): **VK-05**. No conclusion is made. | MVP structure |
| VC-43 | Voucher fraud controls: purchase velocity, refund-abuse, resale detection, device/account linkage, abnormal redemption patterns (section 16). | MVP |
| VC-44 | Every voucher state change, purchase, refund and redemption attempt writes an audit event (section 19). | MVP |

---

## 4. WATCH & EARN

Watch & Earn is a paid merchant advertising/reward campaign (Blueprint 18.1C, 24). It is not an Offer. Customer designs: Watch and Earn hub (37), Reels player (39), still-watching check (40), instant reward unlocked (41), and "Watch to unlock: Free pastry · 37 left".

### 4.1 Control split

| Merchant controls | DealDash controls |
|---|---|
| Paid-view quantity / campaign budget | Reward amount and reward economics |
| Campaign dates | Qualifying-view standards |
| Audience (within approved targeting options) | Fraud rules |
| Geography (within enabled areas) | Maximum frequency and caps |
| Merchant prize inventory (where applicable) | Reward issue |
| Repeat/frequency settings **within DealDash limits** (stricter only) | Campaign safety controls, moderation, suspension |

| ID | Rule | Phase |
|---|---|---|
| WE-01 | The merchant never sets customer reward amount. Merchant UI shall not expose reward amount as an input. | MVP |
| WE-02 | The merchant buys paid qualifying views. **Merchant campaign charge (CPV) and customer reward economics are two separate configurable concepts** with no hard-coded link: the CPV comes from a DealDash rate card; the customer reward comes from DealDash reward rules. **No CPV and no DealDash margin is hard-coded.** Values remain **FOUNDER DECISION REQUIRED (configurable founder settings)**. | MVP structure |
| WE-03 | Merchant may set frequency rules equal to or stricter than the platform minimum; looser rules are rejected. | MVP |
| WE-04 | Approved targeting options at MVP: city/geography, time window, customer eligibility groups, interest categories `[CFG: targeting_dimensions]`. Age/gender targeting is not offered at MVP pending privacy review: **FDR-18 / VK-06**. | MVP |
| WE-05 | Merchant prize inventory (e.g. "Free pastry, 37 left") is optional; merchant declares prize, quantity, redemption validity, branches. Prize allocation mechanic: **FDR-19**. Prizes are redeemed through the redemption rules. | MVP |

### 4.2 Campaign creation and funding

| ID | Rule | Phase |
|---|---|---|
| WE-10 | Merchant supplies a video (upload or approved reference), thumbnail, title (AR/EN), CTA (e.g. "View deal" linking to a Live/Hot/Voucher or merchant page), budget, dates, targeting. | MVP |
| WE-11 | Video technical limits (duration, size, format) `[CFG]`; video duration determines qualifying watch threshold (design shows "+15 pts · 15s"). | MVP |
| WE-12 | Content moderation is required before first publication of any video (AR/EN); video content rules/prohibited content: **VK-07**. | MVP |
| WE-13 | **Campaigns are pre-funded in MVP:** the budget must be funded (paid via PSP or credited) before going Live. A campaign **cannot consume more paid qualifying views than its funded budget allows** (hard cap, WE-51). Funded budget is held in a campaign budget account in the ledger (see WE-54). Payment legal treatment of prepaid budgets: **VALIDATE-KSA (VK-08/VK-16)**. | MVP |
| WE-14 | Campaign status model: section 22. Merchant may pause/resume; DealDash may pause/suspend. | MVP |
| WE-15 | A campaign may link a call-to-action only to the merchant's own approved offers. | MVP |

### 4.3 Qualifying view standard

A **qualifying view** is a completed qualifying view under platform-defined standards. A view is billable and reward-eligible only if every condition is met:

| ID | Condition | Phase |
|---|---|---|
| WE-20 | **Video start:** playback started by a customer action or autoplay within the Reels/hub context, and a server-issued view token was created at start. | MVP |
| WE-21 | **Completion:** a qualified view requires completion under DealDash platform rules **plus fraud checks**. Watched ≥ `[CFG: qualifying_watch_pct]` of the video or ≥ `[CFG: qualifying_watch_seconds]`; skipping/seeking does not count watched time. Exact thresholds, still-watching checks and frequency caps are **configurable** (founder/ops settings; not hard-coded). | MVP |
| WE-22 | **Foreground and visible:** app in foreground, video visible and playing. | MVP |
| WE-23 | **Still-watching checks:** the player may require interaction ("Still watching?" prompt with countdown, design shows 5s). Failure/no response within the countdown invalidates the view. Frequency/triggering of checks: platform-controlled `[CFG: still_watching_policy]`, randomised. | MVP |
| WE-24 | **Background/minimised behaviour:** moving to background, locking the screen, switching apps, or minimising pauses playback and stops counting watched time. Returning within `[CFG: resume_grace_seconds]` resumes; otherwise the view is invalid. Muted playback acceptance: **FDR-22**. | MVP |
| WE-25 | **Unique account and device:** verified account, one active session, device not blocklisted. | MVP |
| WE-26 | **Within targeting:** customer meets campaign targeting at view start. | MVP |
| WE-27 | **Frequency satisfied:** merchant/platform repeat rule satisfied (WE-30 to WE-32). | MVP |
| WE-28 | **Not flagged:** no active fraud flag on account/device; view passes server-side verification of the token and timeline. | MVP |
| WE-29 | The client cannot self-report a view; only the server confirms a qualified view. | MVP |

### 4.4 Frequency, caps, limits

| ID | Rule | Phase |
|---|---|---|
| WE-30 | **Repeat views:** a customer's repeated view of the same campaign counts at most `[CFG: max_qualified_per_customer_per_campaign]` times per `[CFG: repeat_window]` (platform minimum interval). Platform defaults: **FDR-23**. | MVP |
| WE-31 | **Daily limits:** per-customer maximum qualified (rewarded) views per day across all campaigns `[CFG: customer_daily_view_cap]`. | MVP |
| WE-32 | **Device/account limits:** max accounts per device, max devices per account, max concurrent sessions `[CFG]`. | MVP |
| WE-33 | A view that exceeds a cap is **not rewarded and not billed**; the customer UI explains the limit. | MVP |

### 4.5 Invalid views, rewards

| ID | Rule | Phase |
|---|---|---|
| WE-40 | **Invalid views** (no still-watching response, background, skipped, bot/emulator signals, cap exceeded, suspicious velocity, flagged account) are recorded in the view ledger with a reason code but are neither billed nor rewarded. | MVP |
| WE-41 | **Reward issue:** only after a view is confirmed qualified and (for risk-scored accounts) any hold window has passed; reward credited by the Rewards Engine (section 12), amount determined by DealDash reward rules. Instant reward unlock (design screen 41) is the immediate credit case for low-risk accounts `[CFG: instant_reward_risk_threshold]`. | MVP |
| WE-42 | **Reward reversal:** a reward is reversed (counter-entry) if the view is later found fraudulent or invalid; negative balance handling: **FDR-24**. | MVP |
| WE-43 | A qualifying view is billed to the merchant at confirmation (view ledger posts spend). A billed view later found invalid is credited back to the merchant. | MVP |
| WE-44 | Merchant prize "watch to unlock" mechanics: prize availability shown as remaining count; prize is allocated to the customer only after a qualified view. Allocation order/randomisation: **FDR-19**. | MVP |

### 4.6 Budget and campaign state

| ID | Rule | Phase |
|---|---|---|
| WE-50 | **Budget exhaustion:** when paid views are delivered, the campaign becomes Completed and stops serving. | MVP |
| WE-51 | Spend is computed per qualified view; concurrent views near budget end are resolved atomically so **paid qualifying views never exceed the funded budget** (hard cap, tolerance 0). Views beyond the cap are not billed to the merchant and not rewarded as paid views. | MVP |
| WE-52 | **Campaign pause** (merchant or DealDash) stops serving immediately; in-flight views may complete and be evaluated; pause time does not consume the schedule `[CFG]` (extension option). | MVP |
| WE-53 | **Under-delivery:** at campaign end, undelivered paid views are not billed. | MVP |
| WE-54 | **Unused merchant budget** must remain **separately identifiable in the ledger** (campaign budget account: funded, consumed, released/unused, refunded/credited as distinct entries). **Final refund/credit/retention treatment is not decided: configurable and VALIDATE-KSA (VK-08, VK-16).** | MVP structure |
| WE-55 | Campaign suspension for policy/fraud: spend to date is reconciled; invalid views credited; budget treatment per FDR-26. | MVP |

### 4.7 Reporting and fraud review

| ID | Rule | Phase |
|---|---|---|
| WE-60 | **Merchant reporting:** impressions served, started views, qualified views, completion rate, invalid-view counts by category (no customer identities), spend, remaining budget, CTA clicks, resulting detail views, prize allocations. | MVP |
| WE-61 | **Customer reporting:** per-view reward earned, pending/held, reversed, daily progress vs cap, history in Rewards. | MVP |
| WE-62 | **Fraud review:** a review queue receives campaigns/accounts exceeding anomaly thresholds. Actions: allow, hold rewards, invalidate views, block account/device, pause campaign. | MVP |
| WE-63 | Pilot customers are 18+ (AU-31), so under-18 earning/targeting is out of MVP scope. Any youth proposition needs separate legal/product review (VK-06). | MVP |
| WE-64 | Advertising rules for AR/EN content, sponsored labelling and health/age-restricted categories: **VK-07**. | MVP |

---

## 5. CUSTOMER ELIGIBILITY

Eligibility Engine (Blueprint 18.2). Eligibility is a layer attached to offers (Live/Exclusive Deals, Vouchers, and campaign targeting for Watch & Earn).

### 5.1 Sources and model

| ID | Rule | Phase |
|---|---|---|
| EL-01 | Eligibility sources: **public**, **geography**, **bank/issuer**, **card product**, **card tier**, **scheme**, **employer**, **DealDash segment**, **campaign-specific**. | MVP (segment: basic; membership/status: P2) |
| EL-02 | A customer may hold several eligibility attributes at once (multiple employers if permitted, multiple cards, segments). | MVP |
| EL-03 | Rule composition: `ALL`, `ANY`, `NOT` over attributes; a rule set is a tree evaluated against the customer's eligibility profile. | MVP |
| EL-04 | Each attribute records: `source`, `verification_level`, `verified_at`, `expires_at`, `status`. | MVP |
| EL-05 | Verification levels: `self-declared`, `OTP-verified` (employer email), `BIN-matched` (limited metadata), `PSP-confirmed` (card metadata returned at payment), `issuer-verified` (future). An offer may demand a minimum level. | MVP (first four) / P3 (issuer) |
| EL-06 | **DealDash segments** are rule-defined cohorts maintained by DealDash (e.g. new customer, area, interest). Use of sensitive attributes in segments: **VK-06**. | MVP basic |
| EL-07 | **Campaign-specific eligibility:** invite lists/cohorts created by DealDash for a campaign (e.g. a partner-funded campaign). Customer-level cohort uploads by partners need legal basis: **VK-09**. | P2 |

### 5.2 Verification, expiry, reverification

| ID | Rule | Phase |
|---|---|---|
| EL-10 | Lifecycle per attribute: Not declared → Pending → Verified → Re-verification due → Expired; Failed; Revoked. | MVP |
| EL-11 | Expiry and reverification periods per attribute type are parameters `[CFG: employer_reverify_days, card_reconfirm_days]`; values: **FDR-28**. | MVP structure |
| EL-12 | A customer can remove any attribute at any time; offers depending on it become locked immediately. | MVP |
| EL-13 | Attribute removal does not cancel already-issued reservations/vouchers (their eligibility was checked at issue) unless the offer terms require continued eligibility at redemption (RD-30). | MVP |

### 5.3 Priority, conflicts, visibility

| ID | Rule | Phase |
|---|---|---|
| EL-20 | Where several offers apply, the UI shows each with its own eligibility reason; the best-matching eligibility label is shown ("Open to everyone", "Riyad Bank cardholders", "Verified employee"). | MVP |
| EL-21 | **Rule conflict resolution:** if a customer qualifies for several offers from the same merchant, DealDash does not combine them automatically; each offer stands alone (LD-17). Cross-offer stacking policy: **FDR-02**. | MVP |
| EL-22 | **Feed priority/ranking:** relevance, distance, recency, eligibility match, merchant quality; sponsored placement and its labelling: **FDR-29 / VK-10**. | MVP basic |
| EL-23 | **Offer visibility:** per offer, `Public`, `Locked-visible`, `Hidden` (see LD-21). Default pending FDR-03. | MVP |
| EL-24 | Eligibility is checked at three points: **display** (soft), **action** (reserve/buy/claim, hard), **redemption** (re-check where terms require). | MVP |
| EL-25 | Eligibility evaluation outcomes are logged for disputes (what rule failed). | MVP |

### 5.4 Privacy and card safety

| ID | Rule | Phase |
|---|---|---|
| EL-30 | Eligibility data is used only to determine offer access and aggregated reporting. | MVP |
| EL-31 | The platform shall never require, collect or store a full card number (PAN) or CVV. | MVP |
| EL-32 | Partners never receive customer-level eligibility lists by default (section 15). | MVP |
| EL-33 | Eligibility changes are audit logged (section 19). | MVP |

---

## 6. EMPLOYER ELIGIBILITY

Flow: company selected from DealDash partner list → official employee email → OTP → verified status (Blueprint 5.1).

| ID | Rule | Phase |
|---|---|---|
| EM-01 | Customer can choose only employers that are **Active partners** in DealDash. Employers without an active partnership cannot be selected. | MVP |
| EM-02 | The customer enters an **official work email**. The email domain must exactly match one of the employer's **approved email domains** (EM-10). Subdomain matching rule `[CFG]`; default exact domain plus listed subdomains. | MVP |
| EM-03 | An OTP is sent to the work email. OTP is single-use, expires in `[CFG: email_otp_ttl_minutes]`, max attempts `[CFG: email_otp_max_attempts]`, resend limits `[CFG]`, cooldown after failure `[CFG]`. | MVP |
| EM-04 | On success the attribute `employer:<id>` becomes **Verified** (level OTP-verified), `verified_at` set, expiry per EM-20. | MVP |
| EM-05 | The work email itself is stored only as needed for re-verification and abuse control (hashed lookup plus encrypted value, restricted access). Customer sees a masked version. Data minimisation, retention: **VK-11**. | MVP |
| EM-06 | An email address may be linked to **one** customer account at a time `[CFG]`; a second account attempting the same address is blocked and flagged. | MVP |
| EM-07 | Generic/shared mailboxes (info@, hr@, support@) and personal domains (gmail etc.) are rejected `[CFG: blocked_local_parts, blocked_domains]`. | MVP |
| EM-08 | **One active verified employer relationship per customer at a time in MVP** (Switch employer replaces the current one). **DECIDED (founder); FDR-30 closed.** Multiple concurrent employers may be considered later. | MVP |

### Domains, expiry, job change, removal

| ID | Rule | Phase |
|---|---|---|
| EM-10 | Employer partner admins register approved domains; domains are verified by DealDash Partner Management before activation. Proof method (DNS TXT, document, email to registered contact): **FDR-31**. | MVP |
| EM-11 | Domain change (add/remove) is audit logged; removing a domain revokes eligibility of affected employees at next check or immediately `[CFG]`. | MVP |
| EM-20 | **Expiry / periodic reverification (supported in MVP):** verification expires after `[CFG: employer_reverify_days]`; customer must re-verify by new OTP to the work email. **The exact period is configurable** (not hard-coded). A grace period applies `[CFG]`. Work-email OTP remains the MVP verification method. | MVP |
| EM-21 | **Job change / leaving:** DealDash cannot know automatically. Controls: periodic reverification (EM-20), customer self-removal, employer-initiated revocation (employer admin can disable employer-offers for the programme or flag), email bounce signal. Employer sending leaver lists would be customer-level data sharing and needs approval: **VK-09 / FDR-32**. | MVP / P2 |
| EM-22 | **Failed OTP:** after max attempts the verification attempt locks for `[CFG]` cool-down; repeated failures across accounts for one domain raise a risk flag. | MVP |
| EM-23 | **Employer removal:** if the employer is deactivated/offboarded, its employee eligibility is revoked, employee-only offers are paused, customers are notified. Existing issued vouchers/reservations: admin resolution workflow (MR-42). | MVP |
| EM-24 | **Privacy:** the employer sees only aggregate counts (verified employees, offer usage) subject to cohort thresholds (FDR-33/VK-12). The employer never receives names/emails of employees by default. | MVP |
| EM-25 | **Offer eligibility:** an employee-only offer is shown "Verified employee" and requires an active `employer:<id>` attribute at action time (EL-24). Verified status digitally unlocks the offer in the app; no separate pass is needed (EM-26). | MVP |
| EM-26 | **Employee Pass QR is Phase 2.** In MVP verified employer status digitally unlocks eligible employer offers inside the app; no separate employer QR pass is required for normal redemption. | P2 |

---

## 7. BANK / CARD / SCHEME ELIGIBILITY

MVP method (Blueprint 5.2): issuer/card selection and limited BIN/IIN metadata; no PAN or CVV. Design (screen 56) allows bank, scheme (Visa, Mastercard, mada), type (credit/debit/prepaid), tier and **first 6 and last 4 digits** entry.

| ID | Rule | Phase |
|---|---|---|
| BC-01 | The customer may add **card/membership entries**: issuer bank, scheme, type, tier. | MVP |
| BC-02 | **Eligibility uses an approved safe combination of issuer/card-product selection and limited BIN/IIN metadata** (leading digits only, maximum per PSP/scheme standard, VK-13) where appropriate. **Last 4 digits are NOT collected in MVP** unless a later approved integration specifically requires them. Scope of BIN storage and PCI/SAMA implications: **VALIDATE-KSA (VK-13)**. | MVP |
| BC-03 | DealDash shall never store full PAN, CVV, PIN or full expiry. | MVP |
| BC-04 | Card/issuer entries are recorded as `self-declared` or `BIN-matched`. Neither proves card ownership. **A card must not be described to customers, merchants or partners as "verified"** unless DealDash has an actual verification mechanism (PSP-confirmed at payment, or future issuer/token verification). UI wording uses "added", "matched to offers", or "saved". | MVP |
| BC-05 | When a purchase is paid through DealDash's PSP, PSP-returned issuer/BIN/scheme metadata may upgrade the attribute to `PSP-confirmed` for that transaction and be used to validate **card-restricted purchases** (e.g. a voucher or reserved-with-payment). | MVP |
| BC-06 | **Card tier:** tier is selected by the customer (Classic/Gold/Platinum/Signature…) and mapped to the issuer's product catalogue maintained by the bank partner; an offer may require tier ≥ X using the partner-defined order. | MVP |
| BC-07 | **Bank-specific benefits:** offers targeted to an issuer (e.g. Riyad Bank screen 13) are visible to customers who declared that issuer, with the card requirement stated clearly. | MVP |
| BC-08 | **Scheme/network benefits:** the scheme/network list is **configurable** (admin-managed reference data). The MVP architecture supports **Visa, Mastercard, Amex and mada**. Brand, technical and regulatory use of each network (marks, scheme rules): **VALIDATE-KSA (VK-14)**. | MVP |
| BC-09 | **Offers requiring payment with an eligible card:** the offer detail and terms shall state clearly "Valid only when paying with [issuer/scheme/tier] card". For offline merchant payments, enforcement is by terms and merchant discretion only. | MVP |
| BC-10 | **No proof of offline card use:** DealDash does **not** claim, represent or guarantee that a customer used an eligible card at a merchant till. Customer-facing and partner-facing wording must not imply verification. Without issuer/payment integration, such offers are "card-presented at merchant's discretion". | MVP |
| BC-11 | **Card-restricted offers verified at purchase** are limited to transactions paid through the PSP (voucher purchase). Whether to launch card-restricted vouchers in the pilot: **FDR-36**. | MVP / FDR |
| BC-12 | Issuer-/token-based verification and card-linked offers are future capabilities; the attribute model (`verification_level`) must support them without redesign. | P3 |
| BC-13 | Bank partner may maintain card products, tiers, BIN ranges; changes are effective-dated and audited. BIN range correctness is the partner's responsibility; DealDash validates format and overlaps. | MVP |
| BC-14 | Customer may add up to `[CFG: max_card_entries]` entries and remove at any time; removal immediately locks dependent offers. | MVP |
| BC-16 | Architecture must support future PSP-, issuer- or token-based card verification and card-linked offers without data-model redesign (`verification_level`, `source` fields). | P3 |
| BC-15 | Wallet/insurance/student memberships appear in the design ("Wallet, Insurance, Student"); these are additional membership types. Whether they are in MVP or Phase 2 is **FDR-37**. | FDR-37 |

---

## 8. RESERVATIONS

A Reservation is a child of an Exclusive Deal (and of controlled Live Deals if enabled). Free in MVP.

| ID | Rule | Phase |
|---|---|---|
| RS-01 | **Creation:** a verified customer may reserve 1…N units (≤ per-customer limit HD-08) at a selected eligible branch while the deal is Live and stock is available. | MVP |
| RS-02 | Creation is atomic: stock check, decrement, record and code issue happen as one operation; failure leaves no partial state. | MVP |
| RS-03 | **Hold:** the reservation is `Reserved`; units remain blocked during the hold period `[CFG: reservation_hold_minutes]`. Design shows "valid for 1 hour once confirmed". Hold length (default and merchant-adjustable range): **FDR-38**. | MVP |
| RS-04 | **Confirmation:** in the free MVP flow creation = confirmation (the customer taps "Reserve"). Where a deposit is enabled (P2), a reservation is `Pending Payment` until paid, then `Confirmed`. | MVP / P2 |
| RS-05 | **Expiry:** at hold end, an unredeemed reservation becomes `Expired`; units return to available stock if the deal is still Live and not ended. | MVP |
| RS-06 | **Cancellation by customer:** allowed until redeemed; stock released immediately; no penalty in MVP free flow beyond strike rules (RS-10). Cancellation cut-off `[CFG]`. | MVP |
| RS-07 | **Cancellation by merchant/DealDash:** merchant may cancel individual reservations with reason (e.g. stock/closed) → customer notified; frequent cancellations affect trust (HD-34). | MVP |
| RS-08 | **Extension** of hold: not supported in MVP. | P2 |
| RS-10 | **No-show:** a reservation that expires without redemption is marked `No-show` against the customer. Consequences (strike system, temporary reservation block, thresholds): **FDR-39**. Structure: `[CFG: noshow_strikes_threshold, noshow_block_days]`. | MVP structure |
| RS-11 | **Merchant inventory release:** units return to stock on expiry/cancel/no-show; stock cannot exceed original total; released stock after the deal end is discarded. | MVP |
| RS-12 | **Branch binding:** a reservation is valid at its chosen branch only (wrong-branch redemption is rejected, RD-20). | MVP |
| RS-13 | **Customer history:** customer sees active, redeemed, expired, cancelled reservations with times and branch. | MVP |
| RS-14 | **Merchant history:** merchant sees reservations for own branches: counts, status, code reference, redeemed time; **no customer personal data beyond first name/masked identifier** needed for service `[CFG]`. | MVP |
| RS-15 | **Audit events:** created, confirmed, extended (P2), cancelled (by whom), expired, no-show marked, redeemed, reversed, stock release, admin override. | MVP |
| RS-16 | One customer may hold at most `[CFG: max_active_reservations]` concurrent active reservations across deals (anti-hoarding). | MVP |
| RS-17 | Reservation requires the same eligibility as the deal at action time (EL-24). | MVP |

---

## 9. REDEMPTION

Applies to Vouchers, Exclusive Deal reservations, controlled Live Deals, and Watch & Earn merchant prizes. Staff flow: Scan → Validate → Redeem (Blueprint section 14).

| ID | Rule | Phase |
|---|---|---|
| RD-01 | **QR:** scanning the code (signed payload) identifies the instrument and returns validation. | MVP |
| RD-02 | **One-time code:** every instrument has a human-readable code that is single-use. | MVP |
| RD-03 | **Manual fallback:** staff can enter the code by hand; manual attempts are rate-limited per staff/device/branch `[CFG]` and logged. | MVP |
| RD-04 | **Staff validation:** only authenticated staff assigned to the merchant and branch can validate/redeem. | MVP |
| RD-05 | Validation returns one of: **Valid**, **Invalid**, **Expired**, **Already redeemed**, **Wrong branch**, **Not yet valid**, **Suspended/Refunded/Cancelled**, **Ineligible** (eligibility recheck failed). | MVP |
| RD-06 | **Redeem** requires an explicit confirm after Valid; validate alone does not consume. A validation "lock" holds the instrument for `[CFG: redeem_lock_seconds]` to avoid two staff redeeming simultaneously. | MVP |
| RD-07 | Redemption is atomic and idempotent (idempotency key per confirm tap); duplicate submissions return the original result. | MVP |
| RD-20 | **Branch validation:** redemption allowed only at the branches listed on the instrument. | MVP |
| RD-21 | **Duplicate redemption** attempts are rejected and logged with the original redemption details; repeated attempts raise a fraud flag (FR rules). | MVP |
| RD-22 | **Expired/invalid** results show clear reason; no state change. | MVP |
| RD-30 | **Eligibility at redemption (decided):** recheck eligibility only when the offer's own rules require current eligibility (e.g. a free restricted offer or reservation may be rechecked at redemption). A **voucher legitimately purchased while the customer was eligible stays valid through its stated validity** even if employer/card status later changes, unless the voucher terms explicitly say otherwise. **A paid customer instrument is never silently invalidated because eligibility changed**; any exception must be stated in the terms shown before purchase. | MVP |
| RD-31 | Redemption never releases a payment; financial events are posted by the ledger at the accrual point (ST rules). | MVP |
| RD-40 | **Reversal (decided):** frontline merchant staff **cannot** reverse a completed redemption. **Authorised Merchant Manager (Owner, Admin or Branch Manager by permission) and DealDash Admin roles** may reverse within a configurable window `[CFG: reversal_window_hours]`. A reason is required and the action is fully audit-logged. Reversal restores the instrument to Active (if still within validity) or issues refund per policy and reverses ledger postings (LG-05). | MVP |
| RD-41 | Staff may ask a manager to reverse; a **reversal-request queue** inside the portal is Phase 2 (in MVP managers reverse directly or contact DealDash support). Staff self-reversal is never allowed. | P2 (queue) |
| RD-50 | **Permissions:** Redemption Staff: validate, redeem, view own-branch recent history (**no reversal**). Branch Manager, Merchant Admin and Owner: history, reports and **reverse within the configurable window** (reason + audit). DealDash Support/Admin: lookup and reversal. No staff access to financial/settlement/billing/campaign creation. | MVP |
| RD-51 | **Audit trail:** every attempt (success or failure) logs instrument, result, staff, branch, device, time, location if permitted. | MVP |
| RD-52 | Redemption history is retained and visible to merchant/customer per role. Retention periods: **VK-15**. | MVP |
| RD-53 | Partial redemption/bill amount entry: **FDR-11**. | P2 |
| RD-54 | Offline/queued redemption when staff device has no connection: not supported at MVP. | P3 |
| RD-55 | Token credit: for reservations where a token is credited to the bill, the staff screen shall show the credited amount (design shows "token, credited to your bill"). Only relevant if deposits are enabled (conflict C-01). | P2 / FDR-06 |

---

## 10. PAYMENTS

Architecture: marketplace/platform using a **regulated payment service provider (PSP)**. Merchant of Record, legal treatment, licensing: **VK-16 / VK-05**. No conclusion made.

| ID | Rule | Phase |
|---|---|---|
| PY-01 | Payments are processed only by the PSP; DealDash never handles raw card data (hosted fields/redirect/SDK). | MVP |
| PY-02 | **Initiation:** payment is created for an order (voucher purchase; later deposits) in `Initiated` with amount in SAR halalas, order id, idempotency key, PSP reference once returned. | MVP |
| PY-03 | **Success:** only a verified PSP confirmation (webhook/server-verified) changes an order to `Paid`; client-side success callbacks are not trusted. | MVP |
| PY-04 | **Pending:** where the PSP reports pending/authorising/3-D Secure, the order is `Pending`; inventory hold continues up to the hold limit `[CFG]`; final status is set by PSP result or reconciliation. | MVP |
| PY-05 | **Failure:** failed/declined → order `Failed`; hold released; customer can retry. | MVP |
| PY-06 | **Retry:** customer may retry with the same or another method up to `[CFG: payment_retry_limit]` within the hold; each attempt has a unique PSP reference and idempotency key; duplicate captures are prevented. | MVP |
| PY-07 | **Cancellation:** customer cancels before payment completes → order `Cancelled`, hold released. Authorised-not-captured amounts are voided. | MVP |
| PY-08 | **Refund:** full refund to the original method via PSP; status `Refund Pending` → `Refunded`/`Refund Failed`. Failed refund: manual finance exception queue. | MVP |
| PY-09 | **Partial refund is Phase 2.** The payment/ledger model records refunds with an amount (so partial refunds need no redesign), but MVP exposes full refund only. | P2 |
| PY-10 | **Reversal:** void/reversal of an uncaptured authorisation; and ledger reversal entries for any posted financial event. | MVP |
| PY-11 | **PSP reference:** every payment/refund stores PSP transaction ids; DealDash order id is sent to the PSP as merchant reference. | MVP |
| PY-12 | **Reconciliation:** daily comparison of PSP reports to ledger by PSP reference/amount/status; mismatches create exceptions assigned to Finance; no silent auto-correction of money. | MVP (manual-assisted) / P2 (automated) |
| PY-13 | **Chargebacks/disputes** raised by PSP create a case, hold related merchant payable, and follow SP rules. Chargeback liability between DealDash and merchant: **FDR-42 / VK-16**. | MVP structure |
| PY-14 | **Merchant payable and DealDash fees** are computed by the settlement rules (section 11), not by the PSP layer. | MVP |
| PY-15 | Saved payment methods: tokenised card on file via PSP for faster checkout (design shows a saved Visa ending 4417). Allowed only as PSP tokens; customer can remove. Whether pilot includes saved methods and the interplay with card eligibility: **FDR-43 / VK-13**. | MVP / FDR |
| PY-16 | Supported payment methods at launch (mada, Visa, Mastercard, Apple Pay, STC Pay, etc.): depends on PSP selection: **FDR-44**. | MVP |
| PY-17 | Customer amounts are tax-inclusive/exclusive per VAT rules: **VK-03**. Receipts show required fields. | MVP |
| PY-18 | Payment events never expose card data in logs. | MVP |

---

## 11. SETTLEMENT

Lifecycle: **sale → merchant payable → adjustments → refund/reversal → settlement → reconciliation.** Final timing/economics are not hard-coded.

| ID | Rule | Phase |
|---|---|---|
| ST-01 | The financial event model supports: `sale`, `redemption`, `refund`, `platform_fee`, `merchant_payable`, `settlement`, `adjustment` (Blueprint 27). Events are append-only ledger entries with source object references. | MVP |
| ST-02 | **Accrual point (decided for MVP):** sale recorded immediately; merchant amount becomes **settlement-eligible on successful redemption**. The ledger records sale, redemption, refund and expiry events separately and keeps accrual point configurable for later change after VALIDATE-KSA. Redemption reversal returns the amount to "held". | MVP |
| ST-03 | **Platform fee:** configurable fee rules per merchant/product (percentage, fixed, tiered); effective-dated; versioned; stored on each accrual so later changes do not alter history. Values: **FDR-16**. | MVP structure |
| ST-04 | **Merchant payable** = eligible sales/redemptions − platform fees − refunds − chargebacks − deductions ± adjustments; computed per merchant per settlement period. | MVP |
| ST-05 | **Adjustments:** manual entries by Finance with reason, amount, reference, and (above threshold) a second approver (maker–checker). Thresholds: **FDR-45**. | MVP |
| ST-06 | **Refund/reversal impact:** refund before settlement reduces the open payable; after settlement it creates a negative payable carried forward or recovered `[CFG]`. Recovery method: **FDR-46**. | MVP |
| ST-07 | **Settlement cycle** (frequency, cut-off, delay after accrual), minimum payout, reserve/hold-back: **FDR-47**. Structure supports periodic batches. | MVP structure |
| ST-08 | **Statements:** each settlement produces a merchant statement listing items, fees, refunds, adjustments, net payout, with bilingual and tax fields per **VK-03**. | MVP |
| ST-09 | **Payout:** to the merchant's verified settlement bank account; MVP execution may be manual by Finance with approval; payout status `Pending`, `Paid`, `Failed`, `Returned`. | MVP / P2 (automated) |
| ST-10 | Payout bank account must be in the merchant legal entity's name; verification method: **FDR-48**. Bank detail change triggers re-review and a payout hold `[CFG]`. | MVP |
| ST-11 | **Reconciliation:** settlement totals reconcile to PSP settlements and bank movements; unreconciled items are flagged. | MVP |
| ST-12 | **Watch & Earn spend** is billed under campaign rules (WE-13, WE-43), invoiced/deducted per **FDR-20**; it is separate from voucher payable. Netting between voucher payables and campaign spend: **FDR-49**. | MVP structure |
| ST-13 | Fund holding between payment and payout: **VK-05**. | — |
| ST-14 | VAT on platform fees, merchant sales, vouchers and campaign spend, and e-invoicing: **VK-03**. | — |
| ST-15 | Merchant offboarding final settlement: **FDR-14 / FDR-50**. | MVP structure |
| ST-16 | Settlement disputes: merchant may dispute a statement within `[CFG: statement_dispute_days]`; handled as a case (section 18). | MVP |
| ST-17 | Partner-funded offers (bank/scheme funding discounts): invoicing and funding settlement | P2 (FDR-51) |
| ST-18 | All settlement actions are audit logged. | MVP |

### 11A. Financial ledger architecture requirements (confirmed)

The financial ledger is an **append-only, double-entry-style ledger** with accounts per merchant, per campaign budget, and platform accounts. The architecture shall support all of the following. **No fee percentage, payout frequency, minimum payout or other commercial value is hard-coded; all are configuration, effective-dated and versioned.**

| ID | Capability | Rule | Phase |
|---|---|---|---|
| LG-01 | **Configurable platform fees** | Fee rules (percentage, fixed, tiered, per merchant/product/category) stored as versioned configuration with effective dates; the applied rule version is stamped on each fee entry so later changes never alter history. | MVP |
| LG-02 | **Voucher sale** | A successful payment posts immediately: customer payment received (via PSP reference) → amount held for merchant (not yet payable). Inventory/order/voucher ids linked. | MVP |
| LG-03 | **Settlement-eligible on redemption (MVP)** | A successful redemption event moves the merchant's amount (net of platform fee computed at that point) from `held` to `settlement-eligible`. The accrual trigger is configurable (`payable_accrual_point`) so it can later move to sale or hybrid after VALIDATE-KSA without schema change. | MVP |
| LG-04 | **Refund** | A full refund before redemption reverses the held amount and returns funds to the customer via PSP; fee never became payable. Refund after settlement-eligibility posts a negative against the merchant (LG-07). Partial refund is Phase 2 (entries already carry amounts). | MVP (full) / P2 (partial) |
| LG-05 | **Reversal** | Redemption reversal moves the amount back from `settlement-eligible` to `held` (if not yet paid out) or posts a recoverable negative (if paid). Payment reversal/void and chargeback entries are supported. Reversals are counter-entries, never edits. | MVP |
| LG-06 | **Adjustment** | Manual adjustments (credit/debit) by Finance with reason code, reference, approver (maker–checker above `[CFG: adjustment_threshold]`), linked to merchant/period; fully audited. | MVP |
| LG-07 | **Negative merchant balance carried forward** | If a merchant's settlement-eligible balance goes negative (refunds, reversals, chargebacks, adjustments, penalties), the negative balance is **carried forward** and netted against future settlement-eligible amounts; payout is withheld until the balance is non-negative. Recovery by other means (invoice, bank debit, offboarding recovery): **FOUNDER DECISION REQUIRED (FDR-46, P2) / VALIDATE-KSA**. | MVP (carry-forward) |
| LG-08 | **Campaign spend** | Watch & Earn: campaign budget funding posts to a **campaign budget account**; each billed qualified view posts a consumption entry (merchant charge, separate from customer reward); invalid-view credits post back. Charge per view comes from configurable rate cards (not tied to reward). | MVP |
| LG-09 | **Unused campaign balance** | At campaign end/cancel/suspension, the remaining funded balance is posted as a distinct `unused-campaign-balance` entry, **separately identifiable** (never merged into merchant payable). Its final treatment (refund/credit/retain) is configurable and **VALIDATE-KSA (VK-08)**; the ledger records whichever treatment later applies as further entries. | MVP structure |
| LG-10 | **Periodic merchant payouts** | Settlement runs create statements/payout batches from settlement-eligible balances on a **configurable schedule** (frequency, cut-off, minimum payout, reserve/hold-back are configuration; values are founder settings, FDR-47). Manual trigger by Finance also supported. Payout statuses Pending/Paid/Failed/Returned; failed payouts return the amount to eligible. | MVP |
| LG-11 | **Reconciliation** | PSP reports, ledger and bank payout files are matched by references/amounts/status; exceptions queue for Finance; no silent corrections; reconciliation status stored per payment, payout and period. | MVP (manual-assisted) / P2 (automated) |
| LG-12 | **Separation of concepts** | Merchant payable (vouchers), campaign budget (Watch & Earn), customer rewards (points ledger, non-cash) and platform revenue are separate account families; netting between them is a configurable settlement rule (FDR-49), never implicit. | MVP |
| LG-13 | **Immutability and traceability** | Every entry has id, timestamp (UTC), account, amount (SAR halalas, signed), currency, type, source object ids, PSP reference where relevant, actor, reason; no updates/deletes; entries balance per transaction; periodic trial-balance checks. | MVP |
| LG-14 | **Model neutrality** | The ledger must remain valid whichever Merchant-of-Record / voucher-fund model is finally chosen (VK-05, VK-16); accounts distinguish customer funds held, merchant amounts, DealDash revenue and PSP clearing. | MVP |
| LG-15 | **Tax fields** | Each fee/charge entry can carry tax code/amount fields so VAT treatment can be applied after validation (VK-03) without schema change. | MVP structure |

---

## 12. REWARDS

| ID | Rule | Phase |
|---|---|---|
| RW-01 | MVP rewards (DealDash points) are **non-cash, non-withdrawable, and non-transferable** between customers unless later approved. Customer terms must state it. Regulatory classification of points: **VK-17**. | MVP |
| RW-02 | **Reward account:** one per verified customer; holds `available`, `pending/held`, `lifetime earned`, `redeemed`, `expired`. Balance is derived from the ledger, never edited directly. | MVP |
| RW-03 | **Earn:** points are earned by Watch & Earn qualified views (MVP). Other sources (Play & Win, referral, promotions) are P2. Earn amount comes from DealDash rules only (WE-01). | MVP |
| RW-04 | **Append-only ledger:** entries `earn`, `hold`, `release`, `redeem`, `reverse`, `expire`, `adjust`, each with id, account, amount, source object (view/campaign/redemption), reason code, actor (system/user), timestamp, balance-after. No updates or deletes; corrections are counter-entries. | MVP |
| RW-05 | **Reversal:** fraudulent/invalid source → `reverse` entry; if points were already spent the balance may go negative or the spend is clawed back: **FDR-24**. | MVP |
| RW-06 | **Redeem:** customers redeem points against a **redemption catalogue** (design: "Redeem points", screens 49–50). **Catalogue contents, costs, stock and funding are configurable founder settings** (not hard-coded). Redemption is confirmed by the customer, atomically debits points and issues the item. | MVP |
| RW-07 | **No fixed SAR value per point is hard-coded.** Point valuation is a configurable founder setting; the customer UI shall not show a cash equivalent unless valuation is set and approved. | MVP |
| RW-08 | **Expiry** is a configurable founder setting (period/inactivity rule, notice, FIFO consumption); legal treatment **VALIDATE-KSA (VK-17)**. Structure: per-entry expiry date. | MVP structure |
| RW-09 | **Fraud hold:** earned points from risk-flagged accounts/views are placed on `hold` for review `[CFG: reward_hold_hours]`; released automatically if not flagged, or reversed. | MVP |
| RW-10 | **Adjustment:** manual credit/debit by authorised DealDash roles only; mandatory reason code and ticket reference; amounts above threshold need second approval `[CFG: adjustment_threshold]` (FDR-45); customer is notified. | MVP |
| RW-11 | **Admin permission:** Customer Support may request, Finance/Compliance-Risk/Super Admin may approve per matrix; no single user can both create and approve an adjustment above threshold. | MVP |
| RW-12 | **Audit:** every ledger entry and adjustment is auditable; liability reports (outstanding points) for Finance. | MVP |
| RW-13 | Caps: per-customer daily earn cap (WE-31), lifetime balance cap `[CFG]`. | MVP |
| RW-14 | Points have no value if the account is closed; deletion/closure handling: **VK-11 / FDR-55**. | MVP |
| RW-15 | Customer-facing "Points activity" (design screen 51) shows earn/redeem/expire/pending entries with reasons. | MVP |
| RW-16 | Merchant-funded prizes (WE-05) are not points; they are separate items allocated and redeemed per WE/RD rules. | MVP |
| RW-17 | Rewards expiring notification (NT rules). | MVP |

---

## 13. CAMPAIGN APPROVAL

Common governance model for Offers (Live/Hot), Vouchers, and Watch & Earn campaigns (Blueprint 19.2).

| ID | Rule | Phase |
|---|---|---|
| AP-01 | **Merchant first:** only merchants in `Active` status may create campaigns; draft creation by merchants in onboarding is not allowed. | MVP |
| AP-02 | Every campaign is evaluated by the **guardrails service** on submit and on material edit. Outcome: `Auto-publish`, `Manual review`, or `Reject` (hard rule violation). | MVP |
| AP-03 | Guardrails per product include: allowed mechanics, max discount %, price sanity, prohibited categories/terms/content, inventory/duration/budget limits, minimum content completeness (AR/EN), trust level, and risk flags. | MVP |
| AP-04 | **Standard campaigns** within guardrails from merchants with sufficient trust publish automatically. Default auto-publish set at pilot start: **FDR-56** (Blueprint FD-37, reduced to pilot defaults). | MVP |
| AP-05 | **Unusual/high-risk/flagged** campaigns require manual review: out-of-range discount, new merchant, sensitive category, new video content, large voucher inventory/high face value, large W&E budget, prior flags, edits after rejection. | MVP |
| AP-06 | **Pilot posture:** during the initial Riyadh pilot DealDash may route more campaigns (even whole products) to manual review through configuration, and relax gradually. | MVP |
| AP-07 | **DealDash can pause or suspend any campaign at any time** with a reason code. | MVP |
| AP-08 | Review SLA targets and queue ownership: **FDR-57** / CFG. | MVP |
| AP-09 | Reviewer decisions: `Approve`, `Reject` (final), `Request changes`. Reasons mandatory for reject/changes, bilingual template list. | MVP |
| AP-10 | Four-eyes: Super Admin/Operations/Merchant Management/Compliance can review; reviewers cannot review campaigns of a merchant they have a declared conflict with `[CFG]`. | MVP |
| AP-11 | Post-publish monitoring auto-pauses and opens a review when anomalies occur (sudden discount change, complaint spike, sell-through anomaly, fraud signal). | MVP |
| AP-12 | Merchant **trust level** (new/standard/trusted) is stored; promotion/demotion rules: **FDR-58**; structure CFG. | MVP structure |

### Status model (generic governance), per-product specialisations in section 22

| Status | Meaning | Allowed next |
|---|---|---|
| Draft | merchant editing | Submitted, Deleted |
| Submitted | received; guardrails run | Auto-published→Scheduled/Live, Under Review, Rejected(auto) |
| Under Review | awaiting human | Approved, Changes Requested, Rejected |
| Changes Requested | merchant must edit | Resubmitted→Submitted, Cancelled |
| Approved/Scheduled | approved, start in future | Live, Cancelled |
| Live | publicly available | Paused, Sold Out/Exhausted, Completed, Expired, Suspended, Cancelled |
| Paused | merchant or DealDash paused | Live, Suspended, Cancelled, Expired |
| Suspended | DealDash only, reason | Live (DealDash reinstates), Cancelled, Archived |
| Sold Out / Exhausted / Completed | inventory/budget finished | Archived |
| Expired | time ended | Archived |
| Cancelled | merchant ended early | Archived |
| Rejected | terminal; clone to draft allowed | Archived |
| Archived | read-only | — |

Rules: every transition records actor, timestamp, reason, source status; illegal transitions are rejected; Suspended can be left only by DealDash.

---

## 14. MERCHANT RULES

| ID | Rule | Phase |
|---|---|---|
| MR-01 | **Onboarding states:** Draft → Submitted → In Review → (Changes Requested ↔ Resubmitted) → Approved → Agreement Accepted → Activated; or Rejected. | MVP |
| MR-02 | Required: legal entity details, commercial registration/trade licence, tax registration where applicable, authorised representative and ID, email and mobile verification (OTP), category, ≥1 branch with location and hours, settlement bank details, branding/media, accepted DealDash commercial agreement. Document types and mandatory tax identifiers: **VK-18**. | MVP |
| MR-03 | **Risk-based onboarding model (decided for the Riyadh MVP).** Required before activation: legal/business name; Commercial Registration / trade licence and relevant business documents; authorised representative; verified mobile; verified email; merchant category; branch/location information; settlement bank/IBAN information; **DealDash admin review before activation**. DealDash admins must be able to **approve, reject, request additional information/documents, suspend, and require enhanced review for higher-risk merchants**. Exact Saudi KYB/document requirements: **VALIDATE-KSA (VK-18)**. | MVP |
| MR-03a | **Risk tiering:** each application gets a risk tier (standard / enhanced) from configurable criteria `[CFG: merchant_risk_criteria]` (e.g. category, expected volumes, document anomalies, representative mismatch, prior flags). Enhanced tier requires additional documents/checks and a second reviewer `[CFG]` before activation. Tier can be raised later (post-activation) and triggers re-review. | MVP |
| MR-03b | **Bank/IBAN:** IBAN format validated; account holder name must match the legal entity (verification method/tooling depends on PSP/bank options, FDR-48); any change re-opens review and holds payouts (MR-24). | MVP |
| MR-04 | **Approval** by Merchant Management (or Operations). Rejection requires reason; resubmission after rejection allowed per `[CFG]`. | MVP |
| MR-05 | **Activation** gives campaign-creation rights, staff invites, and settlement eligibility; before activation none of these are available. | MVP |
| MR-06 | **Merchant agreement (decided):** the MVP supports **electronic acceptance/signature** of the merchant agreement. Each acceptance records: **agreement version**, **authorised signatory** (name, role, identity reference), **merchant legal entity**, **date/time**, **acceptance status** (Pending / Accepted / Superseded / Revoked), and an **audit record** (IP/device, method). Where required, the platform can **store an executed agreement/document** (generated PDF or uploaded signed copy) immutably linked to the version and entity. New agreement versions require re-acceptance `[CFG]`; activation requires current-version acceptance by an authorised signatory. Exact Saudi legal/e-signature requirements: **VALIDATE-KSA (VK-19)**. | MVP |
| MR-10 | **Branches:** each branch has name (AR/EN), address, geo-point, phone, opening hours (incl. holiday overrides), status active/inactive. Adding a branch after activation is allowed without full re-review `[CFG]`; closing a branch triggers LD-55. | MVP |
| MR-11 | **MVP supports one legal merchant entity with multiple branches.** Multi-legal-entity groups/chains/franchises are **Phase 2** (the organisation model should leave room for a parent/group link). | MVP / P2 |
| MR-20 | **Staff and roles:** Owner, Admin, Marketing Manager, Finance, Branch Manager, Redemption Staff (Blueprint 17.1). Roles are permission bundles; branch scoping applies. Merchant must always have ≥1 active Owner. | MVP **Finance access is a separable, explicitly granted permission:** *Finance: view* (read-only) and *Finance: manage*; the Owner holds both; Admin does not receive finance access automatically. | MVP |
| MR-21 | **Invitation:** by Owner/Admin to email/mobile with role+branches; invite expires `[CFG]`; staff authentication method: **FDR-62**. | MVP |
| MR-22 | Deactivating a user revokes sessions immediately and is audit logged. | MVP |
| MR-23 | **Staff redemption permissions:** per RD-50; staff cannot see settlement, billing, bank details, campaign creation/editing. | MVP |
| MR-24 | Bank/settlement detail changes require Owner (or Owner+Admin per **FDR-63**), trigger DealDash re-review, and a payout hold. | MVP |
| MR-30 | **Campaign rights:** merchant may create campaigns only while Active and not restricted. DealDash may restrict by product (e.g. no Watch & Earn) or by trust level. | MVP |
| MR-31 | **Settlement rights:** payouts only for Active (or Offboarding) merchants with verified bank details and no unresolved holds. | MVP |
| MR-40 | **Suspension:** DealDash may suspend a merchant with reason. It **immediately prevents new campaigns, sales and reservations** (where applicable) and hides campaigns; settlement-eligible payouts are held `[CFG]`; merchant is notified. **Already purchased vouchers and confirmed reservations do not automatically disappear** (MR-42). Merchant can appeal via support. | MVP |
| MR-42 | **Resolution workflow (suspension and offboarding):** outstanding customer obligations (issued vouchers, confirmed reservations, unclaimed prizes) are tracked as a resolution queue controlled by admin (Merchant Management/Operations, Finance for refunds). Options per item: keep honouring, redirect to another branch, extend, refund (full, before redemption), cancel with notice. **Fraud/emergency cases may be handled through an explicit admin override** (reason mandatory, second approver `[CFG]`, audit logged). Customers are notified of outcomes. | MVP |
| MR-41 | **Reactivation:** by Merchant Management/Compliance after review; campaigns return per LD-54. | MVP |
| MR-50 | **Offboarding:** triggered by merchant request or DealDash termination. Steps: stop new sales/campaigns, run outstanding vouchers/reservations through the admin resolution workflow (MR-42), settle final payable (**FDR-50**), close staff access, retain records. Notice periods: **FDR-64 / VK-19**. | MVP structure |
| MR-51 | Merchant data retention after offboarding: **VK-15**. | — |
| MR-52 | **Reviews/ratings are in MVP** (design screens 19, 27, 36). **Report and moderation controls are required:** any user can report a review; DealDash moderators can hide/remove, with reason and audit; merchants can report a review to DealDash. **DECIDED (founder, FDC-05):** (a) **only signed-in DealDash customers may submit a review**; (b) a **"Verified" review indicator** may be shown **only when DealDash can evidence an eligible merchant interaction**: voucher redemption, a completed/redeemed Exclusive Deal reservation, a controlled-offer redemption, or another future DealDash-tracked merchant transaction; (c) **Watch & Earn viewing alone does NOT qualify** as a verified merchant experience; (d) reviews without a trackable merchant interaction may still be accepted as **normal community reviews** if moderation rules allow, and **must not be labelled Verified**; (e) review abuse, reporting and moderation remain under DealDash control; (f) frequency limits and merchant reply remain configurable `[CFG]`. The basic evidence-based Verified indicator is MVP; **advanced reputation management (scoring, response workflows, richer badge programmes, analytics) = Phase 2.** Legal requirements: **VALIDATE-KSA (VK-20)** (remains open). | MVP (basic) / P2 (advanced) |

---

## 15. PARTNER RULES

Partners: Banks/issuers, Card schemes, Employers. One Partner Portal architecture with module permissions.

### 15.1 Common rules

| ID | Rule | Phase |
|---|---|---|
| PR-01 | **Onboarding states:** Invited/Applied → Profile & documents → Users → Review → Agreement → Configured → Activated. Rejected/Suspended/Offboarded states exist. | MVP |
| PR-02 | DealDash Partner Management reviews and approves; no partner is visible to customers until Activated and configured. | MVP |
| PR-03 | **Users and roles:** Partner Admin, Partner Manager, Partner Analyst; bank also Card Product Manager. First admin verified by DealDash; subsequent users created by Partner Admin; MFA-ready. | MVP |
| PR-04 | **Eligibility configuration:** partner defines attributes (issuer/products/tiers/BIN ranges; scheme list; employer domains) within the formats DealDash supports. Changes are effective-dated and audited. | MVP |
| PR-05 | **Offers:** partner-targeted offers are Offers/Vouchers created by merchants (MVP) with partner eligibility; partner-created or partner-funded campaigns are Phase 2. In MVP, DealDash staff configure partner-funded offers on the partner's behalf. | MVP / P2 |
| PR-06 | **Participating merchants:** partner may see merchants running offers for its eligibility group; partner-initiated merchant invitation | MVP view / P2 invite |
| PR-07 | **Reporting:** aggregated by default (counts of eligible customers, impressions, saves, reservations, purchases, redemptions, spend, merchant participation). | MVP |
| PR-08 | **Small-cohort suppression is configurable:** aggregates below `[CFG: partner_min_cohort]` are suppressed or merged. **Initial pilot product setting = 10 customers** (a product setting only, **not a legal conclusion**); final threshold **subject to privacy validation (VK-12)**. | MVP |
| PR-09 | **No customer-level personal data** is shared with a partner unless (a) an approved legal basis exists, (b) customer consent where applicable, and (c) explicit DealDash permission for that partner and purpose; all such access is logged. Legal basis assessment: **VK-09 / VK-12**. | MVP (control exists, default off) |
| PR-10 | **Suspension:** DealDash may suspend a partner (reason): eligibility based offers pause, reports freeze, users blocked; customers notified where relevant. | MVP |
| PR-11 | **Offboarding:** wind-down of eligibility offers, revocation of partner-based attributes, handling of issued vouchers (**FDR-14**), data handling and export of the partner's own reports, contract notice: **VK-19**. | MVP structure |
| PR-12 | Partner funding of discounts and settlement/invoicing with partners: **FDR-51**. | P2 |
| PR-13 | Partner brand and logo use (Visa, Mastercard, mada, banks) needs written permission: **VK-21**. | MVP |

### 15.2 Bank / issuer-specific

| ID | Rule | Phase |
|---|---|---|
| PR-20 | Bank maintains **card products**, **tiers** and **BIN/IIN ranges** (BC-13); overlapping ranges across partners are rejected. | MVP |
| PR-21 | Public vs card-specific offers: banks may request card-specific offers be tagged to its products; merchant-funded vs bank-funded flag (funding handling P2). | MVP flag / P2 funding |
| PR-22 | Bank reporting: aggregates for its eligibility group; no cardholder identities; transaction-level data only if PSP/acquirer data sharing is separately agreed (**VK-12**). | MVP / P3 |

### 15.3 Card scheme-specific

| ID | Rule | Phase |
|---|---|---|
| PR-30 | Scheme profile, participating issuers, geographies, merchant programmes. | MVP (profile) / P2 (programmes) |
| PR-31 | Scheme-level reporting: aggregates, issuer-level only where permitted by contract/privacy: **FDR-66 / VK-12**. | MVP basic |
| PR-32 | Scheme-funded campaigns: P2. | P2 |

### 15.4 Employer-specific

| ID | Rule | Phase |
|---|---|---|
| PR-40 | Employer maintains approved email domains (EM-10) and employee-offer participation. | MVP |
| PR-41 | Employer reporting: count of verified employees (above cohort threshold), offer usage aggregates. No names or emails. | MVP |
| PR-42 | Employer cannot upload an employee database in MVP. | MVP |
| PR-43 | Employer-funded benefits/campaigns: P2. | P2 |

---

## 16. FRAUD / RISK

Decision vocabulary: **ALLOW**, **BLOCK**, **FLAG FOR REVIEW**. Additional action options attached to FLAG: hold rewards, throttle, require step-up verification. All thresholds are `[CFG]` unless stated; initial threshold values are an operations decision and not invented here.

| ID | Risk | ALLOW | FLAG FOR REVIEW | BLOCK | Phase |
|---|---|---|---|---|---|
| FR-01 | **Account duplication** (same person, several accounts) | Unique verified mobile, no device/link overlap | Same device/payment fingerprint/employer email across accounts; similar identity data | Mobile already registered; blocklisted device/identity | MVP |
| FR-02 | **OTP abuse** (SMS pumping, brute force) | Within per-number/IP/device rate limits | Burst across numbers from one device/IP; unusual country prefixes | Exceeded attempts/cooldown; blocklist | MVP |
| FR-03 | **Fake employer verification** | Domain matches, OTP success, unique mailbox | Many accounts same domain in short time; domain with unusually large claimed headcount; disposable-looking mailboxes | Non-approved domain; shared mailbox; mailbox already linked | MVP |
| FR-04 | **Card eligibility abuse** | Selection consistent with BIN metadata | BIN/issuer mismatch with declaration; many cards declared; repeated edits near offer launches | Invalid BIN format; blocklisted BIN usage patterns | MVP |
| FR-05 | **Voucher abuse** | Normal purchase velocity | High-velocity buying, refund-after-use patterns, bulk buying near expiry, gift/resale signals (P2) | Failed-payment spree; blocklisted account; chargeback abuser | MVP |
| FR-06 | **Duplicate redemption** | First valid redemption | Repeated attempts on one code; same code at several branches | Already redeemed (hard rule, always block) | MVP |
| FR-07 | **QR sharing/screenshots** | Normal scan | Same code scanned/attempted from multiple staff devices; scanning outside validity | Redeemed/expired code; code locked by another scan | MVP (rotating QR P2) |
| FR-08 | **Watch & Earn manipulation** | Qualified view per section 4 | View timeline anomalies; abnormal still-watching response times; many views per device | Emulator/bot signals; cap exceeded; invalid token | MVP |
| FR-09 | **Multi-account behaviour** | Single account per device | Account clusters sharing devices/IP/payment | Linked to previously banned account | MVP basic / P2 graph |
| FR-10 | **Suspicious reward earning** | Within caps | Earning at the daily cap every day; sudden spikes; instant redemption of all points | Reward farming rings; reversed-view abuse | MVP |
| FR-11 | **Merchant abuse** (fake deals, price inflation, self-dealing) | Passes guardrails | Discount outside norms; inflated "original price"; merchant staff redeeming own vouchers; unusual sell-through | Prohibited content; confirmed self-dealing | MVP |
| FR-12 | **Staff abuse** (fraudulent redemptions, bypass) | Normal pattern | Redemptions outside opening hours; bursts; staff redeeming many codes without matching customers present | Deactivated staff; credential sharing detected | MVP basic / P2 |
| FR-13 | **Refund abuse** | Within policy | Repeated refunds by one customer; refund after redemption claim | Refund beyond policy window | MVP |
| FR-14 | **Admin abuse** (internal) | Permitted action | Out-of-hours sensitive actions; many adjustments by one user; viewing excessive PII | Action without permission/second approver; deactivated user | MVP |
| FR-15 | **Account takeover** | Known device/session | New device + sensitive action | Repeated failed login/OTP, impossible travel | MVP |

| ID | Process rule | Phase |
|---|---|---|
| FR-30 | Every FLAG creates a review item with evidence, severity, SLA `[CFG]`, assignee. | MVP |
| FR-31 | Review outcomes: clear, warn, hold rewards, reverse rewards/views, restrict features, suspend account/merchant, ban device. | MVP |
| FR-32 | Customer appeal process for blocks/suspensions: **FDR-67**. | MVP structure |
| FR-33 | Risk signals retained only as needed; device fingerprinting consent/privacy basis: **VK-22**. | MVP |
| FR-34 | Blocks must never reveal detection logic to the user. | MVP |
| FR-35 | Rule changes by Compliance/Risk only and audit logged. | MVP |

---

## 17. NOTIFICATIONS

Channels: push, SMS, email, in-app. SMS is limited to OTP and critical items. Marketing needs separate consent `[VK-23 for PDPL/telecom marketing rules]`. All templates exist in Arabic and English.

| ID | Trigger | Recipient | Channels | Phase |
|---|---|---|---|---|
| NT-01 | OTP (mobile login, work email, sensitive actions) | Customer / User | SMS or email (transactional, always) | MVP |
| NT-02 | Customer onboarding complete / welcome | Customer | in-app, push | MVP |
| NT-03 | Merchant application received | Merchant | email, in-app | MVP |
| NT-04 | Merchant approved / rejected / changes requested / activated | Merchant | email, in-app | MVP |
| NT-05 | Partner approved/rejected/activated | Partner | email, in-app | MVP |
| NT-06 | Campaign approved / rejected / changes requested / auto-published / paused / suspended | Merchant | email, in-app | MVP |
| NT-07 | Reservation confirmed | Customer | push, in-app | MVP |
| NT-08 | Reservation expiring soon (e.g. 15 min left `[CFG]`) / expired / cancelled by merchant | Customer | push, in-app | MVP |
| NT-09 | Exclusive Deal ending soon / sold out | Customers who saved/reserved; opted-in nearby | push (frequency capped) | MVP |
| NT-10 | New reservation / reservation cancelled | Merchant (branch) | in-app, optional push | MVP |
| NT-11 | Voucher purchase success / receipt | Customer | push, email, in-app | MVP |
| NT-12 | Payment failed / pending | Customer | in-app, push | MVP |
| NT-13 | Voucher expiring (`[CFG: reminder days]`) / expired | Customer | push, in-app | MVP |
| NT-14 | Redemption success | Customer, Merchant (history) | push/in-app | MVP |
| NT-15 | Refund initiated / completed / failed | Customer | push, email, in-app | MVP |
| NT-16 | Watch & Earn reward earned / pending / reversed | Customer | in-app, push | MVP |
| NT-17 | Reward expiring / redeemed | Customer | in-app, push | MVP |
| NT-18 | W&E budget low / exhausted / campaign completed | Merchant | email, in-app | MVP |
| NT-19 | Voucher sold out / low stock | Merchant | in-app | MVP |
| NT-20 | Settlement statement ready / payout paid / payout failed | Merchant Finance | email, in-app | MVP |
| NT-21 | Support case created / updated / resolved | Customer, Merchant, Partner | in-app, email | MVP |
| NT-22 | Eligibility verified / expiring / expired / revoked | Customer | in-app, push | MVP |
| NT-23 | Fraud/review queue, failed payments, approval backlog | Internal | in-app, email | MVP |
| NT-24 | Staff invitation / access changes | Staff | SMS/email | MVP |
| NT-25 | Account security (new device, password/OTP change) | User | push, email | MVP |
| NT-30 | Marketing/promotional notifications | Customer (opt-in) | push, email | P2 (consent infrastructure MVP) |

Rules:

| ID | Rule | Phase |
|---|---|---|
| NT-40 | Transactional messages cannot be disabled; marketing requires explicit opt-in and easy opt-out. | MVP |
| NT-41 | Frequency caps and quiet hours: **FDR-68 / VK-23**; structure CFG. | MVP |
| NT-42 | Delivery logs stored (sent, delivered, failed) without message bodies containing sensitive data. | MVP |
| NT-43 | Language follows user's language preference; fallback English. | MVP |
| NT-44 | Notification content must not expose full code/PII on lock screen `[CFG]`. | MVP |

---

## 18. SUPPORT AND DISPUTES

| ID | Rule | Phase |
|---|---|---|
| SP-01 | **Case object:** id, type, requester (customer/merchant/partner), related objects (order, voucher, reservation, redemption, reward, campaign), category, priority, status, assignee, SLA timers, messages, internal notes, attachments, resolution code, timestamps. | MVP |
| SP-02 | **Case types:** customer case, merchant case, payment dispute, voucher dispute, redemption dispute, reward dispute, partner case, fraud-originated case, complaint about a merchant/customer. | MVP |
| SP-03 | **Statuses:** New → Triage → In Progress → Waiting on Requester / Waiting on Third Party (merchant/PSP) → Escalated → Resolved → Closed (reopen window `[CFG]`). | MVP |
| SP-04 | **Customer case:** raised in-app against an order/voucher/reservation/reward or generally. Agents see a masked 360 view. | MVP |
| SP-05 | **Merchant case:** raised in the Merchant Portal (campaign issue, settlement query, redemption dispute, technical). | MVP |
| SP-06 | **Payment dispute:** customer claims wrong/double charge or non-delivery; agent checks PSP status; refund per PY/FDR-13; PSP chargebacks create linked case, hold payable (PY-13). | MVP |
| SP-07 | **Voucher dispute:** cannot redeem/merchant refused/expired issue; evidence: voucher state, redemption attempts, merchant response; outcomes: re-validate, extend (if allowed), refund, merchant penalty. Extension authority: **FDR-69**. | MVP |
| SP-08 | **Redemption dispute:** "already redeemed" claims, wrong amount, staff misconduct; evidence: redemption log, staff/branch, timestamps; outcomes: reverse redemption (RD-40), refund, merchant warning. | MVP |
| SP-09 | **Reward dispute:** missing/removed points; evidence: view ledger, reward ledger; outcomes: release/credit/confirm reversal; adjustments follow RW-10. | MVP |
| SP-10 | **Partner case:** configuration, reporting, eligibility issues. | MVP |
| SP-11 | **Escalation:** Support → Team Lead → Finance/Compliance/Merchant Management by type and value thresholds; timers escalate automatically `[CFG]`. SLA targets by priority: **FDR-70**. | MVP |
| SP-12 | **Evidence:** attachments (images/documents), system-generated evidence snapshots, merchant responses; retained with the case. | MVP |
| SP-13 | **Resolution** requires a resolution code and, where money/points move, the linked ledger entries; the requester is notified. | MVP |
| SP-14 | **Agent authority limits:** refund and adjustment limits by role `[CFG]` (FDR-45); beyond limit requires approver. | MVP |
| SP-15 | **Merchant disputes DealDash decisions** (suspension, fee, rejected campaign): appeal case to Merchant Management with senior reviewer. | MVP |
| SP-16 | Support channels (in-app, email; phone/chat/WhatsApp): **FDR-71**. Arabic and English service coverage and hours: **FDR-71**. | MVP |
| SP-17 | Consumer complaint handling timelines and escalation to authorities: **VK-24**. | MVP |
| SP-18 | **Audit:** every case action, view of sensitive data, and resolution is logged (section 19). | MVP |
| SP-19 | Customer satisfaction survey. | P2 |

---

## 19. AUDIT / DATA

Principles: append-only, tamper-evident, who/what/when/where/why. Retention periods are not invented (**VK-15**).

### 19.1 Common audit record

Each record: event id, timestamp (UTC), actor type (customer/merchant user/staff/partner user/internal/system), actor id, organisation, role, action, object type + id, before/after (or hash for sensitive), reason code, source (portal/API/job), IP, device/session, request id, outcome.

### 19.2 Events that must be logged

| ID | Domain | Events | Phase |
|---|---|---|---|
| AU-01 | **Authentication** | login success/failure, logout, OTP sent/verified/failed, session revoke, password/PIN change, MFA enrol/challenge, lockout, new device | MVP |
| AU-02 | **Verification** | mobile/email verification, employer verification attempts/outcomes, document upload/review decisions, KYB result | MVP |
| AU-03 | **Eligibility** | attribute added/removed/verified/expired/revoked, card selections (no PAN), rule evaluation failures on disputes, partner eligibility rule/BIN/domain changes | MVP |
| AU-04 | **Campaigns** | create, edit (diff), submit, guardrail decision, review decision, publish, pause, resume, suspend, cancel, expire; W&E budget commit, targeting change, video change | MVP |
| AU-05 | **Payments** | initiation, PSP callbacks, status changes, retries, failures, reconciliation exceptions (PSP reference, no card data) | MVP |
| AU-06 | **Refunds** | request, approval, execution, failure, partial refund, chargeback events | MVP |
| AU-07 | **Vouchers** | product create/edit, inventory change, hold, purchase, activation, transfer (P2), expiry, void, extension | MVP |
| AU-08 | **Reservations & Redemption** | reservation lifecycle, redeem attempts (all outcomes), reversal, staff identity, branch, device | MVP |
| AU-09 | **Rewards** | every ledger entry, holds, releases, adjustments with approver, catalogue changes, rule changes | MVP |
| AU-10 | **Settlements** | statement generation, adjustments, approvals, payout batches, bank detail changes, fee rule changes | MVP |
| AU-11 | **Admin changes** | user/role/permission changes, config changes (fees, reward rates, caps, guardrails, feature flags), exports, sensitive data views, impersonation if any | MVP |
| AU-12 | **Merchant changes** | profile, legal details, bank details, branches, users/roles, agreement acceptance, status changes | MVP |
| AU-13 | **Partner changes** | profile, users/roles, configuration (BIN ranges, domains, tiers), agreement, status changes, report access | MVP |
| AU-14 | **Privacy** | consent grants/withdrawals, data export/deletion requests, partner data-sharing permissions and accesses | MVP |
| AU-15 | **Risk** | flags, decisions, blocks, appeals | MVP |

### 19.3 Rules

| ID | Rule | Phase |
|---|---|---|
| AU-20 | Audit store is append-only; no user (including Super Admin) can edit or delete records; corrections are new records. | MVP |
| AU-21 | Access to audit logs limited to Super Admin and Compliance/Risk (read); queries themselves are logged. | MVP |
| AU-22 | Logs never contain full PAN, CVV, OTP values, passwords or tokens. | MVP |
| AU-23 | Financial and rewards ledgers are separate append-only stores in addition to audit. | MVP |
| AU-24 | **Data retention periods** (audit, ledger, KYC documents, communications, device data, video views): **not decided; VK-15**. System must support configurable per-class retention and legal hold. | MVP structure |
| AU-25 | Customer data rights (access/export/correction/deletion): MVP supports requests and processing workflow; legal obligations and exceptions (financial records retention vs deletion): **VK-11**. | MVP |
| AU-26 | Data residency/hosting location and cross-border transfer constraints: **VK-25**. | MVP decision |
| AU-27 | Customer-visible security activity history. | P2 |
| AU-30 | **Customer authentication:** mobile number + OTP is the primary and only customer sign-in method in MVP. **Google and Apple sign-in are Phase 2.** The identity model must allow linking additional sign-in providers later without account migration. | MVP / P2 |
| AU-31 | **Age:** the controlled Riyadh pilot is for customers **aged 18 or over**. Date of birth is collected at onboarding and used to enforce this; under-18 sign-ups are blocked. Any minor/youth proposition is outside this MVP and requires separate legal/product review (VK-06). | MVP |
| AU-28 | Tamper evidence (hash chaining) for audit and ledgers. | MVP / CFG |

---

## 20. OUTPUT

## 21. Complete rules catalogue

Sections 1 to 19 above are the catalogue (about 330 rules, each phase-tagged). Index of scope by phase:

- **MVP:** all four products (Live, Hot with free reservation, Vouchers, Watch & Earn), eligibility (public, geography, issuer/card selection, limited BIN, employer, segment), reservation/redemption, PSP-backed payments, ledgers, settlement structure, rewards (non-cash), guardrails-based approval, merchant/partner/admin governance, fraud controls, notifications, support, audit.
- **P2:** Exclusive Deal deposits, gifting/transfer, partial redemption, promo codes (if confirmed), partner-funded campaigns and invoicing, automated reconciliation/payout, visit verification, reversal-request workflow, rotating QR, marketing notifications, extended reservation holds, Play & Win rewards sources.
- **P3:** issuer/token card verification, card-linked offers, offline redemption, advanced fraud graph, POS integration.

## 22. State / status models

**Live Deal:** Draft → Submitted → (Under Review ↔ Changes Requested) → Approved/Scheduled → Live ↔ Paused → Expired | Cancelled | Suspended → Archived. Controlled mode adds Claim states: Claimed → Redeemed | Expired | Cancelled.

**Exclusive Deal:** Draft → (Auto-publish | Under Review) → Live ↔ Paused → Sold Out | Expired | Cancelled | Suspended → Archived.
**Reservation:** Reserved → Redeemed | Expired(No-show) | Cancelled(customer) | Cancelled(merchant/DealDash). P2: Pending Payment → Confirmed → …; Refunded/Forfeited.

**Voucher product:** Draft → Submitted → (Under Review) → On Sale ↔ Paused → Sold Out | Ended | Suspended → Archived.
**Voucher instance:** Pending Payment → Active → Redeemed | Expired | Refunded | Voided; Active → Reversed-to-Active (redemption reversal). P2: Gifted/Transferred.

**Watch & Earn campaign:** Draft → Submitted → (moderation/guardrails) → Approved → Funded/Committed → Scheduled → Live ↔ Paused → Completed | Expired(under-delivered) | Suspended | Cancelled → Reconciled → Archived.
**View record:** Started → (Checks passed) → Qualified | Invalid(reason) | Capped; Qualified → Billed; Billed → Credited back (invalid after review).
**Reward ledger entry:** Pending/Held → Released(Available) → Redeemed | Expired | Reversed.

**Payment/Order:** Initiated → Pending → Paid | Failed | Cancelled; Paid → Partially Refunded | Refund Pending → Refunded | Refund Failed; Paid → Disputed(Chargeback) → Won | Lost.

**Settlement:** Accrued → Included in Statement → Approved → Payout Pending → Paid | Failed | Returned; Adjustments/Disputes branch.

**Eligibility attribute:** Not declared → Pending → Verified → Re-verification due → Expired; Failed; Revoked.

**Merchant:** Draft → Submitted → In Review → Changes Requested ↔ Resubmitted → Approved → Agreement Accepted → Activated ↔ Suspended → Offboarding → Offboarded; or Rejected.
**Partner:** Invited/Applied → In Review → Approved → Configured → Activated ↔ Suspended → Offboarded; or Rejected.
**Staff/User:** Invited → Active ↔ Deactivated.
**Case:** New → Triage → In Progress ↔ Waiting → Escalated → Resolved → Closed (→ Reopened).
**Redemption attempt result:** Valid → Redeemed | Reversed; or Invalid / Expired / Already redeemed / Wrong branch / Not yet valid / Suspended / Ineligible.

## 23. Rule conflicts and gaps

**v0.2 status:** C-01 (deposit), C-02 (gifting), C-03 (Play & Win), C-04 (mada), C-05 (last 4), C-06 (verify wording), C-07 (Google sign-in), C-15, C-16 (partly), C-18, C-19 are **resolved by founder decision**; the design changes they imply are recorded for UX Architecture in section 23A. Remaining open items: C-08, C-09 (P2 only), C-10 to C-14, C-17, C-20 to C-22.

### 23A. Design changes recorded for UX Architecture (design is not edited now)

| # | Screen(s) | Required change / handling |
|---|---|---|
| UX-01 | 20 Deal - Hot limited reserve; 26 Deal - Reserve sheet; (also 31 reservation code if it shows a token) | Change **"Pay SAR 15 and reserve"** / SAR 15 token credited to the bill into a **free reservation** for MVP. Preserve the paid-token version as a **Phase 2 reference**, not deleted. |
| UX-02 | 56 Profile - add card sheet; 57 verify card sheet; any "verified card" labels | Remove **First 6 + Last 4** entry; replace with issuer/card-product selection plus limited BIN/IIN metadata only where needed. Replace "verify card" wording with non-verification language (BC-04). |
| UX-03 | 28–30 Checkout (gift with promo, gift voucher card) | **Gift checkout stays Phase 2**; hide from MVP navigation; preserve designs as future reference. Promo field scope open (FDR-10). |
| UX-04 | 38 Play and Win; 42–47 games | **Play & Win stays Phase 2**; preserve designs as future reference. |
| UX-05 | 55 Profile ("Signed in with Google"); 01 Sign in | MVP sign-in is **mobile OTP only**; Google/Apple = Phase 2; keep provider buttons as future reference. |
| UX-06 | 10, 13, 23, 56 (card/scheme lists) | Scheme/network list is configurable; include **Visa, Mastercard, Amex, mada**. |
| UX-07 | Onboarding / DOB screens | Enforce 18+ via date of birth. |
| UX-08 | 19 Reviews, 27 Write a review, 36 Merchant reviews | Add **report/moderation** entry points. |
| UX-09 | Orange/amber use (hot gradient, instant badge) | Review against avoid-orange principle (C-08). |
| UX-10 | 26 / 20 Hot screens | Show per-branch stock ("left at this branch") (HD-07). |
| UX-11 | 37, 39–41 Watch & Earn | Do not display cash-equivalent point values (RW-07); any "pts" amounts are placeholders pending configuration. |

| # | Conflict / gap | Detail | Needed |
|---|---|---|---|
| C-01 | **Designed Exclusive Deal flow includes a paid deposit.** Screens 20 and 26 show "Reserve for SAR 15", "Pay SAR 15 and reserve", SAR 15 token credited to the bill, valid 1 hour, up to 2 per customer, 120 left. Approved scope: free reservation MVP, deposit P2. | Either (a) change the design to free reservation for MVP, (b) approve deposits for the pilot (then PY/RS/ST/VK-02 move to MVP), or (c) ship both modes with deposit off by default. | FDR-06 |
| C-02 | **Gift checkout designed (screens 29–30)** but gifting/transfer is P2 (VC-13). | Hide or defer; wording on promo/gift in checkout. | FDR-09, FDR-10 |
| C-03 | **Play & Win screens 38, 42–47** are designed but P2. Reward sources in MVP are only Watch & Earn. | Exclude from MVP build; keep navigation consistent. | confirm P2 |
| C-04 | **mada** is shown as a card scheme in the design but the approved blueprint names Visa/Mastercard/Amex. | Add mada as a first-class scheme; PSP and partner scheme implications. | FDR-35, VK-14 |
| C-05 | **First 6 + last 4 digits** captured in the Add Card sheet vs approved "limited BIN/IIN metadata". Last 4 is extra and combined with first 6 is more sensitive. | Decide whether last 4 is needed; verify against PCI/SAMA/PSP rules. | FDR-34, VK-13 |
| C-06 | **Offline card-use proof**: design implies cards are "verified" (screen 57 "verify card"); Blueprint forbids claiming proof. | Verify-card wording must say matching to offers, not proving use. | UX stage |
| C-07 | **Signed in with Google** shown on profile; blueprint onboarding is mobile OTP. | Decide sign-in methods (Google/Apple/phone) and how mobile verification is enforced. | FDR-72 |
| C-08 | **Orange/amber** in hot-gradient and instant badge vs design principle "avoid orange-heavy". | Visual only; settle in UX stage. | UX stage |
| C-09 | **Exclusive Deal "token credited to bill"** needs merchant till-level crediting that DealDash cannot verify; reliance on staff. | Applies only if deposits are enabled. | FDR-06 |
| C-10 | **Controlled Live Deal vs per-customer limits**: General deals cannot enforce limits; merchants may expect limits. | Communicate in merchant UI; offer Controlled when limits are needed. | wording |
| C-11 | **Live Deal ROI** remains discovery-only for General deals; merchant success metrics must be set honestly. | Merchant reporting language and expectations. | UX/commercial |
| C-12 | **Reward value vs W&E pricing:** card shows "+15 pts" and "Watch to earn up to 20 points" without economics. | CPV, point value and margin undecided. | FDR-17, FDR-53 |
| C-13 | **Merchant prize inventory** vs voucher/redemption: how prizes are validated at the venue (code type, branch). | Prize uses redemption rules; prize allocation undecided. | FDR-19 |
| C-14 | **Merchant stricter frequency vs inventory of prizes:** fairness between customers when prizes are scarce. | Allocation mechanic. | FDR-19 |
| C-15 | **Suspension vs issued vouchers/reservations:** policy suspension and fraud suspension are treated differently. | Define honour/refund path. | FDR-07, FDR-14 |
| C-16 | **Reservation and eligibility changes:** removed attribute vs issued reservation. | Default honour unless terms require. | FDR-40 |
| C-17 | **Employer leaver handling** cannot be automatic. | Periodic reverification only in MVP. | FDR-28, FDR-32 |
| C-18 | **Reviews:** unrestricted reviews invite fake reviews and legal exposure. | Review eligibility and moderation. | FDR-65, VK-20 |
| C-19 | **Customer age/minors:** age data collected but rules for under-18 are undefined. | Age gating for W&E, payments. | FDR-27, VK-06 |
| C-20 | **Netting** voucher payables and W&E spend is undefined. | Finance policy. | FDR-49 |
| C-21 | **Support language/hours** undefined for a bilingual launch. | Staffing. | FDR-71 |
| C-22 | **Partner offers in MVP are created by merchants/DealDash staff**, not by partners; partners may expect self-service. | Expectation setting with pilot partners. | commercial |

## 24. FOUNDER DECISION REQUIRED items

Grouped; **bold = blocks technical architecture or the next stage (see section 27).**

**Commerce & money**
- ~~FDR-06~~ CLOSED v0.2: free reservation only in MVP; deposit = Phase 2.
- ~~FDR-15~~ CLOSED v0.2: settlement-eligible on redemption (MVP); ledger flexible.
- ~~FDR-16~~ STRUCTURE CLOSED v0.2.1: fees configurable and versioned (LG-01); values remain founder settings.
- ~~FDR-47~~ STRUCTURE CLOSED v0.2.1: payout schedule configurable (LG-10); values remain founder settings.
- FDR-45 Maker–checker and approval thresholds (adjustments, refunds, payouts).
- ~~FDR-46~~ PARTLY CLOSED v0.2.1: negative balance carried forward (LG-07); other recovery methods P2.
- FDR-48 Bank account verification method.
- FDR-49 Netting between voucher payables and campaign spend.
- FDR-50 Merchant final settlement rules on offboarding.
- FDR-51 Partner-funded discount settlement and invoicing (P2).
- ~~FDR-13~~ PARTLY CLOSED v0.2: full refund before redemption in MVP; window configurable + VALIDATE-KSA; partial refund = Phase 2.
- ~~FDR-12~~ RECLASSIFIED v0.2: not decided; configurable + VALIDATE-KSA (VK-04).
- ~~FDR-11~~ CLOSED v0.2: partial redemption = Phase 2.
- ~~FDR-14~~ CLOSED v0.2: admin resolution workflow (MR-42).
- ~~FDR-09~~ CLOSED v0.2: gifting = Phase 2.
- ~~FDR-10~~ CLOSED v0.2.2: promo codes = Phase 2.
- FDR-42 Chargeback liability between DealDash and merchant.
- FDR-43 Saved payment methods in pilot.
- FDR-44 Supported payment methods at launch (PSP-dependent).

**Watch & Earn and rewards**
- ~~FDR-17~~ STRUCTURE CLOSED v0.2: CPV and reward economics separate and configurable; values remain founder settings.
- ~~FDR-21~~ CLOSED v0.2: thresholds configurable.
- ~~FDR-22~~ CLOSED v0.2: configurable.
- ~~FDR-23~~ CLOSED v0.2: configurable.
- FDR-18 Targeting dimensions permitted (age/gender/interests).
- FDR-19 Merchant prize allocation mechanic.
- ~~FDR-20~~ CLOSED v0.2: campaigns pre-funded.
- FDR-24 Reward reversal when points already spent.
- ~~FDR-25~~ CLOSED v0.2: cannot exceed funded budget.
- ~~FDR-26~~ RECLASSIFIED v0.2: configurable + VALIDATE-KSA (VK-08).
- ~~FDR-27~~ CLOSED v0.2: pilot is 18+.
- ~~FDR-52~~ STRUCTURE CLOSED v0.2: catalogue configurable founder setting.
- ~~FDR-53~~ STRUCTURE CLOSED v0.2: no fixed SAR per point; configurable.
- ~~FDR-54~~ STRUCTURE CLOSED v0.2: expiry configurable founder setting (VK-17).
- FDR-55 Points on account closure.

**Reservations & operations**
- ~~FDR-38~~ CLOSED v0.2.2: hold configurable; default 30 minutes.
- ~~FDR-39~~ CLOSED v0.2.2: configurable strikes; default 3 confirmed no-shows then temporary restriction; no automatic permanent ban.
- ~~FDR-05~~ CLOSED v0.2: per-branch inventory in MVP; pooled = Phase 2.
- ~~FDR-07~~ CLOSED v0.2: instruments not auto-removed; admin resolution workflow.
- FDR-08 Merchant penalties for cancelling live deals.
- ~~FDR-40~~ CLOSED v0.2.3: recheck only where offer rules require; paid vouchers stay valid (RD-30).
- ~~FDR-41~~ CLOSED v0.2.3: staff cannot reverse; Merchant Manager and DealDash Admin within configurable window (RD-40).
- FDR-04 Whether to pursue visit verification for Live Deals (P2).
- FDR-02 Offer stacking policy.
- ~~FDR-03~~ CLOSED v0.2.2: locked only if a realistic unlock path exists; otherwise not shown.
- ~~FDR-01~~ CLOSED v0.2.2: both Arabic and English required before production publication; ops can help translate.

**Eligibility & partners**
- ~~FDR-28~~ CLOSED v0.2: periodic reverification; period configurable.
- FDR-30 Multiple employers per customer.
- FDR-31 Employer domain ownership proof method.
- FDR-32 Employer leaver signal (P2).
- ~~FDR-34~~ CLOSED v0.2: no last-4 collection in MVP.
- ~~FDR-35~~ CLOSED v0.2: configurable list; Visa, Mastercard, Amex, mada.
- ~~FDR-36~~ CLOSED v0.2.2: card-restricted vouchers = Phase 2 unless a launch partner requires.
- FDR-37 Membership types (wallet/insurance/student) in MVP or P2.
- ~~FDR-33~~ CLOSED v0.2: configurable; pilot setting 10 (privacy validation VK-12).
- FDR-29 Feed ranking and sponsored placement.
- FDR-66 Scheme issuer-level reporting scope.

**Merchant/Admin governance**
- FDR-56 Pilot auto-publish vs manual review defaults.
- FDR-57 Review SLAs/queue ownership.
- FDR-58 Trust-level promotion/demotion rules.
- ~~FDR-59~~ CLOSED v0.2.1: risk-based onboarding (MR-03); exact KYB = VK-18.
- ~~FDR-60~~ CLOSED v0.2.1: e-acceptance/signature (MR-06); exact rules = VK-19.
- ~~FDR-61~~ CLOSED v0.2: single legal entity in MVP.
- ~~FDR-62~~ CLOSED v0.2.3: staff OTP login on mobile-first PWA.
- FDR-63 Who may change bank details (Owner only vs Owner+Admin).
- FDR-64 Offboarding notice periods.
- ~~FDR-65~~ CLOSED v0.2: reviews in MVP with report/moderation.

**Support/risk/notifications**
- FDR-67 Customer appeal process for fraud actions.
- FDR-68 Notification caps/quiet hours.
- FDR-69 Authority to extend voucher validity.
- FDR-70 Support SLAs.
- FDR-71 Support channels, languages and hours.
- ~~FDR-72~~ CLOSED v0.2: mobile OTP only; Google/Apple = Phase 2.

## 25. VALIDATE-KSA items

| ID | Topic | Related rules |
|---|---|---|
| VK-01 | Price/savings claim and advertising truthfulness rules | LD-18 |
| VK-02 | Legal nature of deposits/tokens on reservations (if enabled) | HD-21 |
| VK-03 | VAT treatment, tax invoice/e-invoicing format, tax on fees/vouchers/campaign spend, receipts | VC-02, VC-16, PY-17, ST-08, ST-14 |
| VK-04 | Voucher validity minimums, expiry, refund and consumer protection rights | VC-04, VC-33, VC-36 |
| VK-05 | Treatment and holding of voucher funds (escrow/segregation), payment-licensing implications | VC-42, ST-13 |
| VK-06 | Use of age/gender and other personal attributes for targeting/segmentation; minors | WE-04, WE-63, EL-06 |
| VK-07 | Advertising/content rules for video (AR/EN), restricted categories, sponsored labelling | WE-12, WE-64 |
| VK-08 | Treatment of unused prepaid advertising budget | WE-54 |
| VK-09 | Legal basis for any customer-level sharing with partners/employers | EL-07, EM-21, PR-09 |
| VK-10 | Rules on sponsored/paid ranking disclosure | EL-22 |
| VK-11 | Personal data protection law: minimisation, work-email handling, deletion vs financial record retention, data subject rights | EM-05, AU-25, RW-14 |
| VK-12 | Aggregation/anonymisation standards and cohort thresholds for partner reports | PR-08, PR-22, PR-31 |
| VK-13 | Card data handling: first-6/last-4 storage, PCI scope, central bank/SAMA and PSP requirements, saved cards | BC-02, PY-15 |
| VK-14 | Use of mada/Visa/Mastercard marks and scheme rules | BC-08 |
| VK-15 | Retention periods for audit, financial, KYC, communications, device and redemption data | AU-24, RD-52, MR-51 |
| VK-16 | Merchant-of-Record model, PSP licensing, chargeback responsibility | PY, PY-13 |
| VK-17 | Legal classification of rewards points/loyalty, expiry rules | RW-01, RW-08 |
| VK-18 | Merchant onboarding documents, commercial registration, tax IDs, KYB/sanctions obligations | MR-02, MR-03 |
| VK-19 | Contract/e-signature validity, offboarding notice and termination | MR-06, MR-50, PR-11 |
| VK-20 | Review/rating legal requirements, defamation, moderation | MR-52 |
| VK-21 | Brand/logo usage permissions (banks, schemes, merchants) | PR-13 |
| VK-22 | Consent and legal basis for device fingerprinting and fraud profiling | FR-33 |
| VK-23 | Marketing communications consent, SMS/push rules, quiet hours | NT, NT-41 |
| VK-24 | Consumer complaint-handling timelines and regulator escalation | SP-17 |
| VK-25 | Data residency, hosting location, cross-border transfers | AU-26 |

## 26. Decisions that can safely remain configurable during development

All as parameters with admin-editable (audited) values; no schema/architecture change needed when decided: impression thresholds; live-deal reconfirmation days; material-field lists; max hot-deal duration/per-customer cap/remaining-count display; reservation hold minutes, grace, cancellation cut-off, no-show strike thresholds/blocks, max active reservations; voucher checkout hold, min validity, per-customer caps, expiry reminder days; OTP TTL/attempts/cooldowns; qualifying-view thresholds, still-watching policy, resume grace, caps, device limits, reward hold hours, instant-reward risk threshold; employer/card reverification periods; blocked email local parts/domains; redeem lock seconds; reversal window; payment retry limit; statement dispute days; guardrail limits and trust thresholds; pilot auto-publish matrix; notification triggers, reminder timings, frequency caps; case SLAs and escalation timers; fee rules values; reward rates and caps; enabled cities; targeting dimensions; scheme list; card-entry limits.

## 27. Rules that must be fixed before UX / database / technical architecture (v0.2, after founder decisions)

Most previously blocking items are now closed (see the decisions table at the top). Remaining items that genuinely block UX Architecture or technical architecture:

**Blocks UX Architecture** *(v0.2.2: items 1, 3, 4, 5, 6, 7 below are now CLOSED by founder decisions; item 2 (FDR-37, memberships) remains assumed card-only. No FOUNDER DECISION REQUIRED item blocks portal wireframing.)*
1. **FDR-36** Card-restricted vouchers in the pilot: decides whether any card-payment-required checkout flow exists in MVP screens.
2. **FDR-37** Membership types (wallet/insurance/student): decides whether the Add Card/Membership sheet is card-only or multi-type in MVP.
3. **FDR-10** Promo codes at checkout (design has a promo field): in or out for MVP.
4. **FDR-03** Locked-visible vs hidden for ineligible offers (affects every offer card).
5. **FDR-01** Arabic/English content completeness rule (affects merchant creation forms and fallback display).
6. **FDR-38** Reservation hold length (shown on reservation screens; design shows 1 hour).
7. **FDR-39** No-show consequence model (customer-facing warning and block messaging).

**Blocks technical architecture (data model / ledger / security)**
8. ~~Ledger structure~~ **CLOSED v0.2.1:** ledger architecture confirmed in section 11A (LG-01 to LG-15): configurable fees, voucher sale, settlement-eligible on redemption, refund, reversal, adjustment, negative-balance carry-forward, campaign spend, unused campaign balance, periodic payouts, reconciliation. Commercial values remain configurable.
9. **FDR-41** Who may reverse a redemption (permission model) and window (configurable).
10. **FDR-40** Eligibility recheck default at redemption (affects redemption validation logic).
11. **FDR-62** Staff authentication method (mobile OTP vs PIN vs password) for the Staff app.
12. **FDR-29 / FDR-35 reference data** Feed ranking approach at MVP (rules-based) so search/index design is fixed.
13. ~~FDR-59 / FDR-60~~ **CLOSED v0.2.1:** risk-based merchant onboarding (MR-03, MR-03a, MR-03b) and electronic agreement acceptance/signature with version, signatory, entity, timestamp, status and audit (MR-06). Exact Saudi KYB/document and e-signature requirements remain VALIDATE-KSA (VK-18, VK-19).

**Do not block (model-neutral design handles them):** VK-16, VK-05 (payment model, voucher funds), VK-04 (refund window, expired value), VK-08 (unused budget), VK-12 (cohort threshold final value), VK-13 (BIN storage scope), VK-15 (retention), VK-25 (hosting). They gate the PSP choice, final settlement design and production launch, not product definition.

— End of Business Rules v0.2 (founder decisions applied; draft for approval) —



---

## Addendum (Oct 2026) — Subscription, licensing & entitlement rules (FD-24 CLOSED)

Full specification: `SUBSCRIPTION_LICENSING_ENTITLEMENT.md`. Rules in force:

- SUB-01 The **Business Account** is the subscriber. A subscription / licence is a **Contract** of a commercial kind (merchant subscription,
  merchant enterprise, bank enterprise, scheme network licence, corporate partner, custom enterprise). Brands, regions, branches and units own
  no subscription. Partners are ordinary Business Accounts with their own legal entities and contracts; there is no sponsor-subscription concept.
- SUB-02 A **plan** is a reusable, versioned template; a published version never changes; a change is a new version published by a different
  person. A contract keeps the version it entered.
- SUB-03 Effective entitlement = plan default, **replaced** by a contract override, **plus** add-ons; effective-dated; the one authorization source.
- SUB-04 Billing party = the contract's billing legal entity, else its contracting legal entity, else the Business Account; never a brand or branch.
- SUB-05 Lifecycle: Draft, Pending activation, Trial, Active, Past due, Suspended, Cancelled, Expired. Renewal is separate (auto, manual,
  non-renewing, renewal pending). Upgrade, downgrade, add-on, renewal, pricing, entitlement, market addition and extension are **amendments**.
- SUB-06 Starter is a genuine free plan. A trial is separate and becomes Starter only when configured; a paid post-trial plan waits for acceptance.
- SUB-07 A paid plan, an upgrade and a paid add-on require the authorised person's **acceptance**, recorded immutably with the pricing
  version and maximum exposure. Nothing is charged before acceptance.
- SUB-08 A downgrade is **blocked while usage exceeds the new limits**; nothing is deleted. A forced downgrade by DealDash needs a reason, is
  audited and restricts additions instead of deleting.
- SUB-09 Past due within grace: everything keeps working. Suspended / grace elapsed / financial hold / ended: **only new exposure** is
  refused (new paid campaigns, activations, branches and users beyond entitlement, premium / API operations, exposure-raising upgrades).
  **Never** blocked: redemption of issued vouchers and credentials, rewards, refunds, finance, invoices, history, fulfilment. Live prepaid
  campaigns continue by default; stricter treatment is configurable per plan / contract. Grace days are configuration.
- SUB-10 Limits are HARD (refuse) or SOFT (warn, overage charge, or require approval) with warning thresholds; resource counts, period usage
  and billable events are measured separately; usage and billing events are idempotent.
- SUB-11 Prices resolve: negotiated contract rate → promotion → plan version / price book → discount → waiver; every billing event retains
  its pricing version; indicative "from" references are never charged.
- SUB-12 Customer points funding, merchant reward commitments, sponsor / loyalty funding and customer subsidies are **not DealDash revenue**.
- SUB-13 DealDash-only changes (entitlement override, pricing, market addition, extension) and catalog publishing need a second DealDash person.
- SUB-14 Pakistan configuration (data): Starter PKR 0 (1 branch / 2 users), Growth PKR 4,999 / month (5 / 10), Business PKR 14,999 / month
  (25 / 50), Enterprise negotiated; bank, scheme and corporate licence figures and the product price book as in the specification.
- SUB-15 (founder, Oct 2026) A real pilot / production Business Account must have an explicit Merchant Plan or Enterprise Contract /
  Licence before commercial launch; the default plan is for development / test fixtures only.
- SUB-16 (founder, Oct 2026) Add-on prices are configurable / to be commercialized; none is set until explicitly approved.
- SUB-17 (founder, Oct 2026) An Exclusive Deal that starts immediately / as soon as approved stays commercially stable when re-saved or
  submitted; only a genuinely scheduled start or a commitment-raising change re-quotes. Product name: **Exclusive Deal** (never "Hot Deal").
- Status: **FOUNDER APPROVED AND FROZEN.**

## Addendum (Oct 2026) — Phase 4 / Phase 5 business rules (awaiting approval)

**Visibility**
- V1. Engagement (impression, view, click, save, direction request) is never a verified outcome; a click is never a sale, a direction
  request never a visit, an issued credential never a redemption. Enforced by a database CHECK on analytics events.
- V2. Analytics events are append-only and idempotent; a credited-back Watch view reduces qualified views and spend.
- V3. Reporting is filtered on the server by tenant, role, scope (branch / unit / campaign), legal entity and product entitlement. Grouping
  above branch (country, legal entity, brand, region, city) needs ADVANCED_REPORTING; grouping by business is DealDash only.
- V4. A target is an objective, never a guarantee. Forecasts are labelled FORECAST_ESTIMATE, carry a confidence and are not shown before
  10 % of the period has elapsed (configurable).
- V5. Each target milestone (default 25 / 50 / 75 / 90 / 100 %, custom allowed) alerts once. Behind-target alerts start after 25 % of the
  period.
- V6. One alert per code / subject / cooldown window. Organization rules override platform defaults. Recipients must be members; roles
  must belong to the organization type; rule scope objects must be the organization's own.
- V7. Preferences are personal (frequency, channels, mute); CRITICAL_ONLY never suppresses a critical alert; muting never hides anything
  from the team.
- V8. Unacknowledged alerts escalate by step; acknowledging or resolving stops escalation and closes the task.
- V9. An alert action only opens the normal screen; RBAC, scope, maker-checker, acceptance, finance approval and audit always apply.
  Viewers without the permission see the action as unavailable.
- V10. The support timeline never shows codes, tokens or full mobile numbers.

**Billing and finance**
- F1. The billed party is a legal entity (never a brand or branch); one billing account per organization, legal entity and currency,
  one default per currency.
- F2. Each billing event is collected exactly once: invoice, prepaid draw-down, netting from the merchant payable, or the campaign case.
- F3. Billing runs only draft; issuing is a Finance action. At or above the configured amount a second finance person approves.
- F4. Issued documents are immutable and never deleted; corrections are credit / debit / adjustment notes; only drafts are cancelled.
  A credit note never exceeds the invoice.
- F5. Tax follows country configuration; when not configured the document says so and no tax is invented.
- F6. Payments are in the account currency; excess stays as unallocated credit; over-allocation is refused.
- F7. When an account requires a PO, an invoice needs a valid PO with enough remaining value.
- F8. Credit exposure includes open receivables; no exposure above the approved credit, PO or funding.
- F9. No currency conversion without an approved exchange rate (maker-checker).
- F10. Expired, rejected or modification-requested quotations cannot be accepted; the economics are re-quoted as a new version.
- F11. Overdue invoices are reported in the financial status (grace with reasons). They block new exposure only when
  `finance.billing.overdueDrivesPastDue` is switched on. Customer rights, redemptions and records are never affected.
- F12. Write-off stays disabled until the statutory treatment is confirmed (VALIDATE-KSA).

**AI**
- A1. Agents use authorised tools that call existing services as the requesting person; no bypass of RBAC, scope, entitlement or rules.
- A2. Business agents need AI_COPILOT; customers need the customer assistant to be enabled.
- A3. MVP autonomy is at most L3 (execute after human approval); L4 is disabled; L5 is always refused.
- A4. The customer assistant never reserves, buys, pays, spends points or redeems; it recommends only offers the customer is eligible for
  and that are available now, and explains why; savings are only as stated by the merchant.
- A5. Merchant Growth plans are drafts: the objective is a target, nothing is published and no exposure is created.
- A6. Every number in an answer must come from a tool result; statements are labelled fact / trend / forecast / hypothesis /
  recommendation.
- A7. Every interaction, tool call, draft, approval, execution and refusal is audited; usage is metered but not priced.
- A8. Unsupported languages (e.g. Urdu) are answered in English with a note; no machine-translated financial text.

## Addendum (Oct 2026) — Market / country configuration rules (awaiting approval)

- MK1. The market (country), not the region, is the tax, currency, invoicing, payment, settlement, regulatory and launch authority.
- MK2. A market moves PLANNED → CONFIGURING → TESTING → PILOT → ACTIVE (SUSPENDED, CLOSED); CLOSED is terminal. PILOT and ACTIVE need the
  activation gate and a second administrator; ACTIVE needs every mandatory item configured and every blocking validation closed.
- MK3. New exposure (campaign submission / activation, Live Deal submission, AI assistants) needs both the market and the product open
  (PILOT / ACTIVE). Issued customer rights, redemptions, refunds and records are never affected by market or product status.
- MK4. A campaign belongs to exactly one market (its branches' country); a campaign spanning markets is refused.
- MK5. Tax comes only from the market's own approved, effective-dated rules; no fallback to another country. Documents keep the rule
  version they were issued with; approved rules are never edited.
- MK6. Pricing for one market never prices another: market-neutral and default pricing apply only where approved.
- MK7. No uncontrolled conversion: campaign funding is SAR-only until a ledger decision; other currencies are refused, not converted.
- MK8. Provider credentials are never stored in configuration (references only); mock adapters never satisfy launch readiness.
- MK9. Legal, tax and regulatory conclusions are never encoded as rules: they are validation items until a decision with evidence is
  recorded and approved. The §25 VALIDATE-KSA items (VK-01..VK-25) and the founder launch-readiness items now live in the market
  validation register (source preserved).
<!-- stage7-addendum -->
## Addendum (Oct 2026) — Stage 7 partner rules (awaiting approval)

- PR1. A partner is a Business Account with legal entities, markets, a contract and scoped roles; no separate partner identity.
- PR2. Partner type decides what is offered (configuration); the contract decides what is entitled; the market decides where.
- PR3. New partner exposure needs an ACTIVE partner; ACTIVE needs every mandatory readiness item and a second DealDash approver.
- PR4. Nobody grants more access than they hold; organization-level work needs an organization-wide grant.
- PR5. A referenced (network) merchant never gains Exclusive Deals, vouchers, Watch & Earn rewards, staff redemption, settlement or
  finance until it is registered, approved and enabled.
- PR6. Duplicates are suggested, never merged silently; only DealDash merges.
- PR7. A partner-created campaign runs at a registered, active merchant of the partner's network; Campaign Creator, Sponsor and
  Fulfilment Merchant stay separate roles; the fulfilment merchant approves its own obligations (DealDash never stands in); a partner
  only commits its own funding; a merchant can never change the creator.
- PR8. A partner benefit on a Live Deal keeps the deal public, is eligibility-controlled, is approved by the merchant then by DealDash
  (a different person), and is never counted as a redemption.
- PR9. Card data: BIN / IIN prefixes (6–8 digits) with issuer, scheme, product and tier only; never a card number or CVV; "verified"
  only with evidence from the verification method.
- PR10. Partner reporting is aggregate by default; no ROI is shown without revenue data.
- PR11. Partner ingestion: at least one qualifying partner feature AND the shared capability (BULK_IMPORT / API_ACCESS).

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

- PR12 (FD-S7-1). A partner may own a Watch & Earn budget as Sponsor / Funder: Campaign Creator, Sponsor / Funder and the merchant
  that holds the campaign (fulfilment / reward provider) are recorded separately; only the budget owner funds it; it needs an active
  partner, the WATCH product in its contract in the market, commercial acceptance by every party and DealDash review (never
  auto-published). DealDash sets customer points, qualification, fraud controls and reward rules; the partner cannot set points.
- PR13 (FD-S7-2). Partner-specific ingestion entitlements apply on the Partner Portal routes only; the frozen Phase 2 shared routes
  keep the shared permissions / capabilities.
- PR14 (FD-S7-3, refines PR9). A card issuer / product / tier / scheme attribute is VERIFIED only with a trusted verification source
  and evidence (database enforced); BIN / IIN metadata, customer selection or self-declaration is DECLARED, never VERIFIED. Rules may
  require VERIFIED or accept DECLARED. No full PAN, no CVV.
- PR15 (FD-S7-4). A partner Live Deal needs a confirmed publication right (DealDash-authorised feed, DealDash-approved import with a
  publication reference, or a manual entry DealDash confirmed); it keeps source, authority, external offer id, merchant source id,
  dates, eligibility, market, provenance, last sync and audit; it gives the merchant no Exclusive Deal, voucher, controlled redemption,
  staff, settlement or finance capability; public discovery stays frictionless and click / directions / referral are not redemption.
