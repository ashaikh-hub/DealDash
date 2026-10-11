# DealDash — User Acceptance Test Plan

Stage 9. UAT has **not started**: it needs a staging environment (hosting not selected) and provider sandboxes. Everything below is
ready to run once staging exists. Automated coverage of the same journeys already passes locally (see the Stage 9 readiness doc §Tests);
UAT is people confirming the product does what the business needs, in English and Arabic, on real devices.

## 1. Entry criteria
- Staging deployed from a release tag; migrations rehearsed on a restored copy (runbook §6).
- Provider sandboxes connected (payment, SMS, email at minimum) **or** development adapters with `ALLOW_MOCK_PROVIDERS=true`
  (then payment / SMS steps are marked "simulated").
- An approved KSA settlement rule exists in staging (B1 — uses **placeholder values** agreed for UAT; not a regulatory answer).
- UAT accounts per role created by engineering; pilot merchants' sample data loaded (no real customer data).
- Native Arabic reviewer available for the Arabic passes (B5).

## 2. Participants (founder assigns names)
| Role | Covers |
|---|---|
| Founder / product owner | Final sign-off; business rules; pricing and commercial terms |
| Operations lead | Admin operations, cases, restrictions, launch controls |
| Finance lead | Payments, refunds, settlements, payouts, reconciliation, invoices |
| Merchant representatives (2–3 pilot merchants) | Merchant portal, staff redemption |
| Partner representative | Partner portal |
| Customers (5–10 recruited testers) | Customer app on their own phones |
| Native Arabic reviewer | Arabic copy and RTL layouts |

## 3. Scripts
Each script: steps, expected result, pass / fail, evidence (screenshot), defect id. "EN" and "AR" passes are separate runs.

### Customer (phone)
- **C1 Sign-in:** request OTP, receive SMS, sign in; wrong code; resend after cooldown; sign out. *Expected:* clear errors, no attempt count revealed.
- **C2 Discovery:** city, categories, search, filters, deal detail, map distance, location denied → still usable.
- **C3 Live Deal:** claim / show code; staff validates (S2).
- **C4 Exclusive Deal:** reserve a unit at a branch; hold timer; cancel; reserve again; staff redeems; no-show rule after expiry.
- **C5 Voucher purchase:** buy with sandbox card; 3-D Secure; failure and retry; wallet shows the voucher; gift / redeem.
- **C6 Refund:** request a refund; partial refund approved by admin; **points earned on the order reverse proportionally (B4)**.
- **C7 Watch & Earn:** watch, "still watching?", points credited once; daily caps.
- **C8 Rewards:** balance, history, redemption of points where configured.
- **C9 Help and cases (B6):** open a request; DealDash asks a question → customer sees it in *My requests*, replies with a reference;
  case returns to DealDash; card number in a reply is refused.
- **C10 My data:** export request; deletion request (explains what must be kept); a **legal hold** blocks deletion (ops places it).
- **C11 Arabic:** repeat C1–C10 in Arabic: layout right-to-left, numbers and currency, no English leftovers, no clipped text.

### Merchant and staff
- **M1 Onboarding:** sign-in with MFA; profile; branches with map location; documents.
- **M2 Live / Exclusive Deals:** create, submit for review, edit after changes requested, go live, pause, sold out.
- **M3 Vouchers:** create a voucher product; stock; pricing.
- **M4 Commercial:** quotation acceptance, funding, credit; subscription plan and usage.
- **M5 Operations:** inbox, cases with DealDash, reply to a request (shared note), activity.
- **M6 Settlements:** statements, reserve lines, payout status (manual reference / provider).
- **S1 Staff sign-in** by OTP on a branch device. **S2 Redemption** by QR camera and manual code; wrong branch; already used; reversal within the window.

### Partner
- **PA1** Sign-in; **PA2** add a merchant (market list loads first — B8 fix); **PA3** network view, tasks, Watch & Earn campaigns; **PA4** users and roles.

### DealDash admin
- **A1 Approvals:** deals, merchants, campaigns; maker-checker (the requester cannot approve).
- **A2 Cases:** route, assign, ask the customer (C9), ask the merchant (M5), resolve, approval above threshold.
- **A3 Refunds and adjustments** with approval thresholds.
- **A4 Settlements (B1/B2):** run with the approved rule (cut-off, reserve, release, tax line); a finance approver who did not prepare
  the statement sends the payout; failed payout retried within the limit; paid with a bank reference; reversal.
- **A5 Reconciliation:** import a sandbox statement; breaks resolved.
- **A6 Rules and controls (B7):** propose a change (reasons, SLA, approvals, risk, notifications, reviews, platform limits) → second
  person approves → applied; scheduled change; stale proposal refused; rollback from history.
- **A7 Launch controls:** pilot allowlist (only listed merchants visible / able to launch); emergency stop of new purchases in KSA →
  checkout refused, wallet intact → lift with reason.
- **A8 Restrictions, fraud review, moderation, notifications delivery, SLA, reports.**
- **A9 Privacy:** data requests; legal hold placed and lifted by a different person.
- **A10 Arabic** pass of A1–A9 (admin is used in both languages).

### Cross-cutting
- **X1 Devices:** run C1–C7 and S1–S2 on the device matrix (§4).
- **X2 Accessibility:** keyboard-only pass of the customer checkout and admin case screens; screen reader spot checks (VoiceOver iOS, TalkBack Android).
- **X3 Notifications:** every notice arrives once, in the user's language, with the right link; throttling (20/hour default) and quiet behaviour.

## 4. Device matrix (to execute — **no physical device testing has been performed**)
| Device class | OS / browser | Apps |
|---|---|---|
| iPhone (current and previous generation) | iOS latest, Safari | Customer, staff |
| Mid-range Android (popular in KSA) | Android 13+, Chrome | Customer, staff |
| Low-end Android | Android 11+, Chrome | Customer |
| iPad / Android tablet | Safari / Chrome | Staff at the counter |
| Laptop | Windows / macOS, Chrome, Edge, Safari | Merchant, partner, admin |
Done so far (automated, not a device test): headless Edge (Chromium) at desktop widths and phone widths (390 px, 320 px reflow) in
English and Arabic.

## 5. Defects
S1 blocks a journey or risks money / data → fix before sign-off. S2 workaround exists → fix before go-live or founder waiver. S3 cosmetic
→ backlog. Arabic copy defects are fixed through the translation CSV (B5), not by editing dictionaries by hand.

## 6. Exit criteria
All scripts executed in EN and AR; no open S1; S2 fixed or waived in writing by the founder; native Arabic review complete for pilot
screens; device matrix executed; finance signs A4/A5; operations signs A2/A6–A9; founder signs the UAT summary.
