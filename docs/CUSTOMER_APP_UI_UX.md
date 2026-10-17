# Customer App UI/UX — Founder approved

**Status: FOUNDER APPROVED (2026-10-16).** The final Customer App UI/UX below is the reference for the customer app. Do not start
another redesign; changes need a new founder decision. Business rules are unchanged by this work except where a rule is recorded
in `DEALDASH_BUSINESS_RULES.md` (RC-97, RC-98, RC-99, founder UAT finding of the same day).

## Locked product names (customer-facing)

1. **Live Deals**
2. **Exclusive Deals**
3. **Vouchers**
4. **Watch & Earn**
5. **Rewards**

Never use "Live Offers" or "Hot Deals" in customer-facing copy (internal code names such as `hot` are not customer-facing).

## Home: approved layout and order

1. Header: DealDash wordmark with the tagline "Discover Deals. Watch. Get Rewarded.", notification bell with the unread count
   (opens My Deals → Updates), My Deals, language; beneath, the location pill and the greeting chip (initials, "Hi <first name>",
   points balance, chevron into Profile; a guest sees "Sign in").
2. Search.
3. Shop by Category (photo / colour tiles with count badges, horizontal scroll).
4. Browse Offers By: All / By card / By employer / By brand, plus All offers / New offers / Ending soon. These open the existing
   Explore views and sorts; eligibility stays with Explore and the API (nothing is filtered on Home).
5. Hero (photo, location, Live Deals count, "Explore deals").
6. Live Deals Near You.
7. Exclusive Deals.
8. Watch & Earn.
9. Vouchers ("Buy now. Use later.").
10. Rewards card.
11. Ending Soon, only for offers not already on the page.

**Compact discovery carousels** (Live Deals, Exclusive Deals, Watch & Earn, Vouchers, Ending Soon): up to five image-led cards,
about two and a half visible with the next card peeking, smooth horizontal swipe, compact metadata (`.dd-rail`, `RAIL_SIZE` in
`apps/customer/features/presentation.ts`). The same offer never appears twice on Home: by id, and by merchant + title for
duplicated records. A section with nothing right now keeps its heading and See all with a short note.

Exclusive Deal cards show how the customer reserves: **Pay & Reserve** (paid reservation), **Free reservation**, or walk-in.
Watch & Earn cards show the reward proposition ("Watch 12s · earn points"), the points and the distance.

## Watch & Earn instant prizes and favourites (founder approved 2026-10-17)

FDR-19 instant probabilistic prize allocation (rules WE-80, WE-81, WE-82). Approved presentation, 320 / 390 / 412 px, English and
Arabic:

- **Cards:** immersive, image-led cards with a favourite heart, watch duration, merchant and distance. A prize campaign shows the
  orange / yellow pill "Instant reward chance" (or "Instant reward" only when every qualified view wins) with the points beside it;
  a points-only campaign shows its points pill. On the two-column Watch & Earn page a long pill wraps inside the card.
- **Outcome:** points always; then "You won!" with the prize, validity, branches, QR and manual code, or "No prize this time. Your
  points are yours."
- **Winner notification:** one in-app `PRIZE_WON` notification (shared engine) naming the prize and merchant with "Valid until …
  · View prize"; it opens the prize under Rewards (`/rewards/prizes/{id}`).
- **Rewards → Your prizes:** each prize with its status and View prize; the prize page shows the redemption credential (QR,
  manual code, reference) that staff redeem in the normal staff flow.
- **Favourites:** Watch & Earn campaigns can be saved and appear under Saved.

Review set: `node tooling/e2e/watch-prize-review.mjs` -> `docs/screenshots/watch-prize-review/` (development demo campaign only).

## Information architecture decision

**My Vouchers → Profile** (founder approved 2026-10-16). My Vouchers is reached from the Profile menu ("My Vouchers", under
Account settings) and opens `/my-vouchers`. The header carries the notification bell and My Deals instead.

## Reservations in the customer app

- **Free Reservation** (only where the reservation policy allows it): detail → "Reserve this offer?" (it is free, hold time) →
  confirmation "It is free…" → ticket with countdown → QR and manual code for staff.
- **Paid Reservation / Pay & Reserve**: detail with amount and terms → Review and pay (amount charged now, refund rule, whether a
  deposit is credited to the bill or is a booking fee, cancellation cut-off, payment window, hold time, branch) → explicit acceptance
  of the terms → payment page → confirmation "Payment received and your unit is secured" → ticket with countdown → credential.
  Cancellation and refunds show on the ticket. A paid reservation is never a Voucher.

## Visual language

White / very light lavender surfaces, deep navy text, DealDash purple actions, rounded cards with restrained shadows, image-led
merchandising, Arabic right-to-left, verified at 320 / 390 / 412 px. A merchant's own media is always shown unchanged; a card
without media shows category art in production. Development review only (`next dev`) shows approved brand-free photography for
seed placeholders (`presentation.ts`).

## Development-only demo data

`pnpm --filter @dealdash/api db:dev:demo` (`apps/api/prisma/dev-demo.ts`) adds, to a development database only, demo Exclusive
Deals (free and paid reservation examples with limited stock) and funded Watch & Earn campaigns on the seeded fictional demo
merchants, so the carousels and both reservation journeys can be reviewed. It refuses to run outside development, is idempotent,
marks every item as a development demo, and never touches users, passwords or other business data. It creates no production data.

## Review screenshots

`node tooling/e2e/founder-review.mjs` (API and customer app running in development) captures the review set from the running app
into `docs/screenshots/founder-review/` (regenerable, not kept in Git).
