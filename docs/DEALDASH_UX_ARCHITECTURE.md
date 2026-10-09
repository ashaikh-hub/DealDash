# DEALDASH UX ARCHITECTURE

Version 0.4 (decisions applied + MVP rationalised screen architecture + customer final alignment) · 2026-10-07
Inputs: `DEALDASH_MASTER_BLUEPRINT.md` v0.2.2, `DEALDASH_BUSINESS_RULES.md` v0.2.1, and the 63-screen design reference in `Figma Files\` (PNG renders, `design-tokens.json`, README).
Scope: UX architecture only. No application code, no new visual design files. The existing customer design is the approved baseline and is **not** redesigned.

> **Reading note (v0.3):** sections B-F and K.2-K.6 are the detailed **function catalogue** (every function, state and rule). **Section L (MVP UX Rationalised Screen Architecture) is the authoritative screen list for wireframing** (94 core screens). Counts quoted in B-F and K are superseded by section L.

> **Update v0.4 (Customer App final alignment):** the customer section of this document is finalised in `DEALDASH_CUSTOMER_MVP_FINAL.md` (final disposition of all 63 screens: 4 keep, 36 modify, 10 replace, 13 Phase 2/3; **26 core customer screens**; My benefits replaces the Bank Cards and Employer Explore tabs; Exclusive Deal reservation is free; no generic Activate; selection-only card flow). Where this document and the Customer MVP Final differ on customer screens, **the Customer MVP Final wins**. **Customer App is structurally frozen for MVP; all FDC items (including FDC-05 reviews) are closed.** Merchant, Staff, Admin and Partner sections are unchanged and frozen.
## 0. How this document works

- **Phase tags:** MVP / P2 / P3.
- **Disposition of existing screens:** **KEEP** (as-is), **MODIFY** (same layout, specific changes), **REPLACE** (the screen's concept changes; redesign this screen only), **FUTURE** (not in MVP; preserved as a future-phase reference, never deleted).
- **IDs:** existing screens `S01–S63` (the design file numbers). New screens: `CU-` customer, `MP-` Merchant Portal, `SA-` Staff app, `PP-` Partner Portal, `AD-` Admin.
- **Rule references** (e.g. HD-07, WE-01) point to `DEALDASH_BUSINESS_RULES.md`.
- **Audit method:** every one of the 63 PNGs was inspected. Games 42, 44, 45, 46 were inspected through the README list plus the sampled game screens (38, 43, 47) because they share one template; merchant-page screens 35 and 36 render the same content as 34 (see A.2). Images are low-resolution for very long lists (07, 08), so those two were audited at layout level.
- **Founder decisions v0.2 (below) are applied throughout.** Items still assumed rather than decided are marked **ASSUMED**.

### 0.1 UX founder decisions applied (v0.2)

| # | Decision | Effect in this document |
|---|---|---|
| UXD-01 | **No generic "Activate offer" step** (UXF-04). General Live Deals stay Discover → View → Visit. Explicit actions only where the product needs one: Reserve (eligible Exclusive Deal), Buy Voucher, Watch & Earn, controlled redemption where configured. No artificial activation for attribution. | S10, S13, S17, S23 rewritten; CU-37 is a requirement text, not an action |
| UXD-02 | **Points are not a payment method** in MVP; no "X points = SAR Y" or SAR-per-point text anywhere (UXF-07). Rewards are not cash; valuation and redemption economics configurable later. | S28, S48, S49 changed |
| UXD-03 | **Watch & Earn is the only MVP earning mechanism** (UXF-08): no check-ins, referrals, reviews, purchases, daily login, social-sharing earning. Rewards Engine/ledger stays source-agnostic so Phase 2 sources add without redesign. | S37, S48, S51 changed; "Log my saving" no longer earns |
| UXD-04 | **Watch & Earn is a separate campaign domain and UX** (UXF-13). No video ad bundled into a Live/Exclusive Deal lifecycle. A campaign may *link* to a merchant, merchant page, Live Deal, Exclusive Deal, Voucher or product/service, with its own budget, paid views, targeting, qualification rules, rewards, analytics, fraud controls. | S62/S63 stripped of video/reward/budget; deal pages no longer embed points video; new "Promote with Watch & Earn" link |
| UXD-05 | **Ineligible-offer visibility:** show **locked with a clear reason and action** only if the customer could realistically unlock it ("Verify your employer to unlock", "Add your eligible bank card to unlock"); if definitely not eligible with no reasonable unlock path, **do not show it**. (Replaces ASM-01.) | Offer card/detail states, S11, S13, S24 |
| UXD-06 | **Language:** Arabic and English, RTL and LTR. Customer-facing merchant/partner offer content must exist in **both languages before production publication**; DealDash operations can help complete translations during the pilot. | Merchant forms show AR/EN with completeness gate; new MP-49 and AD-52 translation workflow |
| UXD-07 | **Reservation hold is configurable**, initial default **30 minutes** for immediate Exclusive Deals, within approved DealDash limits (supersedes the 1-hour default and ASM-03). | S20, S26, S31, MP-51 |
| UXD-08 | **No-show control:** configurable strikes model; initial default **3 confirmed no-shows → temporary restriction on new Exclusive Deal reservations**; rolling period and restriction duration are admin settings; **no automatic permanent ban**. | CU-47 (new), AD-19 (new), AD-124 |
| UXD-09 | **Promo codes are Phase 2**; not in core checkout. | S28, S29 |
| UXD-10 | **Card-restricted voucher purchasing is Phase 2** unless a launch partner requires it; architecture may support future rules. | S22, S28 |
| UXD-11 | **Add card UX:** collect no PAN, no CVV, **no last four**. Select **Bank/issuer → card product → tier where applicable**. This is eligibility declaration, not ownership verification. Never label "Verified Card"; use "Added card" / "Card benefits added". Future issuer/PSP/token verification can upgrade status. | S10, S13, S23, S55, S56, CU-30..35 |
| UXD-12 | **Fonts:** Plus Jakarta Sans (English); **IBM Plex Sans Arabic** as the initial Arabic companion. Arabic typography, numerals, spacing and RTL are tested during detailed screen design. | Sections I and J |
| UXD-13 | Phase 2 screens (Play & Win, gift voucher flows) are **not deleted**; kept as clearly marked future-phase references. | A.1 FUTURE rows |

### 0.2 Remaining assumptions

| ID | Assumption | Source |
|---|---|---|
| ASM-06 | The Add Card sheet is **card-only** in MVP: wallet / student / insurance memberships hidden (decision 11 covers cards only). | FDR-37 |

---

## A. EXISTING CUSTOMER UX AUDIT (63 screens)

### A.1 Audit table

Columns: **#** · **Screen** · **Module / journey** · **Phase** · **Disposition** · **Conflicts, missing states and actions** · **Data required**.

| # | Screen | Module / journey | Phase | Disp. | Conflicts, missing states and actions | Data |
|---|---|---|---|---|---|---|
| S01 | Sign in | Auth / first run. Welcome with Google, Apple, phone, "Skip for now". | MVP | MODIFY | **Google and Apple are P2**: hide, keep designs as future reference; phone is primary. Missing: phone entry, OTP entry, resend/lockout/error, language switch, terms/privacy links as real pages. "Skip for now" implies guest browsing: new decision UXF-01. | phone, OTP, consents, language |
| S02 | Home - Food & Drink | Discovery hub. Location, search, category chips with counts, Browse by Card/Employer/Brand, hero, Live Offers, Watch strip, Live near you, Exclusive Deals, Vouchers, bottom nav. | MVP | MODIFY | Good fit with Live/Hot/Voucher/W&E. Needs: loading, empty (no offers in area), offline, no-location, guest variant, "Sponsored" label slot, Arabic/RTL. Header shows points ("1,250 pts") and notification badge: fine. Voucher "SAVE 25%" claims need truthfulness rule (VK-01). | categories, location, offers, points |
| S03 | Home - Electronics | Same hub, category variant. | MVP | KEEP | A **state of S02**, not a separate screen. Note a "Hot" card shows "5 days left" (Exclusive Deals should be short: check against `hot_deal_max_hours`). | as S02 |
| S04 | Home - Location sheet | Area selection. "Use my current location" + Riyadh areas. | MVP | MODIFY | Add: permission denied, area search, enabled-cities-only (Riyadh), recent areas. | location, areas |
| S05 | Home - Notifications | Alert preferences by category + notification feed. | MVP | MODIFY | Mixes preferences and feed; separate into feed + settings (CU-NT). Add: empty, mark read, channel prefs, marketing consent, transactional vs marketing. "Following 0 merchants" introduces **Follow merchant** (not in blueprint): UXF-02. | categories, follows, notifications |
| S06 | Home - Best Deal for Me | Comparison assistant ("We compare offers, cards, distance"). | **P2** | FUTURE | Not in approved blueprint; no results screen exists. Needs founder decision UXF-03. Hide entry points on S07-S12 in MVP. | prompt, people, occasion |
| S07 | Explore - Live Deals (list) | Live Deals list. | MVP | MODIFY | Very long unpaged list. Add: filter/sort sheet, pagination, search results, empty, offline, Locked-eligibility cards in-list. | deals, filters |
| S08 | Explore - Exclusive Deals | Exclusive Deals list. Cards with Reserve or View deal; one "Sold out". | MVP | MODIFY | Align CTA rule: quantity-limited with reservation → **Reserve (free)**; time-limited walk-in → View deal. Add: per-branch stock wording, ended/sold-out states, filters, countdown accuracy. | deals, stock, countdown |
| S09 | Explore - Vouchers | Voucher list. Buy / My vouchers tabs, "valid 90 days". | MVP | MODIFY | **Gift icon on every card is P2**: hide. Add: My vouchers tab content, sold out/ended, filters. Savings % claims (VK-01). | vouchers, owned vouchers |
| S10 | Explore - Bank Cards | Bank card hub: card list, "Offers on your cards", locked offers. | MVP | **REPLACE** | **Decided:** remove all "Verified / Verify" language, the "Link a card ... first 6 and last 4" copy and the generic **"Activate offer"** step (UXF-04). Cards appear as **"Added card"** (issuer → product → tier), no digits, no ••last-4. Offers say "Matches your added Riyad Bank Visa Platinum" plus the requirement text; the action is the product action (Live: view/directions; Voucher: Buy). Offers the customer could unlock by adding a card show **locked: "Add your eligible bank card to unlock"**; definitely-ineligible offers are not shown. Add: empty (no cards), error. | added cards, offers |
| S11 | Explore - Employer (not verified) | Employer hub, locked offers. | MVP | KEEP | Add: employer with no offers, "Other" employer (EM-01), empty. | employers, offers |
| S12 | Explore - Live Deals map | Map of live deals; pins. | MVP | MODIFY | Add: pin-tap bottom card (cut off in export), permission denied, cluster/zoom, list/map sync, RTL map controls. | geo, pins |
| S13 | Explore - Offers by Riyad Bank | Issuer offer list, "Funded by Riyad Bank". | MVP | MODIFY | Same card-language rules as S10: no VERIFIED badge, no "Verify your card to unlock" (use "Add your eligible bank card to unlock"), no "Activate offer" button (use the product action). Show requirement text ("Pay with a Riyad Bank credit card"). Add: card filter, empty. | issuer offers |
| S14 | Employer - verification sheet | Choose employer, enter work email, Send code. | MVP | MODIFY | Missing the whole flow after "Send code": **OTP entry, invalid domain, resend, lockout, success, expired**. "Other" employer must route to "request your employer". | employer, email, OTP |
| S15 | Employer - verified | Verified employee card, ~~Employee pass~~, Switch employer, offers. | MVP | MODIFY | **Remove the "Employee pass" button (Phase 2, UXD-14).** Verified status digitally unlocks eligible offers. Add: expiry/reverification banner, remove employer, multi-employer rule (FDR-30). | employer attribute |
| S16 | Employer - employee pass | QR employee pass sheet. | **P2** | FUTURE | **Employee Pass QR is Phase 2 (UXD-14).** Preserved as a future reference; no staff scan flow is built in MVP. | pass token |
| S17 | Deal - Live overview | Live Deal detail: "Just see and go", Get directions, "Log my saving", eligibility block, merchant media, how it works. | MVP | MODIFY | Frictionless footer ("Free, no code, no reservation") **matches LD-02**: flow is Discover → View → Visit. **Remove "Activate on 1 card"** (UXF-04): replace with an eligibility panel "Matches your added card. Pay with it at the till" (terms text only, no activation). **Remove the embedded "Watch to earn up to 30 points / Instant reward" video block:** a deal page shows ordinary merchant photos/video with no points; a "Watch & Earn" teaser appears **only when a separate campaign links to this deal** (UXF-13). "Log my saving" no longer awards points (UXF-08); remains an optional self-report (UXF-09). Add: ended, paused, locked, closed branch, multi-branch picker, offline. | deal, branches, eligibility, media |
| S18 | Deal - Details | Details tab: highlights, what you get, how to redeem, fine print, hours, locations. | MVP | MODIFY | Render from structured terms blocks (LD-16); add branch list per branch hours, bilingual. | terms, menu items, hours |
| S19 | Deal - Reviews | Reviews tab, rating histogram, review list, merchant card, **Sponsored** slot. | MVP | MODIFY | Add: **report review**, sort, empty, pagination, who can review (MR-52). "Sponsored" ad needs label rules (VK-10, UXF-06). | reviews, rating |
| S20 | Deal - Hot limited reserve | Exclusive Deal detail with stock bar and reservation call to action. | MVP | **REPLACE (partial)** | **Conflict resolved:** free reservation, no token. CTA "Reserve my spot (free)". Show **per-branch stock** ("120 left at Riyadh Park"), hold time (**default 30 minutes, configurable**), per-customer limit, and a one-line no-show note ("3 missed reservations pause new reservations"). Remove token copy and "Before you go: token credited". Remove embedded video points block (as S17). Add: sold out, ended, limit reached, reservations restricted (no-shows). | stock per branch, limit, hold |
| S21 | Deal - Hot time-limited | Walk-in Exclusive Deal with countdown ("Ends in 34:11"). | MVP | KEEP | Matches HD-14. Remove embedded "Watch to earn up to 15 points" block (UXF-13). Add: ended state. | start/end |
| S22 | Deal - Voucher | Voucher detail, "Pay 80, get 100", Buy Now. | MVP | MODIFY | "Buy as a gift" hidden (P2). Remove embedded "Watch to earn up to 15 points" block (UXF-13). Add: refund-before-redemption statement (window VALIDATE-KSA), sold out/ended. "One or several visits" copy changed to full redemption (see S32). Card-restricted vouchers are P2: no card requirement UI. | voucher, stock, validity |
| S23 | Deal - Bank card offer (3 cards) | Card offer with card picker. | MVP | **REPLACE** | Replace the picker with a **"Cards that match" list** (added cards that match / do not match, with reason) and the requirement text; no "Verify", no "Activate on 1 card" (UXF-04). If no added card matches but the customer could add one: "Add your eligible bank card to unlock". Remove embedded video points block. | card offer, added cards |
| S24 | Deal - Employer offer | Employee-only Live Deal. | MVP | MODIFY | Show "Verified: [employer] employee. This offer is unlocked for you" with the standard terms; **no employee-pass instruction** (UXD-14). The verified offer page is what the customer shows if asked. Remove embedded video points block. Add locked ("Verify your employer to unlock") and expired-verification variants. | employer, offer |
| S25 | Deal - Photo viewer | Full-screen gallery. | MVP | KEEP | Add: swipe/zoom, low-res fallback, RTL swipe direction. | media |
| S26 | Deal - Reserve sheet | Quantity, branch, confirm reservation. | MVP | **REPLACE** | **Conflict resolved:** no payment and no card selector. Sheet: quantity (≤ per-customer limit), **branch**, hold time (default 30 min), no-show note, "Reserve for free". Add: stock race, limit reached, reservations restricted, success → S31. | qty, branch |
| S27 | Deal - Write a review | Rating stars + text sheet. | MVP | MODIFY | Add: guidelines, min length, who may review, moderation notice, edit/delete own. | rating, text |
| S28 | Checkout - voucher | Contact email, qty, sale countdown, payment, totals. | MVP | MODIFY | **Remove from MVP:** "Use loyalty points" (UXF-07), promo code (P2), "Buy as a gift" (P2). Payment methods (Visa, Mastercard, mada, Apple Pay, STC Pay, new card) are PSP-hosted/tokenised; last-4 on saved payment methods is **PSP-supplied display** (not collected by DealDash; confirm with PSP, VALIDATE-KSA). Add: payment pending / failed / 3-D Secure, hold timer, terms + refund checkbox, receipt link. | order, PSP methods |
| S29 | Checkout - gift with promo | Gift recipient, card style, send via WhatsApp/SMS/Email/Link, promo EID15. | **P2** | FUTURE | Gifting P2 (VC-13). Preserve. | recipient |
| S30 | Checkout - gift voucher card | Gift card result, send/print. | **P2** | FUTURE | Preserve. | gift token |
| S31 | Code - reservation | QR + code and hold timer. | MVP | MODIFY | Hold timer starts at the configured hold (**default 30:00**). Remove "Token paid: SAR 15, credited to your bill". Add Cancel reservation, branch, states: expired, redeemed, cancelled. | reservation, code |
| S32 | Code - voucher | Voucher QR + code, "spend SAR 100 in one or more visits". | MVP | MODIFY | **Conflict:** "one or more visits" = partial redemption (P2, VC-32). MVP copy: "Show at till; redeemed in full". Add: redeemed, expired, refunded, brightness/wake-lock, offline copy of code. | voucher, code |
| S33 | Receipt sheet | Receipt for a reservation token (DD-2004). | MVP | MODIFY | Redesign for voucher purchases; add VAT/invoice fields (VK-03), refund status, support link. Token type removed. | order, payment |
| S34 | Merchant page - Offers | Merchant profile, Follow/Call/WhatsApp/Directions/Share, offers list. | MVP | MODIFY | **Follow** (UXF-02). Add: multi-branch selector, closed state, empty offers, report merchant. | merchant, offers |
| S35 | Merchant page - Info | Info tab. | MVP | MODIFY | **Export defect:** frame renders the Offers tab. Rebuild: about, hours, branches, contacts, links. | merchant info |
| S36 | Merchant page - Reviews | Reviews tab. | MVP | MODIFY | Same export defect; rebuild with report/moderation. | reviews |
| S37 | Watch and Earn | W&E hub: points, reels strip, all reels list; tab to Play & Win. | MVP | MODIFY | **Watch & Earn MVP focuses on qualifying views, rewards and fraud control.** **Remove streak, daily goal and milestone (Phase 2, UXD-17).** Reword "Points equal seconds watched" (rewards are DealDash-controlled). Hide Play & Win tab/card (P2). Keep Fair play panel. Add: caps reached, no campaigns, offline, ineligible, "how qualifying views work". | points, reels, caps |
| S38 | Play and Win - games | Games menu. | **P2** | FUTURE | Preserve. | plays |
| S39 | Reels - player | Vertical video: like, save, share, sound, follow, View deal, "+15 pts · 14s", "Watch to unlock: Free pastry • 37 left". | MVP | MODIFY | Add: buffering/error, background pause, cap reached, campaign ended, captions (AR/EN), report content, mute rule (WE-24), prize sold-out. Likes/follow = social features (UXF-02). | video, progress |
| S40 | Reels - still watching check | "Still watching?" modal with 5s countdown. | MVP | KEEP | Matches WE-23. Add: failure result ("view not counted"), accessibility timing. | check token |
| S41 | Reels - instant reward unlocked | Prize unlocked, funded by merchant, added to My Deals. | MVP | MODIFY | Add: pending/held reward state, prize out of stock, points earned line, error. | reward |
| S42 | Game - Gift Box | Game. | **P2** | FUTURE | Preserve. | |
| S43 | Game - Spin the Wheel | Wheel with points/discount segments. | **P2** | FUTURE | Preserve; orange-heavy palette. | |
| S44 | Game - Scratch Card | Game. | **P2** | FUTURE | Preserve. | |
| S45 | Game - Memory Match | Game. | **P2** | FUTURE | Preserve. | |
| S46 | Game - Quick Quiz | Game. | **P2** | FUTURE | Preserve. | |
| S47 | Game - result | Win result, play again. | **P2** | FUTURE | Preserve. | |
| S48 | Rewards | Points header, redeem, activity, prizes. | MVP | MODIFY | **Remove "10 points = SAR 1", "Worth SAR 130" (UXD-02), streak and milestone claim (UXD-17).** Rewards are not cash; valuation configurable later. Hide Play & Win card (P2). Remove the My Deals payments block (belongs to S53). | points, catalogue |
| S49 | Redeem points | Catalogue grid with filters. | MVP | MODIFY | Remove "Worth SAR ..." labels and any SAR-per-point messaging; show item description and point cost (configuration). Donations (P2, VALIDATE-KSA) and "Convert to bank points / travel miles" (P3) hidden, preserved as references. Add: empty, out of stock, insufficient points. | catalogue, stock |
| S50 | Redeem - confirm sheet | Cost / balance / after redeem. | MVP | KEEP | Add: insufficient, success, out of stock, redemption validity and branch. | item |
| S51 | Points activity | Balance and ledger list with filters. | MVP | MODIFY | **MVP shows only Watch & Earn earn entries** (plus redemptions, holds, reversals, expiry per configuration). Remove check-in, review, voucher purchase, redeemed-deal and game-prize entries and the "never expire" sentence; Silver/Gold tiers are P2. Ledger stays source-agnostic so Phase 2 earn sources add without redesign (UXF-08). | ledger |
| S52 | My Deals - active | Reservations & vouchers list; includes gifts and prizes; embedded savings donut. | MVP | MODIFY | Remove "Paid SAR 15" reservation; gift items P2; savings block duplicates S54. Add: empty, history tab (used/expired), filters, refund. | deals owned |
| S53 | My Deals - payments | Payments list with token statuses (held / credited / refunded). | MVP | MODIFY | Token statuses removed; keep voucher payments, refund status, receipts. Sample-history placeholders removed. | payments |
| S54 | Savings | "Saved with DealDash SAR 1,420", per-saving list (Live/Hot/Vouchers/Rewards). | MVP | MODIFY | Much of it is **self-reported** ("I used this deal"): label as "reported savings", never as verified/DealDash-generated. Whether to keep in MVP: UXF-09. | savings entries |
| S55 | Profile | Header, stats, cards, work offers, saved, settings. | MVP | MODIFY | Header shows phone sign-in (not Google). Cards listed as **"Added card"** (issuer, product, tier), no last-4, no Verified/Verify. Wallet/student/insurance rows hidden (assumption ASM-06). "DealDash for Business" must route to the merchant/staff surfaces, not an embedded console. Add: edit profile, DOB/18+, consents, delete account, log out, privacy/terms, language (AR/EN), security. | profile, consents |
| S56 | Profile - add card sheet | Add card benefits. | MVP | **REPLACE** | **Selection-only flow (decided):** Bank/issuer → card product (network/type) → tier where applicable. **No PAN, no CVV, no last-4, no first-6.** Copy: "Select your card to see matching offers. We never ask for your card number." Result state: "Card benefits added" (not "Verified card"). This is eligibility declaration, not ownership verification. Add: success, duplicate, limit reached, edit/remove. Future issuer/PSP/token verification can upgrade the status. | issuer, product, tier |
| S57 | Profile - verify card sheet | Issuer SMS code to verify a card ("Demo code"). | **P3** | FUTURE | **No issuer verification exists** (BC-04). Remove from MVP; preserve as the future issuer-verified flow. | |
| S58 | Business console - Campaigns | Mobile merchant console: create Hot/Live, empty list. | MVP→ | **REPLACE** | Superseded by the Merchant Portal + Staff app (sections C and D). A phone "quick actions" console may return in P2. | |
| S59 | Business console - Redeem | Enter or paste a code; "**Use latest customer code**". | MVP→ | **REPLACE** | Becomes the Staff app. **Remove "Use latest customer code"** (bypasses scanning; fraud risk FR-12). No staff identity, branch, or result states here. | |
| S60 | Business console - Analytics | Views/Clicks/Saves/Claims/Redemptions, "DealDash generated SAR 11,224". | MVP→ | **REPLACE** | Metrics redefined (LD-60, WE-60); "Claims 179%" invalid; revenue attribution claim unsupported for walk-in deals (LD-62). | |
| S61 | Business console - Boost | Pay to boost a deal in search/home. | **P2** | FUTURE | **Merchant Boost is Phase 2 (UXD-15).** No paid placement in MVP; "Sponsored" slots (S19) hidden. Preserved as future reference. | |
| S62 | Business - Create Live Deal | Mobile one-page create (to be replaced by Merchant Portal flow). | MVP→ | **REPLACE** | In the portal: AR/EN fields, branches, schedule, eligibility (Public / bank card / employer; **student eligibility is Phase 2, UXD-16; engine extensible**), structured terms, media, optional controlled-redemption toggle (off by default), preview, auto-publish vs review result (matches AP-04). **Removed from the deal form:** video ad, instant reward (incl. "Bonus points"), reward limit, "Also fund a Play & Win prize", radius/audience/budget. Promotion is a separate **Watch & Earn campaign** (UXF-13) that can link to this deal ("Promote with Watch & Earn"). | |
| S63 | Business - Create Exclusive Deal | Mobile create (to be replaced by Merchant Portal flow). | MVP→ | **REPLACE** | In the portal: type (time / quantity / both), **per-branch inventory**, reservation settings (hold default 30 min within DealDash limits, per-customer limit), schedule/duration, eligibility, AR/EN, media, preview, "Launch" under pre-approved rules. Same removals as S62. Deposit disabled ("coming soon"). | |

### A.2 Duplicates, export defects and structural notes

| Item | Finding | Action |
|---|---|---|
| S02 / S03 | Same screen in two categories | Treat as one screen with category state |
| S34 / S35 / S36 | Same render (Offers tab) in three frames | Rebuild Info and Reviews tab frames |
| S48 vs S53 | Rewards screen contains the My Deals payments block | Split into Rewards and My Deals |
| S52 vs S54 | Savings summary duplicated | Keep one (Savings), link from Profile |
| S17/S18/S19 | One deal screen, three tabs | One screen, tab states |
| S28/S29/S30 | Checkout plus gift variants | One checkout; gift is P2 |
| S58–S63 | Business console inside the customer app | Replace with separate surfaces |

### A.3 Known conflicts: status

| Conflict | Status |
|---|---|
| Exclusive Deal paid SAR 15 | S20, S26, S31, S33, S52, S53 modified to free reservation |
| Last-4/first-6 card digits | S10, S56 replaced; S55 display of last-4 removed |
| "Verified" card language | S10, S13, S23, S55, S57 removed or replaced |
| Gift checkout P2 | S09, S22, S28 hide; S29, S30 FUTURE |
| Play & Win P2 | S37 tab, S48 card, S38, S42–S47 FUTURE |
| Live Deals frictionless | S17, S18, S21 consistent: keep |
| Watch & Earn MVP | S37, S39–S41 retained with edits |
| Newly discovered | Points shown as SAR (S48, S49, S28); earn sources (S51); expiry text (S51); loyalty-points payment (S28); card "Activate" (S10, S17, S23); "Students" (S62); Boost (S61); Follow/Like (S34, S39); Savings reporting (S54); "Use latest code" (S59); voucher partial-redemption copy (S22, S32) | **Status v0.2:** points-as-payment, SAR-per-point, earn sources, expiry text, card "Activate", partial-redemption copy, merchant-chosen points, bundled video ad, "Use latest code" are **resolved by UXD-01..UXD-13** (screen rows updated). Still open: Boost (UXF-06), Follow/Like (UXF-02), Savings reporting (UXF-09), "Students" (UXF-15). |

---

## B. CUSTOMER APP: MISSING MVP SCREENS AND STATES

Existing screens cover discovery, deals, checkout, codes, merchant pages, W&E, rewards and profile at happy-path level. The missing items are mostly **flows around the existing screens**: onboarding, OTP, eligibility completion, error/empty/loading/offline, My Vouchers, support and deletion.

Format: **ID** · screen/state · purpose · links · phase.

### B.1 Onboarding and account

| ID | Screen / state | Purpose, data, actions | Links | Phase |
|---|---|---|---|---|
| CU-01 | Language selection (AR/EN) | First-run language; also in Settings | → CU-02 | MVP |
| CU-02 | Phone number entry | Saudi mobile, country code, consent line; primary action Send code | S01 → CU-03 | MVP |
| CU-03 | OTP entry | 6-digit, resend timer, wrong code, expired, locked out (OTP-limits) | → CU-04 | MVP |
| CU-04 | Email (optional vs required: UXF-10) and name | Receipt email (checkout needs one) | → CU-05 | MVP |
| CU-05 | Date of birth + 18+ gate | DOB picker; **under-18 block screen** with explanation (AU-31) | → CU-06 / CU-05b | MVP |
| CU-05b | Under-18 blocked | Non-judgemental message; no account created | end | MVP |
| CU-06 | Gender (optional) | Optional, "prefer not to say"; whether to ask at all: UXF-11 | → CU-07 | MVP |
| CU-07 | Location permission + city/area | Uses S04; denied state | → CU-08 | MVP |
| CU-08 | Interests | Category chips (same as S05 list) | → CU-09 | MVP |
| CU-09 | Consents | Terms & Privacy (required), location, notifications, **marketing (separate, optional)** | → CU-10 | MVP |
| CU-10 | Profile complete / welcome | Summary + CTA to home, optional prompts for employer/cards | → S02 | MVP |
| CU-11 | Guest mode prompts | Login-required interstitial on reserve/buy/earn/save (UXF-01) | → CU-02 | MVP |
| CU-12 | Session expired / signed out | Re-login | → CU-02 | MVP |

### B.2 Employer verification (completing S11/S14–S16)

| ID | Screen / state | Purpose | Phase |
|---|---|---|---|
| CU-20 | Employer OTP entry | Code sent to work email; resend; masked email | MVP |
| CU-21 | Employer verified success | Confirmation + link to employer offers | MVP |
| CU-22 | Employer verification failed | Wrong code, expired, lockout, domain mismatch ("use your work email"), shared mailbox rejected, email already linked | MVP |
| CU-23 | Employer "Other / not listed" | Request-an-employer form (no verification) | MVP |
| CU-24 | Reverification due / expired | Banner on S15 and offers; re-verify flow | MVP |
| CU-25 | Employer removed/deactivated | Employer-offer locked state with explanation | MVP |
| CU-26 | Remove employer | Confirm removal | MVP |

### B.3 Card / bank eligibility (replacing S10, S13, S23, S56, S57 behaviour)

| ID | Screen / state | Purpose | Phase |
|---|---|---|---|
| CU-30 | My cards (list) | **"Added cards"**: issuer, product, tier, remove/edit; no VERIFIED, no digits, no last-4 | MVP |
| CU-31 | Add card: issuer | Bank list (configurable) | MVP |
| CU-32 | Add card: network, type, tier | Visa, Mastercard, Amex, mada (configurable); product/tier from issuer catalogue | MVP |
| CU-33 | Add card: success | "Added. Matching offers: N" | MVP |
| CU-34 | Add card: failure/limit/duplicate | Limit reached, duplicate, unsupported issuer | MVP |
| CU-35 | Edit/remove card | Update tier, remove (locks dependent offers) | MVP |
| CU-36 | Eligibility expiry/reconfirm | Reconfirm prompt if configured (`card_reconfirm_days`) | MVP (configurable, may be off) |
| CU-37 | Offer card-requirement panel | Standard component: "Pay with [bank] [product/tier] card to get this offer" (BC-09). Text only: **no activate step, no verified badge** (UXD-01, UXD-11) | MVP |
| CU-38 | Issuer-verified card (future) | Replaces S57 when issuer/PSP verification exists | P3 |

### B.4 Product states

| ID | Product | Missing screen / state | Phase |
|---|---|---|---|
| CU-40 | Live Deals | Ended / paused / suspended deal page; multi-branch picker; locked (ineligible) variant; closed branch; no results | MVP |
| CU-41 | Live Deals | Filter & sort sheet (distance, category, eligibility, open now) | MVP |
| CU-42 | Live Deals | Search results + recent searches | MVP |
| CU-43 | Exclusive Deals | Reserve sheet (free) (replaces S26); reservation success → S31 | MVP |
| CU-44 | Exclusive Deals | Sold out; ended; limit reached; stock race failure | MVP |
| CU-47 | Exclusive Deals | **Reservations paused notice:** shown after 3 confirmed no-shows (configurable); explains the temporary restriction, end date, how to appeal; never a permanent ban (UXD-08). Also the no-show warning line on the reserve sheet. | MVP |
| CU-48 | Offers | **Locked offer state** (only when a realistic unlock path exists): reason + single action ("Verify your employer to unlock" / "Add your eligible bank card to unlock"); non-unlockable offers are simply not listed (UXD-05) | MVP |
| CU-45 | Exclusive Deals | Reservation detail with Cancel, expired state, redeemed state | MVP |
| CU-46 | Exclusive Deals | Exclusive Deal ending/near-expiry reminder (in-app) | MVP |
| CU-50 | Vouchers | My vouchers tab (active/used/expired/refunded) | MVP |
| CU-51 | Vouchers | Voucher detail states (redeemed, expired, refunded, suspended merchant) | MVP |
| CU-52 | Vouchers | Refund request (before redemption) + result | MVP |
| CU-53 | Vouchers | Payment states: pending, failed, 3-D Secure, timeout, hold expired | MVP |
| CU-54 | Vouchers | Order confirmation (success) + receipt | MVP |
| CU-55 | Vouchers | Merchant suspended: resolution notice ("we're resolving your voucher") | MVP |
| CU-60 | Watch & Earn | Reward pending/held; reward reversed; cap reached; no campaigns; view invalid result | MVP |
| CU-61 | Watch & Earn | Prize claimed / prize sold out; prize in My Deals | MVP |
| CU-62 | Watch & Earn | How qualifying views work (help sheet) | MVP |
| CU-70 | Rewards | Points detail with pending/held/expired; empty; redeem success/out of stock/insufficient | MVP |
| CU-71 | Rewards | Milestone claim success (only as a catalogue/prize item fed by Watch & Earn: UXF-21) | MVP/decision |
| CU-80 | My Deals | Empty states; History (used/expired); gift items (P2) | MVP |
| CU-90 | Profile | Edit profile; change phone; consents management; language; linked accounts (P2 Google/Apple) | MVP/P2 |
| CU-91 | Profile | Security activity (P2) | P2 |

### B.5 Notifications, support, deletion, system states

| ID | Screen / state | Purpose | Phase |
|---|---|---|---|
| CU-100 | Notification feed | Separate from preferences; read/unread; empty | MVP |
| CU-101 | Notification settings | By channel and category; marketing opt-in | MVP |
| CU-110 | Help centre | FAQs, contact | MVP |
| CU-111 | Contact support / create case | Category, related order/voucher/reservation, attachments | MVP |
| CU-112 | My cases / case detail | Status, messages, resolution | MVP |
| CU-113 | Report (review/merchant/content/reel) | Report sheet | MVP |
| CU-120 | Account deletion request | Explanation (financial-record exceptions: VK-11), confirm via OTP, status | MVP |
| CU-121 | Data export request | Request and status | MVP/decision |
| CU-130 | Global loading skeletons | Home, lists, detail | MVP |
| CU-131 | Global empty states | Per module | MVP |
| CU-132 | Offline / no connection | Banner, cached content, retry; code screens must work offline-cached | MVP |
| CU-133 | Error / server problem | Retry + support | MVP |
| CU-134 | Location denied / unavailable | Manual area flow | MVP |
| CU-135 | Maintenance / forced update | | MVP |
| CU-136 | Terms/Privacy viewer (AR/EN) | | MVP |

---

## C. MERCHANT PORTAL

Surface: responsive web portal (desktop-first, tablet-usable), Arabic/English. Separate from the customer app (S58–S63 are superseded).

### C.1 Information architecture (8 top-level sections)

| Section | Contents | Roles with access |
|---|---|---|
| **Home** | Dashboard, alerts | All portal roles |
| **Campaigns** | Live Deals · Exclusive Deals · Vouchers · Watch & Earn (sub-tabs) | OWN, ADM, MKT (branch scope for BRM view-only) |
| **Redemptions** | History, code lookup, reversal requests | OWN, ADM, BRM, FIN (read) |
| **Insights** | Analytics by product, exports | OWN, ADM, MKT, BRM (own branches) |
| **Business** | Profile · Branches · Team & roles | OWN, ADM (BRM branch view) |
| **Finance** | Statements · Payouts · Campaign spend · Invoices · Bank details | OWN, FIN (ADM read, no bank edit: FDR-63) |
| **Support** | Help, cases | All |
| **Settings** | Account, notifications, language, security, agreement | All (scoped) |

Roles: **OWN** Owner, **ADM** Admin, **MKT** Marketing Manager, **FIN** Finance, **BRM** Branch Manager, (Redemption Staff use the Staff app only).

### C.2 Screen inventory

Columns per screen (section G of the brief): ID · Screen · Role · Purpose / main data · Primary action; secondary · States · Links · Phase.

#### C.2.1 Onboarding

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-01 | Register | applicant | Email, mobile, password/OTP, business name | Create account; sign in | validation, duplicate | → MP-02 | MVP |
| MP-02 | Verify email | applicant | Email code/link | Verify; resend | expired, resent | → MP-03 | MVP |
| MP-03 | Verify mobile | applicant | Mobile OTP | Verify; resend | locked | → MP-04 | MVP |
| MP-04 | Business details | applicant | Legal name, trade name (AR/EN), CR number, tax no., address, entity type | Save & continue; save draft | incomplete, saved | → MP-05 | MVP |
| MP-05 | Legal documents | applicant | CR/trade licence and other required docs (upload, type, expiry) | Upload; replace | uploading, rejected-file, required-missing | → MP-06 | MVP |
| MP-06 | Authorised representative | applicant | Name, role, ID reference, contact | Save | validation | → MP-07 | MVP |
| MP-07 | Category & branding | applicant | Category, logo, cover, gallery, description (AR/EN) | Save | image rules | → MP-08 | MVP |
| MP-08 | Branches & hours | applicant | Branch name, address, map pin, phone, hours per day, holidays | Add branch; copy hours | at least one branch | → MP-09 | MVP |
| MP-09 | Settlement details | applicant | Bank, IBAN, account holder (must match entity) | Save | IBAN invalid, mismatch | → MP-10 | MVP |
| MP-10 | Commercial agreement | authorised signatory | Read agreement (AR/EN), version, accept/e-sign, signatory name | Sign; download | not signatory, version superseded | → MP-11 | MVP |
| MP-11 | Review & submit | applicant | Summary, missing items checklist | Submit; back | blocked until complete | → MP-12 | MVP |
| MP-12 | Application pending | applicant | Status timeline, expected SLA, contact | Contact support | in review, enhanced review | → MP-13..15 | MVP |
| MP-13 | Changes requested | applicant | Reviewer notes per section, request for documents | Fix & resubmit | partial resubmit | → MP-11 | MVP |
| MP-14 | Rejected | applicant | Reason, appeal route | Appeal; contact | final | support | MVP |
| MP-15 | Approved / activated | OWN | Welcome, next steps (add staff, first campaign) | Go to dashboard | agreement pending | → MP-20 | MVP |
| MP-16 | Suspended notice | OWN/ADM | Reason, what is blocked, resolution steps, customer-obligations queue status | Contact support | appeal open | support | MVP |

#### C.2.2 Dashboard, business profile, branches, team

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-20 | Dashboard | All (scoped) | Live campaigns, today's redemptions, reservations, voucher sales, W&E delivery/budget, alerts (low stock, ending, review needed, payout) | Create campaign; open alert | empty (new merchant), suspended | campaigns, insights | MVP |
| MP-30 | Business profile | OWN, ADM | Legal/trade info, branding, categories, contacts (AR/EN) | Edit; preview customer page | material change → re-review notice | MP-31 | MVP |
| MP-31 | Branches list | OWN, ADM, BRM | Branch cards: status, hours, open now | Add; edit | active/inactive | MP-32 | MVP |
| MP-32 | Branch detail / edit | OWN, ADM | Address/pin, phone, hours, holiday hours, assigned staff, deals assigned | Save; deactivate | deactivate impact warning (LD-55) | MP-33 | MVP |
| MP-33 | Opening hours editor | OWN, ADM | Weekly + exceptions | Save | overlap validation | MP-32 | MVP |
| MP-34 | Team list | OWN, ADM | Users, role, branches, status | Invite; filter | invited/active/deactivated | MP-35 | MVP |
| MP-35 | Invite user | OWN, ADM | Email/mobile, role, branches | Send invite | invalid, duplicate | MP-34 | MVP |
| MP-36 | Edit role / branches | OWN, ADM | Permission summary per role | Save | cannot remove last Owner | MP-34 | MVP |
| MP-37 | User detail | OWN, ADM | Activity, last login | Deactivate; resend invite | deactivated (sessions revoked) | MP-34 | MVP |
| MP-38 | Roles & permissions reference | OWN | Read-only matrix | n/a | | | MVP |

#### C.2.3 Live Deals

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-40 | Live Deals list | OWN, ADM, MKT, BRM(view) | Table: title, branches, dates, status, reach, saves, directions | Create; filter, duplicate | draft, scheduled, live, paused, expired, suspended, changes requested | MP-41, MP-44 | MVP |
| MP-41 | Create / edit Live Deal (stepper) | OWN, ADM, MKT | Steps: mechanic and value, title/description (AR/EN), branches, schedule, eligibility (Public / bank-card / employer / segment), terms builder, media (ordinary photos/video, no points), **controlled mode toggle (off by default)**, review. Final step offers **"Promote with Watch & Earn"** (opens a separate campaign linked to this deal) | Submit; save draft | validation, auto-publish vs review result | MP-42, MP-43 | MVP |
| MP-42 | Preview | same | Customer card + detail in AR and EN, RTL preview | Back to edit; submit | | MP-41 | MVP |
| MP-43 | Submission result | same | "Published" or "Sent for review" with reason (guardrail) | View deal | auto-published / under review | MP-44 | MVP |
| MP-44 | Live Deal detail & analytics | same | Status, funnel (impressions → detail → saves → directions → page visits), by branch, **labelled "discovery signals"** | Pause/resume; edit; end | all lifecycle states | MP-45 | MVP |
| MP-45 | Pause / resume / cancel dialogs | OWN, ADM, MKT | Reason, impact note | Confirm | suspended: resume disabled | MP-44 | MVP |
| MP-46 | Changes requested / rejected feedback | same | Reviewer notes, fields flagged | Edit & resubmit | | MP-41 | MVP |
| MP-47 | Controlled redemption settings | same | Code requirement, per-customer limit; explains effect | Save | | MP-41 | MVP |
| MP-48 | Bulk / templates / duplicate | OWN, ADM, MKT | Duplicate from template | | | | P2 |
| MP-49 | Translation status & help | OWN, ADM, MKT | Per campaign/profile: AR/EN completeness checklist; **publication blocked until both languages exist**; "Ask DealDash to help translate" request (pilot ops service, UXD-06) | Request help; save | missing-AR, missing-EN, translation requested, ready | MP-41, MP-51, MP-61, MP-71 | MVP |

#### C.2.4 Exclusive Deals

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-50 | Exclusive Deals list | OWN, ADM, MKT, BRM | Status, time left, stock per branch | Create; quick pause | live, sold out, ended, paused, suspended | MP-51, MP-52 | MVP |
| MP-51 | Create Exclusive Deal (stepper) | OWN, ADM, MKT | Type: time-limited / quantity-limited / both; value; title (AR/EN); **inventory per branch**; reservation on/off; hold time (**default 30 minutes**, within DealDash limits), per-customer limit; schedule/duration; eligibility; media; preview. Deposit option shown disabled ("coming soon"). No video ad or reward fields (Watch & Earn is separate). | Launch / submit; save draft | auto-publish vs review (pre-approved rules), guardrail errors | MP-52 | MVP |
| MP-52 | Live monitor | same + BRM | Countdown, remaining per branch, reservations, redemptions, no-shows, sell-through | Add stock; pause; end | near sold out, ending soon, paused | MP-53 | MVP |
| MP-53 | Reservations list | OWN, ADM, BRM | Reservation code (masked), customer first name, qty, branch, status, time left | Cancel reservation (reason); export | reserved, redeemed, expired, no-show, cancelled | MP-54 | MVP |
| MP-54 | Exclusive Deal results | same | Final stats, no-show rate | Duplicate | ended | | MVP |
| MP-55 | Deposit settings | same | Deposit amount rules | | | | P2 |
| MP-56 | Pooled inventory settings | same | Shared stock across branches | | | | P2 |

#### C.2.5 Vouchers

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-60 | Vouchers list | OWN, ADM, MKT, FIN(read) | Face value, price, stock, sold, redeemed, status | Create; filter | draft, review, on sale, paused, sold out, ended, suspended | MP-61, MP-62 | MVP |
| MP-61 | Create voucher | OWN, ADM, MKT | Face value, selling price (auto % saving), quantity, per-customer cap, validity (fixed date / N days), branches, terms, eligibility, media, preview | Submit; save draft | guardrail messages (discount ceiling, large inventory → review) | MP-62 | MVP |
| MP-62 | Voucher detail | same | Sales, redemptions, refunds, remaining, settlement status, price/validity locked after sales (VC-08) | Pause sales; add stock | all states | MP-63 | MVP |
| MP-63 | Voucher sales & redemptions | OWN, ADM, FIN | Order list: date, qty, status, refund state (no customer PII beyond first name) | Export | refunded, redeemed | MP-64 | MVP |
| MP-64 | Refund status | OWN, ADM, FIN | Refund cases affecting merchant payable | View | pending, completed | Finance | MVP |
| MP-65 | Inventory adjust | OWN, ADM | Increase stock | Save | cannot reduce below sold | | MVP |

#### C.2.6 Watch & Earn

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-70 | W&E campaigns list | OWN, ADM, MKT | Budget, delivered paid views, spend, status | Create | draft, moderation, funded, live, paused, completed, suspended | MP-71 | MVP |
| MP-71 | Create campaign (stepper) | OWN, ADM, MKT | Video, title (AR/EN), CTA target (own deal/page), audience, geography, dates, **paid views / budget** (cost estimate from rate card), frequency (stricter-only within platform limits), prize inventory (optional), review. **No reward-amount input** (WE-01). | Fund & submit; save draft | guardrail, moderation | MP-72, MP-73 | MVP |
| MP-72 | Video upload & moderation status | same | Upload progress, transcoding, preview, moderation result | Replace video | processing, rejected (reason) | MP-71 | MVP |
| MP-73 | Fund campaign | OWN, FIN, MKT (permission) | Budget amount, PSP payment, receipt | Pay | pending, failed | MP-74 | MVP |
| MP-74 | Campaign monitor | same | Started/qualified views, invalid breakdown, spend, remaining, pace, prize left | Pause/resume | near budget end | MP-75 | MVP |
| MP-75 | Campaign performance report | same | Completion, CTA clicks, resulting detail views, prizes issued (aggregate, no identities) | Export | | | MVP |
| MP-76 | Prize inventory | same | Prize, quantity, validity, branches, allocations | Add/adjust | out of stock | MP-71 | MVP |
| MP-77 | Unused balance & close-out | OWN, FIN | Remaining budget shown **separately**, treatment per policy (VK-08) | Request treatment | policy pending | Finance | MVP |
| MP-78 | Pause / cancel campaign | same | Reason, impact | Confirm | | | MVP |

#### C.2.7 Redemptions, insights, finance

| ID | Screen | Role | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|---|
| MP-80 | Redemption history | OWN, ADM, BRM, FIN | List: time, branch, staff, instrument type, value, result | Filter; export | | MP-81 | MVP |
| MP-81 | Redemption detail | same | Instrument, branch, staff, device, audit | Request reversal (→ support in MVP) | reversed | | MVP |
| MP-82 | Reversal request | BRM, ADM | Reason, evidence | Submit | pending/approved | support | P2 (MVP via support) |
| MP-83 | Code lookup | ADM, BRM | Check a code's status | Search | | | MVP |
| MP-90 | Insights overview | OWN, ADM, MKT | Cross-product KPIs (labelled by signal type) | Filter; export | no data | MP-91..94 | MVP |
| MP-91 | Live Deal insights | same | Funnel, by branch/time | | | | MVP |
| MP-92 | Exclusive Deal insights | same | Reservations, sell-through, no-shows | | | | MVP |
| MP-93 | Voucher insights | same | Sales, redemptions, expiry, refunds | | | | MVP |
| MP-94 | Watch & Earn insights | same | Delivery, completion, invalid share | | | | MVP |
| MP-95 | Exports | same | CSV | | | | MVP |
| MP-100 | Statements | OWN, FIN | List by period, net payable | Open | draft, issued, paid, disputed | MP-101 | MVP |
| MP-101 | Statement detail | OWN, FIN | Lines: redemptions, fees, refunds, adjustments, carried-forward negative balance, tax fields | Download PDF; dispute | | MP-107 | MVP |
| MP-102 | Payouts | OWN, FIN | Payout list and status, bank account | | pending, paid, failed, returned | | MVP |
| MP-103 | Campaign spend | OWN, FIN, MKT(read) | W&E funded / consumed / unused ledger | | | | MVP |
| MP-104 | Invoices | OWN, FIN | Tax invoices (format VK-03) | Download | | | MVP |
| MP-105 | Bank details | OWN (FDR-63) | IBAN view/change | Request change | change → re-review + payout hold | | MVP |
| MP-106 | Subscription | OWN, FIN | Plan, billing | | | | P2 |
| MP-107 | Dispute statement | OWN, FIN | Reason, attachments | Submit | | support | MVP |

#### C.2.8 Notifications, support, settings

| ID | Screen | Role | Purpose | Phase |
|---|---|---|---|---|
| MP-110 | Notification centre | All | Approvals, stock, ends, payouts; preferences by channel | MVP |
| MP-111 | Help centre | All | AR/EN guides | MVP |
| MP-112 | Create case | All | Category (campaign, settlement, redemption dispute, technical, review report), related object, attachments | MVP |
| MP-113 | My cases / detail | All | Status, messages | MVP |
| MP-120 | Account settings | All | Name, mobile, password | MVP |
| MP-121 | Language & region | All | AR/EN, date format | MVP |
| MP-122 | Security | All | Password, MFA (OWN/FIN recommended), sessions | MVP (MFA-ready) |
| MP-123 | Agreement & documents | OWN | Accepted versions, executed copy, renewals | MVP |
| MP-124 | Reputation tools (reply to reviews, badges) | OWN, ADM | | P2 |

---

## D. MERCHANT STAFF / REDEMPTION (SA-)

Surface: **mobile-first installable web app (PWA assumption; native vs web is FDR-26)**, Arabic/English. One purpose: **SCAN → VALIDATE → REDEEM**. No access to finance, campaigns, settlement, billing or settings (RD-50, MR-23).

| ID | Screen | Purpose / main data | Primary; secondary | States | Links | Phase |
|---|---|---|---|---|---|---|
| SA-01 | Login | Staff sign-in (method FDR-62: assumed mobile OTP or PIN) | Sign in | locked, wrong credentials, deactivated | → SA-02/03 | MVP |
| SA-02 | Branch assignment | Assigned branch; select if multiple; shows merchant name | Continue | no branch assigned | → SA-03 | MVP |
| SA-03 | Home | Large **Scan** button; "Enter code"; today's redemption count; branch name | Scan; manual code | offline banner | SA-04, SA-05, SA-16 | MVP |
| SA-04 | Scanner | Camera view, torch, permission handling | Scan | camera denied, unreadable code | SA-06..13 | MVP |
| SA-05 | Manual code entry | Code field with format hint; rate-limited | Validate | rate limit reached | SA-06..13 | MVP |
| SA-06 | Result: Valid | Instrument type, item/offer, value, customer first name, branch, validity; big **Redeem** | Redeem; cancel | lock held N seconds | SA-14 | MVP |
| SA-07 | Result: Invalid | "Code not recognised" | Scan again | | SA-04 | MVP |
| SA-08 | Result: Expired | Expiry date | Scan again | | | MVP |
| SA-09 | Result: Already redeemed | When and where (branch/time) | Scan again; report | repeated attempt warning | | MVP |
| SA-10 | Result: Wrong branch | Valid branches list | Scan again | | | MVP |
| SA-11 | Result: Not yet valid / not active | Start time | | | | MVP |
| SA-12 | Result: Suspended / refunded / cancelled | Reason (neutral) | Contact support | | SA-18 | MVP |
| SA-13 | Result: Eligibility failure | Where terms require continuing eligibility (e.g. employer no longer verified) | Contact support | | | MVP |
| SA-14 | Confirm redemption | Summary + confirm | Confirm | duplicate tap handled | SA-15 | MVP |
| SA-15 | Success | "Redeemed" with time and reference | Next scan; undo (if permitted) | | SA-03, SA-17 | MVP |
| SA-16 | Today's history | Own-branch list: time, item, result | Filter | empty | SA-17 | MVP |
| SA-17 | History detail | Redemption details; **reversal** only where permitted (BRM/ADM role; staff: "Ask your manager") | Request reversal | permission denied | | P2 for request flow; MVP: contact support |
| SA-18 | Help / support | Contact support, report problem | Call/message | | | MVP |
| SA-19 | Account | Name, branch, language, log out | Log out | | | MVP |
| SA-20 | Offline / no network | Clear message: redemption needs connection | Retry | | | MVP |
| SA-21 | Access ended | Account deactivated / merchant suspended | Contact | | | MVP |
| SA-22 | Employee pass check | Display-check of an employer pass if QR retained (UXF-05) | | | | P2 |

Staff-app rules (UX): result screens use one colour + icon + sentence + vibration; no financial figures except the item value the staff needs to apply; manual entry always available; **no "use latest code" shortcut**.

---

## E. PARTNER PORTAL (one shared architecture)

Surface: responsive web portal. **One shell, module toggles per partner type** (Bank, Scheme, Employer). Partner reporting is **aggregated by default**; small cohorts suppressed (setting 10, privacy-validated: PR-08). No customer-level data screens exist in the MVP (a permissioned, default-off access path is designed in the data model only).

### E.1 Information architecture (8 top-level sections)

| Section | Contents | Notes |
|---|---|---|
| Dashboard | Aggregate KPIs | all types |
| Eligibility | Bank: card products, tiers, BIN/IIN · Scheme: issuers, tiers, geography · Employer: domains, verification rules | type-specific module |
| Offers | Offers targeted to the partner's eligibility group | MVP read/performance; creation P2 |
| Merchants | Participating merchants | MVP view; invite P2 |
| Reports | Aggregate usage and reach | all |
| Organisation | Profile, users, roles | all |
| Support | Help, cases | all |
| Settings | Account, notifications, language, security | all |

Partner roles: **PAD** Partner Admin, **PMG** Partner Manager, **PAN** Partner Analyst (read-only), **CPM** Card Product Manager (bank).

### E.2 Screen inventory

| ID | Screen | Type | Role | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|---|
| PP-01 | Invitation / register | all | PAD | Accept invite, set credentials, MFA-ready | Continue | expired invite | MVP |
| PP-02 | Organisation profile & documents (onboarding) | all | PAD | Legal name (AR/EN), registration, contacts, documents, logo/brand permission note (VK-21) | Submit for review | draft, changes requested | MVP |
| PP-03 | Authorised users (onboarding) | all | PAD | Add users and roles | Invite | | MVP |
| PP-04 | Agreement | all | PAD | Review and accept data-sharing/commercial terms | Accept | version | MVP |
| PP-05 | Application status | all | PAD | Pending / changes / approved / rejected / suspended | | all states | MVP |
| PP-10 | Dashboard | all | all | Aggregates: eligible audience (thresholded), offer views, saves, reservations, purchases, redemptions, participating merchants | Open report | suppressed ("not enough data") | MVP |
| PP-20 | Organisation profile | all | PAD | View/edit profile | Save | | MVP |
| PP-21 | Users | all | PAD | List, invite, deactivate | Invite | | MVP |
| PP-22 | Roles & permissions | all | PAD | Role matrix, module access | Assign | | MVP |
| PP-23 | Organisation activity log | all | PAD | Own organisation's configuration changes | Filter | | MVP |
| PP-30 | Offers list | all | PAD, PMG, PAN | Offers targeted to the partner (name, merchant, dates, status, aggregate performance) | Open | live/ended | MVP |
| PP-31 | Offer detail & performance | all | same | Terms as customers see them, eligibility rule, aggregate results | | | MVP |
| PP-32 | Request an offer / campaign | all | PAD, PMG | Brief to DealDash (MVP: ticket-style; DealDash configures) | Submit request | | MVP (request) / P2 (self-serve) |
| PP-33 | Partner-funded campaigns | all | PAD, PMG | Create/monitor funded campaigns and budgets | | | P2 |
| PP-40 | Participating merchants | all | all | Merchants running partner-eligible offers | Filter | | MVP |
| PP-41 | Merchant detail | all | all | Offers, aggregate performance | | | MVP |
| PP-42 | Invite merchant | all | PAD, PMG | | | | P2 |
| PP-50 | Reports overview | all | all | Aggregate trends, date range | Export | cohort suppressed | MVP |
| PP-51 | Offer usage report | all | all | Views→redemptions by offer | Export | | MVP |
| PP-52 | Eligible audience report | all | all | Counts by tier/segment (no identities), suppression notice | | | MVP |
| PP-53 | Exports | all | PAD, PMG, PAN | CSV of aggregates | | | MVP |
| PP-60 | Support cases | all | all | Create/track cases | | | MVP |
| PP-70 | Settings | all | all | Account, notifications, language, security | | | MVP |

**Bank / issuer module**

| ID | Screen | Role | Purpose / main data | Primary; secondary | Phase |
|---|---|---|---|---|---|
| PP-B1 | Card products | CPM, PAD | Products by network and type | Add; edit | MVP |
| PP-B2 | Product tiers | CPM, PAD | Tier names and order (Classic, Gold, Platinum, Signature) | Edit | MVP |
| PP-B3 | BIN / IIN ranges | CPM, PAD | Ranges mapped to product/tier, effective dates; overlap validation | Add; schedule change | MVP (where approved, BC-13) |
| PP-B4 | Eligibility rules | PAD, PMG | Which offers require which products/tiers | Save | MVP |
| PP-B5 | Bank offers | PAD, PMG | Card-specific vs public; merchant-funded vs bank-funded (funding P2) | | MVP |
| PP-B6 | Bank reports | all | Aggregate by product/tier | | MVP |

**Card scheme module**

| ID | Screen | Purpose | Phase |
|---|---|---|---|
| PP-S1 | Scheme profile | Network (Visa/Mastercard/Amex/mada), brand rules link | MVP |
| PP-S2 | Participating issuers | Issuers linked to the scheme | MVP |
| PP-S3 | Card tiers/products view | Read of issuer products by scheme | MVP |
| PP-S4 | Geography | Cities/areas in scope | MVP |
| PP-S5 | Merchant programmes | Programme definitions | P2 |
| PP-S6 | Scheme reports | Aggregate; issuer-level only where permitted (FDR-66, VK-12) | MVP basic |
| PP-S7 | Scheme-funded campaigns | | P2 |

**Employer module**

| ID | Screen | Purpose | Phase |
|---|---|---|---|
| PP-E1 | Company profile | Brand (AR/EN), HR contact | MVP |
| PP-E2 | Approved email domains | Add domain, ownership proof (FDR-31), status | MVP |
| PP-E3 | Verification rules | Reverification period options within platform limits, shared-mailbox rules, grace | MVP |
| PP-E4 | Employee offers | Offers visible to verified employees | MVP |
| PP-E5 | Participating merchants | | MVP |
| PP-E6 | Employer reports | Verified employee **count (thresholded)**, offer usage aggregates; **no names or emails** | MVP |
| PP-E7 | Employee communications | | P2 |

---

## F. DEALDASH ADMIN

Surface: responsive web back-office (desktop-first), Arabic/English UI for staff. Internal roles from Blueprint 17.3: Super Admin (SUP), Operations (OPS), Merchant Management (MMG), Partner Management (PMG), Customer Support (CSP), Finance (FIN), Marketing (MKT), Compliance/Risk (RSK), Analyst (ANL). Every sensitive screen shows who can act and requires a reason; PII is masked by default with an audited "reveal".

### F.1 Information architecture (10 top-level sections)

| Section | Contents |
|---|---|
| **Dashboard** | Role-aware queues and KPIs |
| **Customers** | Search, profile 360, eligibility, transactions, rewards, requests |
| **Merchants** | Applications/KYB, merchant 360, agreements, trust, resolution workflow |
| **Partners** | Applications, partner 360, BIN/domain verification, data-sharing permissions |
| **Campaigns & Content** | Approval queue, Live/Hot/Voucher/W&E monitors, video moderation, review moderation |
| **Money & Rewards** | Payments, refunds, disputes, reconciliation, ledger, settlements, fees, rewards ledger/rules/catalogue |
| **Risk** | Queue, clusters, anomaly views, device registry, rules, appeals |
| **Support** | Customer, merchant and partner cases, dispute workspace, templates, SLAs |
| **Reports** | Executive, operations, finance, merchant, partner, risk, export centre |
| **Administration** | Internal users, roles, audit log, system settings, reference data, notification templates, legal documents |

### F.2 Screen inventory

Columns: ID · Screen · Roles · Purpose / main data · Primary; secondary · States · Phase.

#### F.2.1 Dashboard and customers

| ID | Screen | Roles | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|
| AD-01 | Dashboard | all (widgets by role) | Pending applications, approval queue age, live campaigns, redemptions today, failed payments, fraud alerts, payout status | Open queue | empty/quiet | MVP |
| AD-10 | Customer search & list | CSP, OPS, RSK, SUP | Search phone/email/id (masked), filters (status, city, employer, flagged) | Open | no results | MVP |
| AD-11 | Customer 360 | CSP, RSK, SUP | Profile (masked), status, verification, devices, consents; tabs below | Suspend; add note | active/suspended/deleted | MVP |
| AD-12 | Eligibility tab | CSP, RSK | Employer/card attributes: source, verification level, dates | Revoke attribute | expired/revoked | MVP |
| AD-13 | Transactions tab | CSP, FIN | Orders, vouchers, reservations, redemptions | Open order | refunded/redeemed | MVP |
| AD-14 | Rewards tab | CSP, FIN, RSK | Ledger entries, holds, adjustments | Request adjustment | held/reversed | MVP |
| AD-15 | Cases tab | CSP | Cases and complaints | Open case | | MVP |
| AD-16 | Suspend / reactivate | CSP(request), RSK, SUP | Reason code, scope, notify customer | Confirm | maker-checker if configured | MVP |
| AD-17 | Data requests queue | CSP, RSK, SUP | Deletion/export requests, legal-hold flag (VK-11) | Process | pending/completed/refused | MVP |
| AD-18 | Consent log | RSK, SUP | Consent history | | | MVP |
| AD-19 | Reservation restrictions | CSP, OPS, RSK | Customer no-show strikes, active restrictions (start/end), lift early with reason; **no automatic permanent ban** (UXD-08) | Lift/extend restriction | strike counting, restricted, expired | MVP |

#### F.2.2 Merchants

| ID | Screen | Roles | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|
| AD-20 | Merchant applications queue | MMG, OPS | Applications by status, age, risk tier | Open | new, in review, changes requested, enhanced review | MVP |
| AD-21 | Application review (KYB) | MMG, RSK | Business data, representative, bank/IBAN match, documents, checklist, risk tier, notes | **Approve; reject; request information/documents; require enhanced review** | second-reviewer required for enhanced tier | MVP |
| AD-22 | Document viewer | MMG, RSK | Document preview, metadata, expiry, accept/reject per document | Mark | rejected-doc | MVP |
| AD-23 | Merchant list | MMG, OPS, FIN | Status, trust level, branches, campaigns | Open | | MVP |
| AD-24 | Merchant 360 | MMG, OPS, FIN, RSK | Profile, branches, users, campaigns, commercial status, balances, cases | Suspend; edit trust | active/suspended/offboarding | MVP |
| AD-25 | Agreement records | MMG, SUP | Version, signatory, entity, time, status, executed document | Request re-acceptance | superseded | MVP |
| AD-26 | Suspend / reactivate / offboard | MMG, RSK, SUP | Reason, impact summary (campaigns, vouchers, reservations, payouts) | Confirm; open resolution queue | | MVP |
| AD-27 | Trust level management | MMG, RSK | Set new/standard/trusted with reasons | Save | | MVP |
| AD-28 | Obligations resolution queue | MMG, OPS, FIN | Issued vouchers, reservations, prizes owed by suspended/offboarded merchants; actions: honour, redirect, extend, refund, cancel; **emergency override** with reason and second approver | Resolve item | open/resolved | MVP |

#### F.2.3 Partners

| ID | Screen | Roles | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|
| AD-30 | Partner applications queue | PMG | Bank/scheme/employer applications | Open | | MVP |
| AD-31 | Partner review | PMG, RSK | Profile, documents, agreement, users | Approve; reject; request changes | | MVP |
| AD-32 | Partner list | PMG, OPS | Type, status | Open | | MVP |
| AD-33 | Partner 360 | PMG | Configuration (products/tiers/BINs, domains, schemes), users, offers, aggregates | Suspend; edit | | MVP |
| AD-34 | Partner users | PMG | Users and roles | Deactivate | | MVP |
| AD-35 | Domain verification queue | PMG | Employer email domains awaiting proof | Verify; reject | | MVP |
| AD-36 | BIN / issuer range management | PMG | Ranges, overlaps, effective dates; approvals | Approve | scheduled | MVP |
| AD-37 | Partner suspend / offboard | PMG, SUP | Impact on offers and eligibility | Confirm | | MVP |
| AD-38 | Data-sharing permissions | SUP, RSK | Per partner and purpose, **default none**; legal basis reference | Grant/revoke | audit | MVP (control), P2 (usage) |

#### F.2.4 Campaigns and content

| ID | Screen | Roles | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|
| AD-40 | Approval queue | OPS, MMG, RSK | All products: type, merchant, trust, risk reason, age in queue, SLA | Open; bulk assign | pilot-extra-review items flagged | MVP |
| AD-41 | Review item | OPS, MMG, RSK | Customer-preview in AR/EN, guardrail results, flags, merchant history | Approve; reject; request changes (templates) | | MVP |
| AD-42 | Live Deals monitor | OPS | All Live Deals, filters, status | Pause; suspend | | MVP |
| AD-43 | Exclusive Deals monitor | OPS | Real-time stock, countdown, reservations | Pause; suspend | auto-paused by anomaly | MVP |
| AD-44 | Vouchers monitor | OPS, FIN | Sales, stock, redemptions, refunds | Pause; suspend | | MVP |
| AD-45 | Watch & Earn monitor | OPS, RSK | Campaigns, budgets, delivery, invalid share, reward cost | Pause; suspend | | MVP |
| AD-46 | W&E campaign detail | OPS, RSK, FIN | Budget account (funded/consumed/unused), qualified vs invalid views, fraud flags, prizes | Pause; invalidate views | | MVP |
| AD-47 | Pause / suspend dialog | OPS, MMG, RSK | Reason code, notify merchant | Confirm | | MVP |
| AD-48 | Video moderation | OPS, RSK | Queue of videos, AR/EN rules, reason templates | Approve; reject | | MVP |
| AD-49 | Review moderation | OPS, CSP | Reported reviews, hide/remove, merchant reports | Hide; restore | | MVP |
| AD-50 | Reported content | OPS, RSK | Reports on reels/merchants/offers | Resolve | | MVP |
| AD-51 | Guardrail policies | OPS, SUP | Per-product limits, auto-publish matrix, trust thresholds | Save (versioned, audited) | | MVP |
| AD-52 | Translation queue | OPS, MKT | Campaigns/profiles awaiting AR or EN; assign, edit on behalf of merchant (audited), mark complete; blocks publication until both languages exist (UXD-06) | Complete translation; return to merchant | pending, in progress, ready | MVP |

#### F.2.5 Money and rewards

| ID | Screen | Roles | Purpose / main data | Primary; secondary | States | Phase |
|---|---|---|---|---|---|---|
| AD-60 | Payments list | FIN, CSP(read) | PSP reference, order, amount, status | Open | pending/failed/paid/refunded | MVP |
| AD-61 | Payment detail | FIN, CSP | Timeline, PSP data (no card data), ledger entries | Refund; flag | | MVP |
| AD-62 | Failed payments | FIN | Failure reasons, retries | | | MVP |
| AD-63 | Refunds queue | FIN, CSP(≤limit) | Requests with reason, voucher state | Approve; reject | pending/failed | MVP |
| AD-64 | Refund detail | FIN | Ledger impact, merchant payable impact | Execute | | MVP |
| AD-65 | Chargebacks & disputes | FIN | PSP disputes, evidence | Respond | | MVP |
| AD-66 | Reconciliation | FIN | PSP vs ledger vs bank status per day | Open exceptions | matched/unmatched | MVP (manual-assisted) |
| AD-67 | Reconciliation exceptions | FIN | Unmatched items | Resolve with note | | MVP |
| AD-68 | Ledger explorer | FIN, RSK (read) | Append-only entries, filters | Export | | MVP |
| AD-69 | Settlement runs | FIN | Runs by period, totals | Create run | draft/approved/paid | MVP |
| AD-70 | Settlement run detail | FIN, SUP | Statements per merchant, negative balances, holds | Approve payout | | MVP |
| AD-71 | Merchant balances | FIN | Held, settlement-eligible, negative carry-forward | Open merchant | | MVP |
| AD-72 | Adjustments | FIN | Credit/debit with reason; second approver above threshold | Approve | | MVP |
| AD-73 | Fee rules | FIN, SUP | Versioned fee configuration, effective dates | Save | | MVP |
| AD-74 | Payout batches | FIN | Batch file, statuses, returns | Mark paid | | MVP |
| AD-75 | Campaign budget accounts | FIN | W&E funded/consumed/unused per campaign | | | MVP |
| AD-76 | Rewards rules | SUP, FIN (with limits) | Reward per view rules, caps, expiry (configurable founder settings) | Save | | MVP |
| AD-77 | Rewards ledger explorer | FIN, RSK, CSP(read) | All entries | Export | | MVP |
| AD-78 | Reward adjustments | CSP(request), FIN/RSK/SUP(approve) | Manual credits/debits | Approve | | MVP |
| AD-79 | Redemption catalogue | SUP, MKT, FIN | Items, cost in points, stock, validity, funding | Publish | draft/live/out | MVP |
| AD-80 | Points liability & expiry | FIN | Outstanding points report, expiry config | | | MVP |
| AD-81 | Rate cards & reward economics | SUP, FIN | Merchant charge per qualified view and reward economics as **separate** settings | Save (versioned) | | MVP |

#### F.2.6 Risk, support, reports, administration

| ID | Screen | Roles | Purpose / main data | Phase |
|---|---|---|---|---|
| AD-90 | Risk queue | RSK, OPS | Flags by type and severity, SLA | MVP |
| AD-91 | Risk case detail | RSK | Evidence, linked accounts/devices, actions (clear, hold rewards, reverse, restrict, suspend, ban device) | MVP |
| AD-92 | Duplicate-account clusters | RSK | Linked accounts | MVP |
| AD-93 | Suspicious viewing | RSK | View timelines, anomaly scores | MVP |
| AD-94 | Redemption anomalies | RSK, OPS | Duplicate redemption, QR abuse, staff patterns | MVP |
| AD-95 | Voucher / refund abuse | RSK, FIN | Velocity and refund patterns | MVP |
| AD-96 | Device registry & blocklist | RSK | Device ↔ account | MVP |
| AD-97 | Risk rule configuration | RSK, SUP | Thresholds (audited) | MVP |
| AD-98 | Appeals | RSK | Customer appeals of blocks | MVP structure |
| AD-100 | Customer cases inbox | CSP | Cases with SLA | MVP |
| AD-101 | Case detail | CSP, FIN | Messages, evidence, actions (resend, refund ≤ limit, reverse request) | MVP |
| AD-102 | Merchant cases | MMG, CSP | Merchant issues, disputes of DealDash decisions | MVP |
| AD-103 | Partner cases | PMG | | MVP |
| AD-104 | Dispute workspace | CSP, FIN, RSK | Payment / voucher / redemption / reward dispute templates with evidence | MVP |
| AD-105 | Macros & templates (AR/EN) | CSP, SUP | | MVP |
| AD-106 | SLA settings | SUP | | MVP |
| AD-110 | Executive KPIs | SUP, ANL | GMV, users, retention, unit economics | MVP basic |
| AD-111 | Operations reports | OPS, ANL | Queues, SLAs, redemptions | MVP |
| AD-112 | Finance reports | FIN | Revenue, fees, refunds, liabilities | MVP |
| AD-113 | Merchant performance | MMG, ANL | | MVP |
| AD-114 | Partner reports (aggregate) | PMG, ANL | Cohort suppression applied | MVP |
| AD-115 | Risk reports | RSK | | MVP |
| AD-116 | Export centre | permissioned | Audited exports | MVP |
| AD-120 | Internal users | SUP | List, status | MVP |
| AD-121 | Create / invite internal user | SUP | Role, MFA enrolment required for sensitive roles (assumed; FDR-18) | MVP |
| AD-122 | Roles & permissions | SUP | Permission matrix editor (audited) | MVP |
| AD-123 | Audit log | SUP, RSK | Searchable, immutable, filters; read access itself logged | MVP |
| AD-124 | System settings | SUP | Cities, caps, **reservation hold default (30 min) and limits, no-show strikes threshold (3), rolling period, restriction duration**, thresholds (Business Rules section 26), feature flags | MVP |
| AD-125 | Reference data | SUP, PMG | Networks (Visa, Mastercard, Amex, mada), issuers, employers, categories, areas | MVP |
| AD-126 | Notification templates (AR/EN) | MKT, SUP | | MVP |
| AD-127 | Communications | MKT, OPS | Transactional only in MVP; marketing broadcast P2 | MVP / P2 |
| AD-128 | Legal documents & versions | SUP | Terms, privacy, merchant agreement versions | MVP |
| AD-129 | Security policy | SUP | MFA, sessions | MVP |
| AD-130 | Retention & consent configuration | SUP, RSK | Per-class retention values set after VK-15 | MVP structure |

---

## G. SCREEN-DOCUMENTATION STANDARD (applied above)

Every new screen is documented with: **screen ID, name, portal, user role, purpose, main data, primary action, secondary actions, permissions, state variations, links, phase.** The tables in sections B, C, D, E and F carry these fields in compact form (portal is given by ID prefix and section; permissions are the role column; links where they are not obvious from the flow). Per-screen detail beyond this (field-level specs, validation text, empty-state copy) is produced in the **wireframe stage** for the approved subset, not here.

---

## H. NAVIGATION ARCHITECTURE

| Surface | Pattern | Top-level items | Notes |
|---|---|---|---|
| **Customer app** | Bottom tab bar (existing, unchanged) | **Home · Explore · Watch & Earn (centre) · Rewards · Profile** | Keep centre Watch & Earn emphasis. Explore sub-tabs: Live Deals · Exclusive Deals · Vouchers · Bank Cards · Employer (existing). Hide "Play & Win" tab in W&E (P2). Guest mode: Home/Explore browse; sign-in prompt on reserve/buy/earn/save. My Deals reached from Profile and Rewards. RTL: tab order mirrors. |
| **Merchant Portal** | Left sidebar (collapsible) + top bar (branch switcher, language, alerts, user) | Home · Campaigns · Redemptions · Insights · Business · Finance · Support · Settings | Campaigns uses sub-tabs (Live / Hot / Vouchers / Watch & Earn). Branch switcher filters data for BRM. Role-based hiding (not greying) of unavailable sections. Mobile web: sidebar becomes drawer. |
| **Merchant Staff app** | No navigation chrome; single home | **Scan · History · Account** (3 bottom actions) | One-thumb operation; branch shown in header; no settings, no finance. |
| **Partner Portal** | Left sidebar + top bar | Dashboard · Eligibility · Offers · Merchants · Reports · Organisation · Support · Settings | Items shown depend on partner type (Eligibility content differs: Bank / Scheme / Employer). |
| **Admin Portal** | Left sidebar with grouped sections + global search (customer, merchant, order, code) + top bar | Dashboard · Customers · Merchants · Partners · Campaigns & Content · Money & Rewards · Risk · Support · Reports · Administration | Queue badges on Merchants, Partners, Campaigns & Content, Risk, Support. Sections hidden by permission. |

Navigation rules: maximum two levels in every sidebar; deep-link every record (case, order, campaign) for support use; breadcrumbs on desktop surfaces; persistent "back" on customer detail screens; destructive/sensitive actions behind confirmation with reason.

---

## I. DESIGN SYSTEM (extension of the customer baseline)

Source: `design-tokens.json` and the 63 screens. One brand system, adapted to density and input mode.

| Aspect | Customer app (baseline) | Merchant / Partner / Admin adaptation |
|---|---|---|
| Colour | Navy `#0F0C42`, purple `#5B1AFC` (+ `#7E4DFF`), lilac `#EEE8FF`, bg `#F8F9FD`, card `#FFFFFF`, ink-2 `#5B5E80`, line `#E3E1F0`; semantic mint (verified/success), amber (warning), red (live/danger); dark theme tokens exist | Same tokens. App shell: light lavender background, white cards; sidebar uses deep navy (`navy`/`navy-2`) with purple active state. No new brand colours. |
| Orange | Hot gradient (`#FF7A1A`→`#E93A52`) and instant badge | Keep **only** as the Exclusive Deal / instant-reward semantic accent; do not use as a general accent (brief: avoid orange-heavy). Review the Spin-the-Wheel/Create Exclusive Deal banners in the UX stage (C-08). |
| Typography | Plus Jakarta Sans 400–800; title-xl 28/800, title 18/800, body 14/500, caption 12/500, button 15/700 | Same family; add table, dense-form and numeric styles from the same scale (13/12). Tabular figures for money. |
| Shape | Radii: chip 99, card 20–22, hero 24, sheet 26, input 14; card shadow `0 1px 2px / 0 6px 18px` | Same radii; tables inside rounded cards; restrained shadow; modals use sheet radius. |
| Spacing | 16 px screen padding, 24 section gap, 12 card gap | 8-pt grid; desktop page max-width 1280, 24/32 gutters. |
| Wordmark | "Deal" navy, "Dash" purple; white "Deal" on dark/photo | Same on sidebar and login screens; "DealDash for Business / Partners / Admin" appended as a caption in Plus Jakarta Sans, never a different logo. |
| Components to define once | Cards (deal, merchant, voucher), chips, tab pills, bottom sheet, stat tile, progress bar, QR card, countdown, empty state | + data table, filter bar, stepper/wizard, status badge set, timeline, document viewer, approval panel with reason, toast, confirmation dialog with reason, permission-denied state, cohort-suppressed state |
| Status vocabulary | LIVE (red), Hot, VERIFIED (mint), LOCKED | Shared badges for every lifecycle (Draft, Under review, Live, Paused, Suspended, Expired…). **"Verified" is reserved** for states with an actual verification mechanism (employer OTP; verified merchant). Never used for cards in MVP. |
| Data visualisation | Donut and bars in Savings/Analytics | One chart palette derived from the tokens; discovery metrics always captioned "discovery signals" (LD-62). |

Branding rule: Merchant, Partner and Admin must be recognisably the same product: same fonts, tokens, radii, wordmark and tone of voice. Only density and navigation differ.

---

## J. ARABIC / RTL

Principle: **localisation-ready architecture now, translation later.** No screen is translated in this stage.

| Area | Requirement |
|---|---|
| Layout direction | Full RTL mirror for Customer, Merchant, Partner, Admin, Staff. Use logical properties (start/end) in all designs. |
| What mirrors | Navigation order (bottom tabs, sidebars move to the right), back arrows and chevrons, progress bars, steppers, swipe directions (galleries, onboarding, reels carousel), list leading/trailing icons, text alignment, toggles. |
| What does not mirror | Brand wordmark, QR codes, maps and map controls, play/pause icons, media timelines (video scrubbing stays left→right), phone numbers, numerals sequences, charts' time axis (decision to confirm). |
| Numerals and currency | Decide Western vs Eastern Arabic digits (UXF-12); "SAR" vs "ر.س" placement; amounts stay LTR islands inside RTL text; 1,300 / ١٬٣٠٠ formatting; SAR minor-unit display. |
| Typeface | **Decided: Plus Jakarta Sans for English; IBM Plex Sans Arabic as the initial Arabic companion** (Plus Jakarta Sans has no Arabic glyphs). Map weights 400/500/600/700/800 to the closest available Plex Arabic weights; line-height 10–20% larger for Arabic; Arabic typography, numerals and spacing verified in detailed screen design. |
| Bilingual content fields | Every merchant-entered customer-facing field has **AR and EN** variants: title, description, terms blocks, deal name, branch name/address, category labels, video title, prize name, review replies (P2). Merchant forms show AR/EN side by side with completeness indicators (UXD-06). |
| Terms and legal text | Legal documents, merchant agreement, offer terms available in both languages with version tracking; bilingual receipt/invoice fields (VK-03). |
| Truncation and layout risks seen in the 63 screens | Chip rows that overflow ("Bank Cards", category chips) scroll horizontally → direction flips; two-line card titles in the 2-column redeem grid; countdown strings ("Ends in 34:11", "59:59"); "Pay 80, get 100" voucher headline; star ratings and "(1.2K)" abbreviations; mixed Latin brand names inside Arabic sentences (bidi); map pin letters (initials are Latin: need Arabic initials); QR code card; bottom sheets with side-by-side "−/+" stepper; Arabic text expands/contracts vs English in fixed-width buttons ("Reserve my spot"). |
| Content that stays Latin | Brand names (Nobu, Starbucks) may be transliterated by merchants: provide AR brand-name field. |
| Dates | Gregorian default, Hijri display optional (decision UXF-12); Riyadh time zone. |
| Voice/tone | Arabic copy written natively, not translated word-for-word; terminology list agreed with bilingual reviewer before translation. |
| QA | RTL screenshot pass for every component in the component library before screens are built; pseudo-localisation (long strings) test. |

---

## K. OUTPUT

### K.1 Audit of all 63 existing screens

See section A.1 (63 rows) and A.2/A.3. Summary of dispositions:

| Disposition | Count | Screens |
|---|---|---|
| **KEEP** | 6 | S03, S11, S21, S25, S40, S50 |
| **MODIFY** | 34 | S01, S02, S04, S05, S07, S08, S09, S12, S13, S14, S15, S16, S17, S18, S19, S22, S24, S27, S28, S31, S32, S33, S34, S35, S36, S37, S39, S41, S48, S49, S51, S52, S53, S54, S55 |
| **REPLACE** (concept changes) | 10 | S10, S20 (partial), S23, S26, S56, S58, S59, S60, S62, S63 (S58-S60, S62, S63 become the Merchant Portal / Staff app) |
| **FUTURE** (preserved, not in MVP) | 13 | S06, S16, S29, S30, S38, S42, S43, S44, S45, S46, S47, S57, S61 (plus hidden elements inside other screens) |

Total: 6 + 34 + 10 + 13 = 63. S20 is part replace, part modify (counted once, under REPLACE).

### K.2 Customer MVP gap list

Missing screens/states (section B): **onboarding 13** (CU-01 to CU-12 incl. under-18), **employer 7** (CU-20 to CU-26), **card/bank 9** (CU-30 to CU-38), **product states 21** (CU-40 to CU-91), **notifications/support/deletion/system 15** (CU-100 to CU-136). Total ≈ **65 new customer screens or states** (about 6 are Phase 2/3 or decision-dependent). The highest-priority gaps: phone/OTP/DOB onboarding, employer OTP completion, selection-only card flow, free-reservation sheet, My Vouchers and refund, payment pending/failed, support, account deletion, offline/empty/error states.

### K.3 Merchant Portal screen inventory

Section C.2: **≈ 84 screens** (onboarding 16, dashboard/profile/branches/team 10, Live 9, Hot 7, Vouchers 6, W&E 9, redemptions/insights/finance 18, notifications/support/settings 9; about 8 are Phase 2).

### K.4 Merchant Staff screen inventory

Section D: **22 screens/states** (SA-01 to SA-22); two are Phase 2.

### K.5 Partner Portal screen inventory

Section E: **≈ 43 screens** (common 23, bank 6, scheme 7, employer 7); about 7 are Phase 2.

### K.6 Admin Portal screen inventory

Section F: **≈ 96 screens** across 10 sections.

### K.7 Navigation architecture

Section H.

### K.8 UX dependencies

| Dependency | Needed by |
|---|---|
| Design system extension (business components, Arabic font, RTL component pass) | Every new surface |
| Founder decisions on UXF items below | Customer revisions, merchant create flows |
| Customer onboarding + OTP + employer + card flows | Real pilot users |
| Staff app | Voucher and Exclusive Deal redemption (without it, no redemption journey) |
| Merchant Portal onboarding + approval screens + Admin KYB screens | Any merchant activation (admin and merchant sides are one journey) |
| Admin approval queue + guardrails settings | Publishing campaigns (even auto-publish needs monitoring) |
| PSP selection (payment method list, 3-D Secure behaviour) | Checkout/refund/payment-state screens |
| Reward/CPV economics (founder settings) | W&E merchant cost estimator, customer points text |
| VALIDATE-KSA outcomes (refund window, expiry treatment, VAT wording, tax invoice fields) | Voucher terms, receipts, statements (placeholders until then) |

### K.9 Screens to modify (existing)

S01, S02, S04, S05, S07, S08, S09, S10, S12, S13, S14, S15, S16, S17, S18, S19, S20, S22, S23, S24, S26, S27, S28, S31, S32, S33, S34, S35, S36, S37, S39, S41, S48, S49, S51, S52, S53, S54, S55, S56. Highest priority (business-rule conflicts): **S10, S13, S20, S23, S26, S28, S31, S32, S33, S48, S49, S51, S52, S53, S55, S56**.

### K.10 Screens moved to Phase 2 / Phase 3 (preserved as future references)

| Phase | Screens / elements |
|---|---|
| P2 | S06 Best Deal for Me; S29, S30 gift checkout; S38 Play & Win menu; S42–S47 games; S61 Boost (pending decision); gift icon (S09), "Buy as a gift" (S22, S28), promo code field (S28, UXD-09), Play & Win tabs/cards (S37, S48), Google/Apple buttons (S01), membership tiers Silver/Gold (S51), donations in catalogue (S49), reputation tools |
| P3 | S57 issuer card verification; "Convert to bank points / travel miles" (S49) |

### K.11 Screens missing entirely

1. Customer onboarding flow (OTP, DOB/18+, consents, interests, profile).
2. Employer OTP completion and failure/expiry states.
3. Selection-only card flow and card-requirement component.
4. Free reservation sheet and reservation management.
5. My Vouchers and voucher refund.
6. Payment pending/failed/3-D Secure states.
7. Support and case screens (customer, merchant, partner).
8. Account deletion and data requests.
9. Notification feed vs settings.
10. Global empty/loading/offline/error states.
11. The entire Merchant Portal (~84), Staff app (22), Partner Portal (~43), Admin (~96) except the six mobile "business console" screens (S58–S63) that are superseded.
12. Arabic/RTL variants of everything.

### K.12 FOUNDER DECISIONS discovered during UX analysis (UXF)

| ID | Decision | Why it matters | Blocks |
|---|---|---|---|
| UXF-01 | Guest browsing ("Skip for now" in S01): allowed? (assumed yes, read-only) | Onboarding and gating screens | customer UX |
| UXF-02 | **Follow merchant, reel likes, share** social features in MVP? (S34, S39, S05 "Following 0 merchants") | Not in blueprint; adds data and moderation | customer UX |
| UXF-03 | "Best Deal for Me" comparison assistant: Phase 2? | Needs result screen and logic | scope |
| ~~UXF-04~~ CLOSED (UXD-01) | Card offers: remove the "Activate offer / Activate on 1 card" step (no issuer integration)? | Core card journey wording | **customer UX** |
| ~~UXF-05~~ CLOSED (UXD-14) | Employee pass QR is Phase 2; verified status digitally unlocks offers | Staff app scope | none |
| ~~UXF-06~~ CLOSED (UXD-15: Phase 2) | Paid "Boost" / sponsored placement (S61, S19 "Sponsored"): MVP or P2? Labelling rules (VK-10, FDR-29) | New product; ranking fairness | merchant UX |
| ~~UXF-07~~ CLOSED (UXD-02) | **Loyalty points as payment at checkout** (S28) and "10 points = SAR 1" / "Worth SAR 130" (S48, S49): remove for MVP (conflicts non-cash, no fixed point value) | Checkout design, rewards copy | **customer UX** |
| ~~UXF-08~~ CLOSED (UXD-03) | **Earn sources beyond Watch & Earn** (daily check-in, write review, buy voucher, redeem deal, streaks, milestone reward) in MVP? | Rewards economics and fraud surface | **customer UX** |
| UXF-09 | Savings tracker (S54, S52) built on self-reported "I used this deal": keep? Wording as "reported savings" | Trust and claims | customer UX |
| UXF-10 | Email required at onboarding (checkout needs it) or optional? | Onboarding step | customer UX |
| UXF-11 | Ask gender at all (optional)? | Privacy (VK-06) | onboarding |
| UXF-12 (partly closed: fonts decided in UXD-12) | Numeral system (Western/Eastern) and Hijri dates | RTL design | all |
| ~~UXF-13~~ CLOSED (UXD-04) | Merchant create flows bundle "video ad + instant reward" with Live/Hot (S62, S63): keep as **linked but separate** Watch & Earn campaign with its own budget? (recommended) | Domain separation, billing | **merchant UX** |
| ~~UXF-14~~ CLOSED (WE-01 / UXD-04) | Merchant-chosen instant rewards: allow only merchant-funded prizes (free item/coupon) and never points (WE-01)? | Rewards control | merchant UX |
| ~~UXF-15~~ CLOSED (UXD-16: Phase 2) | Merchant "Customer eligibility: Students" (S62): define or remove | Eligibility model | merchant UX |
| ~~UXF-16~~ CLOSED (UXD-18: PWA, OTP) | Staff app platform: PWA vs native (FDR-26); staff login method (FDR-62) | Staff app | staff UX |
| UXF-17 | Exclusive Deal maximum duration (S03 shows "5 days left" on a Hot card) | Hot semantics | merchant UX |
| ~~UXF-18~~ CLOSED (FDC-05) | Who may review: signed-in customers; "Verified" only with DealDash-evidenced merchant interaction (voucher redemption, redeemed Exclusive Deal reservation, controlled-offer redemption); Watch & Earn alone never qualifies; community reviews allowed without the label (MR-52) | Reviews trust | none |
| UXF-19 | Donations ("Plant trees", "Feed a family") and bank-points/mile conversion in catalogue: P2/P3 + VALIDATE-KSA | Catalogue | rewards |
| ~~UXF-20~~ CLOSED (UXD-06) | Merchant portal languages: Arabic and English both required at launch? | RTL scope | merchant UX |
| ~~UXF-21~~ CLOSED (UXD-17: Phase 2) | Streak / daily goal / milestone | Gamification scope | none |

UXF-04, 07, 08, 13 and 14, 20 are **closed** by founder decisions UXD-01 to UXD-13 (see 0.1); UXF-12 is partly closed (fonts decided; numerals/Hijri still to confirm). New: **UXF-21** streak / daily goal / milestone tied to qualified views (not login) allowed in MVP? None of the open items blocks Merchant, Partner or Admin wireframing.

### K.13 Recommended UX design and build sequence

| Step | Work | Why this order |
|---|---|---|
| 0 | Apply UX decisions UXD-01..13 (closed); settle the few open items (UXF-05, 06, 15, 21; FDR-26/62 for staff login/platform); extend the design system (business components, IBM Plex Sans Arabic pairing, RTL component pass) | Everything inherits these |
| 1 | **Customer revisions** to the conflict screens (S10, S13, S20, S23, S26, S28, S31–S33, S48, S49, S51–S53, S55, S56) and the new onboarding / OTP / employer / card flows | Removes every known conflict from the approved baseline first |
| 2 | **Staff app** (SA-01 to SA-21) | Small, critical, easy to validate with real staff |
| 3 | **Merchant Portal**: onboarding, dashboard, business profile/branches/team, Live Deals, Exclusive Deals | Gets merchants live; pairs with step 4 |
| 4 | **Admin**: merchant applications/KYB, approval queue + guardrails, customers, campaign monitors | Minimum operating back-office for the pilot |
| 5 | **Vouchers** end-to-end (merchant, customer states, admin payments/refunds, My Vouchers) | First revenue flow |
| 6 | **Watch & Earn** merchant creation/monitoring, admin moderation and fraud, rewards admin | Differentiator; depends on economics settings |
| 7 | **Partner Portal** (employer first, then bank, then scheme) | Eligibility partners |
| 8 | **Finance**: settlements, statements, reconciliation (merchant and admin sides) | After money flows exist |
| 9 | **Arabic/RTL pass** across all surfaces, then pseudo-localisation tests | Built into components from step 0; full pass last |
| 10 | Clickable prototypes and Riyadh usability tests (customers, merchants, staff, admin) | Validate before build |

---

---

## L. MVP UX RATIONALISED SCREEN ARCHITECTURE

**Status:** supersedes the screen *counts* in sections B–F and K.2–K.6. Those sections remain the **function catalogue** (every function, state and rule they list still exists); this section regroups them into the screens that will actually be wireframed. No business rule, permission or control is removed. Nothing here is wireframed yet.

### L.1 Method and counting rules

| Element | Counted as a screen? | Rule |
|---|---|---|
| **Screen** | Yes | A routable page with its own purpose and URL/deep link that cannot sensibly live inside another page |
| **Tab** | No | A section of a screen (same record or same list family) |
| **Drawer / side panel** | No | Detail or quick-edit of a row without leaving the list |
| **Modal / sheet / dialog** | No | Confirmations, short forms, pickers, OTP steps |
| **Wizard step** | No | One wizard = one screen |
| **State variants** | No | Empty, loading, error, offline, permission-denied, suspended, cohort-suppressed |
| **Status variants** | No | Pending / approved / rejected / changes requested / paused / expired etc. on the **same** record page |
| **Phase 2/3 items** | Not counted in MVP | Listed and preserved |

Guardrails: every screen is deep-linkable (cases, orders, campaigns, applications); every tab declares its role permissions; hiding rather than greying unavailable tabs; every consolidation keeps its audit and permission behaviour.

### L.2 Revised core screen count (MVP)

| Portal | Previous inventory | **Core screens now** | Overlays (drawers, modals, sheets) | Guide | Comment |
|---|---|---|---|---|---|
| Customer app | 46 baseline MVP + ~67 new | **26** (17 existing flows incl. My benefits + 9 new; see Customer MVP Final) | ~20 sheets/modals | n/a | The 63-screen design remains the baseline; 46 of the 63 are MVP, and they collapse into 16 distinct screens |
| Merchant Portal | ~85 | **21** | ~26 | 25–35 | Below guide: onboarding, builders and detail pages carry the variants |
| Merchant Staff app | 22 | **6** | ~8 | 8–12 | Below guide: one Result screen carries all validation outcomes |
| Partner Portal | ~43 | **13** (10 common + 3 type-specific; any partner sees 10–11) | ~10 | 15–25 | Below guide: type modules share one eligibility screen each |
| Admin Portal | ~98 | **29** | ~35 | 25–40 | Within guide |
| **Total** | **~315** | **94** | | | |

Counts are deliberately lower than the guide for Staff, Partner and Merchant because the extra functions are tabs, drawers and modals, not navigation. Nothing was forced to hit a number.

---

### L.3 Customer app (26 core screens; superseded in detail by DEALDASH_CUSTOMER_MVP_FINAL.md)

#### L.3.1 Existing baseline regrouped (16 screens; 46 of 63 baseline frames are MVP)

| # | Screen | Portal | Main purpose | Tabs / sections | Modal / sheet / state variants | Baseline frames | Role | Phase |
|---|---|---|---|---|---|---|---|---|
| C-01 | Welcome | Customer | Entry, language, sign-in choice | – | Guest "Skip", language chip; Google/Apple hidden (P2) | S01 | all | MVP |
| C-02 | Home | Customer | Discovery hub | Category state (Food, Electronics…), Live, Watch strip, Hot, Vouchers | **Location sheet** (S04); loading, empty area, offline, guest | S02, S03, S04 | all | MVP |
| C-03 | Notifications | Customer | Feed of alerts | – | Mark read, empty | S05 | customer | MVP |
| C-04 | Explore | Customer | Browse and filter all products | Tabs: **Live Deals · Exclusive Deals · Vouchers · Bank Cards · Employer**; list/map toggle; issuer-filtered view (Offers by Riyad Bank) | **Filter/sort sheet**; **employer verify sheet** (S14, with OTP step, failure, expired); (employee pass sheet S16 is **Phase 2**); locked-offer state; added-card state; empty/error | S07, S08, S09, S10, S11, S12, S13, S14, S15, S16 | customer | MVP |
| C-05 | Deal detail | Customer | One adaptive offer page for **Live, Hot (limited/time), Voucher, Card offer, Employer offer** | Tabs: **Overview · Details · Reviews** | **Reserve sheet** (S26, free); **review sheet** (S27); photo viewer (S25); states: ended, paused, sold out, locked, closed branch, reservations restricted, ineligible | S17, S18, S19, S20, S21, S22, S23, S24, S25, S26, S27 | customer | MVP |
| C-06 | Checkout | Customer | Pay for a voucher | – | PSP payment methods; pending/failed/3-D Secure states; terms and refund checkbox | S28 (S29/S30 future) | customer | MVP |
| C-07 | My Code | Customer | Show reservation or voucher code | Variant: **Reservation** / **Voucher** | **Receipt sheet** (S33); cancel reservation; refund sheet; states: expired, redeemed, refunded, merchant suspended | S31, S32, S33 | customer | MVP |
| C-08 | Merchant page | Customer | Merchant profile and offers | Tabs: **Offers · Info · Reviews** | Follow (if UXF-02 approved); report; closed state; branch picker | S34, S35, S36 | customer | MVP |
| C-09 | Watch & Earn | Customer | Reel hub and progress | Sections: points, how it works, reel strip, all reels (Play & Win tab hidden P2; **no streak/daily goal/milestone, Phase 2**) | Caps reached, no campaigns, offline, "how qualifying views work" sheet | S37 | customer | MVP |
| C-10 | Reels player | Customer | Watch and earn | – | **Still-watching modal** (S40), **reward unlocked modal** (S41), pending/held reward, prize sold out, error/buffering, background pause | S39, S40, S41 | customer | MVP |
| C-11 | Rewards | Customer | Points overview | Sections: balance, W&E progress, redeem teaser | Balance, redeem entry points; milestone removed (Phase 2) | S48 | customer | MVP |
| C-12 | Redeem points | Customer | Catalogue | Filter chips | **Confirm sheet** (S50), insufficient points, out of stock, success | S49, S50 | customer | MVP |
| C-13 | Points activity | Customer | Ledger | Tabs: **All · Earned · Redeemed** | pending/held/reversed/expired rows | S51 | customer | MVP |
| C-14 | My Deals | Customer | Owned reservations and vouchers, payments | Tabs: **Reservations & vouchers · Payments** (also history) | Empty, refunded, expired | S52, S53 | customer | MVP |
| C-15 | Savings | Customer | Reported savings summary | – | Reported-savings wording; empty | S54 | customer | MVP (UXF-09) |
| C-16 | Profile | Customer | Account hub | Sections: stats, **Added cards**, work offers, saved, settings links | **Add card sheet** (S56 selection-only, steps issuer → product → tier; success/duplicate/limit); remove card; remove employer | S55, S56 | customer | MVP |

#### L.3.2 New standalone customer screens (9)

| # | Screen | Main purpose | Tabs / sections | Modal / sheet / state variants | Replaces | Phase |
|---|---|---|---|---|---|---|
| CS-01 | Phone & OTP | Sign-in / sign-up verification | Steps: phone → OTP | Wrong code, expired, resend, lockout, session expired | CU-02, 03, 12 | MVP |
| CS-02 | Profile setup | First-run profile | Wizard steps: name/email, **DOB with 18+ gate**, gender (optional), location (uses S04), interests, consents (required + marketing optional), complete | **Under-18 blocked** state, validation | CU-04..10 | MVP |
| CS-03 | Search results | Results for text/category/merchant search | Filters inline | Recent searches, no results, offline | CU-42 | MVP |
| CS-04 | Order status | Result of checkout / refund | States: processing, success (with receipt), failed, pending, refunded | Retry, support | CU-53, 54 | MVP |
| CS-05 | Account settings | Edit profile and privacy | Sections: profile, phone, language (AR/EN), consents, security, **delete account** (danger zone), data request | **Delete confirm sheet with OTP**; deletion status | CU-90, 120, 121 | MVP |
| CS-06 | Notification settings | Channel/category preferences | Sections: categories, channels, marketing opt-in | – | CU-101 | MVP |
| CS-07 | Help centre | FAQs and contact | Sections: FAQ, contact | **Create case sheet** | CU-110, 111 | MVP |
| CS-08 | My cases | Support cases and detail | List + detail (messages, status) | **Report sheet** shared (reviews, merchants, reels) | CU-112, 113 | MVP |
| CS-09 | Legal viewer | Terms/privacy | Terms · Privacy (AR/EN) | – | CU-136 | MVP |

#### L.3.3 Customer: what became a state or extension of an existing screen

| New item (old ID) | Now lives in |
|---|---|
| Employer OTP, success, failure, expiry, reverify, removed, "Other employer", remove employer (CU-20..26) | Employer sheet (S14) and Employer tab/state (S11/S15) inside **C-04** |
| Card list, add success/failure, edit/remove, expiry reconfirm, requirement panel (CU-30..37) | **C-16** Profile + S56 sheet; requirement text component in **C-05** |
| Locked offer, ended/paused/sold out/closed branch, reservation restriction notice, reserve sheet, reservation detail (CU-40, 43..48) | **C-05** states and **C-07** variant |
| My vouchers tab, voucher states, refund request (CU-50..52, 55) | **C-14** (tab; S09 "My vouchers" links here) and **C-07** variants + refund sheet |
| W&E states: pending/held/reversed, cap, no campaigns, prize claimed/sold out, how it works (CU-60..62) | **C-09 / C-10** states and a help sheet |
| Rewards states and redeem outcomes (CU-70, 71) | **C-11 / C-12 / C-13** |
| Notification feed (CU-100) | **C-03** |
| Loading, empty, offline, error, location denied, maintenance, forced update (CU-130..135) | Shared component states, not screens |
| Guest sign-in prompt (CU-11) | A sheet over any gated action |
| Security activity (CU-91) | Phase 2 |

---

### L.4 Merchant Portal (21 core screens)

Roles: OWN, ADM, MKT, FIN, BRM (Staff use the Staff app only). Shell: sidebar (Home, Campaigns, Redemptions, Insights, Business, Finance, Support, Settings), branch switcher, language, notification **drawer**, user menu.

| # | Screen | Main purpose | Tabs / sections | Modal / drawer / state variants | Roles | Phase |
|---|---|---|---|---|---|---|
| M01 | Sign in & registration | Account creation and login | Register → verify email → verify mobile; Sign in; forgot password | Errors, lockout, expired link | applicant, all | MVP |
| M02 | Onboarding wizard | Collect KYB and activate | **Steps:** 1 Business details · 2 Documents · 3 Authorised representative · 4 Category & branding · 5 Branches & hours · 6 Settlement/IBAN · 7 Agreement (e-sign) · 8 Review & submit | Save draft; upload progress/rejection; AR/EN fields; incomplete checklist | applicant, OWN | MVP |
| M03 | Application status | One page for the whole application lifecycle | **Status variants:** In review · Enhanced review · Changes requested (per-section notes with deep links into M02 steps) · Rejected (appeal) · Approved/Activated (welcome, next steps) · **Suspended** (what is blocked, obligations status) | Contact/appeal modal | applicant, OWN, ADM | MVP |
| M04 | Dashboard | Operational snapshot | KPIs, alerts (low stock, ending, review needed, payout), live campaigns, quick create | Empty (new merchant), suspended banner, loading | all (scoped) | MVP |
| M05 | Campaigns | List hub for all products | Tabs: **Live Deals · Exclusive Deals · Vouchers · Watch & Earn**; filters and status chips | **Create menu** (opens builders); pause/resume/cancel confirm modals; empty | OWN, ADM, MKT (BRM view) | MVP |
| M06 | Live Deal detail | View and manage one Live Deal | Tabs: **Overview · Analytics** (discovery signals) **· Activity** (edits, reviews) | **Status variants:** draft, scheduled, live, paused, expired, suspended, changes requested; pause/cancel modals; controlled-redemption drawer | OWN, ADM, MKT | MVP |
| M07 | Exclusive Deal detail & monitor | Run a live Exclusive Deal | Tabs: **Live monitor** (countdown, stock per branch) **· Reservations · Results · Activity** | Add-stock modal; pause/end; cancel-reservation modal (reason); sold-out/ended variants | OWN, ADM, MKT, BRM | MVP |
| M08 | Voucher detail | Manage one voucher product | Tabs: **Overview · Sales & redemptions · Refunds · Activity** | Pause sales; add-stock modal; locked-field note after sales; all status variants | OWN, ADM, MKT, FIN (read) | MVP |
| M09 | Watch & Earn campaign detail | Monitor one campaign | Tabs: **Monitor · Performance · Prizes · Budget & unused balance · Activity** | **Fund-budget modal (PSP)**; pause/cancel; replace-video drawer; moderation status variant; completed/close-out variant | OWN, ADM, MKT, FIN | MVP |
| M10 | Live Deal builder | Create/edit | Stepper: Basics · Branches & schedule · Eligibility & terms · Media · Controlled redemption (optional) · **Preview & submit** (AR/EN preview, translation status, "Promote with Watch & Earn") | Submission result variants (published / sent for review / changes requested); translation-help request | OWN, ADM, MKT | MVP |
| M11 | Exclusive Deal builder | Create/edit | Stepper: Type · Value & inventory per branch · Reservation settings · Schedule · Eligibility & media · Preview & submit | Same result variants; deposit option disabled | OWN, ADM, MKT | MVP |
| M12 | Voucher builder | Create/edit | Stepper: Pricing & face value · Inventory & limits · Validity · Branches & terms · Eligibility & media · Preview & submit | Guardrail messages | OWN, ADM, MKT | MVP |
| M13 | Watch & Earn builder | Create/edit | Stepper: Video & content (upload/moderation) · Link target (merchant/page/deal/voucher/product) · Audience & geography · Dates · Budget & paid views · Frequency (stricter-only) · Prizes · **Fund & submit** | Cost estimate panel; no reward-amount field; translation status | OWN, ADM, MKT (FIN for funding) | MVP |
| M14 | Redemptions | History and lookup | Tabs: **History · Code lookup** (reversal-request queue is Phase 2) | Row drawer with redemption detail/audit and **Reverse action** for Owner/Admin/Branch Manager within the configurable window (reason required, audited); staff cannot reverse (UXD-19) | OWN, ADM, BRM, FIN (read) | MVP |
| M15 | Insights | Analytics | Tabs: **Overview · Live · Hot · Vouchers · Watch & Earn** | Export modal; no-data state | OWN, ADM, MKT, BRM | MVP |
| M16 | Business profile | Merchant identity | Tabs: **Profile & branding · Branches · Documents & agreement** | **Branch drawer** (details + opening-hours editor + deactivate impact); add-branch modal; material-change re-review notice; agreement versions | OWN, ADM (BRM branch view) | MVP |
| M17 | Team & roles | Users and permissions | Tabs: **Users · Roles reference** | **Invite modal**; user drawer (role, branches, deactivate); last-Owner guard | OWN, ADM | MVP |
| M18 | Finance | Money overview | Tabs: **Statements · Payouts · Campaign spend · Invoices · Bank details** | Dispute modal; bank-change request modal (re-review + payout hold) | OWN, FIN (ADM read) | MVP |
| M19 | Statement detail | One settlement statement | Sections: lines (redemptions, fees, refunds, adjustments), **carried-forward negative balance**, tax fields, download | Dispute modal; status variants (draft/issued/paid/disputed) | OWN, FIN | MVP |
| M20 | Support | Help and cases | Tabs: **Help centre · My cases** | Create-case modal; case drawer with messages | all | MVP |
| M21 | Settings | Account preferences | Tabs: **Account · Language & region · Notifications · Security (MFA-ready)** | Password/MFA modals | all | MVP |

Not screens: **notification centre** (header drawer), **preview** (step/drawer), **permissions reference** (tab), **PSP payment** (modal), **translation help** (panel inside builders; ops side in Admin A13).
**Moved to Phase 2:** bulk/templates/duplicate, deposit settings, pooled inventory settings, subscription billing, reversal-request workflow, reputation tools (review replies, badges).

---

### L.5 Merchant Staff app (6 core screens)

Mobile-first; no navigation chrome except three bottom actions (Scan, History, Account). No finance/campaign/settlement access.

| # | Screen | Main purpose | Sections | Sheet / modal / state variants | Role | Phase |
|---|---|---|---|---|---|---|
| T01 | Sign in | Staff OTP login on a mobile-first PWA (UXD-18); staff assigned to merchant and branch | – | Wrong credentials, locked, **access ended / merchant suspended** | staff | MVP |
| T02 | Home | Start a redemption | Big **Scan** button; **Enter code**; today's count; branch header | **Branch picker sheet** (if several branches); **manual code sheet** (rate-limited); offline banner | staff, BRM | MVP |
| T03 | Scanner | Camera scan | – | Camera denied, unreadable code, torch | staff, BRM | MVP |
| T04 | Result | One result screen for **every** outcome | **Variants:** Valid (item, value, first name, branch → **Redeem** → confirm → **Success**) · Invalid · Expired · Already redeemed · Wrong branch · Not yet valid · Suspended/refunded/cancelled · Eligibility failure (only for free restricted offers/reservations that require current eligibility; **never for a paid voucher bought while eligible**, UXD-20) | Confirm sheet; success state; duplicate-tap protection | staff, BRM | MVP |
| T05 | History | Today's redemptions | List (own branch) | **Detail sheet** (read-only; **staff cannot reverse**: "Ask your manager"; reversal by Owner/Admin/Branch Manager in the Merchant Portal or DealDash Admin, UXD-19) | staff, BRM | MVP |
| T06 | Account & help | Name, branch, language, logout, support contact | – | Support contact sheet | staff | MVP |

Phase 2: employee-pass QR check (SA-22), staff reversal-request flow. Rule kept: no "use latest code" shortcut.

---

### L.6 Partner Portal (13 core screens)

One shell; type-specific modules replace one screen each. Aggregated reporting by default; cohort suppression (setting 10) applied in every report view; no customer-level data screen exists.

| # | Screen | Main purpose | Tabs / sections | Modal / drawer / state variants | Roles | Phase |
|---|---|---|---|---|---|---|
| P01 | Invitation & sign-in | Accept invite, login, MFA-ready | – | Expired invite | all | MVP |
| P02 | Onboarding & status | Organisation application end-to-end | Wizard steps: Organisation profile & documents · Users · Agreement; **status variants:** pending, changes requested, approved, rejected, suspended | Upload; version of agreement | PAD | MVP |
| P03 | Dashboard | Aggregate KPIs | Eligible audience (thresholded), offer views→redemptions, participating merchants | Suppressed ("not enough data"), empty | all | MVP |
| P04 | **Bank:** Cards & eligibility | Issuer configuration | Tabs: **Card products · Tiers · BIN/IIN ranges · Offer rules** | Range drawer (effective date, overlap validation); add-product modal | CPM, PAD, PMG | MVP |
| P05 | **Scheme:** Programme | Scheme configuration | Tabs: **Profile · Issuers · Tiers & products · Geography** (Programmes P2) | Read-only for issuer-owned data | PAD, PMG | MVP |
| P06 | **Employer:** Eligibility | Employer configuration | Tabs: **Company · Email domains · Verification rules** | Domain-add modal (proof status); rule change confirm | PAD, PMG | MVP |
| P07 | Offers | List of offers targeted to the partner | Filters by status/merchant | **Request an offer modal** (brief to DealDash in MVP); live/ended | PAD, PMG, PAN | MVP |
| P08 | Offer detail | Terms as customers see them + performance | Sections: terms, eligibility rule, aggregate results | – | PAD, PMG, PAN | MVP |
| P09 | Merchants | Participating merchants | List with **merchant drawer** (offers, aggregates) | Empty | all | MVP |
| P10 | Reports | Aggregates | Tabs: **Overview · Offer usage · Audience (thresholded) · Type-specific (Bank by product/tier, Scheme by issuer where permitted, Employer verified count)** | Export modal; suppressed state | all | MVP |
| P11 | Organisation | Profile, users, permissions | Tabs: **Profile · Users · Roles · Activity** | Invite modal; user drawer | PAD (read for others) | MVP |
| P12 | Support | Help and cases | Tabs: **Help · My cases** | Create-case modal | all | MVP |
| P13 | Settings | Account preferences | Tabs: Account · Language · Notifications · Security | – | all | MVP |

**Moved to Phase 2:** partner-funded campaigns, merchant invitations, scheme merchant programmes and funded campaigns, employee communications, data-sharing usage screens (the control lives in Admin A08).

---

### L.7 Admin Portal (29 core screens)

Shell: grouped sidebar (10 sections), global search (customer, merchant, order, code), queue badges, role-based visibility.

| # | Screen | Section | Main purpose | Tabs / sections | Modal / drawer / state variants | Roles | Phase |
|---|---|---|---|---|---|---|---|
| A01 | Dashboard | Dashboard | Role-aware queues and KPIs | Widgets per role | Quiet state | all | MVP |
| A02 | Customers | Customers | Search and list | Tabs: **All · Requests** (deletion/export) | Filters; request-processing drawer (legal-hold flag) | CSP, OPS, RSK, SUP | MVP |
| A03 | Customer detail | Customers | Customer 360 | Tabs: **Profile · Eligibility · Transactions · Rewards · Cases · Restrictions & consent** | **Suspend/reactivate modal**; revoke attribute; request adjustment modal; lift restriction (no-show); PII reveal (audited) | CSP, RSK, SUP | MVP |
| A04 | Merchants | Merchants | Merchant list and queues | Tabs: **All · Applications · Suspended · Obligations** | Obligations resolution drawer (honour/redirect/extend/refund/cancel + emergency override with second approver) | MMG, OPS, FIN, RSK | MVP |
| A05 | Application review (KYB) | Merchants | Decide an application | Sections: business data, representative, bank/IBAN match, documents (viewer), risk tier, checklist, notes | **Approve · Reject · Request information · Require enhanced review**; document viewer drawer; second-reviewer step | MMG, RSK | MVP |
| A06 | Merchant detail | Merchants | Merchant 360 | Tabs: **Profile · Branches & users · Campaigns · Commercial & balances · Agreement · Cases · Trust** | Suspend/reactivate/offboard modal (impact summary), trust-level modal | MMG, OPS, FIN, RSK | MVP |
| A07 | Partners | Partners | Lists and verification queues | Tabs: **Applications · Active · Domain verification · BIN/range approvals** | Approve/reject modals | PMG, OPS | MVP |
| A08 | Partner detail & review | Partners | Partner 360 and application review | Tabs: **Profile & agreement · Configuration (products/BINs/domains/schemes) · Users · Offers & aggregates · Data-sharing permissions (default none)** | Approve/reject/request changes (when in application state); suspend/offboard modal | PMG, RSK, SUP | MVP |
| A09 | Approval queue | Campaigns & Content | All products awaiting review | Filters: product, risk reason, age, SLA; pilot-extra-review flag | Bulk assign | OPS, MMG, RSK | MVP |
| A10 | Review workspace | Campaigns & Content | Decide one item | Sections: AR/EN customer preview, guardrail results, flags, merchant history | Approve · Reject · Request changes (templates) | OPS, MMG, RSK | MVP |
| A11 | Campaign monitor | Campaigns & Content | Live oversight | Tabs: **Live Deals · Exclusive Deals · Vouchers · Watch & Earn** | Pause/suspend modal (reason) | OPS, FIN, RSK | MVP |
| A12 | Campaign detail | Campaigns & Content | One campaign, adaptive by type | Tabs vary by product: Overview · Activity · (Hot) Stock & reservations · (Voucher) Sales/refunds · (W&E) Budget account, qualified vs invalid views, fraud flags, prizes | Pause/suspend; invalidate views modal | OPS, RSK, FIN | MVP |
| A13 | Moderation | Campaigns & Content | Content queues | Tabs: **Videos · Reviews · Reported content · Translations** | Reason templates; translation edit-on-behalf (audited) | OPS, CSP, MKT | MVP |
| A14 | Payments | Money & Rewards | Payments and exceptions | Tabs: **Payments · Failed · Refunds · Disputes/chargebacks** | Refund approval modal (limits, maker–checker above threshold) | FIN, CSP (≤ limit) | MVP |
| A15 | Payment / refund detail | Money & Rewards | One payment | Sections: timeline, PSP data (no card data), ledger entries, merchant-payable impact | Refund, flag | FIN, CSP | MVP |
| A16 | Reconciliation | Money & Rewards | PSP vs ledger vs bank | Tabs: **Daily · Exceptions** | Resolve-with-note modal | FIN | MVP |
| A17 | Ledgers | Money & Rewards | Read-only explorers | Tabs: **Financial ledger · Rewards ledger · Campaign budget accounts** | Export modal | FIN, RSK, CSP (rewards read) | MVP |
| A18 | Settlements | Money & Rewards | Run settlements | Tabs: **Runs · Merchant balances (incl. negative carry-forward) · Payouts · Adjustments** | Create run; adjustment modal (second approver) | FIN | MVP |
| A19 | Settlement run detail | Money & Rewards | One run | Statements per merchant, holds, negatives | Approve payout, mark paid | FIN, SUP | MVP |
| A20 | Commercial & rewards settings | Money & Rewards | Versioned economics | Tabs: **Fee rules · Rate cards & reward economics (separate) · Rewards rules & catalogue · Points liability & expiry** | Versioning/effective-date modal | SUP, FIN | MVP |
| A21 | Risk queue | Risk | Flags and anomalies | Tabs: **All flags · Duplicate accounts · Viewing · Redemption/QR · Voucher/refund · Devices & blocklist · Appeals** | Assign, quick clear | RSK, OPS | MVP |
| A22 | Risk case | Risk | One case | Evidence, linked accounts/devices, actions (clear, hold rewards, reverse, restrict, suspend, ban device) | Action modals | RSK | MVP |
| A23 | Support inbox | Support | Cases | Tabs: **Customer · Merchant · Partner** | SLA filters | CSP, MMG, PMG | MVP |
| A24 | Case workspace | Support | One case or dispute | Messages, evidence, linked objects, dispute templates (payment/voucher/redemption/reward), actions | Refund (≤ limit), reversal request, adjustment request modals | CSP, FIN, RSK | MVP |
| A25 | Reports | Reports | All reporting | Tabs: **Executive · Operations · Finance · Merchants · Partners (aggregate) · Risk · Export centre** | Audited export modal | ANL, OPS, FIN, PMG, MMG, RSK | MVP |
| A26 | Internal users & roles | Administration | Accounts and permissions | Tabs: **Users · Roles & permissions** | Create/invite user modal (MFA enrolment); permission editor | SUP | MVP |
| A27 | Audit log | Administration | Search immutable log | Filters; record drawer | – | SUP, RSK | MVP |
| A28 | System settings | Administration | Configuration | Tabs: **General & limits · Guardrail policies · Risk rules · Reservations & no-shows (hold default 30 min, 3 strikes, period, duration) · SLAs · Retention & consent · Security policy** | Versioned save modal | SUP | MVP |
| A29 | Reference data & content | Administration | Lists and templates | Tabs: **Networks & issuers · Employers · Categories & areas · Notification templates (AR/EN) · Support templates · Legal documents & agreement versions** | Edit/version modals | SUP, PMG, MKT | MVP |

**Moved to Phase 2 (Admin):** marketing broadcast communications, partner data-sharing *usage* tooling, advanced risk graph, CSAT, automated reconciliation matching UI beyond the exceptions queue.

---

### L.8 What was consolidated

| Portal | Consolidation | Result |
|---|---|---|
| Customer | S02/S03 category states; S17-S19 and S34-S36 tabs; S20-S24 offer variants into one **Deal detail**; S07-S13 into one **Explore**; S31-S33 into **My Code**; S48-S51 simplified; all CU-20..CU-136 states folded into existing screens | 46 baseline frames → 16 screens; 67 new → 9 screens |
| Merchant | Onboarding 16 → wizard + one status page; 9 dashboard/profile/branch/team → 3; Live/Hot/Voucher/W&E: separate lists → one **Campaigns** hub with tabs; each product keeps one **detail** and one **builder**; redemptions, insights, finance each one tabbed screen; notification centre → drawer | 85 → 21 |
| Staff | 8 result screens, confirm, success → one **Result**; branch and manual code → sheets | 22 → 6 |
| Partner | 3 partner types → one shell with one eligibility screen each; org profile + users + roles + activity → one screen; reports → one tabbed screen | 43 → 13 |
| Admin | Customer 360 (8 pages → tabs); merchant application + KYB docs → one workbench; payments/refunds/disputes → one tabbed list; reconciliation/ledgers → two tabbed screens; risk 9 → 2; support 7 → 2; reports 7 → 1; admin 11 → 4 | 98 → 29 |

### L.9 Moved to Phase 2 (in addition to earlier Phase 2 list)

Customer: Best Deal for Me (S06), Employee Pass QR (S16), gift flows (S29, S30), Play & Win (S38, S42–S47), Boost (S61, decided P2), streaks/milestones, student eligibility, security activity history, Google/Apple sign-in, promo codes, card-restricted vouchers, membership types, donations, tiers.
Merchant: bulk/templates, deposit settings, pooled inventory, subscription billing, **reversal-request queue** (the direct Reverse action by managers is MVP), Boost, reputation tools.
Staff: employee-pass check, reversal-request flow.
Partner: funded campaigns, merchant invitations, programmes, communications.
Admin: marketing broadcast, partner data-sharing usage, advanced risk graph.
Phase 3: issuer card verification (S57), bank-point/miles conversion.

### L.10 Removed as duplication

- S35 and S36 (identical render of S34) → rebuilt as tabs of one merchant page.
- S03 (state of S02).
- Rewards payments block on S48 (duplicate of S53).
- Savings donut on S52 (duplicate of S54).
- S58–S60, S62, S63 mobile "business console" (superseded by Merchant Portal and Staff app; S61 preserved as future).
- Separate CU-xx/MP-xx/SA-xx/PP-xx/AD-xx entries for statuses, empty/error states and dialogs (kept as variants).

### L.11 What must remain a standalone screen

| Screen | Why it cannot be a tab/drawer |
|---|---|
| Customer: Deal detail, Checkout, My Code, Reels player, Phone & OTP, Profile setup | Distinct full-screen jobs with their own back-stack |
| Merchant: Onboarding wizard, the four **builders**, the four **detail** pages, Statement detail | Long, stateful, deep-linkable work (drafts, review, finance audit) |
| Staff: **Scanner** and **Result** | Camera, one-thumb speed and unambiguous result states |
| Admin: **Application review**, **Review workspace**, **Risk case**, **Case workspace**, **Settlement run detail** | Decision workbenches with evidence, permissions and audit |
| Partner: the three type-specific eligibility screens | Different data models per partner type |

### L.12 Traceability: nothing lost (old inventory → consolidated screen)

| Old IDs | Now in |
|---|---|
| CU-01 | C-01 · CU-02, 03, 12 → CS-01 · CU-04..10 → CS-02 · CU-11 → sheet |
| CU-20..26 | C-04 (employer sheet/tab) |
| CU-30..38 | C-16 + S56 sheet; requirement text in C-05; CU-38 Phase 3 |
| CU-40..48 | C-05 states, C-07 variant, C-04 filter sheet; CU-42 → CS-03 |
| CU-50..55 | C-14, C-07, refund sheet |
| CU-60..62, 70, 71 | C-09, C-10, C-11, C-12, C-13 |
| CU-80 | C-14 · CU-90, 120, 121 → CS-05 · CU-91 Phase 2 |
| CU-100 → C-03 · CU-101 → CS-06 · CU-110, 111 → CS-07 · CU-112, 113 → CS-08 · CU-130..135 → component states · CU-136 → CS-09 |
| MP-01..03 | M01 · MP-04..11 → M02 · MP-12..16 → M03 · MP-20 → M04 |
| MP-30..33, 123 | M16 · MP-34..38 → M17 |
| MP-40, 50, 60, 70 | M05 · MP-41..43, 46, 47 → M10 · MP-44, 45 → M06 · MP-51 → M11 · MP-52..54 → M07 · MP-61 → M12 · MP-62..65 → M08 · MP-71..73, 76 → M13 · MP-74, 75, 77, 78 → M09 · MP-49 → builders' translation panel |
| MP-80..83 | M14 · MP-90..95 → M15 · MP-100, 102..105, 107 → M18 · MP-101 → M19 · MP-110 → drawer + M21 · MP-111..113 → M20 · MP-120..122 → M21 |
| MP-48, 55, 56, 82, 106, 124 | Phase 2 |
| SA-01 → T01 · SA-02, 03, 05 → T02 · SA-04 → T03 · SA-06..15, 20, 21 → T04 · SA-16, 17 → T05 · SA-18, 19 → T06 · SA-22 Phase 2 |
| PP-01 → P01 · PP-02..05 → P02 · PP-10 → P03 · PP-B1..B4 → P04 · PP-S1..S4 → P05 · PP-E1..E3 → P06 · PP-30..32, B5, E4 → P07/P08 · PP-40, 41, E5 → P09 · PP-50..53, B6, S6, E6 → P10 · PP-20..23 → P11 · PP-60 → P12 · PP-70 → P13 · PP-33, 42, S5, S7, E7 Phase 2 |
| AD-01 → A01 · AD-10, 17 → A02 · AD-11..16, 18, 19 → A03 · AD-20, 23, 28 → A04 · AD-21, 22 → A05 · AD-24..27 → A06 · AD-30, 32, 35, 36 → A07 · AD-31, 33, 34, 37, 38 → A08 · AD-40 → A09 · AD-41 → A10 · AD-42..45 → A11 · AD-46, 47 → A12 · AD-48..50, 52 → A13 · AD-60, 62, 63, 65 → A14 · AD-61, 64 → A15 · AD-66, 67 → A16 · AD-68, 75, 77 → A17 · AD-69, 71, 72, 74, 78 → A18 · AD-70 → A19 · AD-73, 76, 79..81 → A20 · AD-90..96, 98 → A21 · AD-91 → A22 · AD-100, 102, 103 → A23 · AD-101, 104 → A24 · AD-110..116 → A25 · AD-120..122 → A26 · AD-123 → A27 · AD-51, 97, 105, 106, 124, 129, 130 → A28 · AD-125..128 → A29 |

### L.13 Wireframe readiness

| Risk | Mitigation |
|---|---|
| Dense tabbed screens (Admin A03, A06, A21, A28) are harder to wireframe well | Wireframe the **tab skeleton first**, then each tab; keep permissions per tab explicit |
| Tabs hide permission differences | Each wireframe annotates role visibility per tab |
| Adaptive screens (Deal detail, Admin Campaign detail, Staff Result) need a variant matrix | Provide a variant matrix before wireframes (one table per adaptive screen) |
| Four merchant builders are similar | Design one builder shell and four step sets |

Remaining open items: none blocks wireframing. UXF-05, 06, 15, 16, 21 and FDR-26, 40, 41, 62 are closed (UXD-14..20); only confirm the mapping "Merchant Manager = Owner, Admin, Branch Manager".

*End of UX Architecture v0.3. No application code and no wireframes created.*

---

## M. CUSTOMER APP FINAL ALIGNMENT (summary; detail in DEALDASH_CUSTOMER_MVP_FINAL.md)

| Item | Final |
|---|---|
| Screen dispositions (63) | KEEP 4 (S03, S25, S40, S50) · MODIFY 36 · REPLACE 10 (S10, S20, S23, S26, S56; S58, S59, S60, S62, S63 moved to other surfaces) · PHASE 2/3 13 (S06, S16, S29, S30, S38, S42-S47, S57, S61) |
| Corrections to earlier rows | S21 is MODIFY (embedded points block removed); S53 becomes a section of My Deals; S57 is Phase 3; S10/S11/S13/S14/S15 form the new **My benefits (C-17)** |
| Core customer screens | **26**: C-01..C-17 and CS-01..CS-09 |
| Exclusive Deal | Free reservation, per-branch stock, default 30-minute configurable hold, no receipt, no token statuses; S20, S26, S31, S08, S33, S52, S53 updated |
| Actions | Reserve (Hot), Buy (Voucher), Watch (W&E), controlled-offer action only; no generic Activate |
| Navigation | Bottom bar unchanged; Explore tabs Live, Hot, Vouchers; Bank Cards and Employer become My benefits (FDC-08, recommended); My Deals shortcut on Home |
| Founder defaults | FDC-01..FDC-08 **all closed** (guest read-only, follow/likes hidden, email required without separate verification, "Reported savings", reviews rule, Western digits and Gregorian dates, configurable hot max duration, consolidated navigation); one active employer at a time |