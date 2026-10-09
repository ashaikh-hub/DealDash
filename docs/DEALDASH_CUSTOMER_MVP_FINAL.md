# DEALDASH CUSTOMER APP: FINAL MVP ALIGNMENT

Version 0.2 (APPROVED; structurally frozen for MVP; FDC-01..FDC-08 and FDC-05 closed) · 2026-10-07
Status: **final alignment of the existing 63-screen customer design to the approved MVP rules.** The 63-screen Figma set stays the approved visual baseline. **Nothing is redesigned from scratch.** No Phase 2 design is deleted; all stay in the design library as clearly marked future references.
Aligned against: Master Blueprint v0.2.2, Business Rules (HD, RS, VC, WE, RW, EL, EM, BC, AU, SP, FR), UX Architecture v0.3 (decisions UXD-01..18), Merchant Portal, Merchant Staff, Admin and Partner Portal (all frozen for MVP).
Output of this stage: documentation only. **No production code.**

> **Update 2026-10-08 (design source status).** For Voucher journeys the **Stage 5 handoff is the current MVP visual source of truth** (`figma-handoff/stage5/` and `docs/STAGE5_FIGMA_HANDOFF.md`). Original screens **S09, S22, S28, S29, S30, S32, S33 and S53 are OUTDATED / SUPERSEDED FOR MVP**: the `MODIFY` rows in the tables below describe the intent, but developers must implement from the Stage 5 frames, not from the original files. Mapping and replacement frames: `docs/DESIGN_SOURCE_MAP.md`. The historical files are kept.

Conventions: **KEEP AS IS · MODIFY FOR MVP · MOVE TO PHASE 2 · REPLACE · ADD STATE · ADD NEW SCREEN**. MVP / P2 / P3. `FDC-nn` = founder decision still open for Customer; `VK-nn` = VALIDATE-KSA.

## 0. Principles that decide every row
1. **Frictionless by default.** An explicit customer action appears only when the product needs it: Exclusive Deal → **Reserve**; Voucher → **Buy**; Watch & Earn → **Watch**; controlled offer → its redemption action. General Live Deals stay Discover → View → Visit.
2. **Honest eligibility.** Cards are **added**, never "verified". Employer status is **verified** because an OTP proves a work email. Offers that need paying with a specific card say so.
3. **No money where there is none.** Exclusive Deal reservation is free. Rewards are non-cash, non-withdrawable, non-transferable; they never pay a bill and have no SAR value.
4. **Separate products.** Watch & Earn is its own experience; deal pages never embed points videos.
5. **One state system.** Missing situations are states, sheets or banners on existing screens, not new screens, unless they are a destination of their own.
6. **Same visual language.** Plus Jakarta Sans (EN) and IBM Plex Sans Arabic (AR), existing tokens, radii, chips, cards, bottom sheets. Western digits.

---

## 1. AUDIT OF THE 63 EXISTING SCREENS

Final classification. "State" additions are listed in the last column; full state catalogue in section 14 and the product sections.

### 1.1 Totals
| Disposition | Count | Screens |
|---|---|---|
| **KEEP AS IS** (layout and content unchanged; states may be added) | **4** | S03, S25, S40, S50 |
| **MODIFY FOR MVP** | **36** | S01, S02, S04, S05, S07, S08, S09, S11, S12, S13, S14, S15, S17, S18, S19, S21, S22, S24, S27, S28, S31, S32, S33, S34, S35, S36, S37, S39, S41, S48, S49, S51, S52, S53, S54, S55 |
| **REPLACE** (concept changes; redesign this screen only) | **10** | Customer: S10, S20 (partial), S23, S26, S56. Superseded by other surfaces: S58, S59, S60, S62, S63 (business console; now Merchant Portal and Staff app) |
| **MOVE TO PHASE 2 / 3** (preserved as future references) | **13** | S06, S16, S29, S30, S38, S42, S43, S44, S45, S46, S47, S61 (P2); S57 (P3, advanced card verification) |
| **Total** | **63** | |

Recount note: **45 existing frames carry the MVP customer experience** (4 kept, 36 modified, 5 replaced in place). Earlier text quoted 46 because S21 was labelled KEEP while also needing a removal; S21 is now MODIFY.
**ADD STATE** is applied to many rows (not counted separately). **ADD NEW SCREEN:** 10 (section 18.2).

### 1.2 Screen-by-screen

| # | Screen | Final | What changes for MVP | States / notes to add |
|---|---|---|---|---|
| S01 | Sign in | MODIFY | Phone number is the primary and only sign-in. **Google / Apple hidden (P2)**. Guest "Skip for now" kept as read-only browsing (FDC-01) | Language switch; terms and privacy links to real viewer |
| S02 | Home (Food) | MODIFY | Four propositions visible: Live Deals, Exclusive Deals, Vouchers sections and the Watch & Earn strip. "Browse by Card / Employer" opens **My benefits** (a discovery layer, not a product). Header gets My Deals shortcut. Hot cards show **Reserve (free)** only where reservable | Loading, empty area, offline, no location, guest, locked offers in-list |
| S03 | Home (category variant) | **KEEP** | A state of S02 | Hot "5 days left" sample is a data example (hot-deal maximum duration is a merchant-side setting) |
| S04 | Location sheet | MODIFY | Enabled cities only (Riyadh pilot); recent areas | Permission denied, search |
| S05 | Notifications | MODIFY | Split **feed** (C-03) from **settings** (CS-06) | Empty, read/unread; transactional vs marketing |
| S06 | Best Deal for Me | **PHASE 2** | Preserved; entry points hidden | |
| S07 | Explore: Live Deals | MODIFY | Paged list, filter and sort sheet | Locked offers in-list, empty, offline |
| S08 | Explore: Exclusive Deals | MODIFY | Quantity-limited reservable deals: **Reserve (free)** with per-branch stock; time-limited walk-in deals: **View deal** | Sold out, ended, limit reached, reservations paused |
| S09 | Explore: Vouchers | MODIFY | Gift icon hidden (P2); "My vouchers" links to My Deals | Sold out, ended |
| S10 | Explore: Bank Cards | **REPLACE** | Becomes the **Card benefits** part of My benefits: added cards (issuer, product, tier) and matching offers. No digits, no "Verified", no "Activate offer" | Empty (no card added), error |
| S11 | Explore: Employer (not verified) | MODIFY | Becomes the **Employer** part of My benefits; locked offers show "Verify your employer to unlock"; "My employer isn't listed" request | Empty, no offers |
| S12 | Live Deals map | MODIFY | Pin bottom card complete; RTL-safe controls | Permission denied, cluster |
| S13 | Offers by Riyad Bank | MODIFY | Issuer offer list with requirement text "Pay with a Riyad Bank card"; no VERIFIED badge; product action only | Locked ("Add your eligible bank card to unlock"), empty |
| S14 | Employer: verification sheet | MODIFY | Full flow: employer → work email → email OTP → verified | Invalid domain, wrong or expired OTP, resend, lockout, not listed (section 6) |
| S15 | Employer: verified | MODIFY | **Employee Pass button removed (P2)**; verified status digitally unlocks offers | Reverification due, expired, remove employer |
| S16 | Employee pass QR | **PHASE 2** | Preserved; no MVP entry | |
| S17 | Deal: Live overview | MODIFY | Frictionless ("Free, no code, no reservation"); eligibility panel replaces "Activate"; **embedded points video block removed** | Ended, paused, locked, closed branch, branch picker, offline |
| S18 | Deal: Details | MODIFY | Structured terms blocks; per-branch hours | |
| S19 | Deal: Reviews | MODIFY | Report review; sort; "Sponsored" slot hidden (Boost is P2) | Empty, pagination |
| S20 | Hot limited: reserve | **REPLACE (partial)** | **Free reservation.** See section 2 | Sold out, ended, limit, paused |
| S21 | Hot time-limited | MODIFY | Remove embedded points block; walk-in, countdown | Ended |
| S22 | Voucher detail | MODIFY | Gift hidden; points block removed; full-redemption wording; refund-before-redemption line | Sold out, ended |
| S23 | Card offer (3 cards) | **REPLACE** | "Cards that match" list (added cards and why), requirement text, no "Activate" | No matching card, locked |
| S24 | Employer offer | MODIFY | "Verified employee. Unlocked for you"; no pass | Locked, verification expired |
| S25 | Photo viewer | **KEEP** | Unchanged | RTL swipe, low-res fallback |
| S26 | Reserve sheet | **REPLACE** | Free reservation sheet (no payment, no card picker) | Stock race, limit, paused |
| S27 | Write a review | MODIFY | Guidelines, moderation notice, who may review (FDC-05) | |
| S28 | Checkout (voucher) | MODIFY | **Points payment removed, promo code removed (P2), gift removed (P2)**; PSP-hosted payment | Processing, pending, failed, 3-D Secure, hold expired |
| S29 | Gift checkout with promo | **PHASE 2** | Preserved | |
| S30 | Gift voucher card | **PHASE 2** | Preserved | |
| S31 | Reservation code | MODIFY | Hold timer from configured hold (default 30:00); **"Token paid SAR 15" removed**; cancel | Expired, redeemed, cancelled |
| S32 | Voucher code | MODIFY | "Show at the till. Redeemed in full."; no "one or more visits" | Redeemed, expired, refunded |
| S33 | Receipt | MODIFY | **Voucher receipts only** (no token receipt) | Refund status |
| S34 | Merchant: Offers | MODIFY | Follow hidden pending FDC-02 | Closed, empty, branch picker |
| S35 | Merchant: Info | MODIFY | Rebuild frame (export showed Offers) | |
| S36 | Merchant: Reviews | MODIFY | Rebuild frame; report | |
| S37 | Watch & Earn | MODIFY | Qualifying views and rewards; **streak, daily goal, milestone removed (P2)**; Play & Win tab hidden | Caps, no campaigns |
| S38 | Play & Win menu | **PHASE 2** | Preserved | |
| S39 | Reels player | MODIFY | Likes and follow hidden pending FDC-02; captions | Buffering, error, cap, ended |
| S40 | Still watching | **KEEP** | Unchanged | Failure result |
| S41 | Reward unlocked | MODIFY | Points earned or merchant-funded prize; held / pending reward | Held, out of stock |
| S42 to S47 | Games and result | **PHASE 2** | Preserved | |
| S48 | Rewards | MODIFY | **"10 points = SAR 1" and "Worth SAR…" removed**; streak/milestone removed; Play & Win card hidden | |
| S49 | Redeem points | MODIFY | No SAR labels; donations and bank-miles hidden | Empty, out of stock |
| S50 | Redeem confirm | **KEEP** | Unchanged | Insufficient, success |
| S51 | Points activity | MODIFY | Only Watch & Earn earn entries plus redemptions, holds, reversals, expiry | Held, reversed, expired |
| S52 | My Deals: active | MODIFY | Rationalised (section 11); no "Paid SAR 15" | Empty |
| S53 | My Deals: payments | MODIFY | Voucher payments and refunds only; becomes a section of My Deals | Refunded |
| S54 | Savings | MODIFY | "Reported savings" wording (FDC-04) | Empty |
| S55 | Profile | MODIFY | Phone identity; added cards without digits; settings links | |
| S56 | Add card sheet | **REPLACE** | Selection-only flow (section 4) | Success, duplicate, limit |
| S57 | Verify card (issuer SMS) | **PHASE 3** | Preserved as the future issuer-verified flow | |
| S58 | Business: campaigns | REPLACE | Now Merchant Portal | out of customer app |
| S59 | Business: redeem | REPLACE | Now Staff app (no "use latest code") | out of customer app |
| S60 | Business: analytics | REPLACE | Now Merchant Insights | out of customer app |
| S61 | Business: Boost | **PHASE 2** | Preserved | |
| S62 | Create Live Deal | REPLACE | Now Merchant Portal builder | out of customer app |
| S63 | Create Exclusive Deal | REPLACE | Now Merchant Portal builder | out of customer app |

---

## 2. EXCLUSIVE DEAL: FREE RESERVATION (S20, S26, S31 and connected screens)

### 2.1 MVP model (rules HD-07, HD-10..14, RS-01..17, UXD-07/08)
- **Free reservation. No SAR 15 deposit, no token, no payment, no card selector.**
- **Inventory per branch.** The customer reserves at one branch; the reservation is valid only there (RS-12).
- **Configurable hold**, **initial default 30 minutes**, within DealDash limits; starts when the customer taps Reserve (creation equals confirmation, RS-04).
- Per-customer limit (HD-08), concurrent-reservation cap (RS-16), same eligibility as the deal at action time (RS-17).
- No-show: expiry without redemption is a no-show; **3 confirmed no-shows (configurable) pause new reservations temporarily**, never a permanent ban (UXD-08).
- **Two Exclusive Deal kinds:** (a) **reservable** (quantity-limited or both): Reserve, then validated by staff; (b) **time-limited walk-in** (HD-14): View deal, visit, no reservation, no code.

### 2.2 Customer journey
```
Discover Exclusive Deal (S02 / S08 / S12)
→ View deal (S20 reservable, or S21 walk-in)
→ Reserve (S26 sheet: free)                     [reservable only]
→ Reservation confirmed (S31: code + hold timer)
→ Visit merchant (directions)
→ Staff scans or validates the reservation code → Redeemed  [reservable]
```
Walk-in time-limited deal: Discover → View → Visit (no reserve, no code). No payment appears anywhere in the reservation journey.

### 2.3 Screen specification

**S08 Exclusive Deals list card**
- Reservable: price/benefit, **"120 left at Riyadh Park"** (per-branch stock; nearest or selected branch), CTA **"Reserve (free)"**.
- Walk-in: countdown and CTA **"View deal"**.
- Sold out: disabled chip "Sold out"; ended: not listed (or in Past).

**S20 Exclusive Deal detail (reservable)**
- Stock bar per **selected branch** (branch picker if several), "Up to 2 per customer", hold line **"Held for 30 minutes after you reserve"** (value from configuration), countdown for time-limited-and-quantity deals.
- CTA **"Reserve my spot (free)"**.
- One-line honesty note: "If you don't show up in time, the spot goes back. 3 missed reservations pause new reservations."
- **Removed:** "Pay SAR 15", token copy, "token credited to your bill", embedded Watch & Earn points block.
- States: sold out at my branch (offer another branch if available), ended, limit reached, **reservations paused** (CU-47 notice with end date and how to appeal), locked (eligibility), closed branch, offline.

**S26 Reserve sheet**
- Fields: quantity stepper (≤ per-customer limit and ≤ stock), **branch** (with stock), hold time, note. Primary **"Reserve for free"**. **No payment method, no card, no price.**
- States: stock changed ("Only 1 left, adjust"), **stock race** ("Sorry, just taken. Try another branch"), limit reached, too many active reservations, paused, not eligible, session expired, network error with retry.

**S31 Reservation confirmed / code**
- Header "Reserved at [branch]", **QR + code**, **hold timer starting at the configured hold (default 30:00)**, quantity, deal title, **Directions**, **Cancel reservation** (confirm sheet; cancellation releases stock; no penalty in the free flow beyond strike rules, RS-06).
- Removed: "Token paid: SAR 15, credited to your bill".
- States: **Expired** (hold elapsed; shown in Past with "No-show" wording kept neutral), **Redeemed** (time and branch), **Cancelled by you**, **Cancelled by merchant** (apology, no penalty), **Merchant suspended** (resolution notice), brightness and screen wake for the code, offline copy of the code.
- Notifications: reservation confirmed, 10 minutes left (configurable), expired, cancelled.

**Connected screens updated**
| Screen | Change |
|---|---|
| S02, S03 | Hot cards use the rule above; no price tokens |
| S21 | Walk-in only; remove embedded points block; ended state |
| S33 | A free reservation has **no receipt**; confirmation lives on S31 and in My Deals. Receipts exist for vouchers only |
| S52 | Reservation rows show branch, time left, status; **no "Paid SAR 15"** |
| S53 | No token payments, holds or credits |
| S54 | Reported savings may include used Exclusive Deals (self-reported) |
| S05 / notifications | Reservation messages as above |
| S12 | Hot pins show remaining stock for the branch |

### 2.4 Staff step
Where a reservation is used, the **staff validates the code in the Staff app** (RD rules). The customer screen shows a clear "Show this to staff" instruction. Wrong branch, expired and already-redeemed results appear on the staff side; the customer sees the resulting state (Redeemed or "Not valid here").

---

## 3. NO GENERIC "ACTIVATE OFFER"

| Product | Customer action | Code or QR? |
|---|---|---|
| **General / unlimited Live Deal** | None (View, Get directions, Save, Share) | **No** |
| **Controlled Live Deal** (merchant turned on controlled redemption) | The relevant redemption action configured for it (for example "Show to staff") | Yes, only for that campaign |
| **Exclusive Deal (reservable)** | **Reserve** | Yes (reservation code) |
| **Exclusive Deal (time-limited walk-in)** | None | No |
| **Voucher** | **Buy** | Yes (voucher code) |
| **Watch & Earn** | **Watch** | No |
| **Card offer** | Product action only ("Pay with your eligible card") | No activation |
| **Employer offer** | Product action only | No pass in MVP |

**Removed everywhere:** "Activate offer", "Activate on 1 card", "Claim", embedded activation buttons (S10, S13, S17, S23). The eligibility panel is informational text only.
S17 footer wording stays: "Free · No code · No reservation" for general Live Deals only.

---

## 4. CARD / BANK ELIGIBILITY (S10, S13, S23, S55, S56; S57 future)

### 4.1 Principles (BC-01..BC-10, UXD-11)
- **Collect no PAN, no CVV, no last four, no first six.** Never ask for a card number.
- **Never "verified".** Use **"Added card"**, **"Card benefits added"**, **"Bank benefits added"**, **"Eligible offers unlocked"**.
- It is an eligibility selection, not proof of ownership. DealDash cannot know which card is used at the till.
- Future issuer/PSP/token verification can upgrade an added card's status without redesign (status field exists; S57 preserved).

### 4.2 Add-card flow (replaces S56; three steps in one bottom sheet)
```
Step 1  Choose your bank (issuer list, searchable)
Step 2  Choose your card (product: network and type, e.g. Visa Platinum credit, mada debit)
Step 3  Choose your tier (only where the product has tiers)
→ Card benefits added (success: "3 offers unlocked")
```
Copy on step 1: **"Select your card to see matching offers. We never ask for your card number."**
States: success (with offers count), **duplicate** ("Already added"), **limit reached** (configurable), **issuer not available yet** ("We'll tell you when it's supported"), error with retry. Editing: change tier or remove; removing locks dependent offers (confirm sheet lists them).
Entry points: My benefits, locked-offer button, Profile.

### 4.3 Where cards show up
| Place | Content |
|---|---|
| **My benefits → Card benefits** (S10 replaced) | Added cards (issuer, product, tier, remove) and **offers for your added cards**; locked offers the customer could unlock |
| **Offers by issuer** (S13) | Issuer offer list, requirement text, funder ("Funded by Riyad Bank"), **no VERIFIED** |
| **Deal detail** | **Requirement panel** (CU-37): "Pay with a Riyad Bank Visa Platinum card to get this offer" and "Cards that match" (S23 replaced): added cards that match or not and why. No card picker that implies selection of a payment card |
| **Profile** | Added cards (no digits) |

### 4.4 Requirement honesty (BC-09/BC-10)
- Any offer that requires paying with a specific card states it at three points: list card chip, detail requirement panel, and code/terms.
- Standard line: **"Pay with your eligible [bank] [product] card. DealDash can't check which card you use at the till."**
- Vouchers restricted to a card are **Phase 2** (UXD-10); card offers in MVP are Live-type benefits.

---

## 5. CUSTOMER ONBOARDING (CS-01 Phone & OTP, CS-02 Profile setup)

### 5.1 Steps (sign-in primary: **Mobile OTP**; Google/Apple **Phase 2**)
| # | Step | Screen | Notes |
|---|---|---|---|
| 1 | **Mobile number** | CS-01 | Saudi mobile; consent line to terms and privacy; primary "Send code" |
| 2 | **OTP** | CS-01 | 6 digits, resend timer, attempts per rules |
| 3 | **Email** | CS-02 | Needed for voucher receipts (FDC-03); not verified in MVP |
| 4 | **Date of birth** | CS-02 | Date picker |
| 5 | **18+ validation** | CS-02 | Under 18: blocked state; no account |
| 6 | **Gender** | CS-02 | Selectable, with **"Prefer not to say"**; not used for targeting in MVP (WE-04); VK-06 |
| 7 | **Location / city** | CS-02 | Uses the S04 sheet; Riyadh pilot; denied state |
| 8 | **Interests / preferences** | CS-02 | Category chips |
| 9 | **Required consents** | CS-02 | Terms and Privacy (required), location (as needed), notifications; **marketing is separate and optional** |
| 10 | **Profile completion** | CS-02 | Welcome, optional prompts: add bank benefits, verify employer |

Order within the wizard: 1–2 sign in; 3–9 profile setup; 10 completion. Progress indicator "Step x of 7" (after OTP). Guest users can browse before step 1 and are prompted when they reserve, buy, watch to earn or save (CU-11).

### 5.2 States
| State | Behaviour |
|---|---|
| **OTP sent** | Masked number, 6-box input, resend countdown, "Change number" |
| **OTP wrong** | Inline error "That code isn't right", attempts remaining where policy allows |
| **OTP expired** | "Code expired", Resend |
| **Resend** | Disabled until timer ends; resend limit with cooldown message (OTP abuse controls, FR-02) |
| **Lockout** | "Too many tries. Try again in mm:ss" |
| **Mobile already registered** | If it is a returning user the flow signs them in; if flagged as duplicate-risk: neutral message and support link (no account enumeration beyond what policy allows) |
| **Under-18** | Calm blocking screen: "DealDash is for people 18 and over." No account created, nothing stored beyond the legal minimum (VK-11) |
| **Consent missing** | Primary disabled; inline "Please accept the Terms and Privacy Policy to continue" |
| **Onboarding interrupted** | Progress saved per step after OTP; next sign-in shows "Continue setting up" with resume |
| **Resume onboarding** | Returns to the first incomplete step; skipped optional steps can be completed from Profile |
| **Session expired** | Re-login sheet, returns to the same place |
| **Network error** | Retry banner |

Rate limits, attempt counts and timers are configuration (OTP rules), not fixed numbers.

---

## 6. EMPLOYER ELIGIBILITY (S11, S14, S15, S24; S16 future)

### 6.1 MVP journey (EM-01..EM-26)
```
My benefits → Employer (S11)
→ Select employer from DealDash partner list       [EM-01: active partners only]
→ Enter official work email                        [domain must match approved domain]
→ Email OTP
→ Verified employer status
→ Eligible employer offers unlocked
```
Verified status **digitally unlocks** employer offers. **No employer pass or QR in MVP** (Employee Pass QR is Phase 2). The verified offer page is what the customer shows if asked.

### 6.2 Screens and states (inside S14 sheet and S11/S15)
| State | Behaviour |
|---|---|
| **Choose employer** | Searchable list of active partners; **"My employer isn't listed"** opens a request form (no verification) |
| **Enter work email** | Hint "Use your official work email"; personal domains and shared mailboxes rejected |
| **Invalid domain** | "This email isn't from [employer]. Use your official work email." |
| **Email already linked** | "This email is linked to another account." (one email per account) |
| **OTP sent** | Masked email, 6 digits, resend |
| **OTP failure** | Wrong code with attempts left; **lockout** after maximum with cooldown |
| **Expired OTP** | "Code expired", Resend |
| **Success** | "You're verified at [employer]" and offers unlocked count |
| **Employer not listed** | Request form; confirmation "We'll let you know if it becomes available" |
| **Verification expired / reverification required** | Banner on S15 and on employer offers; offers become locked with "Verify again to unlock"; grace period shown if configured |
| **Employer deactivated** | Offers locked with explanation; customer notified (EM-23) |
| **Remove employer** | Confirm sheet |
| **Multiple employers** | Decision FDR-30 default: one at a time with "Switch employer" |

Customer sees only a masked email. Employers never see customer names or emails (EM-24).

---

## 7. ELIGIBILITY VISIBILITY (UXD-05)

| Situation | Treatment |
|---|---|
| Customer **could realistically unlock** by completing a verification | Show the offer **locked** with a clear reason and **one action**: "Verify your employer to unlock" or "Add your bank benefits to unlock" |
| Customer **definitely not eligible**, no realistic path (e.g. different issuer already excluded, wrong city, restricted to a partner they cannot join) | **Hidden from normal discovery** |
| Eligible | Shown normally with the requirement panel where relevant |
| Eligibility lost after viewing (card removed, verification expired) | Offer turns locked with the same action; existing reservations/vouchers follow their own rules |

Locked state is one component: dimmed card, lock chip, reason line, single button. Used in Home, Explore, issuer lists, employer lists, deal detail and search.

---

## 8. VOUCHERS (S09, S22, S28, S32, S33; My Deals)

### 8.1 MVP journey (VC-01..VC-44)
```
Discover (Home / Explore / Merchant page)
→ View voucher (S22: "Pay 80, get 100", validity, branches, terms)
→ Buy (S28 checkout: PSP-hosted payment)
→ Payment processing
→ Purchase success (order status + receipt)
→ My Deals → Vouchers
→ QR / code (S32)
→ Merchant redemption (staff scans; full value)
→ Redeemed
```
**Gift vouchers, promo codes and partial redemption are Phase 2.** Checkout has no points payment, no promo field, no gift toggle. Voucher purchase requires a signed-in, verified customer.

### 8.2 Checkout and payment states (CS-04 Order status carries these)
| State | What the customer sees | Rule |
|---|---|---|
| **Hold** | "We're holding your voucher for mm:ss" during checkout | VC-11 |
| **Payment processing** | Spinner, "Don't close the app"; PSP or 3-D Secure step | VC-12 |
| **Payment pending** | "Waiting for your bank. We'll notify you." Voucher stays Pending; not usable | VC-05 |
| **Payment failed** | Reason (declined, timeout, cancelled), **Try again** or other method, hold released message; nothing charged | VC-35 |
| **Hold expired** | "Your hold ended. Try again if still available" | VC-11 |
| **Purchase success** | Confirmation, receipt link, **View voucher**; push and email | VC-16 |
| **Sold out during checkout** | Message, no charge | VC-03 |

### 8.3 Voucher lifecycle states (S32, My Deals)
| State | Display and actions |
|---|---|
| **Active** | QR and code, branch list, validity date, "Show at the till. Redeemed in full." Actions: Directions, **Request refund** (while allowed) |
| **Refund requested** | Chip "Refund requested", expected timing, status in My Deals; code disabled |
| **Refunded** | "Refunded to your original payment method", amount, date; receipt shows refund |
| **Expired** | "Expired on [date]"; no code; the treatment of unredeemed value follows the configured policy (VC-33, **VK-04**); a support link, no promise of refund or extension in the UI text |
| **Redeemed** | "Redeemed at [branch], [time]" |
| **Redemption failed** | Staff-side outcomes shown as a friendly message on retry: wrong branch, outside validity, not active; **Contact support** |
| **Duplicate redemption** | "Already redeemed at [branch], [time]" (blocked atomically, VC-31); link to report an issue |
| **Merchant suspended** | Notice "We're resolving your voucher" with outcome when decided (VC-39) |

Refund rule in the UI: **full refund before redemption** within the configured window (VC-36, **VK-04**); a redeemed voucher cannot be refunded (VC-38). Copy states the rule once at checkout (terms and refund checkbox) and on the voucher.
Receipts (S33): voucher purchases only, with VAT and invoice fields as validated (VK-03).

---

## 9. WATCH & EARN (S37, S39, S40, S41, S48 to S51)

### 9.1 Separate MVP product
Watch & Earn is a **separate, advertising-funded campaign experience** (UXD-04). It may link to a merchant page, Live Deal, Exclusive Deal or Voucher, but deal pages never embed points videos. The merchant pays for qualifying views; **DealDash alone controls the customer reward** (WE-01, WE-02). No SAR-per-point is shown. Rewards are **not cash**.

### 9.2 Journey
```
Discover Watch & Earn (centre tab, home strip)
→ Watch merchant video (reels player)
→ Qualifying-view controls (foreground, visible, playing, no skip)
→ "Still watching?" check where configured (S40)
→ Completed qualifying view (server-confirmed)
→ Reward issued (S41: points, or merchant-funded prize)
→ Reward wallet / activity (Rewards, Points activity)
```
The client never decides that a view counted; the server confirms (WE-29). Results are shown after confirmation, which may take a moment.

### 9.3 States
| State | Customer-facing behaviour |
|---|---|
| **Already watched / frequency limit** | "You've already earned from this video. Back at [time]" or "Come back later" |
| **Daily cap reached** | "You've reached today's limit" with reset time; videos stay watchable without earning if the product allows (otherwise hidden) |
| **Campaign ended** | Card or reel shows "Campaign ended"; in-progress view completes if started before end |
| **Budget exhausted** | "No more rewards on this video"; same card treatment as ended; no blame wording |
| **Video unavailable** | "This video isn't available. Try another"; buffering and error with retry |
| **View did not qualify** | Neutral "That view didn't count" with a short reason class (left the app, skipped, didn't respond); link to "How qualifying views work" |
| **Still-watching failure** | S40 times out: view not counted, same message |
| **Suspicious / reward held** | "Your reward is being checked. We'll update you." Status **Held** in activity (RW-09); released or reversed later with a note |
| **Reward issued** | S41 celebration; points added or prize in My Deals; activity entry |
| **Prize out of stock** | "This prize has run out. Points earned are kept" |
| **Not eligible for campaign** | Hidden, or "Not available for you" only when a realistic path exists |
| **Offline / background** | Pauses, no counting (WE-24) |

Removed: streak, daily goal, milestone claims (Phase 2); Play & Win tab (Phase 2); likes/follow (FDC-02).
"Points equal seconds watched" copy is removed (rewards are DealDash-controlled).
Help sheet "How qualifying views work" explains requirements in plain language.

---

## 10. REWARDS (S41, S48..S51)

- **Non-cash, non-withdrawable, non-transferable** (RW-01). Terms line in Rewards: "Points can't be withdrawn or transferred and aren't cash."
- **Removed:** "10 points = SAR 1", "Worth SAR 130", "Worth SAR…" on catalogue items, any "pay with points" at checkout (S28), conversion to bank points or miles (hidden; P3), donations (hidden; P2).
- **Kept:** balance with pending/held, **earning history** (Watch & Earn only in MVP), **redemption catalogue when configured** (items show description and point cost only), reward activity (earn, hold, release, redeem, reverse, expire).
- **Catalogue contents are configuration.** If empty: "Rewards are coming soon."
- **Streaks / milestones: Phase 2. Play & Win: Phase 2** (designs S38, S42..S47 preserved).
- Expiry notice shows only if configured (VK-17).

---

## 11. MY DEALS (S52, S53 rationalised; screen C-14)

One screen, **two tabs**, filter chips; no extra pages.

| Tab | Contains |
|---|---|
| **Active** | **Reservations** (with hold timer, branch, Show code) · **Vouchers** (active, with validity) · **Prizes** from Watch & Earn when issued · Upcoming (scheduled start) |
| **Past** | Used / redeemed · Expired · Cancelled · **Refunded** (with refund status) |

- **Filter chips:** All · Reservations · Vouchers · Prizes.
- **Refund status** appears as a chip on the row and inside the detail; **Payments & receipts** is a section reached from a voucher row or a link at the bottom of Past (the former S53 list), not a separate navigation tab.
- Row tap opens **My Code** (S31/S32). Empty states per tab with an invitation to explore.
- Savings (S54) stays one screen, linked from Profile.
- Gift items (Phase 2) not shown.

---

## 12. CUSTOMER SUPPORT (CS-07 Help, CS-08 My cases)

| Capability | Specification (SP-01..SP-18) |
|---|---|
| **Help** | FAQ categories (Offers, Reservations, Vouchers and payments, Watch & Earn, Account), search, "Contact support" |
| **Contact support** | Create case sheet: category, **related item picker** (voucher, reservation, order, reward, merchant), message, attachments where allowed |
| **Transaction context** | When opened from a voucher, reservation or reward, the case is pre-linked and shows an evidence summary (state, times, branch) |
| **Evidence** | Customer may attach images/documents for dispute types that allow it; system snapshots are added automatically |
| **My cases** | List with status; case detail with messages, status chip (New, In progress, Waiting on you, Resolved, Closed) and **resolution** text with outcome (refund, re-validated voucher, points released, etc.) |
| **Appeal** | Where an account or risk decision applies (reservations paused, reward held or reversed, restricted account), the notice shows **"Appeal this decision"**, opening a case of type appeal with the decision reference. Outcome is communicated in the case. (AU-15 appeals; wording on legal rights follows VK-24) |
| **Report** | Shared report sheet for reviews, merchants, reels |

Channels, hours and languages are configuration (FDR-71).

---

## 13. ACCOUNT / PROFILE (C-16 Profile, CS-05 Account settings)

| Area | Content |
|---|---|
| **Personal details** | Name, mobile (change with OTP), email, date of birth (read-only after 18+ check unless support), gender, city |
| **Bank / card-benefit selections** | Added cards (issuer, product, tier), no digits; link to My benefits |
| **Employer verification** | Status, masked work email, reverification date, remove |
| **Preferences** | Interests, categories |
| **Language** | English / العربية |
| **Notifications** | Channels and categories (CS-06); marketing is a separate opt-in |
| **Consents** | View, withdraw (marketing, location, notifications); terms/privacy versions accepted |
| **Privacy** | Data request (export), legal viewer (CS-09) |
| **Support** | Help centre, my cases |
| **Account deletion** | Danger zone with explanation, OTP confirmation, status. **Records that must be kept for legal or financial reasons are retained** (for example orders, refunds, ledger entries, audit records); points lose value on closure; open reservations and vouchers are handled or refunded per policy. Retention and exceptions are **VALIDATE-KSA (VK-11)**; the UI states only that some records must be kept, without legal claims |

---

## 14. GLOBAL STATES (components, not full screens)

| State | Pattern | Where |
|---|---|---|
| **Loading** | Skeletons for Home, lists, detail, code | all lists |
| **Empty** | Illustration, one line, one action (per module copy) | lists, My Deals, benefits |
| **Offline** | Persistent top banner "You're offline"; cached content stays; **codes remain visible from cache**; actions that need network disabled with explanation; retry | global |
| **Generic error** | Inline card "Something went wrong" + Retry + Contact support | any |
| **Service unavailable / maintenance** | Full-screen only for forced update or maintenance; otherwise banner | global |
| **Payment failure** | Result panel on checkout / order status with retry (section 8) | checkout |
| **Eligibility failure** | Locked-offer component (section 7); at action time a sheet "You no longer qualify. [Unlock action]" | deal detail, reserve, buy |
| **Location disabled** | Card "Turn on location for nearby offers" + manual area picker; never blocks browsing | Home, map |
| **Permission denied** | Sheet for location or notifications: explains why and links to settings | global |
| **Campaign unavailable** | Detail shows "This offer isn't available" (ended, paused, suspended, sold out, branch closed) with similar offers | deal, reel, voucher |
| **Reservations paused** | Notice with end date, appeal | reserve flow |
| **Session expired** | Re-login sheet | global |

Rule: a state is a component (banner, card or sheet) unless it is a destination in its own right.

---

## 15. ARABIC / RTL

Languages: **English and Arabic; LTR and RTL.** Fonts: **Plus Jakarta Sans (EN), IBM Plex Sans Arabic (AR).** Western digits (FDC-06 default). **Not translating every string now.**

| Area | RTL rule |
|---|---|
| **Layout and cards** | Fully mirrored; start/end logical alignment; list leading and trailing icons swap |
| **Bottom navigation** | Tab order mirrors (Home at the right); centre Watch & Earn stays central |
| **Deal details** | Tabs, chevrons, back arrows mirror; price and numbers stay LTR islands inside RTL text |
| **Checkout** | Totals right-aligned; amounts "SAR 80" isolated; payment method logos do not mirror; stepper and quantity −/+ keep order logic of reading direction |
| **QR / code screens** | QR never mirrors; code text LTR isolated; hold timer digits LTR |
| **Forms and OTP** | Labels right-aligned; **OTP boxes keep left-to-right digit order**; phone number LTR; date pickers RTL layout |
| **Countdown timers** | Digits LTR "29:41"; surrounding label RTL |
| **Maps** | Map and controls do not mirror; pin cards and bottom card mirror; pin initials need Arabic initials |
| **Numbers** | Western digits; thousands separators; "SAR" placement consistent |
| **Mixed Arabic / English merchant names** | Isolate with bidi isolation; merchants provide an Arabic name field; truncation uses ellipsis at the end of the reading direction |
| **Media** | Play/pause icons and video timelines do not mirror; gallery swipe direction mirrors |
| **Chip rows** | Horizontal scroll starts on the right |
| **Test list** | Hot card "120 left at Riyadh Park", voucher "Pay 80, get 100", "Reserve my spot (free)" in fixed-width buttons, star ratings "(1.2K)", long Arabic category chips |

---

## 16. NAVIGATION

**Keep the existing bottom navigation: Home · Explore · Watch & Earn (centre) · Rewards · Profile.** No new tab.

| Change | Detail |
|---|---|
| **Explore tabs** | **Live Deals · Exclusive Deals · Vouchers** are the product tabs. **"Bank Cards" and "Employer" stop being product tabs.** They become **My benefits**, an eligibility and discovery layer reached from Home ("Browse by card / employer"), an Explore filter chip **"For my benefits"**, and Profile. Result: three product tabs plus Watch & Earn in the centre tab; the four MVP propositions stay obvious and the app doesn't read as a menu of many products |
| **My benefits (new C-17)** | One screen: Card benefits (added cards, matching offers, add card sheet) and Employer (status, offers, verify sheet); locked offers shown here too |
| **My Deals** | Keeps its place under Profile and Rewards and gains a **header shortcut on Home** (ticket icon with active count) so reservations and vouchers are one tap away |
| **Hidden** | Play & Win tab and cards, Best Deal for Me, Boost slots, gifting, Google/Apple |
| **Guest** | Browsing allowed; gated actions show a sign-in sheet |
| **Employer / card benefits** | Appear mainly as **chips and locked/unlocked states on normal offers**, not as separate shopping destinations |

If the founder prefers zero navigation change from the baseline, the previous five Explore tabs can stay; the recommended change above is a light consolidation (**FDC-08**).

---

## 17. PHASE 2 LABELS (designs preserved, hidden in MVP)

| Feature | Designs | Label |
|---|---|---|
| Play & Win | S38, S42–S47, S37 tab, S48 card | **PHASE 2** |
| Gift vouchers / gifting | S29, S30, gift icon S09, "Buy as a gift" S22, S28 | **PHASE 2** |
| Employee Pass QR | S16, button on S15 | **PHASE 2** |
| Streaks / milestones / daily goal | S37, S48, S51 elements | **PHASE 2** |
| Google / Apple sign-in | S01 buttons | **PHASE 2** |
| Promo codes | S28 field, S29 | **PHASE 2** |
| Paid Exclusive Deal deposit | paid-token variants of S20, S26, S31, S33 | **PHASE 2** (HD-20) |
| Student eligibility | S62 option | **PHASE 2** |
| Advanced card verification (issuer / PSP / token) | S57 | **PHASE 3** (architecture-ready) |
| Best Deal for Me | S06 | **PHASE 2** |
| Boost / sponsored | S61, S19 slot | **PHASE 2** |
| Card-restricted vouchers | none | **PHASE 2** |
| Donations, bank-points / miles | S49 items | **PHASE 2 / 3** |

Each is kept in the design library with a visible "Future phase" label and removed from MVP prototypes and navigation.

---

## 18. FINAL OUTPUT

### 18.1 Customer MVP screen count
**26 core screens**: 16 baseline-derived flows (C-01..C-16) + **My benefits (C-17)** + 9 new standalone screens (CS-01..CS-09). Sheets, modals, tabs and states are not counted. This replaces the earlier count of 25 (UX Architecture L.3) by adding My benefits.

| ID | Screen | Baseline frames |
|---|---|---|
| C-01 | Welcome | S01 |
| C-02 | Home | S02, S03, S04 |
| C-03 | Notifications feed | S05 |
| C-04 | Explore (Live, Hot, Vouchers, map toggle) | S07, S08, S09, S12 |
| C-05 | Deal detail (Live, Hot, Voucher, card offer, employer offer) | S17–S27 |
| C-06 | Checkout | S28 |
| C-07 | My Code (reservation / voucher) | S31, S32, S33 |
| C-08 | Merchant page | S34–S36 |
| C-09 | Watch & Earn | S37 |
| C-10 | Reels player | S39, S40, S41 |
| C-11 | Rewards | S48 |
| C-12 | Redeem points | S49, S50 |
| C-13 | Points activity | S51 |
| C-14 | My Deals (Active, Past) | S52, S53 |
| C-15 | Savings | S54 |
| C-16 | Profile | S55, S56 |
| **C-17** | **My benefits (cards and employer)** | S10, S11, S13, S14, S15 |
| CS-01 | Phone & OTP | new |
| CS-02 | Profile setup | new |
| CS-03 | Search results | new |
| CS-04 | Order status | new |
| CS-05 | Account settings | new |
| CS-06 | Notification settings | new |
| CS-07 | Help centre | new |
| CS-08 | My cases | new |
| CS-09 | Legal viewer | new |

### 18.2 New MVP screens required (10)
CS-01 to CS-09 and **C-17 My benefits**.

### 18.3 New states and components required
Locked-offer component; requirement panel; "Cards that match" list; add-card three-step sheet; free reserve sheet; per-branch stock line; reservation hold-timer card and states; reservations-paused notice with appeal; OTP six-box input with timer and attempts; consent list with separate marketing opt-in; under-18 block; resume-onboarding banner; employer verification sheet states; order status panel (processing, pending, failed, success); refund sheet and status chip; reward status chips (Pending, Held, Reversed, Expired); Watch & Earn result states and "how it works" sheet; My Deals Active/Past tabs with filter chips; offline banner; location-disabled card; campaign-unavailable card; sign-in sheet for guests; appeal action; shared report sheet.

### 18.4 Navigation changes
Bottom bar unchanged. Explore product tabs reduced to Live, Hot, Vouchers; Bank Cards and Employer become **My benefits** (C-17) via Home, a filter chip and Profile; My Deals shortcut on Home; Play & Win and other Phase 2 entries hidden. See section 16.

### 18.5 Business-rule conflicts resolved
| Conflict | Resolution |
|---|---|
| Exclusive Deal paid SAR 15 token (S20, S26, S31, S33, S52, S53) | Free reservation, per-branch stock, 30-minute configurable hold, no receipt, no token statuses |
| Generic "Activate offer / Activate on 1 card" (S10, S13, S17, S23) | Removed; product actions only |
| "Verified" cards, last-4 / first-6, card SMS verification (S10, S13, S23, S55, S56, S57) | Selection-only "Added card"; S57 to Phase 3 |
| Embedded points video in deal pages (S17, S20, S21, S22, S23, S24) | Removed; W&E teaser only when a separate campaign links to the deal |
| Points as payment, SAR-per-point (S28, S48, S49) | Removed; rewards non-cash |
| Streaks, milestones, non-W&E earn sources (S37, S48, S51) | Phase 2 |
| Partial voucher redemption copy (S22, S32) | Full redemption wording |
| Gift and promo in checkout (S09, S22, S28) | Phase 2 |
| Employee pass (S15, S16) | Phase 2; verified status unlocks offers digitally |
| "Use latest customer code" (S59) | Removed; staff scans |
| Business console in customer app (S58–S63) | Replaced by Merchant Portal and Staff app |
| Savings shown as DealDash-generated (S54) | "Reported savings" |

### 18.6 Remaining founder decisions (all have defaults; none blocks structure)
| ID | Decision | Default used |
|---|---|---|
| ~~FDC-01~~ | Guest browsing | **CLOSED:** read-only; sign-in on reserve, buy, watch to earn, save |
| ~~FDC-02~~ | Follow merchant, reel likes | **CLOSED:** hidden in MVP (Phase 2); Save and Share kept |
| ~~FDC-03~~ | Email required at onboarding | **CLOSED:** required; no separate verification for the general customer account; mobile OTP stays the primary authentication; employer work-email verification is separate and uses OTP |
| ~~FDC-04~~ | Savings tracker | **CLOSED:** always "Reported savings"; never implies DealDash knows the customer's actual total financial savings; self-reported; no points |
| ~~FDC-05~~ | Who may review | **CLOSED:** see section 19 (signed-in only; "Verified" only with DealDash-evidenced merchant interaction; Watch & Earn alone never qualifies) |
| ~~FDC-06~~ | Numerals and Hijri dates | **CLOSED:** Western digits and Gregorian dates as initial MVP default |
| ~~FDC-07~~ | Exclusive Deal maximum duration | **CLOSED:** configurable DealDash setting (`hot_deal_max_hours`); sample "5 days" in S03 is data |
| ~~FDC-08~~ | Navigation consolidation | **CLOSED:** the approved consolidated customer navigation is used (My benefits replaces the Bank Cards and Employer Explore tabs) |
| ~~FDR-30~~ | Multiple employers per customer | **CLOSED:** one active verified employer relationship at a time in MVP (Switch employer) |

### 18.7 VALIDATE-KSA items affecting Customer UX
VK-01 savings and price claims; VK-03 VAT and invoice on receipts; VK-04 voucher validity, refund window, treatment of expired value; VK-05 / VK-16 funds held between sale and settlement; VK-06 gender and personal attributes; VK-07 video content rules; VK-10 sponsored labelling; VK-11 data retention, deletion and data requests; VK-12 aggregation (indirect, via partner data); VK-13 card-data scope; VK-14 / VK-21 brand and bank marks; VK-17 points classification and expiry; VK-23 notification consent; VK-24 consumer complaint timelines; PSP rules for payment screens (card display, 3-D Secure, saved methods).

### 18.8 Can the Customer App be structurally frozen for MVP?
**Yes, subject to your approval of this document.** Every existing frame now has a final disposition; all known business-rule conflicts have a resolution; the journeys for Live, Hot, Voucher, Watch & Earn, eligibility, onboarding, support and account are specified with states; and Phase 2 designs are preserved. The nine defaults in 18.6 are configuration-level and do not change structure. Next stage (not started): wireframes and high-fidelity updates for the 10 new screens and the replaced frames, using the existing Figma baseline.

---

## 19. DECISIONS CLOSED AFTER APPROVAL (v0.2)

**Customer App status: structurally frozen for MVP.** All FDC items are closed; no customer founder decision remains open. VALIDATE-KSA items in 18.7 stay open (plus VK-20 for reviews).

### 19.1 Reviews (FDC-05 closed; screens S19, S27, S34-S36; Business Rules MR-52)
| Rule | Specification |
|---|---|
| Who may submit | **Signed-in DealDash customers only.** Guests see reviews read-only and get the sign-in sheet on "Write a review" |
| **Verified** indicator | Shown **only** when DealDash can evidence an eligible merchant interaction: **voucher redemption**, **completed/redeemed Exclusive Deal reservation**, **controlled-offer redemption**, or another future DealDash-tracked merchant transaction |
| Not qualifying | **Watch & Earn viewing alone does not qualify.** A saved deal, a viewed deal, directions taps, an expired or cancelled reservation and walk-in Live Deals (no tracked interaction) do not qualify |
| Community reviews | Reviews without a trackable interaction **may** be accepted as normal community reviews if moderation rules allow; they carry **no Verified label** |
| Display | Review row shows a **"Verified visit/purchase"** chip only for evidenced reviews; the rating summary may show counts of verified vs community reviews. Chip never appears on the basis of the customer's own claim |
| Review sheet (S27) | Guidelines, minimum length, moderation notice; the sheet states "Reviews marked Verified come from a DealDash-tracked purchase or visit" without promising a badge |
| Abuse, report, moderation | **Report review** on every review; DealDash moderators hide or remove with reason and audit; merchants can report to DealDash; merchants cannot remove reviews. All under DealDash control |
| Frequency limits | One review per merchant per customer per configurable period; edits and deletes of own review allowed within configuration; limits are `[CFG]` |
| Merchant reply | Configurable (`[CFG]`) |
| Phase 2 | Advanced reputation management: scoring, response workflows, richer badge programmes, analytics |
| Legal | **VK-20** remains open |

### 19.2 Confirmed defaults (recorded)
Guest browsing read-only; Follow and Like hidden; email required during onboarding without separate verification for the general account (mobile OTP stays primary; employer work-email OTP separate); savings described only as **"Reported savings"** and never implying DealDash knows total financial savings; Western digits and Gregorian dates; Exclusive Deal maximum duration a configurable DealDash setting; approved consolidated customer navigation; **one active verified employer relationship at a time**.

*No production code was written.*
