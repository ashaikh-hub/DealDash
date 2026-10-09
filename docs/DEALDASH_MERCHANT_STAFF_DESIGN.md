# DEALDASH MERCHANT STAFF / REDEMPTION: MVP DESIGN

Version 0.3 (APPROVED; Stage 4 final UX decisions recorded 2026-10-08) · 2026-10-08
Scope: the Merchant Staff experience only. Inputs: Business Rules (RD-, RS-, EM-, MR-, FR- rules), UX Architecture (T01–T06), Merchant Portal documents, customer design baseline (code screens S31, S32).
Delivery: **mobile-first responsive web / PWA** (no native app in MVP). No production code.

**Mockups:** `docs/mockups/merchant-staff-mobile.html`: an interactive phone prototype, a gallery of every screen and variant (English), an Arabic RTL set, and an errors/edge-case view. Rendered and inspected at desktop width (gallery and Arabic set). Real-device testing (cameras, glare, one-handed reach, weak networks) is not done and is part of QA.

## STAGE 4 FINAL UX DECISIONS (2026-10-08; supersede any conflicting text below)

1. **Result colours = success / recoverable / hard failure.** GREEN: Valid, Redeemed. AMBER: Expired reservation, Not valid yet, Wrong branch. RED: Invalid code, Already redeemed, Eligibility failed, Campaign suspended or blocked (and any other hard failure, including a cancelled reservation). The result matrix in section 5 is updated to match; the app (`toneOf` in `apps/staff/features/redeem.tsx`) and the history chips use the same mapping.
2. **Redeem confirmation is a mobile bottom sheet.** Valid → **Redeem** → bottom sheet (offer, benefit, customer first name, branch, reference, irreversible warning) → **Confirm redemption** → success. The sheet locks while the request runs; a rapid second tap sends nothing (one Idempotency-Key per attempt).
3. **Not valid yet is its own result** (amber, never offers Redeem) and shows when it starts. It is no longer folded into \

| # | Decision | Effect in this document |
|---|---|---|
| 1 | **Staff sign-in is mobile OTP only for MVP.** The authentication provider must remain **configurable** (provider abstraction). | S-02 closed |
| 2 | **Session = one working shift** as the initial concept; exact duration **configurable**. | S-01 closed |
| 3 | **History:** frontline staff see only the **recent operational validation/redemption history needed for their work**. Full historical reporting remains with authorised Merchant roles and DealDash Admin. | S-03 closed; T05 limited to recent window (configurable) |
| 4 | **Feedback:** haptic and/or sound where supported; **never rely on sound or haptics alone**; every validation result keeps an obvious visual status. | S-04 closed |
| 5 | **Value display:** show the voucher/offer/reservation benefit needed to complete the redemption. **Do not expose merchant revenue, settlement values or unrelated finance information.** | S-05 closed |
| 6 | **No-show wording:** neutral operational language, **"Reservation not completed"**, never accusatory customer-facing wording. | S-06 closed; result title changed |
| 7 | **OTP:** SMS is the MVP staff authentication channel; provider abstraction; rate limits, resend limits and abuse controls. **Final Saudi SMS/provider requirements: VALIDATE-KSA.** | S-07 closed except VALIDATE-KSA |
| 8 | **VALIDATE-KSA stays open** for: SMS/OTP rules, device/location audit capture, retention periods. | Section 14 |

Staff design is **structurally frozen for MVP**. Visual, device, network and Arabic QA are later tasks and do not block the next portal.

---

## 1. STAFF ROLE AND PERMISSIONS

| Aspect | Rule |
|---|---|
| Who | A person invited or created by an **approved, active merchant** (by Owner, Admin or Branch Manager). Belongs to one merchant; assigned to **one or more branches**. |
| Sign-in | **Mobile number + one-time code (OTP)**. No password. Session lasts a configurable shift length and is revoked immediately when the person is deactivated. (Email as an alternative identifier is not offered in MVP: decision S-02.) |
| Can | Scan or enter a code, see the validation result, redeem, view **today's** redemptions and rejected checks **for their assigned branches**, view their own account and contact help. |
| Cannot | See finance, statements, bank details, campaigns, settings, team, analytics or customer profiles; create or edit anything commercial; **reverse a completed redemption**. |
| Reversal | Only an **authorised Merchant Manager (Owner, Admin, Branch Manager by permission)** in the Merchant Portal, or **DealDash Admin**, within the configurable window, with a mandatory reason and full audit (RD-40). Staff screens say "Ask your manager". |
| Branch scope | Validation succeeds only at branches the instrument allows; staff redeem only at their assigned branch(es). A staff member with several branches picks the current branch once per session (branch chip in the header). |
| Suspended merchant / deactivated staff | Sign-in or next action shows "Access ended" and contacts support. Existing customers are handled through the admin resolution workflow, not by staff. |

---

## 2. NAVIGATION

Minimal. **Three bottom actions: Scan · History · Account.** No sidebar, no menus, no settings. The Scan tab is the app's home. Header shows the DealDash wordmark, merchant name and branch; a help button opens a small help sheet. The confirm step is a bottom sheet over the result, not a separate page.

---

## 3. FINAL CORE SCREEN INVENTORY (6)

| # | Screen | Purpose | Variants and overlays (not counted as screens) |
|---|---|---|---|
| **T01** | **Sign in** | Mobile number → one-time code | Enter number · Enter code · Wrong code (tries left) · Expired code (new one sent) · Too many attempts · Resend with timer · **No branch assigned / access ended** · Invited-by banner |
| **T02** | **Home / Scanner** | Start every redemption. Camera opens immediately | Scan QR (default) · **Manual code sheet/page** · Camera permission off · Torch toggle · Help sheet · Connection banner |
| **T03** | **Validation result** | One adaptive screen for **every** outcome | **Valid · Invalid · Expired · Already redeemed · Wrong branch · Eligibility failed (only where rules require) · Reservation expired · Reservation not completed · Not valid yet · On hold / refunded / cancelled** |
| **T04** | **Confirm & success** | Final confirmation and result of redeeming | **Confirm sheet** → **Processing (locked)** → **Success** · Failure (retry-safe) · Duplicate caught |
| **T05** | **Today / History** | What was redeemed or rejected today at my branch(es) | All · Redeemed · Rejected filters · Search by code/reference · **Detail sheet** (read-only) |
| **T06** | **Account & help** | Who am I, where, language, sign out, contact manager | Language switch (EN/AR) · Help & contact · Sign out |

Compared with the earlier plan (T01–T06) the confirm sheet and success are now one screen with states (T04) and Account/Help are merged (T06); the count stays **6**.

---

## 4. SCAN → VALIDATE → REDEEM JOURNEY

```
Open app (signed in, branch set)
   │
T02 Scanner opens instantly ── or ── Enter code manually
   │  QR recognised / code submitted  (server validation, one request)
   ▼
T03 Result (one screen, colour-coded)
   ├─ VALID ─────────► [Redeem] ──► T04 Confirm sheet ──► [Confirm redemption]
   │                                      │ button locks; "Redeeming…" (idempotent)
   │                                      ▼
   │                                T04 Success  "Redeemed" · time · reference
   │                                      ├─ [Scan next] ► T02
   │                                      └─ [View details] ► T05 detail sheet
   └─ ANY OTHER RESULT ─► [Scan next] (or Enter code / Contact manager) ► T02
```

**Three taps for the happy path:** Scan → Redeem → Confirm. Then Scan next.

Principles: the result colour and icon fill the top third so staff understand it at arm's length; one sentence explains it; details appear only when they help; the primary button is always the next sensible action; the destructive-feeling action (Redeem) is green and only appears for Valid.

---

## 5. ADAPTIVE VALIDATION RESULT MATRIX (T03)

Same layout for all outcomes: coloured header (icon, title, one sentence) → details card → buttons. Colours are restrained functional states with white text meeting contrast: **green = success, amber = recoverable / informational, red = hard failure** (see the final decisions above); every state also has an icon and words.

| Result | Header | What it means | Details card | Primary / secondary action | Rule |
|---|---|---|---|---|---|
| **Valid** | Green · check | Redeemable here, now | Item, type (Voucher / Reservation / Prize / Controlled deal), merchant, **customer first name**, value/benefit, valid until, branch | **Redeem** / Cancel | RD-01..07 |
| **Invalid** | Red · x | Not a DealDash code for this merchant | None ("No details to show") | **Scan next** / Enter code manually | RD-05 |
| **Expired** | Amber · clock | Past validity | Item, expiry date | Scan next / Contact manager | RD-05, VC-33 |
| **Already redeemed** | Red · alert | Used earlier | Item, **when and where it was redeemed** (own merchant only), first name | Scan next / Contact manager | RD-21 |
| **Wrong branch** | Amber · pin | Valid at other branches | Item, **the branches where it works** | Scan next / Contact manager | RD-20, RS-12 |
| **Eligibility failed** | Red · ban | Only for **free restricted offers or reservations** whose rules require current eligibility. **Never shown for a paid voucher bought while the customer was eligible** | Item, what is needed ("Verified employee"), no personal data | Scan next / Contact manager | RD-30 |
| **Reservation expired** | Amber · clock | The hold timed out | Item, hold end time | Scan next | RS-05 |
| **Reservation not completed** | Red · ban | The reservation is no longer available (released, cancelled or counted as not completed). **Neutral operational wording; no accusation** | None | Scan next | RS-10 |
| **Not valid yet** | Amber · clock | Campaign or reservation starts later | Start time | Scan next | RD-05 |
| **On hold / refunded / cancelled / suspended** | Red · lock | Cannot be redeemed; reason not detailed to staff | None | Contact manager | RD-05 |

Notes: unknown vs expired vs wrong merchant must not leak information about other merchants (an instrument from another merchant shows **Invalid**). Every validation attempt, whatever the result, is audit-logged with staff, branch, device and time.

---

## 6. REDEEM CONFIRMATION AND SUCCESS (T04)

**Confirm sheet** (over the Valid result): "Redeem this voucher?" · item and type · merchant and branch · customer first name · value/benefit · note "This cannot be undone by staff." · **Confirm redemption** (green, 56 px) · Cancel.

**Processing:** the sheet is replaced by "Redeeming… Please wait. Do not tap again." The button is disabled and the request carries a one-time **idempotency key**, so a second tap or a retry can never redeem twice; if the response is slow the app keeps asking the server for the outcome of the same key.

**Success:** large green check, **Redeemed**, "Handed over successfully", item card with customer first name, **time** and **reference (e.g. RD-48210)**; **Scan next** (primary) and **View details**.

**If it fails:**

| Case | Behaviour |
|---|---|
| Server says already redeemed (race with another device) | Switches to the **Already redeemed** result with time and place |
| Network lost mid-request | Shows "Checking…", then either Success (if it went through) or **No connection** with Retry (same key). Never shows Success without server confirmation |
| Server error | "Something went wrong. Nothing was redeemed" or "Already redeemed" after checking; Retry; contact manager |

---

## 7. TODAY / HISTORY (T05)

- Header chips: **Redeemed 27 · Rejected 3** (today, my branch).
- Segmented filter **All · Redeemed · Rejected**; search by code or reference; list rows: result icon, item, first name, time.
- **Detail sheet (read-only):** item, first name, time, reference, branch, result; banner "Staff cannot reverse a redemption. Ask your manager." No money, no customer profile, no settlement.
- Scope: own branch(es), current day by default; "Yesterday" available for disputes `[CFG: staff_history_days]`.
- Rejected checks show the reason in plain words (Wrong branch, Already redeemed, …) to help resolve counter conversations.

---

## 8. ERROR / FAILURE STATES

| State | Screen / treatment |
|---|---|
| Wrong OTP | Red boxes, cleared, "That code is not correct." (never a tries-left count) |
| Expired OTP | Amber banner "The code has expired. Request a new one." with **Send a new code** |
| Too many OTP attempts / SMS pumping control | Lockout message with retry time (FR-02) |
| No branch assigned / access ended | Full-page explanation, **Contact support** (T01) |
| Camera permission off | Full-page card with **Allow camera** and **Enter code manually** (T02) |
| Unreadable QR | Gentle hint under the frame; manual entry always available |
| Manual-code rate limit | "Too many tries. Wait a minute." (5 per minute per device `[CFG]`) |
| **No connection** | Amber banner at the top; full-page message **"We cannot safely redeem without a connection. Your scan is saved. We will check again when you are back online."**; saved code and time shown; **Try again** enabled; **Redeem disabled** |
| Slow connection | "Checking…" with a timeout; no duplicate submit |
| Session expired | Return to sign-in; saved scan can be re-validated after login |
| Merchant suspended | "Access ended" (T01) |

**Offline behaviour (MVP):** online-first. **No offline redemption.** The app may remember the last scanned code and retry **validation** when the connection returns, but a redemption is only ever confirmed by the server. True offline redemption is **Phase 2/3** (RD-54).

---

## 9. SECURITY AND PRIVACY RULES

**Staff see only what is needed to validate and redeem:** item name and type, merchant and branch, **customer first name only**, value/benefit, validity, and result reasons.

**Never exposed to staff:** full name, phone, email, date of birth, employer or work email, card or issuer details, reward balance, other transactions, financial figures, other merchants' data.

| Control | Rule |
|---|---|
| OTP sign-in | Rate-limited, expiring, single-use, SMS cost controls; sessions bound to device and revocable |
| One-time redemption | Atomic server-side state change with idempotency key; duplicate taps return the original result |
| Branch and merchant scoping | Every request is checked against staff's merchant and branch assignment |
| Audit | Every **validation and redemption attempt** (success or failure) is logged: instrument, result, staff, branch, device, time, location if permitted (RD-51, AU-08) |
| Manual-entry abuse | Rate limits, anomaly flags (FR-06, FR-07, FR-12) |
| QR sharing | Codes are single-use; screenshot sharing is mitigated by one-time use now and rotating QR later (P2) |
| No "use latest code" shortcut | Removed from the old console design (S59) |
| Screen privacy | Result screens avoid showing full codes; session timeout; no data stored on device beyond the last saved scan |
| Reversal | Not possible for staff; manager and DealDash flows are audited |
| Reporting suspected misuse | Contact manager / support; DealDash risk queue receives the signals |

---

## 10. RESPONSIVE / MOBILE BEHAVIOUR

| Topic | Spec |
|---|---|
| Primary target | Phones 360 × 640 up to 430 × 932, portrait, **one-handed use**: primary actions in the bottom third, 56-px buttons, 44-px minimum touch targets, 16-px side padding |
| PWA | Add-to-home-screen, full-screen, fast start, camera access via browser, wake-lock while the scanner is active, vibration/sound feedback on result (configurable) |
| Scanner | Camera starts on app open; rear camera; torch toggle; visual frame with scan line; auto-detect; manual entry one tap below |
| Tablet / counter terminal | Same screens centred in a 480-px column, or a two-pane layout (scanner left, result right) for countertop tablets (optional; not a separate design) |
| Orientation | Portrait first; landscape tablet supported by the centred column |
| Typography | Result titles 26–30 px / 800; body 14–16; code and reference numerals tabular |
| Contrast | Result headers: white on `#0E8F6A` (green), `#C9213D` (red), `#B26B00` (amber), `#4B4E75` (grey) all meet AA for large text; details cards navy on white |
| Weak networks | Small payloads; explicit loading states; timeouts with clear messages; no optimistic success |

---

## 11. RTL BEHAVIOUR (Arabic and English)

- Full mirror: header content, back arrows, list chevrons, button icon order, bottom bar order, bottom-sheet layout and key/value rows.
- **Do not mirror:** the camera frame and torch icon, QR codes, numbers, codes and references (always left-to-right islands), phone numbers, OTP boxes (digits stay left-to-right).
- Plus Jakarta Sans for English, **IBM Plex Sans Arabic** for Arabic; Western digits (decision D10); Arabic line height +10–20%.
- Currency "SAR" is shown as a left-to-right token next to the amount.
- Arabic strings in the mockup are **placeholders**; native review required before launch.
- Result colours, icons and layout are identical in both languages so staff can switch without relearning.
- Mixed text (e.g. English merchant names inside Arabic sentences) must render in correct bidirectional order.

---

## 12. REUSABLE COMPONENTS (Staff)

| Component | Spec |
|---|---|
| App header | Wordmark, merchant name, branch chip, help button |
| Stat tiles | Two tiles (Redeemed, Rejected) |
| Scanner viewport | Rounded dark camera area, corner brackets, scan line, hint text, torch/help buttons |
| Primary / secondary / success buttons | 56-px pill buttons (purple primary, green confirm, lilac tonal, outline), 44-px compact variant, disabled state |
| **Result header** | Full-width coloured block with icon circle, title, one sentence; four colour variants |
| Details card | Item row with thumbnail and key/value rows |
| Bottom sheet | Grab handle, 28-px top radius, scrim; used for confirm, details, help, manual code (optional) |
| Field and OTP boxes | 56-px fields, six OTP boxes with focused/error states |
| Banners | Amber connection banner, info banner, error/expired banners |
| Segmented filter, search pill, history list row | History screen |
| Bottom bar | Scan · History · Account |
| States | Loading ("Redeeming…"), offline, permission-off, no-access |

All components share the Merchant Portal tokens (navy, purple, lilac, rounded cards, Plus Jakarta Sans). The Staff app has no gradient hero and no tables.

---

## 13. TRACEABILITY

| Earlier item | Now |
|---|---|
| SA-01 | T01 |
| SA-02, SA-03, SA-05 | T02 |
| SA-04 | T02 |
| SA-06 to SA-13, SA-20, SA-21 | T03 (and T01 for access ended, T02 for offline banner) |
| SA-14, SA-15 | T04 |
| SA-16, SA-17 | T05 |
| SA-18, SA-19 | T06 |
| SA-22 (employee pass check) | Phase 2 |
| Staff reversal request | Phase 2 (staff cannot reverse; manager or DealDash does) |

---

## 14. FOUNDER DECISIONS (all closed) AND VALIDATE-KSA ITEMS

| # | Item | Default used |
|---|---|---|
| S-01 | Session length | **Closed:** one working shift, duration configurable |
| S-02 | Sign-in identifier | **Closed:** mobile OTP only; provider configurable |
| S-03 | Staff history window | **Closed:** recent operational history only; full history via Merchant/DealDash roles |
| S-04 | Haptic/sound feedback | **Closed:** where supported, never the only signal |
| S-05 | Value display | **Closed:** benefit needed to redeem; no revenue/settlement/finance |
| S-06 | Wording for no-show results at the counter | **Closed:** "Reservation not completed" |
| S-07 | OTP channel | **Closed:** SMS with provider abstraction, rate/resend limits; Saudi requirements VALIDATE-KSA |
| VALIDATE-KSA | SMS/OTP rules, device and location data capture for audit, retention of redemption logs (VK-15) | Placeholders |

---

## 15. OPEN QA ITEMS (visual / real-world)
- Test the scanner on real mid-range Android and iPhone browsers (lighting, glare, focus speed, PWA camera permissions).
- Verify result colours and contrast outdoors / in bright restaurants.
- Arabic native review; right-to-left real-device check.
- Weak-network testing for the double-submit protections.
- Counter-tablet layout check.

*End of Merchant Staff design v0.1. No production code.*
