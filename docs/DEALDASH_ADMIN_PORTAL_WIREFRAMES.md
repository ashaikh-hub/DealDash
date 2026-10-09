# DEALDASH ADMIN PORTAL: UX / WIREFRAME ARCHITECTURE

Version 0.1 (draft for approval) · 2026-10-07
Scope: the internal DealDash Admin Portal for the controlled Riyadh pilot. Partner Portal and visual UI design are separate later stages.
Inputs: Master Blueprint v0.2.2, Business Rules v0.2.x (incl. RD-, ST-, LG-, RW-, FR-, SP-, AP-, AU-), UX Architecture section L.7 (A01–A29 earlier plan), Merchant Portal documents (statuses, finance permissions, translation gate), Staff design.
Output type: structural wireframes in text (layout, content, tabs, drawers, modals, states, permissions, workflows). No production code.

## OPERATING DECISIONS CLOSED (v0.2): supersede conflicting text below

### D-1. Customer appeal route (closes FDA-09)
A customer may appeal an important DealDash administrative decision through **Support / Case Management** (case type *Appeal*). Rules:
- The appeal **references the original decision** and includes the customer's reason/evidence; the **original decision and its audit history are preserved** (never overwritten).
- It is reviewed by an **authorised second-level user** and **cannot be finally decided by the person who made the original decision**.
- **Routing by subject:** customer service issue â†’ **Support supervisor**; fraud / account restriction â†’ **Risk / authorised Operations reviewer**; payment or refund matter â†’ **Finance / Support as appropriate**.
- **Every appeal decision records:** reviewer, date/time, reason, outcome, and an audit entry.
- No large legal appeals system in MVP: one case type, one reviewer rule, one outcome record. Appears in A25/A26 (case type Appeal) and A23 (Appeals tab).

### D-2. Voucher validity extension (closes FDA-10)
- A **merchant may request** an extension where appropriate (support case or portal request); a **merchant cannot directly extend** a sold customer's voucher.
- **Authorised DealDash Operations/Admin users approve.** Required: **reason, original expiry, new expiry, affected voucher/customer scope, customer notification, audit trail**.
- If the extension **creates or changes a financial liability, settlement treatment or accounting impact**, it must also go through an **authorised Finance / maker-checker workflow**.
- Saudi consumer/legal requirements: **VALIDATE-KSA (VK-04)**. Surfaces in A13 (voucher trace), A18/A26 (case actions) and A12 (Voucher tab).

### D-3. Exceptional Exclusive Deal corrections (closes FDA-11)
- **Operations may make non-material operational corrections alone**, with audit: typo, formatting, translation, non-material descriptive corrections.
- **Material corrections need a second authorised approval** (maker-checker or supervisor): offer value/discount, customer entitlement, eligibility, participating branches, material timing, **inventory below already committed reservations/redemptions**, important terms, anything that materially changes the customer's expectation.
- **Emergency suspension remains immediately available** (customer or platform risk), audited and reviewed afterwards.
- Surfaces in A12 (Exclusive Deal Inventory & reservations tab, Corrections modal) and the maker-checker table (section 5.2).

### D-4. Privileged access review (closes FDA-12; extends FDA-04)
- **Quarterly access reviews** of privileged DealDash Admin users are approved (review workflow in A28 *Sessions & MFA / Access review*: list of privileged holders, last use, attest/remove, reviewer, date).
- **Immediate review or removal** when: an employee **leaves**, **changes role**, **temporary access expires**, **suspicious activity occurs**, or a **manager requests removal**.
- **High-risk permissions get particular attention:** refunds, financial adjustments, settlements, reward adjustments, and user/role administration (flagged in the review list; separation-of-duty warnings).
- Temporary access carries an expiry date enforced automatically; every review decision is audited.

### Other closed items
FDA-03 (refund/adjustment limits and checker thresholds): remain **configuration** in A30; no numbers are set. FDA-02 and FDA-04 as written below.

> **Admin Portal status (approved):** structurally and visually **frozen for MVP**. The following remaining items are **QA / validation only** and do **not** block the next portal: tablet QA; keyboard and screen-reader QA; real-data stress testing; native Arabic review; final contrast verification in Figma; remaining VALIDATE-KSA items.

---

## 0. Principles and conventions

| Principle | Meaning here |
|---|---|
| Operational, not decorative | Tables, queues, evidence and decisions come first. Photography and gradients are minimal (a single quiet hero-free layout). |
| Queue-driven | Every role starts from "what needs my attention". Work arrives as queues (applications, reviews, refunds, risk, cases, exceptions). |
| One pattern per job | One list pattern, one **detail workbench** pattern, one **decision panel** (Approve / Reject / Request changes + reason), one **case** pattern. |
| Least privilege | Pages, tabs and actions are shown only to roles that may use them (hidden, not greyed). Sensitive data is masked by default with an audited reveal. |
| Everything traceable | Every sensitive action requires **reason, actor, timestamp**, writes an audit entry, and (for money, rewards, and high-risk changes) can require a **second approver**. |
| Honest metrics | Only measurable data. Live Deals show discovery/engagement only; no invented Live Deal revenue. |
| Don't lose rules | Every approved control survives the rationalisation (section 14 maps all earlier items). |

Conventions: **Phase** MVP unless marked P2/P3. Role codes: **SUP** Super Admin · **OPS** Operations · **MMG** Merchant Management · **PMG** Partner Management · **CSP** Customer Support · **FIN** Finance · **RSK** Risk / Compliance · **MKT** Marketing / Campaign Operations · **ANL** Analyst. Permission verbs: **V**iew · **C**reate · **E**dit · **A**pprove · **S**uspend · **R**efund · **J** adjust · **T** settle · **X** export · **G** configure. `VK-nn` = VALIDATE-KSA item, `FDA-nn` = founder decision for Admin.

Design system: the DealDash tokens (white / light-lavender surfaces, deep navy, purple accent, rounded cards, subtle borders, Plus Jakarta Sans and IBM Plex Sans Arabic). Admin is denser than the Merchant Portal (table row 44–48 px, 13-px text) but uses the same shell, chips, drawers and banners. No photography beyond merchant logos/thumbnails; no hero gradient cards.

---

## 1. ADMIN ROLES

| Role | Purpose | Typical home queues | Hard boundaries |
|---|---|---|---|
| **Super Admin (SUP)** | Governs the platform: people, roles, configuration, approvals of last resort | Everything | Not a day-to-day operator; sensitive actions still need reason + audit; cannot approve their own maker-checker items |
| **Operations (OPS)** | Keeps the marketplace running: campaign review, monitoring, pauses | Campaign review queue, live monitor | No finance actions, no role changes |
| **Merchant Management (MMG)** | Merchant lifecycle | Applications/KYB, suspensions, obligations | No refunds/settlement; bank-detail changes route to FIN verification |
| **Partner Management (PMG)** | Banks, schemes, employers | Partner applications, domain/BIN verification | No customer PII access beyond aggregates |
| **Customer Support (CSP)** | Customers and cases | Support inbox, customer lookup | Refund/adjust only up to limits; no settlement; PII masked by default |
| **Finance (FIN)** | Money | Refund approvals, settlement runs, reconciliation, adjustments | No campaign approval, no role changes |
| **Risk / Compliance (RSK)** | Fraud, KYB policy, audit, regulatory | Risk queue, flagged items | Cannot move money; can hold, block, suspend |
| **Marketing / Campaign Operations (MKT)** | Featuring, content, notifications, redemption catalogue | Content moderation queue, templates, catalogue | No PII exports, no finance |
| **Analyst (ANL)** | Insight | Reports | Read-only, aggregated, no PII |

Internal users: invited only by SUP (no self-registration), corporate email, MFA required for SUP/FIN/RSK/MMG/PMG and recommended for others (FDA-02), roles assigned by permission bundles, deactivation revokes sessions immediately.

---

## 2. NAVIGATION

**Nine primary items plus one footer area.** Challenged and consolidated from the suggested eleven: Rewards joins Commerce (a ledger domain), Commerce is renamed **Money**, Campaigns absorbs moderation, and Reports stands alone for Analysts.

```
┌ sidebar (white, 248; collapsible) ┬ top bar: global search · environment tag (Pilot) · queue bell · language · user ┐
│ Deal|Dash  Admin                   │                                                                                    │
│ WORK                               │  page                                                                              │
│  ⌂ Dashboard                       │                                                                                    │
│  ◔ Customers                       │                                                                                    │
│  ▤ Merchants                  ●3   │                                                                                    │
│  ▧ Partners                        │                                                                                    │
│  ◈ Campaigns                  ●7   │                                                                                    │
│  ₪ Money                      ●4   │                                                                                    │
│ ASSURE                             │                                                                                    │
│  ⚑ Risk                       ●5   │                                                                                    │
│  ? Support                    ●12  │                                                                                    │
│  ▥ Reports                         │                                                                                    │
│ ───────────                        │                                                                                    │
│  ⚙ Administration (footer)         │                                                                                    │
└────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────┘
```

| Item | Contains (pages / tabs) | Visible to |
|---|---|---|
| **Dashboard** | A02 | all |
| **Customers** | A03 list · A04 detail | CSP, RSK, OPS, SUP, FIN (read), ANL (aggregate only via Reports) |
| **Merchants** | A05 list (tabs All · Applications · Suspended · Obligations) · A06 application review · A07 detail | MMG, OPS, FIN (read), RSK, SUP |
| **Partners** | A08 list · A09 detail / application review | PMG, RSK (read), SUP |
| **Campaigns** | A10 list (tabs Live Deals · Exclusive Deals · Vouchers · Watch & Earn · Review queue) · A11 review workspace · A12 campaign detail · A13 voucher & code trace · A14 moderation | OPS, MMG, MKT, RSK, FIN (vouchers/W&E money), SUP |
| **Money** | A15 payments · A16 payment detail · A17 refunds · A18 refund case · A19 settlements · A20 settlement run · A21 reconciliation · A22 rewards | FIN, CSP (limited), RSK (read), SUP; Rewards also MKT (catalogue) |
| **Risk** | A23 queue · A24 case | RSK, OPS (read), SUP |
| **Support** | A25 inbox · A26 case workspace | CSP, MMG, PMG, FIN (their case types), SUP |
| **Reports** | A27 | ANL, OPS, FIN, MMG, PMG, RSK, SUP |
| **Administration** (footer) | A28 admin team · A29 audit log · A30 system configuration · A31 reference data & content | SUP (A28, A30), RSK + SUP (A29), MKT/PMG/SUP (A31 sections) |

Rules: max two navigation levels; queue badges on Merchants, Campaigns, Money, Risk, Support; a role's sidebar shows only its permitted items; global search finds customers, merchants, orders, vouchers, reservations, codes and cases (results filtered by role); every record has a stable deep link.

---

## 3. SHELL AND SHARED PATTERNS

| Pattern | Spec |
|---|---|
| **Top bar** | Global search (`/`), environment tag, queue bell (drawer of items assigned to me), language, user menu (role, MFA status, sign out) |
| **Page header** | Breadcrumb, title, status chip(s), primary action, "⋯" menu |
| **List page** | Tabs, toolbar (search, filters as removable chips, saved views, export if permitted), table with hover rows, row click opens detail or drawer, server pagination, density toggle |
| **Detail workbench** | Header card (identity, status, key facts, actions) → tabs → main + side panels (related objects, notes). A sticky **Decision panel** appears where a decision is pending |
| **Decision panel** | Approve / Reject / Request changes (templates, bilingual), mandatory reason for reject/changes, optional note, second-approver prompt when required |
| **Reason modal** | Used by every sensitive action: reason code (list) + free text + impact summary + (if configured) "Needs second approval" notice |
| **Evidence viewer** | Document / image / video / log viewer in a drawer |
| **Case/Notes** | Internal notes (never customer-visible), timeline, attachments |
| **Audit strip** | Every detail page has an Activity/Audit tab that is a filtered view of the central log (A29) |
| **PII mask** | Phone, email, ID shown masked; "Reveal" requires permission, a reason, and creates an audit entry |
| **Banners** | Environment, suspended entity, legal hold, maker-checker pending, system incident |

Responsive: desktop-first (≥ 1280). Laptop collapses the sidebar. Tablet is supported for **read, approve and respond** tasks (drawers become sheets; tables become cards). Phones are not a supported Admin target except push-notification triage and read-only case view.

---

## 4. PERMISSION MODEL

### 4.1 Verb × area matrix

Legend: ● allowed · ◐ allowed within limits or with second approval · ○ read only/aggregate · – none. (Menus show only what the role can do.)

| Area | Verbs | SUP | OPS | MMG | PMG | CSP | FIN | RSK | MKT | ANL |
|---|---|---|---|---|---|---|---|---|---|---|
| **Customers** | View (masked) | ● | ● | – | – | ● | ○ | ● | – | ○ |
| | Reveal PII | ◐ | – | – | – | ◐ | – | ◐ | – | – |
| | Edit approved data | ◐ | – | – | – | ◐ | – | ◐ | – | – |
| | Suspend / reactivate | ◐ | – | – | – | ◐ request | – | ● | – | – |
| | Review/revoke eligibility | – | – | – | ◐ (partner attrs) | ● | – | ● | – | – |
| | Lift reservation restriction | – | ● | – | – | ● | – | ● | – | – |
| **Merchants** | View | ● | ● | ● | – | ○ | ○ | ● | ○ | ○ |
| | Approve / reject / request changes (KYB) | ◐ | – | ● | – | – | – | ● (enhanced tier) | – | – |
| | Suspend / reactivate / offboard | ● | – | ● | – | – | – | ● | – | – |
| | Change trust level | ● | – | ● | – | – | – | ● | – | – |
| | Bank-detail verification | – | – | – | – | – | ● | – | – | – |
| | Obligation resolution (vouchers/reservations) | ◐ | ◐ | ● | – | – | ◐ (refund) | ◐ override | – | – |
| **Partners** | Approve / configure / suspend | ● | – | – | ● | – | – | ○ | – | – |
| | Data-sharing permission | ◐ SUP+RSK | – | – | – | – | – | ◐ | – | – |
| **Campaigns** | View | ● | ● | ● | ○ | ○ | ○ | ● | ● | ○ |
| | Approve / reject / request changes | ● | ● | ● | – | – | – | ● (flagged) | ◐ content only | – |
| | Pause / suspend / restore | ● | ● | ● | – | – | – | ● | ◐ pause | – |
| | Exceptional Exclusive Deal correction | ◐ | ◐ | – | – | – | – | – | – | – |
| | Invalidate Watch & Earn views | ◐ | – | – | – | – | – | ● | – | – |
| | Edit guardrail policy | ● | ◐ propose | – | – | – | – | ◐ propose | – | – |
| **Moderation** | Hide / restore review, video | ● | ● | – | – | ● | – | ● | ● | – |
| **Payments** | View | ● | – | – | – | ◐ limited | ● | ○ | – | – |
| **Refunds** | Request / review | ● | – | – | – | ◐ ≤ limit | ● | ○ | – | – |
| | Approve | ◐ | – | – | – | ◐ ≤ limit | ● (≥ limit second approver) | – | – | – |
| **Settlements** | View | ● | – | ○ | – | – | ● | ○ | – | – |
| | Create / settle / pay | ◐ | – | – | – | – | ● maker; second FIN or SUP checker | – | – | – |
| | Adjust (money) | ◐ | – | – | – | – | ● maker + checker | – | – | – |
| **Rewards** | View ledger | ● | – | – | – | ● | ● | ● | ○ | ○ |
| | Adjust points | ◐ | – | – | – | ◐ request | ● | ● | – | – |
| | Rules / catalogue | ● | – | – | – | – | ◐ | – | ◐ catalogue | – |
| **Risk** | View / work cases | ● | ○ | – | – | ○ | ○ | ● | – | – |
| | Block / hold / ban device | ◐ | – | – | – | – | – | ● | – | – |
| **Support** | Work cases | ● | ◐ | ● (merchant) | ● (partner) | ● | ● (money) | ● | – | – |
| **Reports** | View | ● | ● | ● | ● | ○ | ● | ● | ● | ● |
| | Export | ◐ | ◐ | ◐ | ◐ | – | ◐ | ◐ | – | ◐ aggregate |
| **Administration** | Users and roles | ● | – | – | – | – | – | ○ | – | – |
| | Audit log | ● | – | – | – | – | – | ● | – | – |
| | System configuration | ● | ○ | – | – | – | ○ fees | ○ | – | – |
| | Reference data & content | ● | – | – | ● partners/networks | – | – | – | ● templates | – |

### 4.2 Separation rules (no inherited privilege)
- **Finance verbs (Refund approve, Adjust, Settle)** are separate permissions. SUP has them only through maker-checker; OPS, MMG, PMG, MKT, ANL never do.
- **Role and permission changes** are SUP-only and require a reason; a user cannot change their own role.
- **PII reveal and exports** are separate permissions, audited, and rate-limited.
- **Configuration** is SUP-only; other roles can *propose* changes (guardrail policy, fee rules) that SUP or FIN approve.
- Analyst and Marketing never see customer-level data.

---

## 5. SENSITIVE-ACTION AND MAKER-CHECKER MODEL

### 5.1 Every sensitive action

`Action → Reason modal (reason code + text) → impact summary → confirm → audit entry (who, what, when, object, before/after, reason, source) → notification to affected party where applicable`.

### 5.2 Maker-checker (four-eyes)

| Action | Maker | Checker | Threshold / trigger | Notes |
|---|---|---|---|---|
| Refund approval | CSP (≤ limit), FIN | FIN (different person); SUP for very large | Amount > `[CFG: refund_checker_threshold]`, any refund on a merchant under review, any refund flagged by risk | CSP limit `[CFG]`; FDA-03 sets values |
| Manual points adjustment | CSP (request), FIN/RSK | FIN or RSK (different person) | Any manual credit; any debit; amount > `[CFG]` | Rewards are non-cash |
| Settlement run | FIN (creates run) | FIN or SUP (approves payout) | Every payout batch | Runs never self-approve |
| Merchant adjustment / penalty | FIN | FIN or SUP | Every adjustment above `[CFG]` | Carried-forward negatives follow LG-07 |
| Bank-detail change (merchant) | MMG receives; FIN verifies | FIN | Every change; payout hold until verified | MR-24 |
| Obligation resolution **emergency override** | MMG/OPS/RSK | SUP or RSK (different person) | Always | Fraud/emergency only |
| Partner data-sharing permission | PMG | SUP + RSK | Always | Default none |
| Role / permission change, admin deactivation | SUP | Second SUP (once ≥ 2 exist) | Role changes affecting Finance/SUP | FDA-04 |
| Voucher validity extension affecting liability/settlement/accounting | OPS/Admin approves extension | FIN checker (D-2) | Any financial effect | Customer notified; audited |
| Exclusive Deal **material** correction | OPS | Second authorised approver (D-3) | Any material change | Non-material corrections alone with audit |
| Appeal of an administrative decision | Original decision maker is excluded | Second-level reviewer (D-1) | Always | Original record preserved |
| Guardrail / fee / reward-rule changes | OPS/FIN proposes | SUP approves | Always, effective-dated, versioned | Settings are never edited in place |
| Merchant suspension (fraud) | RSK/MMG | none (urgent), reviewed within SLA | Optional second review within 24 h | Audit + notification |

Rules: maker ≠ checker; checker sees the maker's reason and evidence; rejected items return to the maker with a note; items pending checker approval show a **"Pending second approval"** banner and a chip; actions execute only on approval; all steps are audited.

---

## 6. CORE PAGE INVENTORY (31)

| # | Page | Nav | Tabs / sections | Roles | Phase |
|---|---|---|---|---|---|
| **A01** | Sign in & MFA | – | Sign in · MFA challenge · **Invite acceptance + MFA enrolment** (internal onboarding, section 12) | all | MVP |
| **A02** | Dashboard | Dashboard | Role-aware: KPIs · My queues · Alerts | all | MVP |
| **A03** | Customers | Customers | Tabs: All · Requests (data deletion/export) · Restricted | CSP, RSK, OPS, SUP | MVP |
| **A04** | Customer detail | Customers | **Overview · Eligibility · Reservations · Vouchers · Rewards · Payments · Support · Risk/flags · Activity** | CSP, RSK, SUP (OPS view) | MVP |
| **A05** | Merchants | Merchants | Tabs: All · Applications · Suspended / offboarding · Obligations | MMG, OPS, RSK, FIN, SUP | MVP |
| **A06** | Merchant application review (KYB workbench) | Merchants | Business · Representative · Bank/IBAN · Documents · Risk & checks · Notes; decision panel | MMG, RSK, SUP | MVP |
| **A07** | Merchant detail | Merchants | **Overview · Legal / KYB · Branches · Users · Campaigns · Vouchers · Watch & Earn · Redemptions · Finance · Support · Audit** | MMG, OPS, FIN, RSK, SUP | MVP |
| **A08** | Partners | Partners | Tabs: Applications · Active · Domain & BIN verification | PMG, SUP | MVP |
| **A09** | Partner detail / application review | Partners | **Overview · Profile & agreement · Authorised users · Eligibility configuration · Offers & campaigns · Reporting permissions · Status · Audit** | PMG, RSK (read), SUP | MVP |
| **A10** | Campaigns | Campaigns | Tabs: Review queue · Live Deals · Exclusive Deals · Vouchers · Watch & Earn | OPS, MMG, MKT, RSK, SUP | MVP |
| **A11** | Campaign review workspace | Campaigns | AR/EN customer preview · Guardrail results · Flags · Merchant history · Decision panel | OPS, MMG, RSK, SUP | MVP |
| **A12** | Campaign detail (adaptive by product) | Campaigns | Common: Overview · Content & terms · Performance · Review history · Audit. **Hot:** + Inventory & reservations. **Voucher:** + Purchases & refunds. **W&E:** + Views & fraud · Budget & balance | OPS, MMG, RSK, FIN, SUP | MVP |
| **A13** | Voucher & code trace | Campaigns | Search any voucher/reservation/redemption code → lifecycle timeline | CSP, OPS, FIN, RSK, SUP | MVP |
| **A14** | Moderation | Campaigns | Videos · Reviews · Reported content · Translations | OPS, CSP, MKT, RSK | MVP |
| **A15** | Payments | Money | Payments · Failed · Disputes / chargebacks | FIN, CSP (limited), SUP | MVP |
| **A16** | Payment detail | Money | Timeline · PSP data (no card data) · Ledger entries · Merchant impact | FIN, CSP, SUP | MVP |
| **A17** | Refunds | Money | Queue · My approvals · Completed / failed | FIN, CSP, SUP | MVP |
| **A18** | Refund case | Money | Request · Eligibility · Evidence · Decision · PSP processing · Ledger & merchant impact · Audit | FIN, CSP, SUP | MVP |
| **A19** | Settlements | Money | Runs · Merchant balances · Payouts · Adjustments · Exceptions | FIN, SUP | MVP |
| **A20** | Settlement run detail | Money | Statements · Holds & negatives · Approvals · Payout file | FIN, SUP | MVP |
| **A21** | Reconciliation | Money | Daily · Exceptions | FIN | MVP (manual-assisted) |
| **A22** | Rewards | Money | Accounts · Ledger · Adjustments & holds · Rules & catalogue · Liability & expiry | FIN, CSP (read), RSK, MKT (catalogue), SUP | MVP |
| **A23** | Risk queue | Risk | All flags · by type · Devices & blocklist · Appeals | RSK, OPS (read), SUP | MVP |
| **A24** | Risk case | Risk | Signals · Evidence · Linked accounts/devices · Context · Decision (Allow / Block / Flag) · Notes · Audit | RSK, SUP | MVP |
| **A25** | Support inbox | Support | Customer · Merchant · Partner · Disputes (payment · voucher · redemption · reward) · Campaign issues | CSP, MMG, PMG, FIN, RSK, SUP | MVP |
| **A26** | Case workspace | Support | Overview · Conversation · Evidence · Related object · Internal notes · Escalation · Resolution | same | MVP |
| **A27** | Reports | Reports | Executive · Growth · Campaigns · Commerce · Watch & Earn & Rewards · Operations · Partners (aggregate) · Export centre | ANL, OPS, FIN, MMG, PMG, RSK, SUP | MVP |
| **A28** | Admin team | Administration | Users · Roles & permissions · Invitations · Sessions & MFA | SUP | MVP |
| **A29** | Audit log | Administration | Search · Record drawer · Saved searches | SUP, RSK | MVP |
| **A30** | System configuration | Administration | General & cities · Guardrails · Reservations & no-shows · Eligibility & verification · Rewards · Fees & rate cards · Notifications · Support SLAs · Reporting thresholds | SUP (propose: OPS, FIN, RSK) | MVP |
| **A31** | Reference data & content | Administration | Networks & issuers · Employers · Categories & areas · Notification templates · Support macros · Legal documents & agreement versions | SUP, PMG, MKT | MVP |

**31 core pages.** Overlays specified below (drawers, modals, sheets) are not counted.

---

## 7. PAGE SPECIFICATIONS

Format: **Purpose · Layout · Key content · Actions · Overlays · States · Permissions/notes.** Common list and detail patterns from section 3 apply.

### A01. Sign in & MFA
- **Purpose:** secure entry for internal users; also the first-time flow for invited users.
- **Layout:** centred card on lavender; wordmark "DealDash Admin"; no marketing imagery.
- **Flows:** corporate email + password (or SSO later) → MFA challenge (authenticator/OTP; provider configurable) → home. **Invite acceptance:** link → verify email → set password → **enrol MFA** → role summary → activation.
- **States:** wrong password/code, lockout, expired invite, MFA required notice, session timeout warning.
- **Notes:** MFA mandatory for SUP/FIN/RSK/MMG/PMG (FDA-02). Every sign-in event is audited.

### A02. Dashboard: "What needs DealDash's attention right now?"
- **Layout:** header with date and role; **row 1 KPI strip** (measurable only); **row 2 attention queues** (cards with counts and oldest-item age); **row 3 live operations** (two tables); **row 4 alerts** (incidents, SLA breaches). Widgets differ by role (my queues first).
- **KPI strip (all measured):** active customers · approved merchants · active campaigns (by product) · Exclusive Deals running · voucher sales (units and SAR) · reservations today · redemptions today · Watch & Earn qualifying views. **Live Deals show discovery signals only; no Live Deal revenue.** Each KPI shows period vs previous.
- **Attention queues:** merchant applications · campaigns needing review · refund cases awaiting approval · fraud flags · support cases (SLA at risk) · settlement exceptions · failed payments · obligations to resolve · translations pending. Each card: count, oldest age, **Open queue**.
- **Live operations:** Exclusive Deals ending soon / low stock; suspended merchants with open obligations.
- **States:** empty queue ("All clear"), loading, widget error with retry; role with no permission for a widget hides it.
- **Permissions:** MMG sees applications and merchants; FIN sees money queues; RSK sees risk and KYB flags; ANL sees KPI strip only.

### A03. Customers (list)
- **Layout:** tabs **All · Requests · Restricted**; search by phone/email (masked in results), customer ID, name; filters (status, city, employer-verified, card-added, flagged, restricted from reservations, joined date).
- **Columns:** customer (first name + masked phone), status chip, city, joined, eligibility chips (employer, card), active reservations, vouchers, open cases, risk flag.
- **Requests tab:** deletion/export requests with legal-hold flag (VK-11), due date, status.
- **Actions:** open customer; process request (reason modal); export (permissioned).
- **States:** no results with tips; PII masked banner.

### A04. Customer detail (tabs, not pages)
- **Header card:** masked identity, status chip (Active, Restricted, Suspended, Deleted), joined date, city, language, key flags, actions (**Suspend / reactivate**, **Add case**, **⋯**).
- **Tabs:**
  1. **Overview:** profile (masked), consents, age verified (18+), devices count, summary counters, open cases, risk level.
  2. **Eligibility:** employer attribute (verified date, expiry, reverify), card entries as **"Added card"** (issuer, product, tier; no digits; never "verified"), segments; actions: **revoke / review attribute** (reason).
  3. **Reservations:** list with status and branch; **no-show strikes** and active restriction with **Lift restriction** (reason).
  4. **Vouchers:** purchased vouchers with status; link to voucher trace (A13).
  5. **Rewards:** balance (available / held), ledger excerpt, **Request adjustment** (maker-checker).
  6. **Payments:** orders and refunds, PSP refs (no card data).
  7. **Support:** cases linked.
  8. **Risk/flags:** flags, linked accounts/devices, decisions.
  9. **Activity / Audit:** admin and customer events.
- **Overlays:** Suspend modal (reason, scope, notify), Reveal PII modal (reason), Edit approved data drawer (limited fields, reason, audited), Adjustment request modal.
- **Do not expose:** card numbers/digits, full ID numbers, OTP codes, passwords, raw device identifiers beyond what risk needs.
- **Permissions:** CSP and RSK full per matrix; OPS view-only; FIN sees Payments/Rewards tabs only.

### A05. Merchants (list)
- **Tabs:** **All · Applications · Suspended / offboarding · Obligations.**
- **All:** table with logo, trade name (AR/EN), status, trust level, branches, active campaigns, open cases, last activity. Filters by status, trust, category, city, risk tier.
- **Applications:** queue sorted by age and risk tier (Standard / Enhanced), SLA clock, assigned reviewer, **Claim**.
- **Suspended / offboarding:** reasons, dates, open obligations count.
- **Obligations:** items owed by suspended/offboarded merchants (issued vouchers, confirmed reservations, unclaimed prizes) with actions via **resolution drawer**: *keep honouring · redirect to another branch · extend · refund (full, before redemption) · cancel with notice*; **emergency override** requires reason and a second approver (MR-42).
- **States:** empty queues, SLA breach highlight.

### A06. Merchant application review (KYB workbench)
- **Layout:** header (applicant, reference, submitted date, risk tier, status chip **Submitted · In review · Needs changes · Approved · Rejected · Enhanced review**); left rail of sections (Business · Representative · Bank/IBAN · Documents · Risk & checks · Notes); right **decision panel** (sticky).
- **Content:** business data and duplicate-CR warning; representative; bank/IBAN with name-match indicator; **document viewer** (preview, type, expiry, accept/reject each); checklist (completeness, consistency, screening result when available); risk tier editor; reviewer notes; history.
- **Decision panel:** **Approve** · **Reject** (reason, appeal-able flag) · **Request changes** (select sections/documents + message template, AR/EN) · **Require enhanced review** (second reviewer RSK) · **Hold**.
- **Rules:** Approve activates only after agreement acceptance; enhanced tier needs second reviewer; bank details verified by FIN before first payout; exact Saudi KYB/document requirements **VK-18**.
- **States:** missing documents warning, resubmitted version diff, locked when decided.

### A07. Merchant detail
- **Header card:** logo, names (AR/EN), status, trust level, branches count, agreement version, actions (**Suspend / Reactivate / Offboard**, **Change trust level**, **⋯**).
- **Tabs:** **Overview** (health, counters, banners) · **Legal / KYB** (documents, agreement records with version/signatory/time, bank verification status) · **Branches** (list, hours, status) · **Users** (roles, branches, finance access flags, status, deactivate) · **Campaigns** (all products, statuses) · **Vouchers** (stock, sales, refunds) · **Watch & Earn** (campaigns, budget accounts) · **Redemptions** (history, reversals, anomalies) · **Finance** (held, eligible, negative carry-forward, statements, payout holds; FIN/SUP) · **Support** · **Audit**.
- **Overlays:** Suspend modal (shows impact: campaigns, vouchers, reservations, payouts), Offboard wizard, Trust-level modal, Obligations drawer.
- **Permissions:** Finance tab FIN/SUP/MMG(read); bank details masked.

### A08. Partners (list)
- **Tabs:** **Applications · Active · Domain & BIN verification.** Types: Bank/issuer, Card scheme, Employer.
- **Verification queue:** employer email domains awaiting ownership proof (method FDA-05); BIN/IIN ranges and tier changes awaiting approval (effective-dated, overlap check).
- **Actions:** open partner; approve/reject range or domain (reason).

### A09. Partner detail / application review
- **Header:** type, name (AR/EN), status (**Submitted · In review · Changes requested · Approved · Configured · Active · Suspended · Offboarded**), actions.
- **Tabs:** **Overview** · **Profile & agreement** · **Authorised users** (roles, MFA state) · **Eligibility configuration** (Bank: products, tiers, BIN/IIN ranges; Scheme: issuers, tiers, geography; Employer: domains, verification rules) · **Offers & campaigns** (offers targeted to the partner; funded campaigns P2) · **Reporting permissions** (aggregate-only by default; cohort threshold; **customer-level data sharing permission: none unless granted** with legal-basis reference, SUP + RSK) · **Status** (suspend/offboard with impact) · **Audit**.
- **Application mode:** the same page shows a decision panel when status is Submitted/In review.
- **Notes:** brand-mark permissions VK-21; data sharing VK-09/VK-12.

### A10. Campaigns (one list for all products)
- **Tabs:** **Review queue · Live Deals · Exclusive Deals · Vouchers · Watch & Earn.**
- **Common columns:** campaign (thumbnail, title AR/EN), merchant (+ trust chip), product chip, branches, status chip, dates, key metric, review reason.
- **Product key metrics:** Live: impressions, directions clicks (**signals, not sales**); Hot: stock left, reservations, redeemed, no-shows; Voucher: sold, redeemed, refunded; W&E: delivered / paid views, spend, invalid share.
- **Review queue:** items auto-held by guardrails or flagged: reason (out-of-range discount, new merchant, sensitive category, large inventory, new video, flagged by risk), age, SLA, assignee, **pilot extra-review** tag.
- **Filters:** product, status, merchant, branch, city, risk reason, date.
- **Bulk actions:** none in MVP (single-item decisions, so each has evidence).
- **Quick actions:** open, pause (reason), assign.

### A11. Campaign review workspace
- **Layout:** left: **customer preview** (EN/AR, Card/Detail, product-appropriate); centre: **guardrail results** (rule, value, limit, pass/warn/fail), **flags**, **merchant history** (trust level, past decisions, complaints); right: **Decision panel**.
- **Decisions:** **Approve** (publish now or schedule), **Reject** (final; reason, bilingual template), **Request changes** (select fields, notes, templates), **Escalate to RSK**.
- **Checks shown:** translation completeness (blocks approval if missing, or **Edit on behalf** with audit), prohibited content, price sanity, eligibility wording ("Pay with an eligible card…" shown where required), video moderation result for W&E.
- **Notes:** standard approved-merchant campaigns auto-publish where allowed (AP-04); flagged/high-risk or pilot-extra-review items land here; every decision audited and emailed/notified to the merchant.

### A12. Campaign detail (adaptive)
- **Header:** merchant, product, status chip, branches, dates, actions: **Approve · Reject · Request changes** (when pending) · **Pause · Suspend · Restore** (reason, permissioned).
- **Common tabs:** **Overview** (summary, eligibility rule, customer journey) · **Content & terms** (AR/EN, media, structured terms, version history with diffs for minor/major edits) · **Performance** · **Review history** · **Audit**.
- **Live Deal:** Performance = impressions, detail views, saves, directions, merchant-page visits; banner "Discovery signals. No sales conversion is claimed."; controlled-redemption status if enabled; edit classification (minor/material) log.
- **Exclusive Deal:** + **Inventory & reservations** tab: per-branch inventory (committed = reserved + redeemed), available, redeemed, expired (hold timed out), **no-show** (meets rule), customer limits, hold duration; **Exceptional correction** modal (cancel reservation, restore stock; reason; audited; SUP/OPS with second approver where configured).
- **Voucher:** + **Purchases & refunds** tab: orders, statuses (Pending payment, Active, Redeemed, Expired, Refunded, Voided), revenue (FIN/SUP), merchant payable state, disputes; link to trace (A13).
- **Watch & Earn:** + **Views & fraud** (started / qualified / invalid by category, device and velocity anomalies, flagged-view list, **Investigate** drawer, **Invalidate views** modal, RSK) and **Budget & balance** (funded, consumed by qualified views, **unused balance separately**, rate card and **reward cost shown as separate concepts**, caps, frequency rules; adjustments only via controlled workflow).
- **Notes:** all admin changes to a live campaign are audit-logged; merchants are notified.

### A13. Voucher & code trace
- **Purpose:** follow any voucher, reservation, prize or redemption code end-to-end.
- **Layout:** big search; result header (instrument, merchant, customer masked, status chip); **lifecycle timeline** `Created → Purchased → Active → Redeemed | Refunded | Expired | Voided` (each event: time, actor, device/branch, ledger entry id); side panels: payment (PSP ref), merchant payable state (held / settlement-eligible / settled), related cases.
- **Actions:** **Resolve** (open refund case, extend validity where policy allows, reverse redemption **request/execute** within window with reason, void for fraud) — each permissioned and audited.
- **Notes:** no unresolved Saudi legal conclusions: expiry/refund treatment shown as configured policy (VK-04/VK-05).

### A14. Moderation
- **Tabs:** **Videos** (Watch & Earn moderation queue, preview, AR/EN rules, approve/reject with reason templates) · **Reviews** (customer reviews, **reported reviews**, merchant reports, merchant response where allowed; **Hide / Remove / Restore** with reason) · **Reported content** (reels, merchants, offers) · **Translations** (campaigns/profiles missing AR or EN; assign, **edit on behalf** with audit, mark complete).
- **Layout:** queue list left, item viewer right with decision buttons; SLA chips.
- **Notes:** simple MVP review moderation; advanced reputation tools Phase 2 (MR-52).

### A15. Payments
- **Tabs:** **Payments · Failed · Disputes / chargebacks.**
- **Columns:** time, order ID, product (voucher / W&E funding), merchant, customer (masked), amount (SAR), status chip (**Pending · Paid · Failed · Refunded · Reversed**), PSP reference, method (brand only).
- **Filters:** status, product, merchant, date, amount, PSP reference.
- **Disputes:** PSP-raised chargebacks with evidence due dates and linked cases.
- **Notes:** no card data anywhere (PCI scope stays with the PSP).

### A16. Payment detail
- **Header:** order, amount, status; actions **Open refund case**, **Flag**.
- **Sections:** **Timeline** (initiated, authorised, captured, webhooks, refunds) · **PSP data** (reference ids, result codes; no card numbers) · **Ledger entries** (sale, held, fee, payable) · **Merchant impact** (payable state) · **Linked** voucher/campaign/customer/cases · **Audit**.

### A17. Refunds
- **Tabs:** **Queue · My approvals · Completed / failed.**
- **Columns:** case, requester, customer (masked), instrument, amount, reason, age/SLA, status, maker, checker.
- **Statuses:** Requested → In review → Awaiting second approval → Approved → PSP processing → Completed / Failed / Rejected.
- **Actions:** open case; claim; approve/reject (if permitted).

### A18. Refund case (workflow workbench)
- **Layout:** left steps (Request · Eligibility · Evidence · Decision · PSP processing · Impact), main panel for the current step, right summary and **maker-checker panel**.
- **Request:** source (customer in-app, support-initiated, merchant cannot honour, duplicate charge, fraud void), amount, reason code.
- **Eligibility:** automatic checks: voucher state (**full refund before redemption supported; partial refund Phase 2**), refund window (configurable; **VK-04**), already redeemed (blocks, offers redemption-reversal path), expiry policy (undecided/configurable), merchant standing, risk flags.
- **Evidence:** attachments, customer statement, redemption log, merchant response.
- **Decision:** Approve / Reject (reason; customer message template). Above threshold or flagged → **Awaiting second approval** (maker ≠ checker).
- **PSP processing:** submit refund, status, retry on failure, failure queue to FIN.
- **Impact:** ledger entries, merchant payable adjustment (held reversal, or negative balance carried forward LG-07), customer notification, audit.
- **States:** completed, failed (retry/escalate), rejected (customer notified), locked after completion.

### A19. Settlements
- **Tabs:** **Runs · Merchant balances · Payouts · Adjustments · Exceptions.**
- **Merchant balances:** per merchant: **held**, **settlement-eligible** (amounts become eligible on **successful redemption**, MVP rule), pending refunds, **negative carried forward**, holds (bank verification, dispute, risk), next run.
- **Runs:** period, merchants count, total eligible, fees, refunds, net, status (Draft → Approved → Payout pending → Paid / Partly failed), maker/checker.
- **Payouts:** batches, per-merchant status (Pending, Paid, Failed, Returned).
- **Adjustments:** manual credits/debits (reason, reference), pending second approval.
- **Exceptions:** negative balances, failed/returned payouts, missing bank verification, disputed statements, reconciliation mismatches.
- **Rule:** payout frequency, cut-off, minimum payout and reserves are **configuration**, not hard-coded (FDA-06); Saudi financial treatment **VK-05/VK-16**.

### A20. Settlement run detail
- **Header:** run id, period, status, maker, checker, totals; actions **Submit for approval**, **Approve payout** (checker), **Mark paid**, **Export payout file**, **Cancel run**.
- **Sections:** **Statements per merchant** (eligible, fee, refunds, adjustments, net, carry-forward) · **Holds & negatives** (excluded merchants and why) · **Approvals** (maker, checker, comments) · **Payout file** (preview, checksum).
- **Notes:** run cannot be approved by its creator; adjustments after approval require a new run.

### A21. Reconciliation
- **Tabs:** **Daily** (PSP report vs ledger vs bank: matched / unmatched per day, totals, status) · **Exceptions** (unmatched items, type, age, assignee, resolve-with-note).
- **MVP:** manual-assisted (upload/ingest reports, matching suggestions); no silent corrections; automated matching Phase 2 (PY-12).

### A22. Rewards
- **Tabs:** **Accounts** (search customer, balances) · **Ledger** (append-only entries: earn, hold, release, redeem, reverse, expire, adjust; filters) · **Adjustments & holds** (pending requests, fraud holds, release/reverse with reason; maker-checker) · **Rules & catalogue** (reward rules and caps; redemption catalogue items, cost in points, stock, funding; **non-cash, non-withdrawable, non-transferable** notice; versioned and effective-dated) · **Liability & expiry** (outstanding points, expiry configuration).
- **Notes:** earn source in MVP = Watch & Earn only; ledger source-agnostic; point valuation and expiry are configuration (FDA-07); VK-17.

### A23. Risk queue
- **Layout:** one queue for all risk types with tabs **All flags · Duplicate accounts · Viewing & rewards · Redemption & QR · Voucher & refund · Eligibility abuse · Merchant & staff · Devices & blocklist · Appeals**.
- **Columns:** severity, type, subject (customer / merchant / staff / device), signal summary, age, SLA, owner, state (**New · In review · Decided**), decision (**Allow · Block · Flag for review**).
- **Actions:** open case; assign; quick clear (reason).
- **Notes:** rule-based signals only (velocity, linkage, patterns); no ML platform in MVP (FDA-08).

### A24. Risk case
- **Layout:** header (subject, severity, owner, state); tabs/sections **Signals** (rule hits with values and thresholds) · **Evidence** (timelines: views, redemptions, logins, payments) · **Linked accounts / devices** (graph-lite list) · **Context** (customer or merchant summary, past cases) · **Decision** · **Notes** · **Audit**.
- **Decision panel:** **ALLOW** (clear, note) · **FLAG FOR REVIEW** (watch, assign, due date) · **BLOCK** (scope: restrict features, hold rewards, reverse rewards/views, suspend account, ban device; reason; notify; appeal path) — destructive scopes can require a second reviewer.
- **Notes:** blocks never reveal detection logic to the user (FR-34); appeals come back as cases (FDA-09).

### A25. Support inbox
- **Tabs:** **Customer · Merchant · Partner · Disputes** (payment, voucher, redemption, reward) **· Campaign issues.**
- **Columns:** case id, subject, requester, type, priority, SLA timer, status, assignee, linked object.
- **Statuses:** New → Triage → In progress ↔ Waiting (requester / third party) → Escalated → Resolved → Closed.
- **Filters:** assignee ("mine"), SLA at risk, type, status, merchant, channel.

### A26. Case workspace
- **Header:** case, status, priority, SLA, assignee; actions (assign, escalate, resolve, merge).
- **Tabs:** **Overview** (requester, summary, related object cards) · **Conversation** (messages, templates/macros AR/EN, attachments) · **Evidence** (system snapshots: voucher state, redemption log, payment, view ledger) · **Related transaction / campaign** (deep links) · **Internal notes** · **Escalation** (to FIN/RSK/MMG with reason) · **Resolution** (resolution code, linked ledger entries, customer message).
- **Actions inside a case (permissioned, audited):** resend voucher, open refund case, request redemption reversal, request reward adjustment, suspend/restrict (escalate), extend voucher validity where policy allows (FDA-10).

### A27. Reports
- **Tabs:** **Executive** (customers, merchants, GMV, unit economics basics) · **Growth** (customer and merchant growth, retention) · **Campaigns** (activity by product; Live Deal **discovery** only) · **Commerce** (Exclusive Deal reservations/redemptions/no-shows; voucher sales, redemption, expiry, refunds) · **Watch & Earn & Rewards** (spend, qualifying views, qualification rate, reward cost, points liability) · **Operations** (queue volumes, SLAs, review times) · **Partners** (aggregate only, cohort suppression applied) · **Export centre** (audited exports).
- **Rules:** metrics from a fixed data dictionary; no Live Deal revenue; partner reports aggregated by default with the configurable small-cohort threshold (pilot setting 10, VK-12); exports permissioned, logged, rate-limited, PII-free unless explicitly allowed.

### A28. Admin team
- **Tabs:** **Users** (list: name, role, MFA state, status, last active) · **Roles & permissions** (permission matrix editor; roles are bundles; changes are versioned and need a reason and second SUP) · **Invitations** (pending, resend, revoke) · **Sessions & MFA** (active sessions, force sign-out, MFA reset by SUP with reason).
- **Overlays:** **Invite user** (corporate email, role, notes), **Change role** (impact summary), **Suspend/Deactivate** (immediate session kill), **Offboard** (reassign queues).
- **Rules:** no self-registration; user cannot change own role; separation-of-duty warnings (e.g. a user holding both Refund-approve and Adjust).

### A29. Audit log
- **Layout:** search bar + filters (actor, role, action type, object type/id, date range, outcome, source/device where captured) → results table → **record drawer** (who, what, when, object, **previous state → new state** diff, reason, source/device, request id).
- **Rules:** append-only, tamper-evident; viewing the audit log is itself logged; export permissioned; retention periods **VK-15** (not decided).

### A30. System configuration
- **Tabs and settings (all versioned, effective-dated, change requires reason; proposals approved by SUP):**

| Tab | Configurable values |
|---|---|
| General & cities | Enabled cities (Riyadh), languages, time zone, feature flags |
| Guardrails | Per-product limits, auto-publish matrix, material-edit field lists, pilot extra-review, trust-level thresholds |
| Reservations & no-shows | Hold default and range (initial 30 min), per-customer caps, **no-show strikes threshold, rolling period, restriction duration** (initial 3 confirmed no-shows → temporary restriction; no automatic permanent ban) |
| Eligibility & verification | Employer and card **reverification periods**, OTP limits, blocked domains/local parts, card-entry limit |
| Rewards | Reward rules, **caps**, hold hours, expiry, point valuation (no fixed SAR per point), instant-reward risk threshold |
| Fees & rate cards | Platform fee rules (versioned), **merchant cost per qualified view** and **customer reward economics as separate settings**, settlement schedule, minimum payout, reserves (all configuration) |
| Notifications | Triggers, frequency caps, quiet hours, channel limits |
| Support SLAs | Priorities, response and resolution targets, escalation timers |
| Reporting thresholds | **Partner small-cohort suppression (pilot setting 10, subject to privacy validation)** |
| Security | MFA policy, session timeouts, SMS/OTP provider abstraction and limits |
- **Not exposed:** low-level infrastructure, database or API settings.
- **Overlays:** **Propose change** (diff, effective date, reason) → approval (SUP) → scheduled; **Rollback** to previous version.

### A31. Reference data & content
- **Tabs:** **Networks & issuers** (Visa, Mastercard, Amex, mada; issuers, products, tiers) · **Employers** (partner list, domains status) · **Categories & areas** (Riyadh areas, merchant categories) · **Notification templates** (AR/EN, versioned) · **Support macros** (AR/EN) · **Legal documents & agreement versions** (terms, privacy, merchant agreement versions; effective dates; re-acceptance rules).
- **Rules:** all customer-facing text exists in Arabic and English (translation status chips); changes versioned and audited.

---

## 8. KEY OPERATIONAL WORKFLOWS

| Workflow | Path and pages |
|---|---|
| **Merchant onboarding** | Application arrives (A05 Applications) → claim → A06 workbench: documents, bank match, risk tier → Approve / Request changes (merchant fixes, resubmits, diff shown) / Reject / Enhanced review (RSK) → agreement acceptance recorded → activation → merchant visible in A07 → FIN verifies bank before first payout |
| **Campaign approval** | Merchant submits → guardrails (A30 policy) → **auto-publish** or **Review queue** (A10) → A11 workspace → Approve / Request changes / Reject → merchant notified; post-publish monitor can auto-pause and re-queue |
| **Exclusive Deal incident** | Low stock or complaint → A12 Hot inventory & reservations → pause/suspend or exceptional correction (reason, second approver where configured) → customers notified → audit |
| **Voucher dispute** | Case (A26) → trace (A13) → evidence → resolution (extend / refund via A18 / void) → merchant payable adjusted → customer and merchant notified |
| **Refund** | Request (customer or support) → A18 eligibility → decision → (second approval if over threshold/flagged) → PSP → ledger and merchant impact → notification |
| **Settlement** | Redemptions mark merchant amounts eligible → FIN creates run (A19/A20) → holds/negatives applied → checker approves → payout file → mark paid → reconciliation (A21) → statements to merchants |
| **Watch & Earn investigation** | Anomaly flag (A23) or campaign alert → A12 Views & fraud → Investigate → invalidate views (credits merchant, reverses rewards) → block/hold per A24 → audit |
| **Risk case** | Signal → A23 queue → A24 evidence → Allow / Flag / Block → notify, appeal path |
| **Suspension & obligations** | MMG/RSK suspends merchant (impact modal) → A05 Obligations → resolve items (honour / redirect / extend / refund / cancel; emergency override with second approver) → audit |
| **Partner onboarding** | A08 Applications → A09 review → configure eligibility (products/tiers/BINs, domains, schemes) → verification queue → activate → reporting permissions (aggregate by default) |
| **Internal user onboarding** | A28 Invite (SUP) → email → A01 acceptance + MFA enrolment → role active → quarterly access review (recommended) |
| **Moderation** | Report or video → A14 → hide/remove/restore with reason → notify |

---

## 9. FINANCE AND MAKER-CHECKER SUMMARY

- **Ledger-backed:** every refund, adjustment and payout writes append-only entries (LG-01…15); admin screens never edit balances directly.
- **Voucher flow:** sale recorded immediately and held; amount becomes **settlement-eligible on successful redemption**; refund before redemption reverses the held amount; refunds after eligibility create a negative carried forward; accrual point stays configurable (LG-03/ST-02).
- **Watch & Earn:** campaign budget accounts hold funded / consumed / **unused (separate)**; merchant CPV and customer reward are separate settings; admin cannot silently move money between accounts.
- **Four-eyes** for refund approvals over threshold, all manual adjustments, every settlement run, bank-detail changes, obligation emergency overrides, partner data-sharing grants, role changes (section 5.2).
- **Segregation:** the person who creates a run, adjustment or refund request cannot approve it; Admin users cannot hold both maker and checker authority for the same item.
- **No hard-coded commercial values:** fees, payout frequency, minimum payout, reserves and thresholds live in A30 and are versioned.

---

## 10. FRAUD / RISK MODEL (MVP)

| Element | Design |
|---|---|
| Single queue | A23 for all types: duplicate accounts, OTP abuse, fake employer verification, card-eligibility abuse, voucher fraud/refund abuse, duplicate redemption, QR sharing, Watch & Earn manipulation, multi-account behaviour, suspicious rewards, merchant/staff abuse, **admin abuse** |
| Detection | Deterministic rules and thresholds (velocity, device/account linkage, timeline anomalies, repeated failed redemptions, refund patterns). Thresholds live in A30. **No ML platform in MVP** |
| Decisions | **ALLOW** · **BLOCK** (scoped: restrict features, hold or reverse rewards, invalidate views, suspend account, ban device) · **FLAG FOR REVIEW** (watch, assign, due date) |
| Evidence | Signals with values, activity timelines, linked accounts/devices, context, prior cases |
| Governance | Case owner, SLA, notes, audit; destructive scopes may need a second reviewer; blocks do not reveal detection logic; appeals return as cases |
| Admin abuse controls | Out-of-hours sensitive actions, excessive PII reveals, many adjustments by one user raise internal flags viewable by RSK/SUP |
| Privacy | Device fingerprinting consent and profiling basis **VK-22**; retention **VK-15** |

---

## 11. LANGUAGE, RTL, VISUAL STYLE

- **Languages:** Arabic and English for admin staff UI (localisation-ready; **not all strings translated now**); customer/merchant-facing content fields always show AR | EN with translation status.
- **Fonts:** Plus Jakarta Sans (English), **IBM Plex Sans Arabic** (Arabic); Western digits (decision D10).
- **RTL:** shell, tabs, drawers, steppers and breadcrumbs mirror. **Operational data stays LTR where clearer:** reference numbers, order and PSP IDs, codes, timestamps, SAR amounts, chart time axes. Tables mirror column order; numeric columns keep LTR figures. Decision panels and drawers open from the start edge.
- **Visual style:** same tokens as the Merchant Portal (white/lavender surfaces, navy text, purple accent, tinted chips with icons, rounded 20-px cards, subtle borders). Admin density: 44–48-px rows, 13-px table text. No photography beyond logos/thumbnails; no gradients; queue counts and age are the visual hierarchy. Status vocabulary shared with merchant portal plus Admin-specific chips (**Pending second approval**, **Under investigation**, **Legal hold**).
- **Accessibility:** keyboard-first tables and decision panels, visible focus, contrast per tokens, no colour-only status, reduced motion.

---

## 12. INTERNAL ADMIN USER ONBOARDING

`Invite (SUP: email, role, reason) → email link (expires) → verify identity (email + known employee record; ID check per HR process) → set password → enrol MFA → role confirmed (read terms of confidentiality) → activation → first-login checklist`. **Suspension** (instant; sessions killed), **role change** (reason; second SUP for finance/SUP roles), **offboarding** (reassign queues and open cases, revoke access, audit export, retention per policy). MFA-ready authentication provider abstraction; SSO possible later.

---

## 13. REMAINING FOUNDER DECISIONS (Admin)

| ID | Decision | Default used |
|---|---|---|
| FDA-01 | Whether Support (CSP) may reveal PII | Yes, masked by default, reveal needs reason + audit |
| FDA-02 | MFA mandatory scope | SUP, FIN, RSK, MMG, PMG mandatory; others recommended |
| FDA-03 | Refund and adjustment limits per role and checker thresholds | Configurable; no numbers set |
| FDA-04 | Second-SUP rule for role changes | Required for finance/SUP roles once two SUPs exist (see also D-4) |
| FDA-05 | Employer domain ownership proof method | Document or DNS proof, reviewed by PMG |
| FDA-06 | Settlement cycle, minimum payout, reserves | Configuration; undecided |
| FDA-07 | Reward valuation, expiry, catalogue values | Configuration; undecided |
| FDA-08 | Risk thresholds and SLAs for pilot | Operations to set during pilot |
| ~~FDA-09~~ | Customer appeal route | **CLOSED (D-1):** appeal case, second-level reviewer, routed by subject |
| ~~FDA-10~~ | Voucher validity extension | **CLOSED (D-2):** merchant requests; Ops/Admin approve; Finance maker-checker if financial effect; VK-04 |
| ~~FDA-11~~ | Exceptional Exclusive Deal corrections | **CLOSED (D-3):** non-material alone with audit; material needs second approval; emergency suspension immediate |
| ~~FDA-12~~ | Access review of admin roles | **CLOSED (D-4):** quarterly privileged review plus immediate triggers; tooling in A28 |

---

## 14. VALIDATE-KSA ITEMS EXPOSED BY ADMIN

| Item | Where it shows up |
|---|---|
| VK-18 | Exact merchant KYB/document requirements (A06) |
| VK-19 | Agreement and e-signature validity, offboarding notice (A07, A31) |
| VK-04 / VK-05 / VK-16 | Voucher refund window, expiry treatment, treatment of funds, Merchant of Record, chargebacks (A13, A15, A18, A19) |
| VK-03 | VAT/invoice fields on statements and fees (A19, A20) |
| VK-08 | Unused Watch & Earn budget treatment (A12) |
| VK-09 / VK-12 | Customer-level partner data sharing; cohort threshold (A09, A27, A30) |
| VK-11 / VK-15 | Data subject requests; retention of audit, ledger, KYB, communications (A03, A29) |
| VK-13 | Card data scope (Eligibility tab shows "Added card" only) (A04) |
| VK-17 | Legal classification of points and expiry (A22) |
| VK-21 | Brand/logo permissions for banks and schemes (A09, A31) |
| VK-22 | Device fingerprinting consent and profiling (A23, A24) |
| VK-23 / SMS | Notification consent and SMS/OTP rules including admin MFA SMS (A30) |
| VK-24 | Consumer complaint timelines (A25, A26) |

---

## 15. RATIONALISATION: EARLIER ADMIN ITEMS → CORE PAGES

Earlier inventory: AD-01…AD-130 (UX Architecture section F, ≈ 98 items) and A01–A29 (rationalised v0.3). Every item is mapped; none is dropped.

| Earlier ID(s) | Now | Kind |
|---|---|---|
| AD-01 | A02 Dashboard | page |
| AD-10 | A03 list | page |
| AD-17 | A03 Requests tab + processing drawer | tab/drawer |
| AD-11, 12, 13, 14, 15, 18 | A04 tabs Overview, Eligibility, Vouchers/Payments, Rewards, Support, Activity | tabs |
| AD-16 | A04 Suspend/reactivate modal | modal |
| AD-19 (reservation restrictions) | A04 Reservations tab + Lift modal; thresholds in A30 | tab/modal |
| AD-20, AD-23 | A05 tabs All, Applications | tab |
| AD-21, AD-22 | A06 workbench + document viewer drawer | page + drawer |
| AD-24, 25, 27 | A07 tabs (Overview, Legal/KYB, Finance), trust modal | tabs/modal |
| AD-26 | A07 Suspend/offboard modal; A05 Suspended tab | modal/tab |
| AD-28 | A05 Obligations tab + resolution drawer | tab/drawer |
| AD-30, 32, 35, 36 | A08 tabs Applications, Active, Domain & BIN verification | tabs |
| AD-31, 33, 34, 37, 38 | A09 detail/review tabs and modals | page/tabs |
| AD-40 | A10 Review queue tab | tab |
| AD-41 | A11 Review workspace | page |
| AD-42, 43, 44, 45 | A10 product tabs (Live, Hot, Voucher, W&E) | tabs |
| AD-46, 47 | A12 W&E tabs; pause/suspend modal | tabs/modal |
| AD-48, 49, 50, 52 | A14 Moderation tabs (Videos, Reviews, Reported, Translations) | tabs |
| AD-51 | A30 Guardrails tab | tab |
| AD-60, 62, 65 | A15 tabs Payments, Failed, Disputes | tabs |
| AD-61 | A16 Payment detail | page |
| AD-63 | A17 Refunds | page |
| AD-64 | A18 Refund case | page |
| AD-66, 67 | A21 Reconciliation tabs Daily, Exceptions | page/tabs |
| AD-68, 75, 77 | A22 Ledger tab; A12 Budget & balance; A19 Merchant balances (read) | tabs |
| AD-69, 71, 72, 74 | A19 tabs Runs, Merchant balances, Adjustments, Payouts | tabs |
| AD-70 | A20 Settlement run detail | page |
| AD-73, 76, 79, 80, 81 | A30 Fees & rate cards, Rewards; A22 Rules & catalogue, Liability & expiry | tabs |
| AD-78 | A22 Adjustments & holds tab (maker-checker) | tab |
| AD-90 to 96, 98 | A23 Risk queue tabs; AD-91 → A24 case | page/tabs |
| AD-97 | A30 (risk thresholds in Guardrails/Eligibility/Rewards tabs) and A23 rule view (RSK propose) | tab |
| AD-100, 102, 103 | A25 Support inbox tabs Customer, Merchant, Partner | page/tabs |
| AD-101, 104 | A26 Case workspace; dispute templates | page |
| AD-105 | A31 Support macros tab | tab |
| AD-106 | A30 Support SLAs tab | tab |
| AD-110 to 116 | A27 Reports tabs | page/tabs |
| AD-120, 121, 122 | A28 Users, Invitations, Roles & permissions | tabs |
| AD-123 | A29 Audit log | page |
| AD-124, 129, 130 | A30 System configuration tabs (General, Security, Reporting thresholds, retention structure) | tabs |
| AD-125, 126, 127, 128 | A31 Reference data & content tabs | tabs |
| New (not earlier) | A13 Voucher & code trace (follow a voucher end-to-end); A01 invite acceptance + MFA | pages |
| Phase 2 | Marketing broadcast tool (AD-127 broadcast), partner data-sharing *usage* tooling, advanced risk graph, CSAT, automated reconciliation matching beyond suggestions, bulk campaign actions | P2 |
| Phase 3 | ML fraud scoring, issuer-API tooling | P3 |

Result: **≈ 98 earlier items → 31 core pages** (plus ≈ 40 drawers/modals). No permission, control or business rule was removed; each control is now a tab, drawer, modal or decision panel on the page above.

---

## 16. READINESS FOR VISUAL UI DESIGN

**Ready**, with these notes: (1) the dense workbenches (A04, A06, A07, A12, A18, A24, A26) should be designed first as a reusable "workbench + decision panel + audit strip" pattern; (2) maker-checker states and the PII-mask/reveal pattern need explicit visual treatment; (3) the 12 FDA decisions above all have defaults and none blocks visual design; (4) Saudi validation items are placeholders flagged in-page.

*End of Admin Portal wireframe architecture v0.1. No production code. Partner Portal not designed.*
