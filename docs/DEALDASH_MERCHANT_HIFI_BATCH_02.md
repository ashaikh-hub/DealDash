# DEALDASH MERCHANT PORTAL: HIGH-FIDELITY BATCH 02

Version 0.1 (draft for approval) · 2026-10-07
Completes the 21 approved MVP core screens. Batch 01 covered M04, M05, M07, M11 (see `DEALDASH_MERCHANT_HIFI_BATCH_01.md`). **Batch 02 covers the other 17: M01, M02, M03, M06, M08, M09, M10, M12, M13, M14, M15, M16, M17, M18, M19, M20, M21.**
Uses the visual system, tokens, components and approved decisions of Batch 01 (v0.2). No production code.

## 0. Deliverables

| Artifact | Location | Notes |
|---|---|---|
| Interactive mockups, Batch 02 | `docs/mockups/merchant-hifi-batch-02.html` | Static HTML for design review. Top bar jumps between all 17 screens; **View as: Owner / Marketing (no finance)** shows how finance data disappears; **RTL layout** flips direction; builders step 1–9; tabs, drawers and modals work. Links back to Batch 01. |
| Batch 01 mockups (updated) | `docs/mockups/merchant-hifi-batch-01.html` | Updated with the approved decisions and now links to Batch 02 (navigation works across both files) |
| This specification | `docs/DEALDASH_MERCHANT_HIFI_BATCH_02.md` | Layout, hierarchy, interactions, states, responsive, RTL per screen |

Visual verification: a representative set (M01, M02, M03, M09, M10, M12, M13, M14, M17 with drawer, M18) was rendered at 1440 px and corrected. Other screens (M06, M08, M15, M16, M19, M20, M21) are built on the same patterns and were not individually rendered. Tablet and phone are specified, not drawn. RTL: shell/dashboard rendered in Batch 01; the Batch 02 RTL toggle flips the layout but its output was not inspected.

## 1. Patterns reused (no new visual language introduced)

| Pattern | Used by |
|---|---|
| Shell (white sidebar, top bar, branch selector) | M06, M08, M09, M14–M21 |
| Collapsed icon rail with easy expand (builders) | M10, M12, M13 |
| Hero gradient card | **M09 only** in this batch (campaign hero, per D3). M18 uses a **soft lavender summary card** (not a gradient) so money screens stay calm |
| Detail framework (header card, KPI strip, tabs, main/side) | M06, M08, M09, M19 |
| Builder framework (rail + form + preview + DealDash checks, 9 steps) | M10, M12, M13 |
| Data table (toolbar, lavender header, row hover, drawer on click) | M14, M16, M17, M18, M19, M20 |
| Status chips, banners, empty/loading/error states | all |
| Bilingual field (EN | AR) | M01, M02, M10, M12, M13, M16 |

## 2. Navigation (final, applies to all screens)

**Seven primary items in three quiet groups plus a footer area:** RUN: **Dashboard · Campaigns · Redemptions**; UNDERSTAND: **Insights · Finance**; MANAGE: **Business · Team**; pinned footer: **Support · Settings** and the merchant card. Vouchers and Watch & Earn are tabs inside **Campaigns** (with icons for prominence) and appear as dashboard Quick actions, attention items and "Promote with Watch & Earn" links. Finance is hidden for people without finance permission. A circular toggle collapses the sidebar to an icon rail (builders open collapsed; one click expands).

## 3. Screen-by-screen specification

Format per screen: **Layout · Content hierarchy · Components · Interactions · States · Responsive · RTL**. Role/permission details come from the wireframe document.

### M01. Sign in & registration
- **Layout:** split screen. Left: soft lavender-to-white panel with wordmark, headline "Reach nearby customers. Fill quiet moments.", supporting sentence, three offset rounded photo tiles, three benefit ticks. Right: white panel with a centred 440-px form.
- **Hierarchy:** headline > photography > form title > single primary button.
- **Components:** segmented Sign in | Register, inputs, bilingual business-name field, six-box OTP, banners.
- **Interactions:** Register → "Check your email" (OTP boxes, resend timer) → Verify → M02. Sign in → M04.
- **States:** inline field errors; **expired-code error banner**; lockout banner with retry time; loading on buttons; success tick after verification.
- **Responsive:** tablet — left panel becomes a 160-px header band; phone — no hero, form only.
- **RTL:** panels swap sides; fields right-aligned; OTP boxes stay left-to-right (digits).

### M02. Onboarding wizard
- **Layout:** minimal top bar (wordmark, Save & exit, language), three columns: progress rail (280) | form card (≤ 720) | help column (320); sticky footer.
- **Tone:** "Set up your shop window", not "KYB". Every step has a friendly title, one explanatory sentence and a **"Why we ask"** card (updates per step).
- **Steps (8):** 1 Business details (bilingual legal and trade names, CR, tax, address) · 2 **Documents** (required document with uploaded/expiry; dropzone; "Needs a clearer copy" chip; reassurance banner that exact requirements are confirmed in review) · 3 Representative · 4 Brand & category (choice chips, photos, bilingual description) · 5 Branches & hours (map pin, hours grid, copy to all days) · 6 Payouts (IBAN with detected bank, account holder, reassurance) · 7 Agreement (scrollable viewer EN|AR, typed signatory, acceptance checkbox, Download PDF) · 8 Review & submit (summary rows with Edit, accuracy confirmation).
- **Components:** progress ring, stepper rail, bilingual fields, dropzone, file rows, checklist card, summary card.
- **Interactions:** Save & continue advances; rail steps clickable; Submit application goes to M03.
- **States:** field/step errors with amber marker; upload progress and per-file chips; saved indicator; draft resumes at the last step.
- **Responsive:** tablet — rail becomes a progress bar with a steps sheet, help card moves below; phone — one section per screen.
- **RTL:** rail on the right, help on the left, Back/Continue swap sides, IBAN and numbers stay LTR.

### M03. Application status
- **Layout:** centred 920 container: status hero card (reference, large status title, status chip, 5-step timeline) → variant panel → read-only application summary. A variant switcher in the mockup stands in for real status.
- **Variants (one page):** **In review** (lilac, plus the neutral "A few extra checks" enhanced-review note) · **Needs changes** (amber, per-item **Fix** buttons, primary *Fix & resubmit*) · **Rejected** (red-tint, reason, Appeal) · **Approved** (green, Sign agreement, Go to dashboard, Get-started checklist) · **Suspended** (solid red banner + panel: what is paused, what continues for customers, Contact support/Appeal).
- **States:** loading skeleton; load error with retry.
- **Responsive/RTL:** single column; timeline mirrors; chips unchanged.

### M06. Live Deal detail
- **Layout:** header card (thumbnail, Live chip, type, title, branches, dates, Edit / Pause / ⋯), info banner about editing rules, tabs **Overview · Performance · Activity**.
- **Overview:** four discovery KPIs (impressions, detail views, saves, directions clicks) → deal summary card (offer, branches, dates, eligibility, **"Discover → View → Visit (no code, no reservation)"**, controlled redemption **Off**, terms) → side: **Promote with Watch & Earn** card and a "Customers see" mini card with the red LIVE badge.
- **Performance:** funnel impressions → detail views → saves → directions clicks → merchant page visits, by-branch list, and the permanent caption **"Discovery signals. They do not prove visits or sales"**. No revenue anywhere.
- **Activity:** timeline with minor-edit entries ("Photos updated, published instantly, logged").
- **States:** Draft, Scheduled, Live, Paused, Expired, Suspended, Pending review, Needs changes variants via the header chip, banner and actions.
- **Editing rule (final):** minor non-commercial edits (typos, formatting, translation corrections) publish instantly with a full audit trail; material edits (value, core proposition, eligibility, branches, material dates, important terms) need review or a revised version; DealDash may tighten this for flagged merchants or content.

### M08. Voucher detail
- **Layout:** header card ("Pay SAR 80, get SAR 100", On sale chip, Pause sales / Add stock), KPI strip: Sold, Redeemed, Refunded, Expiring soon, and **Voucher revenue** (Owner/Finance only; other roles see a lock note), tabs **Overview · Sales & redemptions · Refunds · Activity**.
- **Overview:** stock bar (Redeemed / Sold not redeemed / Available) with legend; voucher summary (face value, price, validity, **redemption in full in one visit**, per-customer limit, refund rule) with a "locked after first sale" chip; "Customers see" card.
- **Sales & redemptions:** searchable table (purchase time, **first name only**, qty, status chip Active/Redeemed/Expired/Refunded, redeemed at, amount column hidden without Finance view).
- **Refunds:** table of full refunds before redemption; amounts permissioned.
- **Edge states:** sold out, ended, suspended (existing vouchers noted as being looked after), empty sales.

### M09. Watch & Earn campaign detail
- **Layout:** hero (gradient, per D3): thumbnail, Live chip, type chip, "Video approved" chip, title, link target and dates, **Pause** and **Add budget** (or **Send for funding** without Finance manage); hero metrics: paid views delivered (620 of 1,000), qualification rate (61%), campaign spend (Finance only), progress bar; tabs **Monitor · Performance · Prizes · Budget & unused balance (Finance only) · Activity**.
- **Monitor:** Views card (started / qualified, billed / not counted) with **"Why views were not counted"** by category (no identities) and the note that only verified views are billed; pace chart (delivered vs scheduled); side: campaign settings (audience, repeat limit, prize, **"What customers earn: set by DealDash"**), amber 92%-used banner, reel preview.
- **Prizes:** inventory table (issued, redeemed, left, validity, branches).
- **Budget & unused balance:** funded, consumed, **unused kept separate**, Add budget (opens the funding modal), funding history; policy note that unused-balance treatment follows DealDash policy.
- **States:** moderation (processing/in review/rejected with reason), Awaiting funding, Paused, Completed, Suspended, close-out.

### M10. Live Deal builder
- **Framework:** common builder, sidebar collapsed, 9 steps: **Basics · Offer · Branches · Eligibility · Dates · Content · Terms · Review & preview · Publish/submit**.
- **Product specifics:** Offer step offers % off, SAR off, Buy 1 get 1, Bundle, Meal deal, Service; Dates step defaults to **"Keep it running until I stop it"** with periodic reconfirmation; Content step adds an ordinary optional video and a note that rewards-for-watching are a separate Watch & Earn campaign; Terms step includes an **optional, off-by-default "Controlled redemption"** card explaining that most Live Deals need nothing.
- **Preview:** customer Live Deal detail (**Live** pill, "Just see and go", "Get directions"; no reservation, no code).
- **DealDash checks:** dates valid, bilingual content, branches, "Frictionless: no code, no reservation (default)".
- **Result:** "Your Live Deal is live" with View campaign and **Promote with Watch & Earn**; other outcomes listed.

### M12. Voucher builder
- **Steps:** **Basics · Pricing · Branches · Eligibility · Inventory & validity · Content · Terms · Review & preview · Publish/submit**.
- **Product specifics:** Pricing shows face value and selling price side by side with the live pill **"Customers pay SAR 80 · get SAR 100 · save 20%"**; Eligibility shows Everyone and a locked **Card-restricted vouchers: Coming later** row; Inventory & validity covers stock, per-customer cap, days-from-purchase or fixed date, and the refund note; Terms include a read-only "Set by DealDash" block for refund/expiry handling.
- **Preview:** customer voucher detail ("Pay 80, get 100", "Buy now", full-redemption note).
- **Checks:** price below face value, bilingual content, large-inventory review warning, validity minimum.

### M13. Watch & Earn builder
- **Steps:** **Basics (name + link target) · Configuration (paid views, estimated cost, repeat limit, prize) · Locations · Audience · Dates · Content (video) · Terms · Review & fund · Publish/submit**.
- **Product specifics:** link-target choice (merchant page / Live Deal / Exclusive Deal / Voucher / product-service); cost estimate card from the rate card; banner **"You do not set rewards"**; repeat limit stricter-only; optional prize with bilingual name, quantity, validity; locations by area or radius; audience groups and interests (no age/gender); video upload with processing state and moderation notice; review step funds via payment provider.
- **Funding variants:** Owner/Finance-manage see **Fund & submit**; others see **Send for funding** (result "Sent for funding · Awaiting funding").
- **Preview:** the customer Reel (progress bar, "Watch to unlock: Free pastry · 37 left", View deal, "Earn rewards · 15s"); no reward amounts shown.

### M14. Redemptions
- **Layout:** header with Export CSV; tabs **History · Code lookup**; toolbar (search, Type, Branch, Date, Result); table (time, branch, type chip, item, value, staff, result); pager.
- **Interactions:** row opens a **redemption drawer** (code, branch, staff, customer first name, time, value, audit trail) with the banner **"Reversible for 02:14:30 by an Owner, Admin or Branch Manager. Staff cannot reverse."** and **Reverse redemption…** opening a modal with required reason, note, impact sentence and the countdown; code lookup is read-only ("Redemption happens in the Staff app").
- **States:** empty "No redemptions yet"; window closed (action hidden, contact support); success toast.

### M15. Insights
- **Layout:** header with branch and date filters and Export; tabs **Overview · Live Deals · Exclusive Deals · Vouchers · Watch & Earn** (with product icons).
- **Honest-metrics rules (decisions D8 / F-2):** Overview shows four cards using the right unit per product (Live: impressions as discovery signal; Hot: reservations and % redeemed; Vouchers: units sold, **SAR revenue only for Owner/Finance**; Watch & Earn: qualifying views). **Live Deals tab** shows the discovery funnel and the permanent caption; **Exclusive Deals** shows reservation outcomes (redeemed / expired = hold timed out / no-show = meets the rule / cancelled) and reserved→redeemed donut; **Vouchers** shows weekly sales, redemption/expiry/refund rates, revenue (permissioned); **Watch & Earn** shows view quality (qualification rate), spend (Finance only), qualifying views, CTA clicks and resulting detail views.
- **Charts:** two types only (line/area and bars/funnel), palette purple/navy/lilac, direct labels; no revenue chart for Live Deals.

### M16. Business
- **Layout:** header with name + Verified, actions Preview customer page and Save changes; tabs **Profile & branding · Branches (3) · Documents & agreement**.
- **Profile:** left cards (Identity with read-only legal name, Branding gallery and bilingual description, Contact) and a sticky **"How customers see you"** preview card with EN/AR toggle.
- **Branches:** table (name/address, today's hours with Open now, status, campaigns, staff) → **branch drawer** (bilingual name, address, map pin, opening-hours grid with copy to all days, deactivate with impact note).
- **Documents & agreement:** documents with Accepted / Expiring soon chips and Upload new; agreement version, signatory, date, status, Download executed copy.

### M17. Team
- **Layout:** header with **Invite user**; tabs **Users · Roles reference**; table (avatar, name, role, branches, **Finance access**, status, last active).
- **Overlays:** invite modal (name, email/mobile, role chips with plain-language descriptions, branch chips); **user drawer** with role and branch chips, a **Finance access card with two separate toggles (Finance: view / Finance: manage)** labelled "Granted by the Owner", and Deactivate.
- **Roles reference:** capability matrix showing Admin as "If Finance: manage / If Finance: view" for finance rows, matching decision F-1.
- **Guards:** last Owner cannot be removed; Admin cannot create Owners.

### M18. Finance (Owner and users with finance permission)
- **Layout:** header with Download statements; **lavender summary card** (Next payout, Settlement-eligible, Held until redeemed, Carried forward) instead of a gradient; tabs **Statements · Payouts · Campaign spend · Invoices · Bank details**.
- **Statements table:** period, redemptions, platform fees, refunds, adjustments, net payable, status chip (Issued/Paid/Disputed); row opens M19.
- **Campaign spend:** funded, consumed, **unused (separate)** per campaign, with the policy note.
- **Bank details:** masked IBAN, verified chip, **Request a change (Owner only)**, example payout-hold banner.
- **No-access state:** a user without finance permission sees a calm "You do not have access to Finance" page with guidance (and the sidebar item is absent).

### M19. Statement detail
- **Layout:** header card (status chip, reference, Download PDF, Dispute); left: **"How we calculated this"** with total row and a Carried-forward card; right: lines table (date, type, reference, amount) with filter chips and pager.
- **States:** Draft (preview), Issued, Paid (payout reference), **Disputed** (banner with case link).

### M20. Support
- **Layout:** header with **Create case**; tabs **Help centre · My cases**; Help: large search, four category cards (Campaigns, Redemptions, Payments & statements, Account & team), popular articles; Cases: table → **case drawer** with message bubbles and a reply box.
- **Create-case modal:** category, related object, subject, message, attachments.

### M21. Settings
- **Layout:** centred 920; tabs **Account · Language & region · Notifications · Security**.
- **Notifications:** matrix of notification × channel (In app / Email) with locked "Always on" rows; finance notices only for Owner/Finance.
- **Security:** password, **two-step verification** toggle (recommended for Owner and Finance), active sessions. Language: English / العربية; dates Gregorian (Hijri later); Riyadh time and SAR fixed.

## 4. Role-aware behaviour demonstrated
Toggle **View as: Marketing (no finance)** in the mockup to see: Finance sidebar item disappears; voucher revenue and campaign spend values disappear (units stay); the Budget tab and funding buttons change to **Send for funding**; Finance page shows the no-access state; Insights shows units only. Owner restores everything.

## 5. Responsive and RTL summary for Batch 02
| Topic | Rule |
|---|---|
| Tablet | Tables become cards; detail pages stack main/side; builders use a compact step bar and a Preview sheet; drawers become full-width sheets |
| Phone priorities | M04 monitoring, M14 code lookup and history cards, M20 support, notifications, campaign status. Builders and finance statements show a "Best on a larger screen" note |
| RTL | Mirror layout; numerals and money stay LTR islands; time axes stay left-to-right; funnel/stock bars fill from the start edge; Arabic UI in IBM Plex Sans Arabic with Western digits (decision D10) |
| Arabic copy | Placeholder only; native review required before launch (D11) |

## 6. Known limitations
- Several Batch 02 screens (M06, M08, M15, M16, M19, M20, M21) were built from established patterns and not individually rendered.
- Tablet/phone drawn nowhere; specified only.
- Photography and icons remain placeholders; custom DealDash icon set and real merchant photography are still to be commissioned.
- Mockups are not a code base.

*End of Batch 02 specification.*

> **Live Deal editing (final, v0.2.4):** For an active Live Deal, **minor non-commercial edits** (typo, formatting and translation corrections and other non-material descriptive corrections) **may publish immediately with a full audit trail**. **Material edits require review or a revised version.** Material = discount/value, core proposition, eligibility, participating branches, campaign dates where material, important terms and conditions, and anything that materially changes what the customer receives. **DealDash may tighten this rule for merchants or content flagged by risk controls.** (Exclusive Deals remain stricter per D6.) Merchant Portal is structurally frozen for MVP; remaining work is visual QA only (7 screens not yet inspected in-browser, tablet/phone states, Arabic/RTL drawn review, final photography/icons, alignment of customer screens S20, S26, S31).
