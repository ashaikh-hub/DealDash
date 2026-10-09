# Subscription / Licensing — Figma handoff

Built screens to be reflected in Figma (the build is the reference; components are the existing `@dealdash/ui` set: Card, KeyValue,
StatusChip, Alert, Tabs, Field / Input / Select / Checkbox, tables, EmptyState / LoadingState). Screenshots:
`docs/screenshots/subscription/` (produced by `tooling/e2e/subscription-browser.mjs`). Copy: `packages/localization/src/dictionaries.subscription.ts`
(English + working Arabic; native review required).

## Merchant portal — Plan and usage (`/[locale]/plan`)

Navigation item "Plan and usage" (after "Commercial terms"); visible with `merchant.subscription.read` (Owner, Admin, Finance; not campaign
managers or staff).

Frames (desktop 1280 and phone 390, English and Arabic RTL):

1. **Header** — title, one-line explanation (invoices live in Finance).
2. **Pending agreement** (only when DealDash assigned a paid plan) — plan, kind, price, one-off fees (indicative shown as "Agreed with
   DealDash"), **maximum commitment**, explicit confirmation checkbox, Accept (disabled until confirmed). Non-authorised users see
   "Only an authorised person of your business can accept."
3. **Default plan / ended** notices.
4. **Current plan card** — plan name, lifecycle chip (tones: Active success, Trial info, Waiting / Payment overdue warning, Suspended
   danger, Cancelled / Expired neutral), price (`PKR 4,999.00 / Monthly`; Free; No charge; Agreed with DealDash), renewal, next renewal, in
   force since / ends on, commercial status chip; trial banner; grace (warning), suspended (danger, states what customers keep), financial
   hold (danger) banners; "Invoices… are in Finance".
5. **Usage** — one meter per limit: label, "6 of 7" (Western digits in Arabic: "6 من 7"), period, bar (success < first warn threshold ≤
   warning < 100 % ≤ danger), mode caption (Hard / Soft limit). Unlimited shows text, no bar.
6. **What is included** — product chips, feature chips, limits list with provenance ("5 in the plan, 2 from add-ons").
7. **Add-ons** and **Promotions and adjustments** side by side (stack on phone).
8. **Changes waiting** — per amendment: type, status chip, impact block, Accept and apply / Cancel.
9. **Change plan** — plan cards (name, price or "Agreed with DealDash", "Your plan" chip, negotiated plans say "Contact DealDash" with no
   button); after "See the difference": When (Immediately / From the next billing cycle) + **impact block**: new price, price change
   (+/−), date, You gain, You lose, limit changes "Branches: 25 → 5"; blocked downgrade alert with the excess per limit and remedies; Request
   this change (disabled while blocked for an immediate change).
10. **Why is something unavailable?** — action select, Check, Allowed / Not available chip, the checks (✓ / ✕) and "What helps".
11. **Plan history** — amendments and previous agreements table.
12. **Stop renewal** — explanation, reason, confirm.

## Admin portal — Subscriptions (`/[locale]/subscriptions`)

Navigation item "Subscriptions" (after "Commercial"); `admin.subscriptions.read`. Tabs:

1. **Agreements** — filters (kind, status), Assign a plan (business ID, plan, market, trial days, post-trial plan), table (business,
   kind, plan, status, billing, renewal, from; "Test fixture" chip). **Agreement detail / enterprise view**: header key-values (kind, plan +
   version, status, agreement version, market + currency, billing cadence, renewal, dates, Business Account, billing party legal entity,
   covered legal entities, account manager, support level, commercial status); Terms and price (price, **pricing version key**, fees);
   Usage meters; Lifecycle (note that suspension blocks new exposure only; reason; Mark payment overdue / Suspend / Reinstate / Cancel
   (approve) / Accept on behalf / Renew now; renewal select); Entitlements table (source, item, value, from, until; ended rows dimmed);
   Negotiated rates (+ form, approve); Promotions (+ form, approve); Changes (list + propose form: type, target plan / override key & value,
   forced checkbox, reason, Preview impact, Propose); Acceptances (immutable); Explain.
2. **Plan catalog** — card per plan: name, code, kind chip, Free / Negotiated chips; versions table (market, version, status, prices,
   from, until, Publish (second person) / Retire); New plan; New draft version form.
3. **Price book** — item rows with market versions (status, price / range / %, indicative marker, reference, Publish, New price version).
4. **Add-ons** — name, code, effect ("Branches +1 each"), offered on, price item.
5. **Changes** — status filter (default "Waiting for acceptance"); amendment cards with impact; Apply (second person) for DealDash-only
   changes, Accept on behalf, Reject with reason.
6. **Billing events** — note (Phase 5 invoices them; funding is never DealDash revenue), status filter, table (type, revenue category,
   amount, status, pricing version, when).
7. **Signals** — note (Phase 4 alert engine), table (signal, business, waiting / taken, when).
8. **Readiness** — note, Run scheduled pass now, list of businesses without an agreement.

## States to design

Loading, empty, error banner (translated error code), success banner, disabled actions (reason required, not confirmed, blocked downgrade),
read-only (no manage / approve permission: no action controls), Arabic RTL mirroring with Western digits and LTR codes (plan codes,
pricing version keys, IDs).

## Out of scope here

Invoices, statements, payments, credit notes (Phase 5); alerts (Phase 4); Partner Portal subscription screens (Stage 7).
