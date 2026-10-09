# DEALDASH ADMIN PORTAL: HIGH-FIDELITY BATCH 01

Version 0.1 (draft for visual-direction approval) · 2026-10-07
Seven operational experiences: **1 Dashboard · 2 Merchant application workbench · 3 Campaign review workbench · 4 Customer detail · 5 Refund workbench · 6 Risk case · 7 Settlement detail**, plus the Admin shell in RTL, a role switcher, and a components sheet.
No production code. The remaining Admin pages (see wireframes A01–A31) are not designed yet.

## 0. Deliverables

| Artifact | Location | Notes |
|---|---|---|
| Interactive mockup | `docs/mockups/admin-hifi-batch-01.html` | Static HTML for design review. Top bar jumps between the seven screens and the Components sheet. **"Signed in as"** switches Support / Merchant Management / Operations / Finance / Risk / Super Admin and the UI re-renders by permission. **RTL** flips the shell (Arabic labels are placeholders). Modals and drawers are live. |
| Visual language | `docs/DEALDASH_ADMIN_PORTAL_VISUAL_DESIGN.md` | Tokens, shell, 17 components, permission interaction model, RTL, accessibility |
| This specification | `docs/DEALDASH_ADMIN_HIFI_BATCH_01.md` | Per-screen layout and behaviour |

Inspection: the Dashboard, Merchant application, Refund, Risk, Settlement, a no-access state and the RTL Dashboard were rendered and checked at 1440 px; defects found (a class-name collision that misaligned the "Request changes" button, a duplicated role chip) were fixed. The Campaign review, Customer detail, components sheet and the modals/drawers were built from the same patterns and were **not** individually rendered. Tablet is specified, not drawn. Real data density, long Arabic strings, and performance are untested.

## 1. SHARED LAYOUT (all workbenches)
`Header card` (identity, status chips, SLA, owner) → `Section rail (sticky)` | `Main evidence (stacked cards)` | `Decision panel (sticky)` → `Audit strip`. The Customer detail uses tabs instead of a rail. Dashboards use queue cards plus one table.

---

## 2. SCREEN 1: ADMIN DASHBOARD
**Question:** "What requires DealDash attention now?"
- **Header:** greeting, date/time, period selector.
- **KPI strip (8 cards, measured only):** active customers · approved merchants · active campaigns (148 Live · 14 Hot · 31 Voucher · 19 W&E) · Exclusive Deals running (3 low stock) · voucher sales today (units; **SAR only with Finance access**) · reservations today · redemptions today · W&E qualifying views (qualification rate). A footnote states that Live Deals show discovery signals only.
- **Attention queues (8 cards):** merchant applications (oldest age, enhanced count) · campaign reviews · refund cases (awaiting second approval) · fraud flags (severity bar) · support cases (SLA at risk) · settlement exceptions · payment failures · appeals. High-priority queues carry a navy left accent. Cards absent without permission.
- **My next items:** one table across queues (item, type, subject, age, priority) with Mine / Unassigned / SLA at risk filter; rows deep-link.
- **Live operations:** Exclusive Deals low stock or ending, suspended merchants with open obligations, translations waiting; a system-health line.
- **States:** "All clear" empty queue; skeletons; widget-level error with Retry; Super Admin notice.
- **Role behaviour:** Operations sees applications, campaign reviews, fraud (read), support; Support sees support, refunds, payment failures; Finance sees money queues; KPI values adapt.
- **RTL:** cards and table mirror; numbers and ages stay LTR.

## 3. SCREEN 2: MERCHANT APPLICATION WORKBENCH
- **Header card:** logo, legal name, chips **In review** and **Enhanced review**, Arabic name, category, submitted date, assignee, SLA, **Message applicant**.
- **Rail (with indicators):** Overview ✓ · Legal/KYB documents ! · Representative ✓ · Branches ✓ · Settlement details ! · Agreement ✓ · Risk flags (2) · Internal notes (3) · Audit.
- **Main sections:** overview key-values (legal and trade names AR/EN, CR, tax, category, address, mobile/email verified); **documents** list with Accepted / Needs clearer copy chips and a **View** button opening the evidence drawer (note: exact Saudi requirements VK-18); representative with masked ID and audited Reveal; branches table; settlement details (masked IBAN, holder match chip *Partial match*, "Finance verifies before first payout"); agreement record (version, signatory, entity, time, status); **risk flags** as banners; **internal notes** timeline with composer.
- **Decision panel:** blocker banner ("Approve is blocked: 1 document needs a clearer copy and the bank holder name is a partial match"); **Approve** (disabled with reason), **Request changes** (modal: tick items, bilingual message), **Reject** (reason template), **Escalate to Risk**; reason field; below it a **Checks** list (✓ ! ·) including "Second reviewer (Risk), enhanced tier".
- **Audit strip:** Submitted → Claimed → Document flagged → Enhanced review applied → Applicant contacted.
- **Permissions:** decide = Merchant Management, Risk (enhanced), Super Admin; Operations and Finance view only (decision area replaced by "View only"); roles without access see the no-access page.
- **States:** missing documents, resubmitted diff, locked after decision.

## 4. SCREEN 3: CAMPAIGN REVIEW WORKBENCH (one adaptive screen)
- **Header card:** thumbnail, title, **Pending review**, merchant with **trust: new**, review reason (varies by product), waiting time, and a **product switcher (Exclusive Deal · Live Deal · Voucher · Watch & Earn)** that changes the configuration card, journey line, dates, preview and the dynamic guardrail row. (Switcher exists in the mockup to show adaptability; in the product the product is data.)
- **Rail:** Merchant & content · Configuration · Eligibility & branches · Dates & terms · Customer preview · Guardrails (warnings) · Review history.
- **Main:** merchant & content (languages complete, photos); **configuration** by product (Hot: limit type, inventory per branch, free reservation, deposit not available; Live: mechanic, controlled redemption off, no per-customer limit, tracked discovery metrics; Voucher: face value/price, inventory, validity, refund rule; W&E: paid views and budget, frequency, audience, separate merchant cost vs customer reward); eligibility and branches; dates and terms; **customer preview** (phone card, EN/AR) with wording checks; **guardrail table** (rule, value, limit, pass/warn); review history.
- **Decision panel:** **Approve** (publish now), **Request changes**, **Reject**; after publishing **Pause** (reversible) and **Suspend** (emergency, immediate); reason field. A **Corrections** card (Exclusive Deals): *non-material correction (alone)* and *material correction (second approver)*.
- **Rules reflected:** Live Deals stay frictionless; Exclusive Deals are free reservation; no sales conversion claimed for Live; material corrections need a second approver; emergency suspension immediate.
- **Permissions:** decide = Operations, Merchant Management, Risk, Super Admin; Finance reads; Support sees the no-access page.

## 5. SCREEN 4: CUSTOMER DETAIL
- **Header card:** avatar, first name + initial, chips **Active** and **Reservations paused**, masked phone with **Reveal**, city, joined date, age verified 18+, language; actions **Add case**, **Suspend** (Risk, Super Admin) or **Request suspension** (Support), by permission.
- **Tabs:** Overview · Eligibility · Reservations · Vouchers · Rewards · Payments · Support (2) · Risk (1) · Activity. Payments and Risk tabs appear only with permission.
- **Overview:** profile (DOB hidden, age verified), consents, activity summary, banner for the active **reservation restriction** with **Lift restriction** (reason).
- **Eligibility:** employer attribute (OTP-verified, re-verify date, Revoke), **card entries as "Added card"** (issuer, product, tier; no digits; never "verified"), and the note that cardholding is not verified.
- **Reservations:** status including **Not completed** (neutral wording). **Vouchers:** list with Trace link. **Rewards:** available / held / redeemed, **non-cash · non-transferable** chip, **Request adjustment** (maker-checker). **Payments:** orders with mono PSP refs. **Support:** cases including an **Appeal** awaiting second-level review. **Risk:** flag with severity bar and link to the case. **Activity:** audit-style timeline (including "Phone revealed, reason: voucher dispute").
- **Right column:** "What you can do here" (permission summary) and "Never shown" (card digits, full ID, OTP codes, passwords, full DOB).
- **Overlays:** Reveal (reason + 5-minute visibility), Suspend (reason + impact + appeal note), Request suspension, Lift restriction, Adjustment request.
- **Permissions:** Support and Risk work the record; Operations views; Finance sees no customer page; Merchant Management none.

## 6. SCREEN 5: REFUND WORKBENCH
- **Header card:** "Refund SAR 240 · Voucher", chip **Awaiting second approval**, case id, requester, time, SLA; a **maker/checker block** (Maker: Lina S. (Support) · requested; Checker: Finance, a different person · pending).
- **Step chips:** Request ✓ → Eligibility ✓ → Evidence ✓ → **Decision** → Payment provider → Ledger & merchant impact.
- **Main:** request (source, reason, amount, type: *full refund before redemption*); customer (masked phone, prior refunds, risk bar); voucher & payment (status, merchant with *under review* chip, order, PSP reference, PSP status *Captured*, refundable amount); **eligibility checks** (✓ not redeemed · ✓ within window (set by DealDash policy, VK-04) · ! merchant under review · ! above checker threshold); **evidence** (customer message, merchant response, voucher snapshot, each viewable in the drawer); previous actions; **financial effect if approved** table (customer +240 via PSP; merchant held –240; fee none; negative balance none) with the VAT/accounting note (VK-03/05).
- **Decision panel:** for a Finance checker: "You are the checker" banner, **Approve refund (SAR 240)**, **Reject**, **Request information**, **Escalate**, reason. For Support (the maker) or Risk: a view-only note ("Approval needs a Finance user who did not create the request") and **Add information**. A **Maker-checker** card lists the four stages through customer/merchant notification.
- **Rules reflected:** full refund only in MVP (partial is Phase 2); ledger entries created on completion only; merchant payable adjusted via held reversal or negative carry-forward; every step audited.

## 7. SCREEN 6: RISK / FRAUD CASE (adaptable across risk types)
- **Header card:** type and entity (here Watch & Earn manipulation, customer), chip **In review**, owner, SLA, opened time; at right the **severity indicator** (four navy-tint segments + "High") and **confidence** (Medium).
- **Main:** **Entity** (joined, devices with sharing count, rewards earned/held) and **Context** (previous cases, open cases, merchant/campaign); **Risk signals** table (signal, observed, threshold, weight bars); **Timeline**; **Linked accounts / devices** (masked, approved linkage only) and **Related transactions** counts; **Evidence** (exports and linkage list, viewable in the drawer); **Internal notes**.
- **Decision panel:** **Allow** (clear), **Flag for review** (watch), **Block…** (opens a scoped modal: hold/reverse rewards, invalidate views, restrict a feature, ban device, suspend account; destructive scopes marked "needs second reviewer"), **Escalate**, **Request review**, reason. **Operations** can allow, flag, escalate but not block (note shown); Support/Finance see the no-access page.
- **Governance card:** blocks never reveal detection logic; the customer may appeal via Support, reviewed by someone other than the decision-maker.
- **Severity design:** bar + word in navy tints; red is not used for severity, so the page is not alarming but is clear.

## 8. SCREEN 7: SETTLEMENT / FINANCE DETAIL
- **Header card:** merchant and period, chips **Awaiting approval** and **Payout hold: bank not verified**, run and statement ids, creator; maker/checker block (Maker: Noor H. · created run; Checker: a different Finance user or Super Admin · pending).
- **Summary:** soft lavender card (no gradient): **Net payable SAR 8,420** with eligible, fees, refunds/reversals, adjustments.
- **Calculation table:** voucher redemptions (118, *settlement-eligible on redemption*), platform fees (fee rule v3), refunds/reversals, adjustments (second approval ✓), carried-forward negative balance, **net payable**; note that fee percentages, payout frequency and VAT treatment are configuration and pending validation (VK-03/05/16).
- **Voucher redemptions table** (mono voucher codes and order ids, value, fee, export if permitted).
- **Reconciliation card** (PSP report matched ✓, ledger matched ✓, bank after payout, exceptions) and **Payout card** (status, masked account, bank verification *Pending*, hold reason).
- **Approval panel:** payout-hold banner; **Approve payout (checker)**, **Send back to maker**, **Add adjustment (needs 2nd approval)**, **Cancel run**; "A run cannot be approved by the person who created it"; a status flow (statement drafted ✓ → checker approval → bank verified & payout file → paid & reconciled).
- **Audit trail strip.**
- **Permissions:** Finance (and Super Admin through maker-checker) only; Support, Operations, Risk, Merchant Management see the no-access state.

## 9. RTL VIEW
The dashboard shell in RTL: sidebar right, top bar mirrored, queue cards and KPI cards in reverse order, chevrons mirrored, numbers and ages as LTR islands, accent bars on the inline-start edge. Navigation, group labels, role names and KPI/queue titles are in illustrative Arabic (IBM Plex Sans Arabic); body text remains English because the product is not translated yet. Other screens flip the same way but were not individually checked.

## 10. COMPONENTS SHEET
Status chips (incl. Admin-specific), risk indicator, maker/checker states, warning banners, empty/loading/error, overlay launchers (reason modal, confirmation modal, evidence drawer, maker-checker request modal), filter and search pattern.

## 11. KNOWN LIMITATIONS
Desktop only; no tablet drawing; Arabic only partial; real long tables, pagination and performance untested; seven screens plus the components sheet were built from patterns without full individual inspection (Campaign review, Customer detail tabs, modals, drawers); icons and thumbnails are placeholders.

*End of Admin Batch 01 specification.*
