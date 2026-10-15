# DEALDASH MASTER FUNCTIONAL BLUEPRINT

Version 0.2.2 · 2026-10-07 · **amended 2026-10-15 (founder): reservation commitment model**
Status: **APPROVED by founder as the current master functional blueprint (v0.2, with the clarifications below).** No application code exists yet.

## Founder decision 2026-10-15 — reservation commitment model (supersedes free-only reservation) — APPROVED 2026-10-15

A reservation is **not a free inventory hold by default**. Live Deals: no reservation. Vouchers: paid in app before issuance. Hot / Exclusive
Deals: reservation is optional per deal (default off); when on, the merchant chooses one commitment method — **full prepayment**,
**deposit** (refundable or non-refundable) or **card pre-authorisation** (logic + mock provider now; real provider deferred). **Free
reservation** only where admin policy explicitly allows it (development / testing). Policy: market default → category override → merchant
override (merchant > category > market). Money is collected for the merchant; DealDash keeps only its agreed commission / fee. Strikes
(3 no-shows / 30 days → 7-day block) apply to all reservations; admin can lift / reset. Existing free reservations stay valid until they
expire. Full rules: `DEALDASH_BUSINESS_RULES.md`, addendum "Reservation commitment model" (RC-01 to RC-90). VK-02 and the Pakistan legal /
payment validation remain **go-live conditions**. Build order: (1) admin policy + merchant configuration, (2) deposit / prepayment +
refunds, (3) pre-authorisation mock flow, (4) customer / merchant / staff screens (Phase-2 "Pay and reserve" design as the visual reference).

## Founder decisions applied (v0.2.2) — these supersede any conflicting older text in this document

Full detail and rule-level effects are in `DEALDASH_BUSINESS_RULES.md` v0.2 (table at its top). Alignment summary:

1. **Exclusive Deals:** ~~MVP free reservation only; deposit/partial payment Phase 2~~ **superseded 2026-10-15 (commitment model above; C-10, M-05b and section 23 updated)**; inventory **per branch** in MVP; pooled multi-branch inventory Phase 2.
2. **Vouchers:** sale recorded immediately; merchant amount settlement-eligible on successful redemption (MVP), ledger kept flexible (FD-41 closed for MVP, still VALIDATE-KSA); full refund before redemption supported, window configurable + VALIDATE-KSA; partial redemption and partial refund Phase 2 (FD-25 closed as P2); expired-value treatment undecided, configurable + VALIDATE-KSA (FD-46).
3. **Watch & Earn:** pre-funded campaigns; hard cap at funded budget; merchant CPV and customer reward economics are separate configurable concepts, nothing hard-coded (FD-50/51 remain founder settings); qualifying-view thresholds, still-watching checks and caps configurable; unused budget separately identifiable in the ledger, final treatment VALIDATE-KSA (FD-54).
4. **Rewards:** non-cash, non-withdrawable, non-transferable; no fixed SAR per point; catalogue, valuation and expiry are configurable founder settings (FD-21/62/63).
5. **Authentication:** mobile OTP is the only customer sign-in method in MVP; Google and Apple sign-in Phase 2.
6. **Cards:** no last-4 collection in MVP; issuer/card-product selection + limited BIN/IIN metadata; never label a card "verified" without a real verification mechanism; FD-07/FD-08 stand as amended (card-payment-required offers must state the requirement); future PSP/issuer/token verification supported.
7. **Schemes/networks:** configurable list; MVP supports Visa, Mastercard, Amex and mada (brand/technical/regulatory use VALIDATE-KSA).
8. **Partner reporting:** aggregated by default; configurable small-cohort suppression, initial pilot setting 10 customers (product setting only, not a legal conclusion; VALIDATE-KSA) (FD-27 closed as setting).
9. **Merchants:** one legal entity with multiple branches in MVP; multi-entity groups/chains Phase 2 (FD-12 closed).
10. **Suspension/offboarding:** blocks new campaigns, sales, reservations immediately; issued vouchers and confirmed reservations are not auto-removed and enter an admin-controlled resolution workflow; fraud/emergency admin override with audit (FD-38, FD-40 resolved structurally).
11. **Employer:** work-email OTP with expiry and periodic reverification, period configurable (FD-05/06 period is configuration).
12. **Reviews:** in MVP with report/moderation controls; advanced reputation management Phase 2.
13. **Age:** Riyadh pilot is 18+, enforced via date of birth (FD-03 closed); youth proposition outside MVP.
14. **Live Deals:** unchanged (frictionless by default).
15. **Design conflicts for UX Architecture:** Exclusive Deal SAR 15 deposit screen → ~~free reservation~~ **visual reference for the commitment model (2026-10-15)**; card UI first 6 + last 4 → approved model; gift checkout and Play & Win remain Phase 2 and their designs are preserved as future-phase references.

All Saudi regulatory, VAT, Merchant-of-Record, voucher-fund, privacy, payment-licensing, data-retention and advertising conclusions remain VALIDATE-KSA.

## Approval clarifications (v0.2.1)

1. **Live Deals stay frictionless.** General/unlimited Live Deals must NOT default to controlled redemption for attribution purposes. Controlled redemption is optional, enabled only by merchants/campaigns that require it. Attribution for general Live Deals relies on discovery metrics (impressions, detail views, saves, directions clicks, merchant page visits). This closes the earlier "Live Deal return on investment" open issue as a design stance; no default-to-controlled. (Affects FD-57, FD-58: controlled mode is opt-in.)
2. **Customer design baseline coverage (63 screens).** The existing designs DO include: Exclusive Deal limited reserve and reservation, voucher checkout and redemption, Watch & Earn, video/Reels, still-watching checks, reward unlocking, and rewards journeys. **Still to be designed:** Arabic/RTL variants of customer screens, and the complete Merchant Portal, Staff interface, Partner Portal and Admin Portal experiences. (Supersedes the earlier assumption that Exclusive Deal reservation and Watch & Earn flows were possibly missing from the customer designs.)
3. **External validation does not gate product definition.** Saudi regulatory, Merchant-of-Record, VAT, voucher-fund and final settlement questions remain subject to external legal/payment-provider validation (`[VALIDATE-KSA]`). They must NOT block the next product-definition stage. They remain gates for production launch and for finalising settlement/payment design, not for product definition.

## Change log v0.1 → v0.2 (founder corrections applied)

1. Domain model split: Offer (Live/Hot) vs Voucher vs Watch & Earn Campaign. Shared base services only where useful (section 18).
2. All four products remain in the controlled commercial MVP (built sequentially, shipped together). Play & Win remains Phase 2.
3. Live Deal rule clarified: no claim/QR by default; discovery metrics tracked incl. directions clicks and merchant page visits.
4. Exclusive Deal: free reservation in MVP; deposit/partial payment architecturally supported, Phase 2 unless a pilot needs it. *(Superseded 2026-10-15: commitment model, see top.)*
5. Watch & Earn principles clarified (merchant vs DealDash control; merchant-stricter frequency rules).
6. Launch market set: Saudi Arabia, Riyadh pilot, SAR, Arabic + English. No regulatory/tax conclusions made (VALIDATION REQUIRED).
7. Payments: marketplace on a regulated PSP; Merchant of Record, voucher-fund treatment, settlement structure, licensing all open pending legal validation.
8. Card eligibility: issuer/card selection and limited BIN/IIN metadata; no PAN/CVV; no assumption of offline card-usage proof.
9. Partner data: aggregate by default; customer-level sharing only with legal basis, consent and explicit DealDash permission.
10. Approval model: tiered guardrails with auto-publish for selected types; manual review for high-risk/flagged; heavier manual review during pilot.
11. Settlement: architecture supports sale/redemption/refund/fee/payable/settlement/adjustment; timing is a founder decision.
12. Rewards: non-cash, non-withdrawable, non-transferable in MVP.
13. Design baseline: existing 63-screen customer UI/UX, pending upload.
14. Founder decisions FD-07, 08, 20, 37, 59, 60, 61 and others updated; see section 38.

Conventions used in this document:

- **MVP / P2 / P3** = Phase classification (MVP = required for a real, controlled commercial pilot).
- **FOUNDER DECISION REQUIRED** = a business policy not yet defined. No policy has been invented. Each is numbered (FD-nn) and collected in section 38.
- "Engine" = a shared backend service/domain module used by several portals.

---

## 1. Vision and proposition

DealDash is a **consumer discovery and merchant campaign platform**. It helps customers discover relevant merchant offers nearby and online, and gives merchants a simple way to create, launch and measure campaigns.

It is **not** a coupon app. It is a multi-sided platform whose differentiators are:

1. Four distinct offer mechanics (Live Deals, Exclusive Deals, Vouchers, Watch & Earn) instead of one "coupon" object.
2. **Eligibility layers** (bank, card, scheme, employer, geography, segment) so the same marketplace serves public and targeted audiences.
3. **DealDash-controlled reward economics** (merchants buy attention; DealDash decides what the customer earns).
4. Measurable merchant campaigns (impressions → detail views → saves/reservations/sales → redemptions).
5. Premium, clean brand experience (see section 13 of the brief; summarised in Appendix A).

### Launch products

| Product | One-line definition | Needs payment? | Needs code/QR? |
|---|---|---|---|
| Live Deals | Ongoing/regular merchant offers; discover and visit | No | No for general/unlimited deals; optional for controlled deals |
| Exclusive Deals | Short-time and/or limited-quantity offers | Only when the deal uses reservation: full prepayment, deposit or card pre-authorisation (2026-10-15); free only by admin policy | Reservation code once the reservation is confirmed |
| Vouchers | Pre-purchased, redeemed later | Yes | Yes (code + QR) |
| Watch & Earn | Merchant-paid video advertising/engagement campaign; customer earns DealDash rewards | No (merchant pays) | No (rewards ledger) |
| Play & Win | Games (wheel, scratch, etc.) | — | — | **Phase 2**, separate from Watch & Earn |

All four launch products (Live, Hot, Vouchers, Watch & Earn) are in the MVP. Build order is sequential (section 36); shipping is together.

### 1.1 Launch context

- **Market:** Saudi Arabia. **Pilot city:** Riyadh. **Currency:** SAR. **Languages:** Arabic + English (RTL/LTR architecture from day one).
- **No regulatory, VAT, payments or privacy conclusions are made in this document.** Each is marked **VALIDATION REQUIRED** with Saudi legal/payment specialists (e.g. VAT/e-invoicing treatment, payment licensing, personal data protection law, consumer protection and e-commerce rules, advertising/content rules, loyalty/rewards rules, card-scheme/bank requirements). Items tagged `[VALIDATE-KSA]` below.
- Implications to design in (not policy): bilingual content fields on all customer-facing entities, RTL UI, Saudi mobile number formats, Hijri/Gregorian date display, SAR minor units, data-residency options kept open `[VALIDATE-KSA]`.

---

## 2. Ecosystem participant map

| Participant | Role | Primary surface | Data they may see |
|---|---|---|---|
| Customer | Discovers, buys, reserves, redeems, earns | Customer app/web | Own data only |
| Merchant (organisation) | Funds and runs campaigns | Merchant Portal | Own business, own customers in aggregate; transaction-level only for own redemptions |
| Merchant Owner/Admin | Manages business, staff, commercials | Merchant Portal | Everything for their merchant |
| Merchant Manager / Marketer | Creates campaigns | Merchant Portal | Campaigns, analytics |
| Merchant Finance | Statements, settlement | Merchant Portal | Commercial module |
| Merchant Staff (branch) | Scan and redeem | Staff Redemption Interface | Redemption validation results only |
| Bank / Card Issuer | Funds/targets offers for its cardholders | Partner Portal | Aggregate reporting; no unrelated PII |
| Card Scheme (Visa/MC/Amex) | Funds/targets offers across issuers | Partner Portal | Aggregate, issuer-level where permitted |
| Employer / Corporate | Employee-only offers | Partner Portal | Aggregate; verified-employee counts |
| DealDash Internal Teams | Operate and govern platform | Admin Portal | Role-limited |
| Payment provider(s) | Collect, refund, settle | Integration | Payment tokens/status only |

Relationships: merchants fund deals/campaigns; partners may co-fund or define eligibility; DealDash approves, controls rewards, takes fees, and settles to merchants.

---

## 3. Portal architecture

Five front-ends over one shared backend platform.

```
 Customer App/Web   Merchant Portal   Staff Redemption UI   Partner Portal   Admin Portal
        \                |                  |                    |               /
         ------------- API layer (single auth, RBAC, tenancy) -----------------
                                   |
   Shared engines: Auth/Users/Orgs · RBAC · Offer · Eligibility · Campaign · Voucher ·
   Reservation · Payment · Redemption · Rewards · Notification · Search/Geo ·
   Analytics · Fraud/Risk · Audit · Settlement · Support/Cases
                                   |
        Data stores · Object storage (media/docs) · Queues · External integrations
```

Architecture rules:

1. **One identity system**, multiple principal types: Customer, Org User (merchant/partner), Staff, Internal User.
2. **Multi-tenancy by organisation**; every org-scoped query is constrained by org (and branch where applicable).
3. **One Partner Portal** with module toggles per partner type (Bank, Scheme, Employer), not three systems.
4. **Staff interface is a separate minimal surface**, not a reduced Merchant Portal.
5. **Every state change on money, rewards, eligibility, approvals and permissions is audit-logged.**
6. **Payments/rewards use immutable ledgers** (append-only, reversal by counter-entry).
7. **No full card numbers (PAN) or CVV stored by DealDash**; limited issuer/BIN metadata only (see sections 5.2 and 26).
8. Customer design direction is preserved (Appendix A): the existing 63-screen design is the baseline.
9. **Separate domains, shared services.** Offer (Live/Hot), Voucher and Watch & Earn Campaign are distinct domain aggregates with distinct lifecycles (section 18). They share only base services: Merchant/Branch, Media, Eligibility, Search index, Approval/Guardrails, Notification, Audit, Analytics events.
10. **Marketplace on a regulated PSP.** DealDash does not build payment processing (section 27).
11. **Bilingual (Arabic/English) and RTL-ready** from the start.

---

## 4. Complete module hierarchy

```
DEALDASH
├── Customer App
│   ├── Onboarding & Profile
│   ├── Discovery (home, categories, search, map/nearby, filters)
│   ├── Live Deals
│   ├── Exclusive Deals (countdown, reserve)
│   ├── Vouchers (buy, wallet, redeem)
│   ├── Watch & Earn (feed, watch, earn)
│   ├── Rewards Wallet (balance, history, redeem)
│   ├── Eligibility (employer, bank/card)
│   ├── Saved / Favourites
│   ├── Notifications
│   ├── Orders & Payments history
│   ├── Support
│   ├── Settings & Consents
│   └── [P2] Play & Win
├── Merchant Portal
│   ├── Dashboard
│   ├── Business Profile (info, branding, locations, hours, categories, contacts)
│   ├── Staff & Users
│   ├── Live Deals
│   ├── Exclusive Deals
│   ├── Vouchers
│   ├── Watch & Earn
│   ├── Redemption (history, verification, reversals)
│   ├── Analytics
│   ├── Commercial (subscription, spend, invoices, settlement, statements)
│   ├── Support
│   └── Settings
├── Staff Redemption Interface (Scan → Validate → Redeem)
├── Partner Portal
│   ├── Common (onboarding, profile, users, roles, offers, campaigns, merchants, eligibility, reporting, notifications, support, settings)
│   ├── Bank/Issuer module
│   ├── Card Scheme module
│   └── Employer module
└── Admin Portal
    ├── Dashboard
    ├── Customers · Merchants · Partners
    ├── Approvals (Live/Hot/Voucher/Watch&Earn)
    ├── Payments · Settlement
    ├── Rewards · Watch & Earn monitoring
    ├── Fraud/Risk · Support
    ├── Reporting · Roles · Audit Log · System Configuration
```

---

## 5. Customer onboarding journey

| Step | Detail | Phase |
|---|---|---|
| 1 | Enter mobile number | MVP |
| 2 | OTP verification (SMS, rate-limited, expiry, resend limits) | MVP |
| 3 | Email entry (verification: FD-01) | MVP |
| 4 | Name, date of birth, gender (gender optional vs required: FD-02) | MVP |
| 5 | Location permission, city selection | MVP |
| 6 | Interests/preferences | MVP |
| 7 | Required consents (terms, privacy, marketing separate and optional, location, notifications) | MVP |
| 8 | Profile complete → home | MVP |
| 9 | Optional later: employer verification | MVP |
| 10 | Optional later: bank/card eligibility | MVP (basic), P2 (richer) |

Notes:
- Minimum age rule: FD-03.
- Guest browsing before sign-up: FD-04 (recommended: allow browsing Live Deals, require login to reserve/buy/earn).
- Re-onboarding, account deletion, data export are required by privacy law (MVP: deletion request flow).

### 5.1 Employer eligibility (as specified)

1. Customer picks employer from DealDash-partnered list.
2. Enters official work email (domain must match employer's registered domains).
3. OTP sent to work email.
4. Customer enters OTP → **Verified Employer** status.
5. No employee database upload for MVP.

Rules to define: re-verification period, what happens on job change/leaving, shared/alias mailboxes, multi-employer, domain collisions. See FD-05, FD-06.

### 5.2 Bank/card eligibility

Goal: determine which bank/card/scheme offers a customer qualifies for **without** storing sensitive card data.

**MVP rules (decided):**
- Never store full PAN. Never store CVV. Avoid any unnecessary sensitive card information.
- Eligibility is identified by an approved safe method: **issuer/card selection** (bank, product, scheme, tier chosen from a partner-maintained list) and/or **limited BIN/IIN metadata** (leading digits only, mapped to issuer/scheme/product).
- Eligibility from these methods is recorded as `self-declared` or `BIN-matched`; it is **not** proof of card ownership.
- DealDash does **not** claim to cryptographically prove offline card usage at MVP. Offline card use cannot be verified without issuer/payment integration.
- **Offers requiring payment with an eligible bank card must state this clearly in the offer terms and on the offer detail screen** (e.g. "Valid only when paying with [Bank] [Card]"). Enforcement at the merchant is by the merchant/terms at MVP.
- Where payment occurs through DealDash's PSP (e.g. voucher purchase), the PSP-returned card BIN/issuer metadata may be used to validate eligibility at purchase. Whether to offer card-restricted vouchers at pilot: FD-08.

**Architecture must support later (P2/P3):** PSP tokenisation with BIN metadata, issuer-provided verification, issuer-linked offers (card-linked), eligibility `verification_level` already modelled so these upgrade without redesign.

---

## 6. Merchant onboarding journey

States: `Draft → Submitted → In Review → (Changes Requested ↔ Resubmitted) → Approved | Rejected → Agreement Signed → Activated`

| Step | Content | Phase |
|---|---|---|
| 1 | Create account: email verification + mobile verification | MVP |
| 2 | Legal business info (legal name, trade name, registration no., tax no., address, type) | MVP |
| 3 | Documents (trade licence / company docs, authorised-signatory ID, proof of address as required) | MVP |
| 4 | Authorised representative details | MVP |
| 5 | Business category | MVP |
| 6 | Locations/branches (address, geo pin, contacts) | MVP |
| 7 | Opening hours per branch (incl. holidays) | MVP |
| 8 | Settlement/bank details (verification method: FD-09) | MVP |
| 9 | Branding/media (logo, cover, gallery, description) | MVP |
| 10 | DealDash commercial agreement (e-accept; e-sign: FD-10) | MVP |
| 11 | Submit | MVP |
| 12 | DealDash review: documents, KYB/screening (FD-11), commercial terms | MVP |
| 13 | Approve / Reject / Request changes | MVP |
| 14 | Activation (go-live; can create campaigns; campaigns still need approval) | MVP |
| 15 | Invite team and staff | MVP |

Merchant-side rules: material changes after approval (bank details, legal name) trigger re-review. Chains/franchises (one legal entity, many branches vs many entities): FD-12.

## 7. Merchant staff onboarding

1. Merchant Admin invites user by email/mobile and assigns **role** + **branch(es)**.
2. Invitee accepts invite, sets credentials (staff login method: FD-13 — mobile+OTP or PIN is typical for staff devices).
3. Staff sees only assigned merchant/branches.
4. Admin can deactivate instantly; sessions revoked.
5. Staff cannot self-expand scope.

## 8. Bank onboarding

`Invite or Apply → Organisation profile & legal docs → Authorised users → DealDash Partner Management review → Commercial/partnership agreement → Configure card products/tiers/BIN ranges → Approve → Activate`

Requires: legal entity details, authorised contacts, data-sharing & privacy agreement, card product catalogue, BIN/IIN ranges, funding model (who pays for bank-funded offers: FD-14). Bank users are created by the partner admin after the first admin is verified by DealDash.

## 9. Card scheme onboarding

Same skeleton as bank, plus: scheme profile, participating issuers list, geographic scope, merchant programme definitions, and constraints on what scheme-level reporting may reveal (FD-15). Brand-usage rules for scheme logos need legal clearance (FD-16).

## 10. Employer onboarding

`DealDash invites/employer applies → Company profile → Official email domains → DNS/ownership check or document proof (FD-17) → Authorised HR/benefits contact(s) → Agreement → Employee verification rules configured → Approve → Activate (appears in customer employer list)`

## 11. DealDash internal-user onboarding

- Accounts created **only** by Super Admin (no self-registration).
- Corporate email required; invite link; forced password set; **MFA-ready** (MVP: structure and enforcement flag; mandatory MFA for Admin roles is recommended — FD-18).
- Role assigned from role catalogue; least privilege.
- Offboarding: immediate deactivation, session kill, audit entry.
- Sensitive actions (manual reward adjustment, refunds above threshold, role changes) require specific permission and optionally maker–checker (FD-19).

---

## 12. Customer functional requirements

| ID | Requirement | Phase |
|---|---|---|
| C-01 | Sign-up/login via mobile + OTP; session management; logout all devices | MVP |
| C-02 | Profile management, preferences, consents | MVP |
| C-03 | Home feed: featured, nearby, categories, Exclusive Deals strip, Watch & Earn strip | MVP |
| C-04 | Search (text, category, merchant, location, filters: distance, offer type, eligibility, open now) | MVP |
| C-05 | Map / nearby discovery | MVP |
| C-06 | Merchant page (branches, hours, active offers) | MVP |
| C-07 | Offer detail with terms, validity, branches, eligibility status ("You qualify" / "Requires X") | MVP |
| C-08 | Live Deal view (no claim/reservation/QR by default; discover and visit); directions/call/website actions; optional controlled-redemption rules | MVP |
| C-09 | Exclusive Deal: countdown, remaining quantity, reservation with commitment (terms before paying, payment status, expiry timer), cancel with refund / forfeit terms | MVP |
| C-10 | Exclusive Deal reservation commitment: full prepayment, deposit, card pre-authorisation (mock provider; real provider deferred) | MVP (2026-10-15; previously Phase 2) |
| C-11 | Voucher purchase, payment, wallet, code/QR, expiry reminders | MVP |
| C-12 | Voucher refund request / auto-refund per policy | MVP |
| C-13 | Watch & Earn: video feed, qualifying view tracking, reward credit, prize inventory | MVP |
| C-14 | Rewards wallet: balance, history, expiry, redemption options (FD-21) | MVP |
| C-15 | Employer verification (section 5.1) | MVP |
| C-16 | Bank/card eligibility declaration (section 5.2) | MVP |
| C-17 | Save/favourite offers & merchants | MVP |
| C-18 | Push/SMS/email/in-app notifications with preferences | MVP |
| C-19 | Order/payment history, receipts | MVP |
| C-20 | Support: FAQ, raise case, track case | MVP |
| C-21 | Account deletion/data request | MVP |
| C-22 | Share offer / referral | P2 |
| C-23 | Play & Win | P2 |
| C-24 | Membership/status tiers | P2 (FD-22) |
| C-25 | Personalised recommendations (ML) | P3 (rule-based in MVP) |
| C-26 | Multi-language / RTL (market-dependent) | FD-23 |

## 13. Merchant functional requirements

| ID | Requirement | Phase |
|---|---|---|
| M-01 | Dashboard: campaigns, performance, sales, redemptions, W&E, alerts | MVP (basic) |
| M-02 | Business profile, branding, locations, branches, hours, categories, contacts | MVP |
| M-03 | Staff & users: invite, roles, branch access, deactivate | MVP |
| M-04 | Live Deals: create/edit/schedule/draft/submit/pause/expire; branch assignment; eligibility; terms | MVP |
| M-05 | Exclusive Deals: time-limited, quantity-limited or both, countdown, inventory, reservation on / off (default off), per-customer limits | MVP |
| M-05b | Exclusive Deal reservation commitment: method, amount, refundable deposit, cancellation cut-off, hold length, no-show refundable portion — within the effective admin policy; reservation list with payment / refund status | MVP (2026-10-15; previously Phase 2) |
| M-06 | Vouchers: face value, selling price, quantity, validity, sales status, redemption, expiry, refunds | MVP |
| M-07 | Watch & Earn: upload/reference video, budget, paid-view quantity, targeting, geography, timing, prize inventory, status, analytics | MVP |
| M-08 | Redemption console: verify code, history, statuses, reversal where permitted | MVP |
| M-09 | Analytics: impressions, detail views, saves, reservations, voucher sales, redemptions, qualified views, conversion | MVP (core metrics) |
| M-10 | Commercial: subscription, spend, invoices, settlement, statements | MVP (statements & settlement view); subscription / licensing / entitlement engine built (FD-24 CLOSED: plan & usage screen, billing hooks); invoicing of subscriptions Phase 5 |
| M-11 | Support & settings | MVP |
| M-12 | Bulk upload / templates / duplicate campaign | P2 |
| M-13 | POS integration | P3 |
| M-14 | Audience insights (aggregate) | P2 |
| M-15 | Self-serve ad credit top-up and auto-renew budgets | P2 |

## 14. Merchant staff functional requirements

| ID | Requirement | Phase |
|---|---|---|
| S-01 | Staff login (assigned merchant + branch) | MVP |
| S-02 | QR scan (camera) | MVP |
| S-03 | Manual code fallback | MVP |
| S-04 | Validate voucher / reservation | MVP |
| S-05 | Result screens: Valid, Invalid, Expired, Already redeemed, Wrong branch | MVP |
| S-06 | Confirm redemption (one tap) | MVP |
| S-07 | Redemption history (own branch, recent) | MVP |
| S-08 | No access to finance, campaign creation, settlement, billing, admin settings | MVP |
| S-09 | Partial redemption / bill-amount entry | P2 (FD-25) |
| S-10 | Offline-tolerant mode | P3 |
| S-11 | Reversal request (staff requests; manager approves) | P2 |

Design: one-handed, large touch targets, works on low-end phones and browsers (installable web app/PWA vs native: FD-26).

## 15. Partner Portal functional requirements

**Common (all partner types)**

| ID | Requirement | Phase |
|---|---|---|
| P-01 | Onboarding & approval | MVP |
| P-02 | Organisation profile | MVP |
| P-03 | Authorised users, roles | MVP |
| P-04 | Eligibility rules configuration | MVP |
| P-05 | Offers (partner-targeted visibility of merchant offers) | MVP |
| P-06 | Campaigns (partner-funded) | P2 (MVP: config + manual operation by DealDash) |
| P-07 | Participating merchants view/manage | MVP |
| P-08 | Reporting (aggregate) | MVP (basic) |
| P-09 | Notifications, support, settings | MVP (basic) |

**Bank / Issuer:** bank profile; card products; tiers; BIN/IIN eligibility; public vs card-specific offers; merchant-funded vs bank-funded; campaign dates, limits; reporting. MVP: profile, products, tiers, BIN ranges, card-specific offers; P2: bank-funded campaigns self-serve, advanced reporting.

**Card Scheme:** scheme profile; participating issuers; tiers; geography; merchant programmes; scheme-funded campaigns; issuer-level and merchant reporting where permitted. MVP: profile + eligibility; P2: funded campaigns + reporting.

**Employer:** company profile; official email domains; verification rules; employee-only offers; participating merchants; campaigns; reporting. MVP: profile, domains, employee-only offers, verified count; P2: campaigns.

**Data minimisation (rule):** Default partner reporting is **aggregated only**. Banks, schemes and employers do **not** automatically receive customer-level personal data. Any customer-level sharing requires (a) an approved legal basis, (b) customer consent where applicable, and (c) explicit DealDash permission recorded against the partner and purpose. Partner reports are restricted by minimum cohort thresholds: **FOUNDER DECISION REQUIRED / PRIVACY VALIDATION REQUIRED** (FD-27) `[VALIDATE-KSA]`. Partner-user access to any customer-level data is off by default and permission-gated and audited.

## 16. Admin functional requirements

| Area | Capabilities | Phase |
|---|---|---|
| Dashboard | GMV, sign-ups, active offers, pending approvals, redemption volume, fraud alerts | MVP basic |
| Customers | search, profile, status, eligibility, transactions, rewards, complaints, suspend/reactivate | MVP |
| Merchants | applications, documents, approve/reject/request changes, branches, users, deals, commercial status, suspend/reactivate | MVP |
| Partners | banks/schemes/employers onboarding, approval, config, users, status | MVP |
| Approvals | Live, Hot, Voucher, Watch & Earn: approve/reject/request changes/pause | MVP |
| Payments | transactions, failures, refunds, reversals, reconciliation | MVP (core) |
| Settlement | merchant payable, fees, deductions, adjustments, status | MVP (semi-manual acceptable: FD-29) |
| Rewards | rules, ledger, redemption, manual adjustment (permissioned), expiry, fraud | MVP |
| Watch & Earn | campaign monitoring, budgets, qualified views, reward cost, fraud flags, status | MVP |
| Fraud/Risk | duplicate accounts, suspicious viewing, QR abuse, duplicate redemption, voucher abuse, suspicious rewards, device abuse | MVP (rules + flags + review queue) |
| Support | cases, complaints, disputes, refunds, merchant complaints | MVP |
| Reporting | operational & finance reports, exports | MVP basic |
| Roles | role/permission management | MVP |
| Audit log | searchable, immutable | MVP |
| System config | fees, reward rates, limits, categories, cities, feature flags | MVP |

---

## 17. User roles and permissions

Principle: **least privilege, scoped by organisation and branch, permission-based (roles are bundles of permissions).**

### 17.1 Merchant roles

| Role | Scope | Key permissions |
|---|---|---|
| Owner | Merchant | Everything incl. bank details, agreement, users |
| Admin | Merchant | Profile, users, campaigns; not bank details (FD-30) |
| Marketing Manager | Merchant/branches | Create/edit/submit campaigns, analytics |
| Finance | Merchant | Commercial module, statements, invoices |
| Branch Manager | Branch(es) | Branch campaigns view, redemption history, approve reversals (P2) |
| Redemption Staff | Branch(es) | Scan/validate/redeem only |

### 17.2 Partner roles

Partner Admin; Partner Manager (offers/campaigns); Partner Analyst (read-only reports); (Bank) Card Product Manager.

### 17.3 Internal roles

| Role | Primary scope |
|---|---|
| Super Admin | Everything; creates users; config |
| Operations | Approvals, campaign monitoring, day-to-day |
| Merchant Management | Merchant applications, accounts, commercial status |
| Partner Management | Partner onboarding/config |
| Customer Support | Customer lookup, cases, limited refunds |
| Finance | Payments, settlement, refunds, reconciliation |
| Marketing | Content/featuring, notifications, campaigns (no finance, no PII exports) |
| Compliance/Risk | Fraud queue, KYB, audit, suspensions |
| Analyst | Read-only aggregated reporting |

### 17.4 Permission matrix (summary; R=read, W=write, A=approve, —=none)

| Capability | Super | Ops | Merch Mgmt | Partner Mgmt | Support | Finance | Marketing | Risk | Analyst |
|---|---|---|---|---|---|---|---|---|---|
| Customers | RW | R | — | — | RW(limited) | R | — | RW | R(agg) |
| Merchants | RW | R | RWA | R | R | R | R | RW | R(agg) |
| Partners | RW | R | — | RWA | — | R | — | R | R(agg) |
| Deal/campaign approval | A | A | A | — | — | — | — | A | — |
| Payments/refunds | RW | R | — | — | RW(≤limit) | RWA | — | R | — |
| Settlement | RW | R | — | — | — | RWA | — | R | — |
| Rewards adjust | A | — | — | — | — | — | — | A | — |
| Fraud/Risk | RW | R | — | — | R | R | — | RWA | — |
| Roles/users | RWA | — | — | — | — | — | — | — | — |
| Audit log | R | — | — | — | — | — | — | R | — |
| System config | RWA | R | — | — | — | R(fees) | — | R | — |

Refund and adjustment thresholds and maker–checker rules: FD-19, FD-31.

---

## 18. Offer and eligibility architecture

### 18.1 Domain model: three separate aggregates, shared base services

Live/Exclusive Deals, Vouchers and Watch & Earn are **fundamentally different products** (a promotion, a financial product, an advertising/reward campaign). They are NOT one Offer object and do NOT share one lifecycle. Shared structure exists only where it genuinely helps.

**Shared base (reusable components, not a super-type):**
- Merchant, Branch, Media assets (bilingual), Terms blocks
- Eligibility rule set (attachable to any aggregate; section 18.2)
- Search/discovery index entry (a read-model projection fed by each domain)
- Guardrails/approval service (policy evaluated per domain)
- Notification, Audit, Analytics-event services

#### A. OFFER (promotion domain) — Live Deal and Exclusive Deal

Common `Offer` fields: merchant, branches[], title (AR/EN), description (AR/EN), images, eligibility rule set, start/end date, status, terms, per-customer limits, funding note (FD-32).

Product-specific structures:

| | **Live Deal** | **Exclusive Deal** |
|---|---|---|
| Mechanic | percentage, fixed amount, BOGO, bundle, meal deal, service offer, everyday promotion | same mechanic types, plus urgency settings |
| Timing | schedule / recurring availability windows | short window (e.g. next 2 hours) and/or limited quantity |
| Inventory | none for general/unlimited deals | quantity cap; remaining count; concurrency-safe |
| Customer action | discover and visit; **no reservation, no claim, no QR/barcode** by default | optional reservation (default off) with a commitment — prepayment / deposit / card pre-authorisation; free only by admin policy (2026-10-15); hold timer; code on confirmation |
| Controlled mode | optional "controlled" rules: redemption code, per-customer limit, or claim where required | n/a (reservation inherent where inventory control is needed) |
| Deposit | none | deposit / prepayment / card hold: **MVP (2026-10-15)**, RC rules |
| Lifecycle | section 21A | section 23 |

`Reservation` is a child entity of Exclusive Deal (and of controlled Live Deals if enabled), with its own state machine (section 23).

#### B. VOUCHER (commerce/financial domain)

A **Voucher product** and **Voucher instance (purchase/ownership)** model with: selling price, face value, inventory, payment (via PSP), order/purchase, ownership, unique code + QR, redemption, expiry, refund, and settlement accrual. Own lifecycle (section 22), own financial ledger postings, own approval guardrails. Not an Offer subtype; it may *link* to a display card in discovery.

#### C. WATCH & EARN CAMPAIGN (advertising/reward domain)

A campaign is an advertising and reward product with: video/content, paid-view budget, targeting (audience, geography, timing), qualifying-view rules (DealDash standard + optional stricter merchant frequency rules), reward logic (DealDash-controlled), **view ledger**, merchant prize inventory where applicable, fraud controls, campaign spend, under-delivery handling, and reporting. Own lifecycle (section 24). Rewards are posted to the Rewards ledger, spend to the Campaign spend ledger.

#### D. Cross-domain contracts

- Every domain emits standard events (`impression`, `detail_view`, `save`, `directions_click`, `merchant_page_visit`, `reserve`, `purchase`, `redeem`, `qualified_view`, etc.) to the shared analytics pipeline.
- The discovery index consumes a normalised **DiscoveryCard** projection from each domain; it does not own domain state.
- Approval/guardrails (section 19.2) are a shared service with domain-specific policy sets.

Why this split: each domain has different money flows, state machines, fraud profiles and reporting; forcing one lifecycle creates hidden coupling and edge-case bugs. Why still share: one search, one eligibility engine, one audit trail, one design system.

### 18.2 Eligibility Engine

Eligibility is a **rule set attached to an offer** evaluated against a **customer eligibility profile**.

Customer eligibility profile (computed attributes):

- public (always)
- geography (city, current location)
- employer(s) verified
- issuing bank(s), card product(s), tier(s), scheme(s) (declared/verified level recorded)
- segment (age band, new vs returning, interests)
- DealDash status/membership (P2)
- campaign-specific (invited, cohort)

Rule composition: `ALL / ANY / NOT` over attributes. A customer can satisfy many at once; the offer shows the **best applicable** eligibility reason. Multiple offers can stack only per stacking policy (FD-33; default: no stacking).

Evaluation points:
1. **Display** (is this shown / locked / hidden?) — hide vs show-locked is FD-34.
2. **Claim/reserve/purchase** (hard check).
3. **Redemption** (re-check where relevant, e.g. card used at payment).

Each eligibility attribute carries `source`, `verification_level` (self-declared / OTP-verified / BIN-verified / issuer-verified), `verified_at`, `expires_at`. Offers can demand a minimum verification level.

### 18.3 Priority and conflict

Public offers < segment offers < partner-funded offers in display ranking? Ranking logic is FD-35. Ranking must be explainable and not pay-to-win without disclosure (sponsored label: FD-36).

---

## 19. Major operational workflows

1. **Merchant approval:** application → document review → risk screen → commercial terms → decision → activation.
2. **Campaign approval (tiered guardrails model, see 19.2).**
3. **Offer pause/suspend:** by merchant (pause) or DealDash (suspend with reason); affects live holds and issued vouchers (issued vouchers remain valid unless fraud; rule FD-38).
4. **Customer onboarding verification:** OTP, employer email OTP, card eligibility.
5. **Redemption:** scan → validate → redeem → ledger → notification.
6. **Support case:** intake → triage → investigate → resolve (refund/adjust/suspend) → close, with SLAs (FD-39).
7. **Fraud review:** rule/flag → queue → analyst decision → action (block, reverse, suspend) → audit.
8. **Content moderation** for merchant videos and descriptions.
9. **Partner configuration change** (e.g. BIN range update) → review → effective-dated.
10. **Merchant offboarding:** wind-down of live offers, honour/refund issued vouchers, final settlement (FD-40).

### 19.2 Approval and guardrails model

Principles:
1. **The merchant must be approved first.** Only Activated merchants can create campaigns.
2. **Merchants operate within DealDash rules and guardrails** (configurable policy set per product: allowed mechanics, max discount %, price sanity checks, prohibited categories/content, quantity/duration/budget limits, video content checks, trust level of merchant).
3. **Risk-tiered publishing** per campaign evaluated by the guardrails service:
   - **Auto-publish:** selected campaign types that pass all automated checks and come from merchants with sufficient trust level (e.g. Exclusive Deals within guardrails; templated Live Deals).
   - **Manual review:** high-risk, unusual, or flagged campaigns (e.g. out-of-range discounts, new/low-trust merchant, sensitive categories, new content, Watch & Earn video, large Voucher inventory, anything flagged by risk rules).
   - Which product/type is auto vs manual by default is configuration, not code.
4. **DealDash can pause or suspend any campaign at any time** (reason required, audit logged, merchant notified).
5. **Pilot posture:** during the initial Riyadh pilot, DealDash may configure the guardrails to route **more** campaigns to manual review while operational controls are tested, then relax per product as confidence grows. Exact pilot defaults: FD-37 (reduced to a configuration choice, not an architecture blocker).
6. Merchant trust level (new / standard / trusted) can be raised or lowered based on history, complaints, fraud flags.

Post-publish monitoring: automated anomaly checks (e.g. sudden discount change, sell-through spikes, complaints) can auto-pause and open a review item.

## 20. Major financial workflows

1. **Voucher purchase:** customer pays via PSP → payment confirmed → voucher issued → merchant payable event recorded (accrual timing — on sale vs on redemption — is FOUNDER DECISION REQUIRED, FD-41; ledger supports both).
2. **Exclusive Deal reservation commitment (MVP since 2026-10-15):** prepayment / deposit captured, or card hold authorised → confirmed → redeemed (prepayment used; deposit credited to the bill; card hold released unless terms say captured) / cancelled before the cut-off (refundable amounts returned, hold voided) / cancelled after the cut-off or no-show (deposit forfeitable; prepayment refundable portion per policy; hold captured up to the no-show charge) / cancelled by merchant or DealDash (full refund / void). Collected for the merchant; DealDash keeps only its agreed fee. Rules RC-30 to RC-72.
3. **Refund:** customer/support-initiated → eligibility per policy → payment provider refund → ledger reversal → notification.
4. **Settlement:** accrual → fees/commissions/deductions → statement → payout → reconciliation. Cycle (weekly/biweekly): FD-29.
5. **Watch & Earn funding:** merchant budget commit/prepay → reserved → consumed per qualified view → rewards cost accrued → unused budget handling (section 24).
6. **Merchant billing:** subscription (P2), campaign spend, platform fees, invoices (tax invoices per jurisdiction: FD-43).
7. **Reconciliation:** PSP report vs internal ledger vs bank settlements; exceptions queue.
8. **Chargebacks/disputes:** PSP notification → evidence → outcome → ledger.
9. **Partner funding:** bank/scheme-funded offers — funding commitment, consumption tracking, invoicing partner (P2).

Ledger principle: double-entry-style, append-only, every movement tied to an object (order, voucher, campaign, view batch).

---

## 21. Campaign lifecycle

There is **no single lifecycle for all products.** Each domain has its own state machine (21A Offer/Live Deal, 22 Voucher, 23 Exclusive Deal, 24 Watch & Earn). The states below are the common **governance skeleton** (draft → review/auto-publish → live → end) that domains specialise. Review step may be skipped by auto-publish (section 19.2).

### 21A. Live Deal lifecycle (and governance skeleton)

```
DRAFT → SUBMITTED → UNDER REVIEW → (CHANGES REQUESTED ↔ RESUBMITTED) → APPROVED → SCHEDULED → LIVE
LIVE → PAUSED ↔ LIVE
LIVE → EXHAUSTED (inventory/budget) | EXPIRED (time) | SUSPENDED (by DealDash) | CANCELLED (by merchant, rules apply)
Any end state → ARCHIVED
REJECTED (terminal; may clone to new draft)
```

Rules: edits to live offers — which fields are editable without re-approval is set by guardrails config (FD-44). Every transition has actor, timestamp, reason, audit entry. SUBMITTED → UNDER REVIEW is skipped when auto-publish applies (section 19.2).

**Live Deal measurement (no claim/QR for general deals):** tracked events — impressions, detail views, saves, directions/location clicks, merchant page visits (plus call/website clicks if available). These are discovery metrics, not proof of purchase. Controlled Live Deals may add redemption tracking (code and/or per-customer limits) where the merchant/DealDash requires it.

## 22. Voucher lifecycle

Voucher **product** (merchant-defined): `Draft → Approved → On Sale → Sold Out | Ended | Suspended`.
Voucher **instance** (customer-owned):

```
PENDING PAYMENT → ISSUED (ACTIVE) → REDEEMED
                         ├→ EXPIRED (→ expired-value policy)
                         ├→ REFUNDED
                         ├→ CANCELLED/VOIDED (fraud)
                         └→ TRANSFERRED/GIFTED (P2, FD-45)
```

Controls: inventory decrement at payment initiation with timeout hold; unique non-guessable code + signed QR; single-use; branch restrictions; validity (fixed date vs N days from purchase); refund rules (before redemption / after expiry: legal by jurisdiction, FD-46); partial redemption (FD-25); merchant settlement trigger (FD-41).

## 23. Exclusive Deal lifecycle

```
DRAFT → [guardrails: AUTO-PUBLISH or MANUAL REVIEW] → LIVE (countdown starts; stock visible)
LIVE → PAUSED ↔ LIVE
LIVE → inventory depletes → SOLD OUT
LIVE → time ends → EXPIRED
LIVE → SUSPENDED (DealDash) | CANCELLED (merchant)
```

Exclusive Deals are designed for immediate demand, so they are the first candidate for **auto-publish within guardrails** (section 19.2); the pilot may initially route more to manual review. Supported limits: time-limited, quantity-limited, or both.

Customer reservation instance (commitment model, 2026-10-15; RC rules):

```
PENDING PAYMENT (stock held for the payment window; no code yet)
   → PAYMENT FAILED / ABANDONED / WINDOW ELAPSED (stock released; card hold voided; no strike)
   → CONFIRMED (prepayment / deposit paid or card hold authorised; code issued; hold timer starts)
        → REDEEMED (at venue; prepayment used / deposit credited / card hold released)
        → EXPIRED = NO-SHOW (stock released; strike; deposit forfeitable / prepayment refundable portion / hold captured up to no-show charge)
        → CANCELLED by customer before cut-off (stock released; refundable amounts returned; hold voided)
        → CANCELLED by customer after cut-off (stock released; forfeit rules; not a strike)
        → CANCELLED by merchant / DealDash (stock released; full refund / void)
FREE (only where admin policy allows): CONFIRMED on creation.
```

Rules: hold duration (bounded by policy), cancellation cut-off (merchant, within admin limits), per-customer cap, no-show strikes (3 / 30 days → 7-day block, admin lift / reset). Inventory must be concurrency-safe (no over-reservation).

## 24. Watch & Earn lifecycle

Campaign:

```
DRAFT → SUBMITTED → (video moderation + budget check) → APPROVED → FUNDED/COMMITTED → LIVE
LIVE → PAUSED → LIVE
LIVE → COMPLETED (paid views delivered) | EXPIRED (end date, under-delivered) | SUSPENDED (fraud/policy) | CANCELLED
→ RECONCILED (final billing, unused budget treatment)
```

Control split (fixed by founder):

| Merchant controls | DealDash controls |
|---|---|
| Campaign budget / number of paid views | Reward amount and reward economics |
| Target audience | Minimum qualifying-view standards |
| Geography | Anti-fraud rules |
| Campaign dates | Moderation, approval/guardrails, suspension |
| Merchant-funded prize inventory (where applicable) | Rate card / pricing structure |
| **Stricter** repeat/frequency rules, within DealDash limits | The outer limits of frequency rules |

Other principles:
- The merchant does **not** set what customers earn.
- A **qualifying view must be a completed qualifying view under platform-defined standards.** Incomplete, skipped, unverified or flagged views are not billed and earn nothing.
- Exact CPV (cost per view) and reward economics: **FOUNDER DECISION REQUIRED** (FD-50, FD-51). No numbers are assumed.
- Prize draw/assignment mechanics for merchant prize inventory: FD-49.

Qualified view (platform standard; thresholds configurable, defaults need decision FD-52): minimum completed watch duration/percentage, app foreground and visible, unique verified account/device, within targeted audience/geo/time, merchant frequency rule satisfied (not looser than platform minimum), not flagged by fraud rules, view token verified server-side (client cannot self-report).

Fraud controls: device fingerprinting, velocity limits, per-customer daily cap (FD-53), emulator/root detection (P2), duplicate-account linking, anomaly detection on view patterns, delayed reward confirmation window for high-risk accounts, clawback rights in terms.

Under-delivery and unused budget: define whether unused budget is refunded, extended, converted to credit, or retained after expiry (FD-54), and billing is per delivered qualified view only (recommended principle: merchant never charged for unqualified/fraudulent views — confirm FD-55).

Reward ledger entries created only after a qualified view is confirmed.

## 25. Redemption lifecycle

```
CODE PRESENTED → SCANNED/ENTERED → VALIDATION
   ├ VALID → CONFIRM → REDEEMED (ledger event, notification, settlement accrual)
   ├ INVALID (unknown/forged)
   ├ EXPIRED
   ├ ALREADY REDEEMED
   ├ WRONG BRANCH / WRONG MERCHANT
   ├ NOT YET VALID / NOT ACTIVE
   └ SUSPENDED/REFUNDED
REDEEMED → REVERSED (permitted roles, time window, reason, audit)
```

Requirements: atomic single-use check (race-safe); every attempt logged (including failures, for abuse detection); staff identity and branch recorded; reversal window FD-56; General Live Deals have **no redemption event** — measurement via impressions, detail views, saves, directions clicks and merchant page visits (check-in/visit verification is P2, FD-57); controlled Live Deals can optionally use redemption tracking (FD-58). Redemption applies to Vouchers, Exclusive Deal reservations and controlled Live Deals.

## 26. Customer eligibility lifecycle

Per attribute (employer, card, etc.):

```
NOT DECLARED → PENDING VERIFICATION → VERIFIED → (RE-VERIFICATION DUE) → EXPIRED
                         └→ FAILED → retry/limit
VERIFIED → REVOKED (employer left, card removed, fraud) 
```

Card privacy design: DealDash stores at most issuer/product/tier selection, scheme, limited BIN/IIN metadata, and (future) a provider token reference. Never PAN, CVV or expiry in DealDash systems. Card entry for payments happens only in the PSP's hosted fields/redirect (PCI scope stays with the PSP; confirm target PCI level with the PSP `[VALIDATE-KSA]`). Card eligibility is recorded with `verification_level` = self-declared / BIN-matched (MVP); future: token/issuer-verified. Card eligibility is not proof of card ownership or of offline card use.

Employer: work-email OTP; periodic re-verification (FD-06); domain removal by employer revokes eligibility.

All changes audited; customer can remove an attribute at any time.

---

## 27. Payments and settlement concept

**Positioning (MVP):** DealDash is architected as a **marketplace/platform using a regulated payment service provider (PSP)**. DealDash does not build payment processing itself. The Payments Engine is a provider-agnostic abstraction over the PSP: initiate, capture, refund, reverse, reconcile.

**Not concluded — VALIDATION REQUIRED before production launch** (legal counsel + PSP, Saudi Arabia `[VALIDATE-KSA]`):
- Merchant of Record model
- Legal treatment of voucher funds (who holds customer funds, whether escrow/segregation is required)
- Settlement structure (split payments by PSP vs DealDash-collected and paid out)
- Payment licensing implications for DealDash's chosen model
- VAT / e-invoicing treatment, currency handling, chargeback responsibility

The architecture stays model-neutral: the ledger and settlement design below work whichever model is chosen.

**Financial event model (architecture must support):** `sale` → `redemption` → `refund` → `platform fee` → `merchant payable` → `settlement` → `adjustment`. Each is an append-only ledger event linked to its source object (order, voucher, reservation deposit (P2), campaign spend). Fees are computed from configurable fee rules, not hard-coded.

Settlement flow (conceptual): event(s) → fee computation (commission, fixed fees, campaign fees) → deductions (refunds, chargebacks, penalties) → adjustments (manual, permissioned, audited) → statement → payout to verified bank account → reconciliation.

**Exact settlement timing (at sale vs at redemption, cycle length, minimum payout, reserves): FOUNDER DECISION REQUIRED** (FD-29, FD-41). Final settlement economics are not hard-coded.

MVP: payments integration via PSP, complete ledger, statements; payout execution may be semi-manual (Finance approves batch) pending the decisions above.

Currency: SAR primary (minor-unit safe amounts). Tax handling: `[VALIDATE-KSA]`, FD-43/FD-61.

## 28. Rewards concept

- **DealDash points/coins** are issued by DealDash only, via rules (Watch & Earn, later Play & Win, referrals, promos).
- **Rewards ledger**: append-only; entries: earn, redeem, expire, reverse, manual adjust (permissioned + reason + audit).
- **Rule engine config** (admin): rate per qualified view, daily/weekly caps, expiry period, tiers, campaign multipliers (DealDash-controlled).
- **MVP rules (decided):** rewards are **non-cash, not withdrawable as cash, and not transferable** between users (transfer only if later approved). Customer-facing terms must say so. Loyalty/rewards regulatory treatment `[VALIDATE-KSA]`.
- **Reward value, expiry and redemption catalogue (what points can be spent on): FOUNDER DECISION REQUIRED** (FD-21, FD-62, FD-63). The Rewards Engine is built configurable so these can be set without redesign.
- **Liability accounting**: outstanding points are a liability; reporting and expiry policy required (FD-62).
- **Merchant-funded prizes**: inventory held in campaign; claim flow, fulfilment via voucher/code/in-store.
- Exchange rate/point value in currency terms: FD-63.

## 29. Fraud / risk requirements

| Area | Control | Phase |
|---|---|---|
| Duplicate accounts | Mobile uniqueness, device/ID linkage, email domain patterns, similarity rules | MVP |
| Suspicious viewing | Server-verified view tokens, velocity limits, device caps, pattern flags | MVP |
| QR abuse | Signed single-use codes, rate-limited scan attempts, screenshot/replay detection (rotating QR optional) | MVP/P2 |
| Duplicate redemption | Atomic state change, idempotency keys | MVP |
| Voucher abuse | Purchase velocity, refund-abuse detection, resale detection | MVP basic |
| Suspicious rewards | Cap enforcement, anomaly alerts, hold windows | MVP |
| Device abuse structure | Device ID registry, device↔account graph, blocklists | MVP structure, P2 sophistication |
| Merchant fraud | Fake deals, self-dealing (merchant staff redeeming own offers), price inflation | MVP (review + flags) |
| Staff fraud | Redemption anomalies per staff/branch | P2 |
| Payment fraud | PSP 3DS/risk tools | MVP via PSP |
| Account takeover | OTP limits, session controls, step-up for sensitive actions | MVP |

Workflow: signals → risk score/flag → review queue → decision → action (hold rewards, block, suspend) → audit. Customer appeal path: FD-64.

## 30. Customer support requirements

- Case management: channels (in-app, email; phone/chat FD-65), categories (payment, voucher, redemption, reward, merchant complaint, account), priority, SLA timers, assignment, internal notes, templates, attachments.
- Customer 360 view for agents (permissioned, masked PII).
- Actions available to support: resend voucher, issue refund (≤ limit), reverse redemption request, reward adjustment request, suspend/reactivate (escalate).
- Merchant complaints, disputes with merchants, partner support queues.
- Merchant/partner help centre and ticketing (MVP basic).
- Quality: CSAT (P2).

## 31. Reporting requirements

| Audience | Reports | Phase |
|---|---|---|
| Customer | Order history, rewards history | MVP |
| Merchant | Campaign performance funnel (impressions → detail views → saves → reservations → purchases → redemptions), voucher sales/redemptions, W&E delivery & spend, statements | MVP |
| Partner | Eligible customers (aggregate), offer usage, merchant participation, campaign results | MVP basic |
| Admin Ops | Approvals queue/SLA, active offers, redemption volumes | MVP |
| Finance | Transactions, refunds, settlement, reconciliation, fees/revenue, rewards liability | MVP |
| Risk | Fraud flags, outcomes | MVP |
| Executive | GMV, MAU, conversion, retention, unit economics | MVP basic, P2 deep |

Exports: CSV; PII exports permissioned and audited. Metric definitions must be fixed in a data dictionary (e.g. "active user", "qualified view", "conversion") — to be written in the next phase.

## 32. Notifications

Channels: push, SMS, email, in-app. Cost-controlled SMS (OTP, critical only).

| Audience | Examples |
|---|---|
| Customer | OTP, welcome, voucher issued/expiring, reservation confirmed/ending, Exclusive Deal near you (opt-in), reward earned/expiring, refund status, case updates, eligibility verified |
| Merchant | Application status, offer approved/rejected, Exclusive Deal sold out, voucher sold, W&E budget low/complete, settlement paid, redemption alerts |
| Staff | Invite, access changes |
| Partner | Approval, campaign events, reports |
| Internal | Approval queue, fraud alerts, failed payments |

Rules: preferences & consent per channel; marketing vs transactional split; quiet hours; frequency caps (FD-66); templates with localisation; delivery logs.

## 33. Audit requirements

- Immutable, append-only log: who (principal, role, org), what (action, object, before/after), when, where (IP/device), why (reason for sensitive actions).
- Mandatory events: auth events, role/permission changes, approvals/rejections/suspensions, offer edits, price changes, refunds, reversals, settlement actions, bank detail changes, reward adjustments, eligibility changes, data exports, config changes, viewing sensitive PII.
- Searchable by Compliance/Super Admin; tamper-evident; retention period FD-67.
- Customer-facing activity history for own account (security events).

---

## 34. MVP / Phase 2 / Phase 3 classification

### MVP (controlled commercial pilot: Riyadh, SAR, Arabic + English)

**All four core products are in the MVP:** Live Deals, Exclusive Deals, Vouchers, Watch & Earn. They may be built sequentially (section 36) but all are available for the controlled commercial pilot. Play & Win is Phase 2.

**Customer:** onboarding (mobile OTP, profile, consents), Arabic/English with RTL, discovery/search/nearby, Live Deals (discovery metrics incl. directions clicks and merchant page visits), Exclusive Deals (countdown, stock, **reservation with prepayment / deposit / card pre-authorisation**, free only by admin policy — 2026-10-15), Vouchers (buy via PSP, wallet, QR, refund), Watch & Earn (watch, earn non-cash rewards, wallet), employer verification, issuer/card selection eligibility, notifications, support, account deletion.
**Merchant Portal:** onboarding + approval, profile/branches/hours, staff & roles, Live/Hot/Voucher/Watch&Earn creation, redemption history, core analytics, statements/settlement view.
**Staff interface:** full scan → validate → redeem flow.
**Partner Portal (one architecture):** onboarding, profile, users, eligibility config, partner-specific offers, basic reporting; Bank (products/tiers/BINs), Scheme (profile, eligibility), Employer (domains, employee-only offers).
**Admin:** customers, merchants, partners, approvals, payments/refunds/reconciliation basics, settlement (semi-manual), rewards (rules/ledger/adjust), W&E monitoring, fraud queue, support cases, roles, audit, system config, basic reporting.
**Platform:** Auth, RBAC, orgs, Offer (Live/Hot) domain, Voucher domain, Watch & Earn Campaign domain, Eligibility/Reservation/Payment (PSP abstraction)/Redemption/Rewards/Notification engines, guardrails (tiered approval) service, geo search, analytics events, fraud rules, audit log, ledgers.

### Phase 2

~~Exclusive Deal deposits / partial payment~~ (moved to MVP 2026-10-15; real card-hold provider deferred); Play & Win; partner-funded campaign self-serve; merchant subscription billing; auto-reconciliation and automated payouts; gifting/transfer of vouchers; referrals; membership tiers; partial redemption and bill amount; check-in/visit verification; richer fraud (device attestation, graph); staff reversal-request workflow; bulk tools; advanced analytics; CSAT; multi-language expansion.

### Phase 3

POS integrations; issuer-side verified eligibility/offer linking (card-linked offers); ML personalisation and ranking; programmatic/auction pricing for W&E; offline staff mode; open APIs for partners; multi-country/multi-currency; advanced finance (partner funding invoicing, tax automation).

---

## 35. Module dependencies

```
Auth/Users/Orgs ─► RBAC ─► (every portal)
Orgs + Docs ─► Merchant/Partner onboarding ─► Admin approval ─► Activation
Merchant activation ─► Offer Engine ─► Approval workflow ─► Search/Geo ─► Customer discovery
Customer profile ─► Eligibility Engine ─► Offer visibility/claims
Payment Engine ─► Voucher Engine ─► Redemption Engine ─► Settlement
Offer domain (Live/Hot) + Inventory ─► Reservation Engine (Exclusive Deals) ─► Redemption   [prepayment / deposit / card hold via Payment = MVP, 2026-10-15]
Watch & Earn Campaign domain ─► View ledger ─► Fraud rules ─► Rewards Engine ─► Rewards ledger
Guardrails service ─► (Offer | Voucher | W&E) publish decisions
Everything ─► Audit, Notification, Analytics events
Support ─► (reads) Payments, Rewards, Redemption, Customers
```

Critical path: **Identity/RBAC → Orgs → Offer + Eligibility → Payments + Voucher → Redemption → Settlement**. Watch & Earn is a parallel track depending on Campaign + Rewards + Fraud.

## 36. Recommended implementation sequence

| Stage | Scope | Outcome |
|---|---|---|
| 0 | Founder decisions (critical FDs), market/legal/PSP choice, data dictionary, API/data model design | Locked specs |
| 1 | Foundations: identity, orgs, RBAC, audit, config, design system/tokens, infrastructure | Platform skeleton |
| 2 | Admin core + Merchant onboarding/approval + profile/branches/staff | Merchants can be onboarded |
| 3 | Offer domain (Live Deals) + guardrails service + Search/Geo + Customer app discovery (AR/EN, RTL) | Browsable marketplace |
| 4 | Eligibility Engine + Partner Portal (employer first, then bank/scheme) | Targeted offers |
| 5 | PSP integration + Voucher domain + Redemption + Staff interface | First revenue flow |
| 6 | Exclusive Deals (inventory, reservation; commitment model added 2026-10-15 in four build phases) | Real-time demand tool |
| 7 | Rewards Engine + Watch & Earn Campaign domain + Fraud rules | Engagement product |
| 8 | Settlement, reporting, support, notifications hardening | Operational completeness |
| 9 | Security review, load/pen testing, Saudi legal/payment/privacy validation sign-off, pilot readiness, runbooks | Pilot launch (all four products) |
| 10 | Phase 2 backlog by pilot learnings | Scale |

Each stage ends with a demo, acceptance criteria, and updating this blueprint.

## 37. External integrations likely required

| Need | Examples / type | Phase |
|---|---|---|
| Payment gateway(s) / split payments | PSP (market-dependent) | MVP |
| SMS/OTP provider | SMS gateway, WhatsApp (optional) | MVP |
| Email delivery | Transactional email service | MVP |
| Push notifications | FCM/APNs | MVP |
| Maps / geocoding / places | Maps provider | MVP |
| Object storage + CDN + video delivery/transcoding | Cloud storage, video streaming service | MVP |
| BIN lookup / card metadata | BIN database or PSP-provided | MVP/P2 |
| KYB / sanctions screening | Identity & business verification vendor | MVP (manual) → P2 (automated) |
| E-signature | For merchant/partner agreements | P2 (MVP: click-accept) |
| Bank account verification | Penny-drop / name match | P2 |
| Device fingerprint / attestation | Fraud vendor, Play Integrity/App Attest | P2 |
| Analytics/product telemetry | Event pipeline, BI tool | MVP basic |
| Accounting/ERP | Invoicing/ledger sync | P2 |
| Support tooling | Helpdesk (or built-in) | MVP built-in or vendor (FD-65) |
| Card-scheme/issuer APIs | Offers/linking | P3 |
| POS | Merchant POS | P3 |
| Crash/monitoring | Observability | MVP |

---

## 38. Major gaps and decisions still unresolved

### 38.1 FOUNDER DECISION REQUIRED register

**Customer & identity**
- FD-01 Is customer email verified (OTP/link) or just collected?
- FD-02 Is gender required, optional or "prefer not to say"? (Also: is it needed at all for targeting?)
- FD-03 Minimum customer age; handling of minors.
- FD-04 Guest browsing allowed before sign-up?
- FD-05 Employer verification validity period and re-verification; behaviour on leaving employer.
- FD-06 Multiple employers per customer? Personal-email-domain employers? Shared mailboxes?
- ~~FD-07~~ RESOLVED v0.2: issuer/card selection and/or limited BIN/IIN metadata; no PAN/CVV; token/issuer verification later.
- FD-08 (narrowed) Do we offer card-restricted *vouchers* at pilot (checkable via PSP card metadata at purchase)? Offline card offers rely on terms only.
- ~~FD-23~~ RESOLVED v0.2: Arabic + English, RTL-ready. (Remaining: translation ownership and Arabic copy/moderation process.)
- FD-22 Membership/status tiers: do they exist, and when?

**Merchant & partner onboarding**
- FD-09 Bank-account verification method.
- FD-10 Agreement: click-accept vs e-signature vs signed PDF.
- FD-11 KYB/sanctions screening depth at launch.
- FD-12 Chains/franchises: entity structure and permissions model.
- FD-13 Staff authentication method (OTP, PIN, password).
- FD-14 Bank/scheme funding model and who pays for card-specific offers.
- FD-15 What scheme/issuer-level reporting is contractually allowed.
- FD-16 Use of Visa/Mastercard/Amex marks and legal clearance.
- FD-17 Employer proof of domain ownership method.
- FD-18 Mandatory MFA for internal users (recommended yes for Admin/Finance/Risk).
- FD-19 Maker–checker (dual approval) for sensitive actions and thresholds.
- FD-30 Whether merchant Admin role can edit bank details or Owner only.

**Offers, campaigns, approvals**
- ~~FD-20~~ RESOLVED v0.2: deposits are Phase 2 (architecture-ready) unless a specific pilot requires them. **RE-DECIDED 2026-10-15: deposits / prepayment / card pre-authorisation are MVP (RC rules).**
- ~~FD-24~~ **CLOSED** (founder-approved architecture, Oct 2026): merchant, bank, scheme and corporate subscriptions / licences are
  Contracts of a commercial kind on the Business Account, driven by versioned plan templates and the one entitlement model; current
  Pakistan configuration (Starter PKR 0, Growth PKR 4,999 / month, Business PKR 14,999 / month, Enterprise negotiated; bank, scheme and
  corporate licences and the product price book) is data, not code. See `SUBSCRIPTION_LICENSING_ENTITLEMENT.md`.
- FD-25 Partial redemption / bill-amount entry at launch?
- FD-26 Staff interface as PWA/web vs native app.
- FD-31 Refund/adjustment approval thresholds per role.
- FD-32 Funding allocation of discounts (merchant/partner/DealDash).
- FD-33 Offer stacking policy.
- FD-34 Ineligible offers: hidden or shown locked?
- FD-35 Ranking/feed logic and sponsored placement rules.
- FD-36 Sponsored labelling and paid placement.
- FD-37 (narrowed; model decided in 19.2) Pilot defaults only: which campaign types auto-publish vs manual review at launch, merchant trust levels, review SLAs. Configuration, not an architecture blocker.
- FD-38 Effect of suspension on already-issued vouchers/reservations.
- FD-44 Which fields can change on live offers without re-approval.
- FD-57 Visit/check-in signals for Live Deals (measurement).
- FD-58 When Live Deals should require a code/claim ("controlled rules").

**Vouchers & Exclusive Deals**
- FD-41 When merchant payable accrues: at sale or at redemption.
- FD-45 Voucher gifting/transfer.
- FD-46 Refund and expired-voucher policy (legal by jurisdiction).
- FD-47 Exclusive Deal hold duration.
- FD-48 No-show penalties, strike system.
- ~~FD-42~~ DECIDED 2026-10-15: deposit capture / forfeit / refund rules = RC-40 to RC-72 (values are admin policy).
- FD-56 Redemption reversal window and who may reverse.

**Watch & Earn & rewards**
- FD-21 (narrowed) Reward redemption catalogue: what points can be used for. Cash-out is excluded in MVP (non-cash, non-withdrawable, non-transferable).
- FD-49 Prize mechanics (random draw, first-come, tiered).
- FD-50 Pricing to merchants per qualified view.
- FD-51 DealDash margin vs reward cost per view.
- FD-52 Qualified-view definition (watch time, uniqueness, repeat).
- FD-53 Per-customer daily/weekly view and earning caps.
- FD-54 Unused-budget handling (refund / extend / credit / retain).
- FD-55 Confirm merchants pay only for verified qualified views.
- FD-62 Points expiry and liability accounting policy.
- FD-63 Point-to-currency value.
- FD-64 Customer appeal process for fraud actions.

**Finance, legal, operations**
- FD-29 Settlement cycle, minimum payout, reserves, manual vs automated at pilot.
- FD-40 Merchant offboarding / wind-down rules.
- FD-43 Invoicing and tax requirements.
- FD-59 Merchant-of-record and payment flow model. **VALIDATION REQUIRED** (Saudi legal + PSP) before production launch; not concluded.
- FD-60 Regulatory/licensing position (voucher funds, escrow, payment licensing, rewards, data protection). **VALIDATION REQUIRED** `[VALIDATE-KSA]`.
- ~~FD-61~~ PARTLY RESOLVED v0.2: Saudi Arabia, Riyadh pilot, SAR, Arabic + English. VAT/e-invoicing/tax regime remains **VALIDATION REQUIRED**.
- FD-39 Support SLAs.
- FD-65 Support channels (phone/chat) and helpdesk tooling.
- FD-66 Notification frequency caps and quiet hours.
- FD-67 Audit/data retention periods.
- FD-27 Minimum cohort size for partner aggregates: **FOUNDER DECISION REQUIRED / PRIVACY VALIDATION REQUIRED**.
- FD-28 (default decided: aggregate only) Any customer-level sharing needs approved legal basis, consent where applicable, and explicit DealDash permission; specific cases to be decided with privacy counsel.

### 38.2 Major gaps and risks identified

1. **Saudi legal/payment/privacy validation is now the highest-leverage dependency.** Market is set (KSA/Riyadh/SAR/AR+EN) but VAT, PSP licensing, voucher-fund treatment, loyalty rules and PDPL privacy are unvalidated. (FD-59/60/43)
2. **Payments/regulatory model** (merchant of record, holding voucher funds) can change settlement design and timeline; ledger is built model-neutral to limit rework.
3. **Live Deals have no natural conversion event.** Without code/claim, measuring merchant ROI is weak; this may undermine the merchant value proposition and renewal. (FD-57/58)
4. **Two-sided cold start:** a pilot needs enough merchants *and* customers in a tight geography; scope pilot city/category deliberately.
5. **Watch & Earn economics:** reward cost vs merchant price vs fraud leakage can make it loss-making; needs a model before build. Fraud pressure is highest here.
6. **Card eligibility is hard without issuer integration;** self-declared eligibility is easy to abuse. Consider restricting card-specific offers to ones verified at payment.
7. **MVP breadth is large** (four products, five surfaces, bilingual/RTL). Founder decision: all four products are in the pilot MVP, built sequentially (section 36). Main risk is schedule; mitigate with strict per-stage acceptance criteria and a stable shared-services core.
8. **Exclusive Deal operations:** time-sensitive approval vs manual review bottleneck; inventory concurrency; no-show handling.
9. **Staff fraud and collusion** (merchant staff self-redeeming, fake redemptions) not solvable by tech alone; needs monitoring and commercial terms.
10. **Video content cost and moderation** (storage, transcoding, bandwidth, inappropriate content) is material.
11. **Privacy/consent:** location, DOB, gender, employer, card data are sensitive; data-protection impact assessment recommended before launch.
12. **Employer verification by work email OTP** can be bypassed by ex-employees whose mailboxes persist; mitigated by re-verification.
13. **No explicit analytics definitions yet** — metric definitions must be fixed before building dashboards.
14. **Customer design baseline not yet in workspace.** The existing 63-screen customer UI/UX is the baseline (it already covers Exclusive Deal reserve/reservation, voucher checkout/redemption, Watch & Earn, Reels, still-watching checks, reward unlocking and rewards). Once added, audit it against this blueprint. Known remaining design work: Arabic/RTL variants, and the Merchant, Staff, Partner and Admin experiences.
15. **Operational capacity:** support, merchant onboarding review and fraud review need people/processes, not just software.

---

## Appendix A — Design principles (from brief, to be preserved)

**Design assets now available in the workspace (2026-10-07):** `Figma Files\` is the official existing DealDash customer UI/UX reference and the customer-facing design baseline. Contents: `dealdash-figma\png\` (63 exact 2x renders, the visual reference), `dealdash-figma\svg\` (63 editable vector frames, generated from the prototype), `dealdash-prototype.html` (live prototype), `design-tokens.json` (light/dark colours, Plus Jakarta Sans type scale, radii, shadow, spacing; 390px frame width), `overview-board.png` and `README.md`. The 63-screen inventory (01 Sign in → 63 Business - Create Exclusive Deal) is confirmed complete: sections Start, Home, Explore & offers, Deal pages & sheets, Checkout & codes, Merchant pages, Watch & Win, Rewards, Profile & cards, Business console. The Customer App is not to be redesigned from scratch. The detailed screen-by-screen audit (mapping to this blueprint, scope conflicts such as Play & Win/gifting/deposits, Arabic/RTL, orange usage, and the missing merchant/staff/partner/admin screens) is deferred to the UX Architecture stage.

**Design baseline:** the founder's existing DealDash customer UI/UX design (63 screens) is the customer-facing baseline once added to the workspace. The Customer App will not be redesigned from scratch. When the files arrive: inventory screens, map them to this blueprint, list gaps (e.g. RTL/Arabic, states, errors), and propose only usability-driven changes for approval.

Premium, modern, clean; white/light-lavender backgrounds; deep navy typography; DealDash purple primary accent; rounded cards; restrained borders/shadows; bold modern type; high-quality food/retail/lifestyle/service imagery; clear hierarchy; avoid orange-heavy palette, clutter, and generic coupon look. Wordmark: "Deal" in navy + "Dash" in purple. Do not redesign the customer experience unless a genuine usability problem is identified.

## Appendix B — Suggested next documents (after approval)

1. Data dictionary & metric definitions
2. Domain/data model and state machines
3. Permission catalogue (role × permission)
4. API and event catalogue
5. Screen inventory per portal
6. Technical architecture & security/compliance plan
7. Pilot plan (city, categories, merchant targets, success metrics)

— End of blueprint v0.1 —


---

## Addendum (Oct 2026) — Subscription, licensing & entitlement engine (FD-24 CLOSED)

The commercial plan engine extends the existing Business Account → Legal Entity → Contract → ContractEntitlement foundation (no parallel
model): versioned plan templates, enterprise licences as contract kinds (merchant, bank, scheme, corporate, custom), effective entitlement =
plan default + override + add-on, usage limits (hard / soft), amendments for every commercial change, immutable acceptance, a pricing engine
that retains its version on every event, suspension that blocks only new exposure and never customer rights, and hooks for Phase 5 billing
(standard billing events, financial-status interface) and Phase 4 alerts (signals). The Pakistan configuration is data. Specification:
`SUBSCRIPTION_LICENSING_ENTITLEMENT.md`; screens: merchant "Plan and usage", admin "Subscriptions"; Figma: `SUBSCRIPTION_FIGMA_HANDOFF.md`.

---

## Addendum (Oct 2026) — Founder approvals: subscription freeze and EXCLUSIVE DEAL terminology

**SUBSCRIPTION / LICENSING / ENTITLEMENT ARCHITECTURE: FOUNDER APPROVED AND FROZEN** (approval record:
`SUBSCRIPTION_LICENSING_ENTITLEMENT.md` §17). **Stage 4 Exclusive Deal commercial regression fix: FOUNDER APPROVED.** FD-24 remains
CLOSED. Add-on pricing remains CONFIGURABLE / TO BE COMMERCIALIZED. Hard pre-launch rule: every real pilot / production Business
Account has an explicit Merchant Plan or Enterprise Contract / Licence before commercial launch.

### Terminology (founder decision)

The approved product name is **EXCLUSIVE DEAL / EXCLUSIVE DEALS**. "Hot Deal(s)" must not be used as a business or product name in
customer, merchant or Admin UI, documentation, business rules, API descriptions, Figma / handoff, future implementation or (where
practical) test descriptions, and must not be reintroduced.

**Legacy internal identifiers (temporary; never shown to users; migrate later only through a controlled refactor):**
API module `apps/api/src/hot-deals/*` (e.g. `hot-commercial.adapter.ts`, `hot-core.service.ts`, `merchant-hot-deals.*`,
`admin-hot-deals.controller.ts`, `customer-hot.controller.ts`); database models / enums `HotDeal`, `HotDealInventory`, `HotDealHistory`,
`HotDealStatus`, `HotDealAction`, `HotDealLimitType`; HTTP paths `…/hot-deals…`; app routes `admin /hot-deals`, `merchant /deals/hot`,
`customer /hot`; UI files `hot-*.tsx`, test ids `hot-*`, dictionary key prefixes (e.g. `mhb.`), seed names `seed-hot-*`. The commercial
product code is already `EXCLUSIVE`. New code and domain naming must use Exclusive Deal.

**Terminology migration: COMPLETE (LR-SUB-05 CLOSED, Oct 2026).** Every customer- and business-facing string (customer app, merchant
portal, staff, admin, shared components, dictionaries EN + AR, API messages), test expectations, browser checks, Figma / handoff text and
current documentation now say **Exclusive Deal / Exclusive Deals** (Arabic: the already-approved **عرض حصري / العروض الحصرية**; the
card badge reads EXCLUSIVE / حصري). The identifiers listed above remain as **LEGACY INTERNAL NAME — NOT USER FACING**; they are not an
open product-name defect and are renamed only through a future controlled refactor. Lines that state the former name on purpose (this
terminology rule) are the only remaining prose mentions.

## Addendum (Oct 2026) — Phases 4 and 5: Visibility / Operations and Billing / Finance / AI (awaiting approval)

The last two pre-Stage-7 shared-platform phases are built on the modular monolith (no Kafka, no microservices). Stage 7 has not started.

- **Phase 4 — Visibility and operations** (`docs/PHASE4_VISIBILITY_OPERATIONS.md`): one governed analytics taxonomy projected from the
  sources of truth (append-only, idempotent; engagement is never a verified outcome), hourly aggregates, hierarchical reporting
  (Business → Country → Legal entity → Brand → Region → City → Branch → Campaign) enforced by role + scope + legal entity + entitlement,
  targets with Target vs Actual, Expected-to-date and a forecast always labelled as an estimate, early-warning alerts for every risk in the
  brief, configurable alert rules, personal notification preferences, escalation, actionable alerts that still go through RBAC /
  maker-checker / acceptance, the Operations Command Centre, integration monitoring with staleness, a customer support timeline, and the
  performance-to-finance linkage.
- **Phase 5 — Billing and finance** (`docs/PHASE5_BILLING_FINANCE.md`): the same finance platform, now with legal-entity billing accounts
  and finance scope, collection rules that bill each event exactly once, quotation expiry / rejection / modification requests, the full
  document set with database-enforced immutability and maker-checker issue, receivables (partial payments, unallocated credit, aging,
  disputes, statements), purchase orders, credit exposure including receivables, controlled multi-currency (approved FX only), and
  reconciliation by business account, legal entity, product, campaign, funding party, merchant, sponsor and currency with product flow
  checks. Overdue invoices are reported in the financial status; enforcement remains a Finance decision unless switched on.
- **Phase 5 — Governed AI** (`docs/AI_AGENTS.md`): Agent → authorised tool → existing service as the requesting person → audit. Five agents
  (Customer Best-Deal, Merchant Growth, Bank / Scheme / Partner foundation, Operations & Support, Admin / Finance), autonomy L0–L3 in the
  MVP (L4 disabled, L5 refused), AI_COPILOT entitlement, grounding check, labelled statements, human approval before any execution,
  append-only audit and usage metering (not priced), evaluation pack.
- Screens (EN / AR, RTL, phone width): merchant Performance, Billing, Assistant; admin Command Centre, Analytics, Billing, AI governance;
  customer Best-deal assistant. Partner portal screens remain Stage 7 (partner APIs exist).


## Founder approval (2026-10-09) — PHASES 1–5: FOUNDER APPROVED AND FROZEN

Phase 4 (Visibility / Operations) and Phase 5 (Billing / Finance / Governed AI) are approved and frozen as the founder-approved baseline,
together with Phases 1–3 and the subscription / licensing / entitlement engine. The QA fixes and regression tests identified during final
validation are part of the frozen baseline and must be preserved. Stage 7 has NOT started.

Founder clarifications recorded with the approval:
1. **Currency.** The Saudi MVP does not require a full multi-currency general ledger, and none is to be built now. The architecture must
   keep supporting configurable transaction, billing and settlement currency and an approved FX rate / source / date where applicable, for
   future Pakistan, Qatar, UAE, KSA and other market deployments (already in place: per-document currencies, `FxRate` with maker-checker).
2. **VALIDATE-KSA launch-readiness items** (do not reopen Phase 4 or 5): Saudi tax invoice format / numbering; write-off treatment;
   FX-rate source; AI data residency; AI consent wording; native Arabic review.
3. **Legacy names.** Internal `HotDeal*` and `*Halalas` identifiers may remain only where already documented as legacy internal
   implementation names; they must not be used in new user-facing or business-facing development.
4. **TR-01** (Watch & Earn player timing test) stays a monitored reliability item; it is not a regression unless it reproduces consistently.
5. Stage 7 is not to be started until separately instructed.

## Addendum (Oct 2026) — Market / country configuration (pre-Stage-7 hardening, awaiting approval)

DealDash launches country by country. GLOBAL → REGION (grouping only) → COUNTRY / MARKET → LEGAL ENTITY → BRAND / OPERATING ENTITY →
REGION / CITY → BRANCH / OUTLET. The market — never the region — drives tax, currency, invoicing, payments, settlement, regulation, product
availability, customer / legal wording, local providers and launch state. The existing CountryConfiguration was extended into the one
market master with a lifecycle (PLANNED → CONFIGURING → TESTING → PILOT → ACTIVE, SUSPENDED, CLOSED), an activation gate with a second
approver, per-market product availability, effective-dated tax / invoice / settlement / policy configuration, local providers (references
only, never secrets), a central validation register (VALIDATE-KSA / UAE / QATAR / PAKISTAN) and audit. Details:
`docs/MARKET_COUNTRY_CONFIGURATION.md`. Stage 7 consumes this architecture; it does not build its own market logic.
## Founder approval (2026-10-09) — MARKET / COUNTRY CONFIGURATION: FOUNDER APPROVED AND FROZEN

The Market / Country Configuration architecture is approved and frozen as the founder-approved baseline: Global → Region → Country /
Market hierarchy, market lifecycle, product availability by market, effective-dated tax, invoice, currency, payment and settlement
configuration, legal entity / contract market scope, market-specific pricing, KYB/KYC readiness, privacy / consent / residency, provider
configuration, the Market Admin workspace, the activation gate, the market validation register (VALIDATE-KSA / UAE / QATAR / PAKISTAN),
RBAC / scope, audit / versioning and the Arabic / RTL handoff.

Founder rules recorded with the approval:
1. Stage 7 does not redesign this architecture.
2. Stage 7 consumes the shared Market / Country framework (MarketService, MarketConfigService, MarketReadinessService, COUNTRY scope).
3. No country-specific tax, currency, provider, pricing, invoice or settlement rule is hard-coded in the Partner Portal.
4. Effective dating and historical financial / configuration records are preserved.
5. A market cannot become ACTIVE unless its mandatory readiness configuration is complete.
6. Stage 7 is not started until separately instructed.
<!-- stage7-addendum -->
## Addendum (Oct 2026) — Stage 7: Enterprise Partner Portal (awaiting founder approval)

Banks, financial institutions, card schemes, corporates / employers and strategic partners use the Partner Portal, another governed
front end on the one platform: Business Account → Legal Entities → Markets → Contract / Enterprise Licence → Entitlements → Roles +
Scope. Partners onboard through a readiness lifecycle (second DealDash approver for activation), manage users with delegated, scoped
administration, run a merchant network (manual / bulk / API through the one ingestion pipeline; referenced vs registered merchants;
provenance; duplicate review), build eligibility rules on the shared engine (card programmes keep BIN prefixes only), create
Exclusive Deals and Vouchers on the shared engines at registered network merchants (partner = creator / owner, merchant = fulfilment
and approves its own obligations), add partner benefits to public Live Deals, sponsor Watch & Earn points through loyalty rules, and
see aggregate performance, finance, alerts, tasks and the governed copilot. Details: `docs/STAGE7_PARTNER_PORTAL.md`.

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

Stage 7 Enterprise Partner Portal is founder approved and frozen; the addendum above no longer "awaits approval". Founder decisions
(all CLOSED): FD-S7-1 YES — an authorized partner may be the Sponsor / Funder and own a Watch & Earn budget (contract, entitlement,
market, finance readiness, pricing, commercial acceptance and approval apply; DealDash keeps points economics, qualification, fraud and
reward rules). FD-S7-2 NO — the frozen Phase 2 shared import / integration routes are unchanged; partner entitlement is enforced only
on the Partner Portal routes. FD-S7-3 — card issuer / product / tier is VERIFIED only with trusted evidence (issuer / scheme API,
approved partner feed, tokenized mechanism, other approved source); BIN metadata or a declaration is never "verified". FD-S7-4 YES —
authorized banks, schemes and partners create / import Live Deals from their merchant networks where publication rights are confirmed,
on the existing master data / provenance architecture, without giving the merchant any controlled capability. Details:
`docs/STAGE7_PARTNER_PORTAL.md` ("Founder decisions").

## Addendum (Oct 2026) — Stage 8: Operational Gap Closure & Admin Operations (awaiting founder approval)
Stage 8 adds the daily operating layer on the shared engines (no new product, no redesign of frozen stages): one case framework (16
types, configurable lifecycle, routing, SLA, maker-checker resolution), customer support workspace, refund / adjustment /
settlement / reconciliation operations, rule-based fraud review, restrictions and holds that stop new actions only, reviews and
moderation (Verified only with a tracked merchant interaction; Watch & Earn never counts), notification delivery tracking, SLA and
escalation, versioned rules and controls, operational reports, audit completeness, privacy data requests and an operations copilot
that executes only after human approval. Full description and gap audit: `docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md`.
## Stage 8 founder approval (2026-10-10): APPROVED AND FROZEN
Stage 8 Operational Gap Closure is founder approved and frozen (docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md). B8 closed (partner "Add a merchant" Stage 7
compatibility fix, now part of the frozen Stage 7 baseline); B9 monitored, not a regression. Pre-pilot items B1–B7 remain open for Stage 9 /
pilot readiness; VALIDATE-market items remain central. Stage 9 not started.

## Addendum (Oct 2026) — Stage 9: Production & Public Launch Readiness (awaiting founder approval)
Stage 9 prepares DealDash to launch without launching it: a production boot safety check, hardened runtime (structured redacted logs,
rate limits, security headers, health / readiness), verified backup and restore, CI / release engineering with a manual protected
production gate, and the pre-pilot items: B1 configurable settlement rule fields (values VALIDATE-KSA), B2 payout instructions (manual
by default), B3 notification throttle / fallback / receipts, B4 proportional points reversal, B5 Arabic review workflow, B6 customer
case replies in the app, B7 structured, governed Rules and controls editor; plus launch controls (pilot allowlist, per-market
emergency stops) and legal holds. No vendor is selected, no regulatory question is answered, no penetration or device test has been
performed. Go-live is NOT READY by design (hosting, providers, VALIDATE-KSA answers, UAT). Full description, KSA checklist and audit:
`docs/STAGE9_PRODUCTION_LAUNCH_READINESS.md`; operations: `PRODUCTION_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `GO_LIVE_CHECKLIST.md`.

## Stage 9 founder approval (2026-10-11): APPROVED AND FROZEN — technical readiness only
Stage 9 Production & Public Launch Readiness is founder approved as technically complete and frozen
(docs/STAGE9_PRODUCTION_LAUNCH_READINESS.md). This does NOT approve public launch: production readiness is pending and public launch is
not authorized. Still open: hosting / production environment, production database, secrets / configuration, vendor selections, payment
and payout production setup, SMS / OTP / email / push providers, penetration testing, native Arabic review, physical device testing,
formal UAT, backup retention, RPO / RTO, manual payout process (if used), GitHub production reviewers, VALIDATE-KSA items, final go-live
checklist (NOT READY). No Stage 10.
