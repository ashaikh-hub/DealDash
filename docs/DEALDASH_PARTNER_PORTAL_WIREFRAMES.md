# DEALDASH PARTNER PORTAL: UX / WIREFRAME ARCHITECTURE

Version 0.1 (draft for approval) · 2026-10-07
Scope: **one shared Partner Portal** for **banks / card issuers**, **card schemes / payment networks** and **employers / corporates**. Visual UI design is a later stage.
Inputs: Master Blueprint v0.2.2 (partner rules), Business Rules (EL-, EM-, BC-, PR-, AU-), UX Architecture (earlier PP inventory), Admin Portal wireframes v0.2 (partner review, BIN/domain verification, data-sharing permission, cohort threshold), Merchant Portal patterns.
Output: structural wireframes in text. No production code.

> **Partner Portal status (approved):** structurally and visually **frozen for MVP**. FDP-02 to FDP-11 remain configurable / default-driven decisions unless later specifically approved; none blocks MVP architecture or development. Remaining VALIDATE-KSA items stay open for external validation. Partner Portal QA items (tablet, keyboard/screen-reader, real-data, native Arabic, contrast, unchecked drawers/modals and RTL pages) may be completed later and do not block the next stage.

## 0. Principles and conventions

| Principle | Meaning here |
|## DECISIONS APPLIED (v0.2): supersede conflicting text below

### FDP-01 closed: partners do NOT self-publish campaigns in the MVP
For MVP, banks, card schemes and employers **do not directly self-publish campaigns**. The Partner Portal lets them:
1. **create campaign proposals**;
2. **define intended eligibility**;
3. **select or request participating merchants** where permitted;
4. **define dates**;
5. **define budget** where applicable;
6. **provide customer-facing content** (AR/EN);
7. **submit the campaign to DealDash**;
8. **receive approval, a request for changes, or rejection**;
9. **monitor approved campaign performance**.

**DealDash retains final campaign approval and activation authority for MVP.** Partners can edit a proposal only while it is **Draft** or **Needs changes**; once **Approved / Scheduled / Live**, any material change must return to DealDash review (a "Request a change" action, not direct editing). Full partner self-service publishing may be considered in **Phase 2**, after controls, guardrails and operating processes are proven. This replaces the earlier "partner-funded campaigns self-serve" wording; it is consistent with the proposal builder (P06) already specified.

### Navigation refinement (v0.2)
Common items: **Dashboard Â· Campaigns Â· Eligibility Â· Merchants Â· Reports Â· Organization Â· Users Â· Support**, Settings in the footer. **Additional type-specific item:** **Cards** (bank), **Issuers** (scheme), **Employee verification / Domains** (employer). *Eligibility* is the common rules area (rule list and the P08 builder); the type-specific item holds the type's own configuration (the P07 tabs: Card portfolio / Network profile and issuers / Company, domains and verification). Counting stays 14 core pages; P07 is the type-specific page and **P08 the Eligibility Rule Builder**; **P05 is the Campaign Proposal Detail** with Bank/Scheme/Employer variants and tabs **Overview Â· Eligibility Â· Merchants Â· Content Â· Budget Â· Performance Â· Activity** (Content split out of the earlier combined tabs).

## DECISIONS APPLIED (v0.3, visual direction approved)

### D-P1. Small-cohort privacy: merged-remainder rule (approved)
When one or more report cells fall below the configurable cohort threshold (**initial pilot product setting: 10 customers**), totals and surrounding values must **not allow the hidden value to be reconstructed by subtraction**. Where necessary:
1. merge small cohorts into an **"Other / suppressed"** group (itself suppressed if the merged group is still below the threshold);
2. **suppress related totals** ("Total not shown because a related group is hidden");
3. **suppress adjacent breakdowns** (e.g. a percentage-of-total that would reveal the hidden remainder; use counts without a total, or hide the breakdown);
4. never rank or sort by a hidden value; never show a hidden value as "<10" next to a visible total.
Uses the existing configurable setting. This is a **privacy / product control, not a final legal conclusion**; **VK-12 remains open**.

### D-P2. Eligible reach shown as rounded range (approved)
Reach is shown as a **rounded range or approximation** (e.g. "1,000–1,250 eligible customers", "~5,000 eligible customers"), never an unnecessarily precise count. Exact small populations are never revealed; below the threshold the value is replaced by "Not shown to protect customer privacy".

### D-P3. Approved / live campaign changes: "Request a change" (approved)
Partners **must not directly alter material campaign terms after DealDash approval**. The partner action is **Request a change**, capturing: **requested change · reason · affected fields · supporting information · submitter · timestamp**. DealDash reviews and responds: **approve · request clarification · reject**. Approved changes are applied by DealDash and versioned; until then the live campaign is unchanged. **Non-material internal notes** do not trigger campaign review. **Emergency pause / suspension remains a DealDash Admin function** unless explicitly delegated later.

---|---|
| **One portal, three personalities** | One shell, one component set, one set of pages. Partner type switches **labels, a few modules and some permissions**, never the architecture |
| **Aggregated by default** | Every report is aggregate with small-cohort suppression. **No customer-level personal data exists in the MVP Partner Portal.** Customer-level sharing is a controlled DealDash exception (legal basis, consent where applicable, explicit DealDash permission), not a screen |
| **Partners do not bypass DealDash** | Campaigns and eligibility rules are **proposals** until DealDash guardrails and review say otherwise; DealDash can pause or reverse |
| **Simple language** | Partners build rules by choosing from plain lists, not by writing logic |
| **Least exposure** | Each user sees only their organisation, only modules relevant to their type, and only functions their role allows |
| **Lean** | 14 core pages; tabs, drawers and modals carry the detail |
| **Do not claim what is not proven** | Cards are "added", never "verified"; offline card use cannot be proven; Live Deal sales are not claimed |

Conventions: **MVP / P2 / P3**; `FDP-nn` = founder decision for Partner; `VK-nn` = VALIDATE-KSA; **Bank**, **Scheme**, **Employer** = partner types. Role codes: **PAD** Partner Admin · **CMG** Campaign Manager · **ELM** Eligibility Manager (shown as *Card Product Manager* for banks, *Network Programme Manager* for schemes, *Benefits Manager* for employers) · **ANL** Analyst / Reporting · **FIN** Finance / Budget Viewer · **RO** Read-only.

Design system: DealDash tokens (white / light-lavender surfaces, navy, purple, rounded cards, tinted chips, segmented tabs, drawers and modals as in Merchant and Admin portals), Plus Jakarta Sans / IBM Plex Sans Arabic. Partner Portal is **simpler than Admin**: calm KPI cards, no queue boards, no maker-checker for partners.

---

## 1. PARTNER TYPES AND WHAT EACH ONE DOES

| | **Bank / issuer** | **Card scheme / network** | **Employer / corporate** |
|---|---|---|---|
| Examples | Riyad Bank, Al Rajhi Bank, SNB | Visa, Mastercard, Amex, mada (list configurable) | Saudi Aramco, large employers, benefit partners |
| Main goal | Give its cardholders better offers | Run network-wide programmes with issuers and merchants | Give employees verified-only benefits |
| Eligibility basis | **Issuer + card product + card tier** (and approved BIN/IIN metadata) | **Network** across participating issuers, tiers, geography | **Verified employer** via official work-email OTP |
| Own configuration | Card portfolio: products, tiers, BIN/IIN metadata | Participating issuers, tier mapping, geography, merchant programmes (P2) | Official email domains, verification rules (reverification within limits) |
| Customer wording | "Pay with a Riyad Bank Visa Platinum card" | "Pay with a Visa card" | "Verified employee" |
| Not available | Employer modules | Employer modules, card portfolio (issuer-owned) | Card modules |
| Verification honesty | Self-declared / BIN-matched; **no proof of card ownership or offline use** | Same | OTP-verified work email; **no employee database** |

Data model fact shared by all: a partner defines **who is eligible** (eligibility rule sets) and may **sponsor or propose offers** targeted at that group; merchants run the offers; DealDash approves and operates.

---

## 2. PARTNER USERS, ROLES AND PERMISSIONS

### 2.1 Roles (common set, type-aware)

| Role | Purpose | Visible to partner types |
|---|---|---|
| **Partner Admin (PAD)** | Owns the organisation: profile, users, agreement, data-sharing requests | all |
| **Campaign Manager (CMG)** | Proposes and monitors campaigns, merchant participation | all |
| **Eligibility Manager (ELM)** | Maintains eligibility configuration and rules | all (label varies: Card Product Manager / Network Programme Manager / Benefits Manager) |
| **Analyst / Reporting (ANL)** | Aggregated reports and exports | all |
| **Finance / Budget Viewer (FIN)** | Budgets, funding, statements (read-only) | all (shown only where funding applies) |
| **Read-only (RO)** | View dashboards and campaigns | all |

### 2.2 Permission matrix (verbs: View · Create/Propose · Edit · Submit · Invite · Export · Manage users)

Legend: ● allowed · ◐ limited · – none.

| Area | PAD | CMG | ELM | ANL | FIN | RO |
|---|---|---|---|---|---|---|
| Dashboard | ● | ● | ● | ● | ◐ budget cards | ● |
| Campaigns: view | ● | ● | ● | ● | ● | ● |
| Campaigns: create / edit / submit proposal | ● | ● | ◐ eligibility part | – | – | – |
| Eligibility configuration: view | ● | ● | ● | ◐ summary | – | ◐ |
| Eligibility configuration: edit / propose rules | ● | – | ● | – | – | – |
| Merchants: view participation | ● | ● | ● | ● | – | ● |
| Merchants: invite / request participation | ● | ● | – | – | – | – |
| Reports: view | ● | ● | ● | ● | ◐ budget | ● |
| Reports: export | ● | ◐ | – | ● | – | – |
| Budget and statements | ● | ◐ view own campaigns | – | – | ● view | – |
| Organisation profile & agreement | ● edit | – | – | – | – | ◐ view |
| Users & roles | ● | – | – | – | – | – |
| Data-sharing requests | ● | – | – | – | – | – |
| Activity history (org) | ● | ◐ | ◐ | – | – | – |
| Support cases | ● | ● | ● | ● | ● | ◐ view |
| Settings (own account) | ● | ● | ● | ● | ● | ● |

### 2.3 Hard boundaries (all roles)
Partner users **cannot**: access DealDash Admin; see other organisations; see unrelated customers or **any customer-level personal data**; change DealDash core rules or guardrails; bypass campaign approval or eligibility review; export non-aggregated data; see DealDash-internal audit.

Authentication: corporate email + password with **MFA-ready** structure (provider configurable); sessions revocable; PAD is the first user (verified by DealDash during onboarding).

---

## 3. NAVIGATION (conditional by partner type)

Eight primary items; **Settings** pinned in the footer. Items and labels adapt:

| Primary item | Bank | Scheme | Employer |
|---|---|---|---|
| **Dashboard** | ✓ | ✓ | ✓ |
| **Campaigns** | ✓ | ✓ | ✓ |
| **Eligibility** | **Cards & eligibility** | **Network & issuers** | **Employees & domains** |
| **Merchants** | ✓ | ✓ | ✓ |
| **Reports** | ✓ | ✓ | ✓ |
| **Organization** | ✓ | ✓ | ✓ |
| **Users** | ✓ | ✓ | ✓ |
| **Support** | ✓ | ✓ | ✓ |
| Footer: **Settings** | ✓ | ✓ | ✓ |

```
┌ sidebar (white, 240) ──────────────┬ top bar: partner name & type · search · notifications · language · user ┐
│ Deal|Dash  Partners                │                                                                          │
│  ⌂ Dashboard                       │                                                                          │
│  ◈ Campaigns                  ●2   │                                                                          │
│  ◫ Cards & eligibility*            │   *label adapts: Network & issuers / Employees & domains                │
│  ▤ Merchants                       │                                                                          │
│  ▥ Reports                         │                                                                          │
│  ▦ Organization                    │                                                                          │
│  ◔ Users                           │                                                                          │
│  ? Support                    ●1   │                                                                          │
│ ─────────                          │                                                                          │
│  ⚙ Settings                        │                                                                          │
└────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────┘
```

Rules: items a role cannot use are **hidden**; Users and Organization are PAD-only except read-only views; a persistent organisation chip shows partner name, type and status (Active / Suspended banner); queue dots only for campaigns needing action and open cases. Mobile/tablet: drawer navigation; reports and campaign monitoring remain usable on tablet; builders are best on desktop.

---

## 4. PAGE INVENTORY: 14 CORE PAGES

| # | Page | Nav | Tabs / sections | Roles | Phase |
|---|---|---|---|---|---|
| **P01** | Sign in & invitation | – | Sign in · MFA · Accept invitation (set password, MFA enrolment) | all | MVP |
| **P02** | Onboarding & application status | – | Wizard (8 steps) · Status page with variants | PAD (applicant) | MVP |
| **P03** | Dashboard | Dashboard | Role- and type-aware cards, alerts | all | MVP |
| **P04** | Campaigns | Campaigns | Tabs: Active · Proposals & review · Upcoming · Ended | PAD, CMG, ELM, ANL, FIN, RO | MVP |
| **P05** | Campaign detail | Campaigns | Overview · Merchants & offers · Eligibility · Performance · Budget & funding · Activity | same | MVP |
| **P06** | Campaign proposal builder | Campaigns | Stepper: Basics · Audience (eligibility builder) · Merchants · Geography & dates · Limits & content · Budget · Review & submit | PAD, CMG (ELM for audience) | MVP |
| **P07** | Eligibility (type module) | Eligibility | **Bank:** Card portfolio · Rules. **Scheme:** Network profile · Issuers · Rules. **Employer:** Company · Email domains · Verification · Rules | PAD, ELM, CMG (view) | MVP |
| **P08** | Eligibility rule builder | Eligibility | Guided builder: Who · Details · Where · Wording · Reach preview & submit | PAD, ELM | MVP |
| **P09** | Merchants | Merchants | Tabs: Participating · Requests & invitations · Not yet participating (P2) ; merchant drawer | PAD, CMG, ELM, ANL, RO | MVP |
| **P10** | Reports | Reports | Overview · Campaigns · Engagement · Merchants & places · Segments (type-specific) · Exports | PAD, CMG, ELM, ANL, FIN, RO | MVP |
| **P11** | Organization | Organization | Profile · Agreement & documents · Data sharing & privacy · Funding & statements · Activity history | PAD (others view/own) | MVP |
| **P12** | Users | Users | Users · Roles reference · Invitations · Access history | PAD | MVP |
| **P13** | Support | Support | Help centre · My cases (case drawer) · Create case modal | all | MVP |
| **P14** | Settings | Settings | Account · Notifications · Language & region · Security | all | MVP |

**14 core pages.** Notifications are a **drawer** from the bell (feed) plus preferences in P14; no separate page.

---

## 5. COMMON PAGES (shared by all partner types)

### P01. Sign in & invitation
- Corporate email + password → MFA (provider configurable) → home. **Invitation:** link → verify email → set password → enrol MFA → role summary → activation.
- States: wrong password/code, lockout, expired invite, session timeout; **Suspended organisation** banner after sign-in.
- Not available: self-registration for users; org registration starts in P02.

### P02. Onboarding & application status

**Journey**

```
Start (public link or DealDash invitation) → verify email → verify mobile
→ 1 Organisation type & name → 2 Legal / entity information → 3 Authorised representative
→ 4 Required documents → 5 Type-specific information → 6 Users (optional) → 7 Commercial agreement (e-sign)
→ 8 Review & submit → Status: Submitted → In review → (Changes requested ↔ Resubmit) → Approved → Configured → Activated | Rejected
```

| Step | Content | Notes |
|---|---|---|
| 1 | **Organisation type** (Bank / issuer · Card scheme / network · Employer / corporate), trade and legal name (AR/EN) | Type decides step 5 and the navigation afterwards |
| 2 | Legal entity details, registration/licence numbers, registered address, website | Exact Saudi requirements **VK-18/VK-19** |
| 3 | Authorised representative: name, role, ID reference, mobile, email; "this person signs the agreement" | Matches signatory |
| 4 | Documents: registration/licence, authorisation letter, **type-specific proof** | Document list is configuration |
| 5 | **Bank:** issuer name, card networks issued, first card products and tiers (BIN/IIN metadata is verified by DealDash after approval). **Scheme:** networks, participating issuers, geography. **Employer:** official email domains (ownership proof method **FDP-04**), HR/benefits contact | No customer data, no employee list |
| 6 | Invite initial users and roles (can be done later in P12) | Optional |
| 7 | Agreement viewer (EN/AR), version, e-signature by signatory, data-sharing terms ("aggregated reporting by default") | **VK-19**; brand-mark use **VK-21** |
| 8 | Review & submit | Summary and checklist |

**Status page variants (one page):** Submitted · In review (and enhanced review neutral wording) · **Changes requested** (per-item Fix links) · **Rejected** (reason, appeal) · **Approved** (next steps: configuration) · **Configured** (eligibility rules awaiting activation) · **Activated** (welcome, first steps checklist) · **Suspended** (what is paused).

Responsive: wizard is desktop-first; status page works on tablet/phone.

### P03. Dashboard — "What DealDash benefits and campaigns are active for my organisation?"

Layout: header (partner name, type chip, status, period) → **KPI strip** → **Campaigns** (active and ending soon) → **Attention** → **Reporting status**.

| Card | Content | Measurability rule |
|---|---|---|
| Active offers / campaigns | Count by status; ending in 7 days | measured |
| Participating merchants | Count and new this month | measured |
| **Eligible reach** | Number of customers who currently match the partner's eligibility (e.g. "Riyad Bank cards added", "Verified employees"), shown **only when ≥ cohort threshold**; otherwise "Not enough data" | thresholded aggregate |
| Engagement | Offer views, saves (aggregate) | measured |
| Redemptions | Confirmed redemptions (vouchers, reservations, controlled offers) | measured; **no redemption claimed for walk-in Live Deals** |
| Voucher activity | Units sold (partner-linked offers) | measured |
| Watch & Earn activity | Qualifying views where a campaign is partner-funded or linked | measured |
| Upcoming expiries | Campaigns, agreements, documents | |
| Alerts | Approval issues (changes requested), eligibility issues (rule needs attention), budget low, report ready | |
| Reporting status | Next scheduled report, last export | |

Role visibility: FIN sees budget cards; ANL sees reports cards; RO sees KPI strip. Bank/Scheme/Employer tailor wording: "Cardholders reached" vs "Verified employees".
States: empty (new partner: onboarding checklist), loading, suppressed values, error, suspended.
**Not shown:** any customer names, contact details, or counts below threshold.

### P04. Campaigns (list)
- Tabs **Active · Proposals & review · Upcoming · Ended**; table: campaign, type chips (Live Deal / Exclusive Deal / Voucher / Watch & Earn offers involved), audience (eligibility summary), merchants (count), dates, status chip, key aggregate metric.
- Statuses (shared vocabulary): Draft · Pending review · Needs changes · Scheduled · Live · Paused · Ended · Rejected · Suspended.
- Primary action **Propose a campaign** (PAD, CMG).
- Filters: status, audience, merchant, dates. No bulk actions.

### P05. Campaign detail (adaptive by content, tabs)
- Header: name, status chip, audience chip, dates, funding chip (merchant-funded / partner-funded / DealDash-configured), actions (Edit proposal if Draft/Needs changes, Withdraw, Contact support).
- Tabs: **Overview** (summary, approval status and reviewer notes, customer-facing preview EN/AR) · **Merchants & offers** (participating merchants and linked merchant offers with status) · **Eligibility** (the rule in plain language and the customer-facing requirement wording; link to P08) · **Performance** (aggregate funnel and redemption where measurable; suppression applied) · **Budget & funding** (where applicable: committed, funded, spend, remaining, linked campaigns, statements; FIN/PAD) · **Activity** (organisation-visible events).
- Approval states are **state variants**, not pages: Pending review (read-only), Needs changes (Fix & resubmit), Approved/Scheduled, Live, Paused (by DealDash), Suspended (by DealDash, reason), Ended.
- Rule: partners can **withdraw or request changes**; they cannot publish, bypass review, edit live commercial terms, or change merchant offers.

### P06. Campaign proposal builder (stepper)
Steps (compact): **1 Basics** (name AR/EN, objective, linked merchant offers if any) → **2 Audience** (**eligibility builder**, same component as P08, with reach preview) → **3 Merchants** (choose participating merchants or request recruitment; merchants must agree) → **4 Geography & dates** (Riyadh areas, start/end) → **5 Limits & content** (per-customer limits, caps, customer-facing text AR/EN, requirement wording, terms) → **6 Budget** (where funding applies: committed amount, per-merchant allocation, funding responsibility; **no hard-coded commercial model**) → **7 Review & submit** (preview, guardrail check, translation completeness, submit).
- Right panel: **customer preview** and **DealDash checks** (as in Merchant Portal): dates valid, bilingual content, audience valid, merchants agreed, requirement text present, budget within limits.
- Outcomes: **Submitted for review** · **Needs changes** · **Approved (scheduled)**. MVP: DealDash reviews every partner proposal and configures live offers with the merchants; self-serve partner-funded campaigns run entirely by the partner are **Phase 2** (FDP-01).
- Autosave drafts; Save draft; withdraw.

### P09. Merchants
- **Participating** tab: table (merchant, category, branches, offers with this partner, performance indicator); **merchant drawer** with locations on a map list, offers for this partner's audience, aggregate performance (no merchant financials, no staff data).
- **Requests & invitations** tab: partner requests to a merchant ("Invite to participate"), merchant responses, DealDash approval; statuses Requested · Accepted · Declined · Expired. Partners can **invite or request**; merchants accept; DealDash confirms. (Rules: partners cannot see unrelated merchant data.)
- Filters: category, area, status, offer type. Search by name (AR/EN).
- **Phase 2:** discover merchants not yet participating, scheme merchant programmes.

### P10. Reports (aggregated by default)
- Tabs: **Overview** (KPI cards, trend) · **Campaigns** (per-campaign aggregate funnel) · **Engagement** (views, saves, reservations, voucher purchases, redemptions) · **Merchants & places** (by merchant, by area/geography) · **Segments** (type-specific: Bank by card product/tier; Scheme by issuer and network; Employer by verified-employee cohort, only when allowed and above threshold) · **Exports**.
- Filters: date range, campaign, merchant, area, product type. Charts: two types only (line/bar).
- **Rules:** every metric is aggregate; **small-cohort suppression** (any cell with fewer than the configured threshold — initial pilot setting **10 customers**, a product setting and not a legal conclusion — is hidden or merged and labelled "Not enough data"); no customer lists; no row-level exports; Live Deals show discovery signals only; redemptions only where measurable.
- Exports: CSV/PDF of **aggregates only**, watermarked with organisation and time, limited by role (PAD, ANL), rate-limited and audit-logged. See section 9.

### P11. Organization
Tabs:
- **Profile** (names AR/EN, type, logo — subject to **VK-21** brand-mark permission — contacts, address); **type-specific profile fields** appear here (Bank: issuer details; Scheme: network details; Employer: HR contact, domains summary).
- **Agreement & documents**: agreement version, signatory, date/time, status; documents with expiry; re-acceptance banner on new versions; download executed copy.
- **Data sharing & privacy**: the organisation's data-sharing posture in plain language: *Aggregated reporting only (default)*; current cohort threshold (read-only); export log; **"Request customer-level data sharing"** (PAD only) opens a request modal that explains it is **not available by default**, that it needs an **approved legal basis, consent where applicable and explicit DealDash permission**, and routes to DealDash (SUP + Risk). Status of any request shown. **No customer-level access is assumed.**
- **Funding & statements** (where applicable): commitments, funded, spend, invoices/statements list (read-only for FIN, PAD). Settlement model is configuration per partner (FDP-05).
- **Activity history**: organisation-visible audit (section 12).
- PAD edits; others view per matrix.

### P12. Users
- Tabs **Users** (name, role, MFA state, status, last active) · **Roles reference** (the matrix for this partner type) · **Invitations** · **Access history** (organisation audit filtered to access events).
- Actions: **Invite user** (modal: name, email, role; type-aware role names), **Edit role** (modal with impact), **Suspend / reactivate**, **Revoke access** (immediate session kill), resend invite. Guards: last PAD cannot be removed; user cannot elevate themselves; role changes audited; DealDash may suspend any user.
- Hidden: roles that do not apply to the type (e.g. Benefits Manager label for employers only).

### P13. Support
- Tabs **Help centre** (search, categories: Campaigns, Eligibility, Reporting, Merchants, Onboarding, Technical, Commercial) · **My cases**.
- **Create case modal:** category (campaign issue, eligibility issue, reporting question, merchant participation, onboarding, technical issue, commercial query), related object (campaign, rule, report), message, attachments.
- **Case drawer:** status chip (New · In progress · Waiting on you · Resolved · Closed), thread, attachments. Same case architecture as Admin A25/A26; partners see only their organisation's cases and public replies (no internal notes).

### P14. Settings
Tabs **Account** (name, mobile with OTP change) · **Notifications** (matrix of event × in-app/email; critical locked on) · **Language & region** (AR/EN, Gregorian, Riyadh time) · **Security** (password, MFA-ready toggle, sessions).

### Notifications (drawer, not a page)
Events: **onboarding status** (submitted, changes requested, approved, rejected, activated) · **campaign submitted · approved · needs changes · live · ending soon** · **eligibility issue** (rule needs attention, domain or BIN range change pending/approved/rejected) · **report ready** · **budget low** · **support update** · user invited/changed. Channels: in-app and email; transactional items cannot be turned off.

---

## 6. TYPE-SPECIFIC MODULES (inside P07 Eligibility, P11 Organization, P10 Segments)

### 6.1 Bank / issuer module ("Cards & eligibility")
P07 tabs: **Card portfolio** · **Rules**.
- **Card portfolio:** table of **card products** (name AR/EN, network Visa/Mastercard/Amex/mada, type credit/debit/prepaid, status) with **tiers** per product (Classic, Gold, Platinum, Signature… ordered by the bank), and **BIN/IIN metadata** per product/tier (**leading digits only, no PAN, no CVV**). A product opens a **drawer**: details, tiers, ranges (effective date, status, overlap check), linked offers.
- **Who edits BIN/IIN metadata:** the bank **proposes** (ELM, PAD); **DealDash verifies and activates** (Admin A08/A09 verification queue); changes are **effective-dated**. Overlap with other issuers is rejected. (FDP-03: who enters ranges.)
- **Rules:** list of eligibility rule sets for this bank (e.g. "Riyad Bank Platinum cardholders"), status, used-by campaigns; **New rule** opens P08.
- **Offers and cardholder benefits:** shown as campaigns (P04/P05) with the issuer audience; "bank-funded" vs "merchant-funded" flag on proposals (settlement of partner funding is configurable, P2 for invoicing).
- **Customer wording:** "Pay with a **[Bank] [Product] [Tier]** card" (BC-09); the customer only **adds** the card (issuer → product → tier); DealDash never calls it "verified"; offline card use is **not provable** without issuer/payment integration (BC-10).
- **Reporting:** by product/tier, aggregate only.
- **Future (P3):** issuer/PSP/token verification; card-linked offers; the model carries `verification_level` and `source` so upgrades need no redesign.

### 6.2 Card scheme / network module ("Network & issuers")
P07 tabs: **Network profile** · **Issuers** · **Rules**.
- **Network profile:** the networks this organisation represents (Visa, Mastercard, Amex, mada; **list is configurable by DealDash**), brand rules link (**VK-14/VK-21**), geography in scope (Riyadh pilot).
- **Issuers:** participating issuers with status (Participating · Invited · Not participating), tier mapping per issuer (read from issuer data; schemes **cannot edit issuer-owned products/BINs**), issuer participation requests (invite an issuer, issuer accepts, DealDash approves). Per-issuer **aggregate** performance.
- **Rules:** network-wide rule sets ("Visa cardholders", "mada debit cardholders in Riyadh").
- **Merchant programmes:** viewing participating merchants in P09; **creating merchant programmes is Phase 2**. **Scheme-funded campaigns:** proposals via P06 (MVP, DealDash-reviewed); self-serve P2.
- **Reporting:** by issuer and network, aggregate; issuer-level breakdown only where the contract/privacy position allows (**FDP-06 / VK-12**).

### 6.3 Employer / corporate module ("Employees & domains")
P07 tabs: **Company** · **Email domains** · **Verification** · **Rules**.
- **Company:** profile shown to customers in the employer list (name AR/EN, logo subject to **VK-21**), HR/benefits contact.
- **Email domains:** official domains with status (**Pending proof · Verified · Disabled**); add domain modal; **ownership proof method** (**FDP-04**: document or DNS proof, reviewed by DealDash Partner Management). Removing a domain revokes eligibility of affected employees at the next check or immediately (configurable).
- **Verification:** how customers verify (read-only explanation: select company → official work email → OTP → verified employer); **reverification period** chosen **within DealDash limits** (initial default configurable), grace period, shared-mailbox blocking (read-only DealDash standards). **No employee database upload in MVP**; no employee names or emails are ever shown.
- **Rules:** employee-only rule sets ("Verified employees", optionally "Verified employees in Riyadh").
- **Employee offers:** employee-only campaigns (P04/P05); **verified status digitally unlocks eligible offers** (no QR pass in MVP; pass is Phase 2).
- **Reporting:** verified-employee **count (thresholded)**, offer usage aggregates; never lists.
- **Leaver handling:** automatic detection is not possible; periodic reverification and domain removal are the controls (EM-21). Employer-supplied leaver lists are **Phase 2 / VALIDATE-KSA** (VK-09).

### 6.4 Where the three modules differ in the shared pages
| Shared page | Bank | Scheme | Employer |
|---|---|---|---|
| P03 reach card | "Cardholders matched" | "Network cardholders matched" | "Verified employees" |
| P05 Eligibility tab | Issuer/product/tier rule text | Network/issuer rule text | Employer rule text |
| P07 | Card portfolio | Network profile, Issuers | Company, Email domains, Verification |
| P10 Segments | Product / tier | Issuer / network | Verified cohort (above threshold) |
| P11 Profile | Issuer details | Network details | Company details |
| P12 role label | Card Product Manager | Network Programme Manager | Benefits Manager |

---

## 7. ELIGIBILITY BUILDER ARCHITECTURE (P08 and embedded in P06)

**Purpose:** let a partner define *who is eligible* in plain language, safely, without technical knowledge. DealDash retains oversight.

### 7.1 Model
An **eligibility rule set** = a name (AR/EN) + one or more **conditions** combined with **ALL / ANY** (and **NOT** where useful) + an optional geography + metadata (version, status, owner, effective dates). Conditions are chosen from **approved attribute types**:

| Attribute | Partner types that can use it | Choices |
|---|---|---|
| **Issuer** | Bank (own issuer), Scheme (any participating issuer) | Issuer list |
| **Card product** | Bank (own), Scheme (via issuer) | Product list |
| **Card tier** | Bank, Scheme | Tier list (order defined by issuer) |
| **Scheme / network** | Scheme, Bank (own networks) | Visa, Mastercard, Amex, mada (configurable list) |
| **Employer** | Employer (own), others (not allowed) | Verified employer |
| **Geography** | all | Riyadh areas |
| **DealDash segment** | all (approved list only) | e.g. New customers, interest groups; **sensitive attributes excluded**; age/gender targeting not offered |
| **Campaign-specific cohort** | **Phase 2** | Partner-supplied or DealDash-created cohorts need a legal basis (**VK-09**) |

Each condition carries the **verification level required**: *self-declared*, *BIN-matched*, *PSP-confirmed* (for card payments through DealDash), *OTP-verified* (employer), future *issuer-verified*. Partners **cannot** require a level DealDash does not offer.

### 7.2 Builder flow (guided, 5 steps)
1. **Who** — choose the audience type in plain words: *Our cardholders* (bank), *Cardholders of these networks* (scheme), *Our verified employees* (employer), or *A mix*.
2. **Details** — choose products/tiers/issuers/networks or the employer; each selection shows a short explanation. "Add another group" (ANY) and "Only if also…" (ALL) as plain buttons; "Except…" (NOT) as an advanced link.
3. **Where** — optional geography (all Riyadh or selected areas).
4. **Wording** — DealDash generates the **customer-facing requirement text** (AR/EN) from the rule, e.g. *"Pay with a Riyad Bank Visa Platinum card"* or *"Open to verified Saudi Aramco employees"*; partner may adjust within approved templates; a **lock/unlock label** is shown ("Add your eligible bank card to unlock" / "Verify your employer to unlock"). The wording states that card offers require paying with the eligible card and that DealDash cannot verify card use at the till (BC-09/10).
5. **Preview & submit** — **estimated reach** (shown as a range or "Not enough data" under the suppression threshold; no names), a plain-language **summary sentence**, conflicts/overlaps ("This overlaps with 'Visa Platinum' rule"), DealDash guardrail check, then **Save draft** / **Submit for review**.

### 7.3 Rules and guardrails
- Rules are **versioned and effective-dated**; changes to a live rule are treated as a new version needing DealDash review; ending a rule does not invalidate issued vouchers/reservations (EL rules, RD-30).
- **DealDash Admin retains oversight:** review queue (Admin A08/A09), ability to reject, narrow, pause or retire any rule; automated checks reject unsupported combinations (e.g. an employer rule from a bank).
- No arbitrary logic, scripting or customer-list upload in MVP.
- Same component is used in the **campaign proposal builder** (step 2) so a campaign audience is either a saved rule or a new one.
- Rule status chips: Draft · Pending review · Needs changes · Active · Paused · Retired · Rejected.
- Arabic/RTL: the builder reads naturally in both directions; chips and sentences mirror; numbers and identifiers remain LTR.

---

## 8. REPORTING AND DATA-SHARING MODEL

| Layer | Default | Notes |
|---|---|---|
| **Reporting** | **Aggregated only** | Campaign performance, engagement, eligible reach, merchant participation, redemptions where measurable, voucher activity where relevant, geographic performance, type-specific segment performance where allowed |
| **Small-cohort suppression** | **Configurable; pilot setting 10 customers** | Cells below the threshold are hidden/merged ("Not enough data"). Product setting, **not a legal conclusion**; final value subject to privacy validation (**VK-12 / FDP-02**) |
| **Customer-level data** | **None in MVP** | No customer lists, names, contacts, individual transactions or employer emails; no row-level exports |
| **Exports** | Aggregate CSV/PDF only | PAD and ANL; watermark, time, organisation; rate-limited; every export logged and visible in the organisation's Activity history |
| **Customer-level sharing (exception)** | **Not assumed** | Requires **approved legal basis, consent where applicable, explicit DealDash permission** (SUP + Risk); handled outside the portal as an agreement; if ever granted, the portal shows scoped access with banner, purpose and expiry (Phase 2). **VALIDATE-KSA (VK-09, VK-11, VK-12)** |
| **What partners never see** | | Other organisations' data, unrelated customers, DealDash internal audit/risk/notes, merchant financials and staff data |

**Metric definitions (examples):** *Eligible reach* = customers who currently match the rule (thresholded); *Engagement* = offer views and saves; *Redemption* = confirmed redemption events (not claimed for walk-in Live Deals); *Voucher activity* = units sold for partner-linked offers.

UX: every card/table that can be suppressed shows a small **"Not enough data (fewer than 10)"** state with a tooltip explaining why; a persistent line on Reports states "Reports are aggregated. No customer-level data is shared."

---

## 9. BUDGET / FUNDING (lean)
Where a campaign is partner-funded or co-funded:
- **Campaign detail → Budget & funding tab** and **Organization → Funding & statements**: committed budget, funded amount, spend to date, remaining balance, linked merchant campaigns, statements/invoices list (download).
- Alerts: **budget low** (threshold configurable).
- Roles: FIN and PAD view; CMG sees own campaigns; others hidden.
- **Out of scope for MVP:** payments from the portal, invoicing automation, reconciliation. Funding model and settlement terms are **configurable per partner** (FDP-05); VAT/accounting **VK-03**; funds treatment **VK-05/VK-16**.
- Partner-funded campaign **self-serve** and **invoicing** are Phase 2.

---

## 10. SUPPORT
Uses the Admin case architecture: categories (campaign issue, eligibility issue, reporting question, merchant participation, onboarding, technical issue, commercial query), SLA timers on the DealDash side, public replies only to partners, attachments, status and resolution. Partner Management (PMG) and Support handle partner cases (Admin A25/A26).

---

## 11. AUDIT (ORGANISATION-LEVEL ACTIVITY HISTORY, P11 tab)
Visible to PAD (and limited views for CMG/ELM): user invitations/role changes/suspensions; campaign created/edited/submitted/withdrawn; DealDash approval events (approved, needs changes, rejected, paused, suspended — with reason text meant for partners); eligibility rule created/edited/submitted and approval events; domain and BIN/IIN proposals and verification outcomes; budget changes; exports; data-sharing requests; agreement acceptance; sign-in security events for own users.
Each entry: actor (partner user or "DealDash"), action, object, time, outcome. **DealDash-internal audit data (reviewer notes, risk flags, internal comments) is never shown.**

---

## 12. KEY WORKFLOWS

| Workflow | Path |
|---|---|
| **Onboarding** | P02 wizard → DealDash review (Admin A09) → approved → eligibility configured (P07) → DealDash verifies domains/BIN metadata → activated |
| **Create eligibility rule** | P07 Rules → P08 builder → Submit → DealDash review → Active (versioned) |
| **Propose a campaign** | P04 → P06 (audience from P08) → submit → DealDash review/guardrails → merchants confirm → scheduled → live → P05 monitors |
| **Merchant participation** | P09 Requests → merchant accepts → DealDash confirms → merchant offers linked to the campaign |
| **Reporting** | P10 → filter → view aggregates → export (aggregate) → logged |
| **Data-sharing request** | P11 Data sharing → request modal → DealDash legal/risk decision → recorded (no automatic access) |
| **User lifecycle** | P12 invite → accept (P01) → role → suspend/revoke → history |
| **Support** | P13 create case → DealDash responds → resolution |

---

## 13. STATES AND PATTERNS (shared components, no new visual language)
Shell, KPI card, data table, segmented tabs, status chips, banners (Suspended, Needs changes, Data privacy), drawers (merchant, product, case, rule summary), modals (invite user, propose rule change, data-sharing request, withdraw campaign), stepper builders (P02, P06, P08), customer preview phone, empty/loading/error states, **"Not enough data" suppressed state**, no-access state, notification drawer.
**Look and feel:** DealDash for institutions: white/lavender surfaces, deep navy, one purple action, rounded cards, calm charts; **not** internet banking, **not** a card-scheme back office, **not** CRM. Simpler than Admin: no queue boards, no maker-checker.
**Arabic/RTL:** same rules as Merchant/Admin: mirrored shell/tables/builders/reports; bilingual campaign and rule wording fields side by side; IDs, amounts, dates LTR; strings not translated now.

---

## 14. RATIONALISATION: EARLIER PARTNER INVENTORY → 14 PAGES

| Earlier ID(s) | Now | Kind |
|---|---|---|
| P01 (L.6), PP-01 | P01 Sign in & invitation | page |
| P02, PP-02, PP-03, PP-04, PP-05 | P02 Onboarding & status | wizard steps + status variants |
| P03, PP-10 | P03 Dashboard | page |
| P07, PP-30, PP-31 | P04 Campaigns (list) and P05 Campaign detail | pages + tabs |
| P08, PP-32 (request an offer) | P06 Campaign proposal builder | page |
| PP-33 (partner-funded campaigns self-serve), PP-S7, PP-B5 funding | P06/P05 proposal and Budget tab (MVP) · **self-serve funded campaigns Phase 2** | page/tab; P2 |
| PP-B1, PP-B2, PP-B3 | P07 Cards & eligibility → Card portfolio (products, tiers, BIN/IIN drawer) | tab + drawer |
| PP-B4 | P07 Rules tab + P08 builder | tab/page |
| PP-B5 | P05 funding chip + P04 audience; bank offers | state/tab |
| PP-B6 | P10 Segments tab (product/tier) | tab |
| PP-S1, PP-S4 | P07 Network profile (networks, geography) | tab |
| PP-S2, PP-S3 | P07 Issuers tab (participating issuers, tier mapping) | tab |
| PP-S5 (merchant programmes) | P09 view; **creation Phase 2** | P2 |
| PP-S6 | P10 Segments (issuer/network, where permitted) | tab |
| PP-E1 | P07 Company tab | tab |
| PP-E2 | P07 Email domains tab (+ add-domain modal) | tab/modal |
| PP-E3 | P07 Verification tab | tab |
| PP-E4 | P04/P05 employee offers + P07 Rules | tab |
| PP-E5, PP-40, PP-41 | P09 Merchants (+ merchant drawer) | page/drawer |
| PP-42 (invite merchant) | P09 Requests & invitations tab (request/invite, merchant accepts, DealDash confirms) | tab (**MVP**, narrower than earlier Phase 2: see FDP-07) |
| PP-E6, PP-50, PP-51, PP-52, PP-53 | P10 Reports tabs and Exports | page/tabs |
| PP-E7 (employee communications) | — | **Phase 2** |
| PP-20 | P11 Profile | tab |
| PP-21, PP-22 | P12 Users (Users, Roles reference, Invitations) | page/tabs |
| PP-23 | P11 Activity history and P12 Access history | tabs |
| PP-60 | P13 Support | page |
| PP-70 | P14 Settings | page |
| Notifications | Drawer + P14 Notifications tab | drawer/tab |
| Funding (earlier P2) | P11 Funding & statements + P05 Budget tab (view only) | tabs |
| Customer-level data sharing usage (earlier P2) | P11 Data sharing request only; usage tooling | **Phase 2** |

Result: **≈ 60 earlier items/states → 14 core pages** (plus ≈ 12 drawers/modals). No business rule or permission was dropped: aggregate-only reporting, cohort suppression, no customer-level data, DealDash oversight of rules and campaigns, hidden irrelevant modules, and org-scoped audit are all preserved.

### Moved to Phase 2
Self-serve partner-funded campaigns and invoicing; scheme merchant-programme creation; employee communications; Employee pass QR; issuer/PSP/token verification and card-linked offers (P3); campaign-specific cohorts and any customer-level sharing tooling; partner discovery of non-participating merchants; student/university eligibility; advanced analytics and scheduled reports beyond basic exports.

---

## 15. FOUNDER DECISIONS STILL REQUIRED (Partner)

| ID | Decision | Default used |
|---|---|---|
| ~~FDP-01~~ | MVP scope of partner-created campaigns | **CLOSED:** proposals only; DealDash approves and activates; self-serve publishing Phase 2 |
| FDP-02 | Cohort threshold value and whether it differs by report | Pilot setting 10, configurable; privacy validation |
| FDP-03 | Who enters bank BIN/IIN metadata | Bank proposes, DealDash verifies and activates |
| FDP-04 | Employer domain ownership proof method | Document or DNS proof, reviewed by Partner Management |
| FDP-05 | Funding and settlement model per partner (who funds discounts, invoicing) | Configurable; no hard-coded model |
| FDP-06 | Issuer-level breakdown visible to schemes | Only where contract/privacy position allows |
| FDP-07 | Partner invitation of merchants in MVP | Request/invite allowed; merchant accepts; DealDash confirms |
| FDP-08 | Maximum number of users per partner and role naming | Configurable; defaults as above |
| FDP-09 | Whether a partner may see offers from merchants it did not target | No |
| FDP-10 | Employer reverification period range allowed to the employer | Within DealDash limits; value configurable |
| FDP-11 | Can partners see merchant names before DealDash approves participation | After merchant acceptance only |

---

## 16. VALIDATE-KSA ITEMS EXPOSED

| Item | Where it shows up |
|---|---|
| VK-18 / VK-19 | Partner document requirements, agreement and e-signature validity, offboarding (P02, P11) |
| VK-21 / VK-14 | Brand, logo and mark use for banks, Visa, Mastercard, Amex, mada (P02, P07, P11) |
| VK-09 / VK-11 / VK-12 | Customer-level sharing, privacy, cohort threshold and aggregation standards (P03, P10, P11) |
| VK-13 | Card data scope; BIN/IIN metadata handling; PSP/issuer verification later (P07) |
| VK-03 / VK-05 / VK-16 | VAT/invoicing, funds treatment and funding model for partner-funded campaigns (P05, P11) |
| VK-15 | Retention of organisation activity history and exports (P11) |
| VK-23 | Notification consent and SMS/email rules for partner users (P14) |
| VK-06 | Use of segments and any personal attributes in eligibility (P08) |
| VK-10 | Disclosure if any placement is sponsored (P04) |

---

## 17. READINESS FOR VISUAL UI DESIGN
**Ready.** Design the shared shell (type-aware navigation) and these four first: **P03 Dashboard**, **P08 Eligibility rule builder** (most distinctive), **P10 Reports with suppression states**, and **P07 for each of the three types** (to prove one architecture serves all). Then propagate to the rest with the existing Merchant/Admin patterns. Nothing in FDP-01 to FDP-11 blocks visual design; each has a default.

*End of Partner Portal wireframe architecture v0.1. No production code.*

## STATUS (v0.3): visual design propagated and QA completed
All 14 core pages are visually specified (`DEALDASH_PARTNER_PORTAL_VISUAL_DESIGN.md` section 13) and checked (`DEALDASH_PARTNER_PORTAL_VISUAL_QA.md`). The change-request workflow (D-P3) is a full page plus request modal, counted under P05 (not an extra core page).