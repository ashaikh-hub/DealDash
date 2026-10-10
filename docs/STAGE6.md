# Stage 6: Watch & Earn and Rewards

Status: built and verified, waiting for approval. Not in this stage: Partner Portal functionality, Play & Win, Stage 7.

## What it is

Watch & Earn is an advertising / reward campaign domain of its own (not a Live Deal, Exclusive Deal or Voucher). A merchant buys **paid qualifying views** of a short video from a pre-funded budget. A customer watches the video and earns **reward points**. DealDash alone controls the reward, the qualifying rules, the fraud rules and the economics. Rewards are a **non-cash, non-withdrawable, non-transferable** points ledger; no SAR value is configured or shown anywhere.

| Merchant controls | DealDash controls |
|---|---|
| video, bilingual text, button destination, cities, eligibility, time of day, schedule, number of paid views (so budget), repeat window (only equal or stricter) | rate card (price per verified view), reward rule (points by video length), qualifying policy, still-watching check, daily / device / account limits, fraud rules and thresholds, hold period, reward catalogue, expiry |

There is **no reward field** in any merchant request or screen (tested). Nothing commercial is hard-coded: every value above is versioned configuration (`watch.*`, `rewards.rules`), all mock defaults.

## Campaign lifecycle

`DRAFT -> PENDING_REVIEW -> (NEEDS_CHANGES -> PENDING_REVIEW) -> SCHEDULED | LIVE -> PAUSED / SUSPENDED / COMPLETED / EXPIRED / CANCELLED`, `REJECTED` is final. Every transition goes through one `transition()` (conditional update, history row, audit row). After approval only wording and the cover image can change (material changes are refused). The sweep job activates scheduled campaigns, expires finished ones, completes exhausted ones, closes sessions that were abandoned, releases held rewards and expires points (when enabled).

## Funding and budget (no overspend)

Budget = paid views x rate card. It must be fully added before a campaign can be sent for review (HTTP 402 `FUNDING_REQUIRED` otherwise). In development the payment is simulated (`MOCK_PAYMENT`); a real provider plugs in behind the same journal. Every money movement is a balanced, idempotent ledger journal:

| Event | Journal | Lines |
|---|---|---|
| funding | `CAMPAIGN_FUNDING` | PSP clearing (debit) / campaign budget (credit) |
| qualified view | `CAMPAIGN_CONSUMPTION` | campaign budget (debit) / platform side (credit), one per view |
| billed view found invalid | `CAMPAIGN_CREDIT_BACK` | exact reverse of the consumption journal |
| close-out | `CAMPAIGN_RELEASE` | campaign budget (debit) / campaign unused (credit), once |

Safety, all enforced by the database and tested: spend is moved by ONE conditional `UPDATE` (`spent + charge <= funded AND qualified < paid AND status = LIVE`); `CHECK` constraints refuse overspend and views above the paid quantity; funding cannot exceed the budget and is idempotent per key; a view is charged at most once (unique journal id) and rewarded at most once (partial unique index on source + type). A 14-way concurrent completion test delivers exactly the paid views, caps the rest, completes the campaign and leaves a balanced ledger.

**Unused budget** is closed out to its own ledger family (`CAMPAIGN_UNUSED`) exactly once and shown separately everywhere. What happens to it (refund, carry forward, retain) is **not decided** (`watch.unused_budget_treatment = UNDECIDED_VALIDATE_KSA`). The Admin "credit a merchant's budget" idea was dropped: under a hard cap it can never apply.

## Qualifying-view pipeline (the server decides)

1. `POST /app/watch/views` checks availability (LIVE, schedule, time window, merchant active), targeting (city + eligibility), budget left, blocks, device / account caps, repeat window and daily cap, then creates ONE open session (a database unique index; starting another video closes the first) and returns a random viewing token (only its hash is stored), the signed video URL and the heartbeat interval. **No threshold is ever sent to the client.**
2. `POST .../events` (header `x-view-token`) takes batched events (heartbeat, background, foreground, prompt answer). Time is stamped by the server. Watched seconds can never exceed elapsed server time, a jump (seek) earns nothing, credit per event is capped, background longer than the grace period invalidates, and a server-scheduled still-watching prompt must be answered in time. Configurable: off by default for short videos, `RANDOM` or `ALWAYS`.
3. `POST .../complete` locks the view row and requires: valid unexpired session, enough real watched time (configurable percent or seconds), prompt passed when required, campaign still LIVE, repeat window and daily cap re-checked, risk screen not BLOCK. Then, in one transaction: budget consumed, view marked qualified, reward written, notification created. A repeated or concurrent completion returns the stored outcome and changes nothing.

Customers only ever see a reason class (left the app, not watched to the end, no confirmation, already earned, daily limit, no longer earning, not available, other). Detection logic is Admin-only.

## Fraud and risk (rule based, no ML)

Signals with configurable weights: blocked account or device, many accounts on one device, new-account burst, impossible timeline, automation-like regularity, prompt answered too fast, view velocity, daily-cap streak, repeat on the same device. Score thresholds give `ALLOW` / `HOLD` (reward held, auto-released after the hold period) / `FLAG` (reward held, case opened, never auto-released) / `BLOCK` (not qualified, not charged, case recorded). Risk reviews a case: clear (release), keep on hold, reverse (removes the reward and credits the merchant back), block device or account, pause the campaign. All audited. Device identity is a random per-installation id the app generates (no fingerprinting; consent is a VALIDATE-KSA item).

## Reward ledger and wallet

Append-only `RewardEntry` (database trigger): `EARN`, `HOLD`, `RELEASE` (two legs), `REVERSE`, `REDEEM`, `EXPIRE`, `ADMIN_ADJUSTMENT`, each with customer, source, amount, bucket, reason, actor, time and an idempotency key. Cached balances change in the same SQL statement as the entry (a reconciliation check compares balances with the ledger). FIFO lots drive expiry (off until decided) and spending. Redemption is one conditional update on the balance and on stock, idempotent per key. Manual adjustments: Support requests, an authorised administrator approves, and above a configurable threshold a different administrator must approve.

## Database changes (migration `20261201000000_stage6_watch_earn_rewards`)

Enums `WatchStatus`, `WatchAction`, `WatchViewStatus`, `WatchFundingSource`, `RiskDecision`, `RiskFlagStatus`, `RewardEntryType`, `RewardBucket`, `RewardAdjustmentStatus`, `RewardItemStatus`; values added to `LedgerAccountFamily` (`CAMPAIGN_BUDGET`, `CAMPAIGN_UNUSED`), `LedgerJournalType` (4), `NotificationType` (6), `DealEventType` (`CTA_CLICK`). Tables `WatchCampaign`, `WatchCampaignHistory`, `WatchFunding`, `WatchView`, `WatchViewEvent`, `DeviceLink`, `RiskFlag`, `RiskBlock`, `RewardAccount`, `RewardEntry`, `RewardLot`, `RewardCatalogueItem`, `RewardRedemption`, `RewardAdjustment`. Hand-written: money CHECKs, one open view per customer, one reward per view, one consumption per view, one active block per subject, append-only triggers on history, view events and reward entries. File kind `WATCH_VIDEO` (MP4 / WebM by magic bytes, MP4 length read server side, range requests for playback).

## APIs

Merchant (`/v1/merchants/:orgId/...`): `watch-options`, `watch` (list, create), `watch/summary`, `watch/:id` (get, update), `/fund`, `/submit`, `/pause`, `/resume`, `/cancel`, `/history`, `/preview`, `/monitor`, `/budget`, `watch-media/intent`, `watch-media/:fileId/complete`.
Admin: `/v1/admin/watch` (overview, list, `:id`, `/monitor`, `/budget`, `/audit`, `/approve`, `/request-changes`, `/reject`, `/pause`, `/resume`, `/suspend`, `/reinstate`, `/stop`), `/v1/admin/risk/flags` (list, detail, `/decide`), `/v1/admin/rewards` (overview, accounts, ledger, reconcile, adjustments + approve / reject, items create / update).
Customer (`/v1/app/...`): `watch`, `watch/campaigns/:id`, `watch/views` (start), `watch/views/:id/events`, `.../complete`, `watch/views/:id`, `rewards`, `rewards/activity`, `rewards/catalogue`, `rewards/redeem`. Discovery signals reuse `POST /app/events` with `product: WATCH`.
OpenAPI regenerated (255 paths). CORS now allows `X-View-Token`.

## Permissions (all enforced in the API, UI hiding is cosmetic)

Merchant: Campaign Manager manages (`merchant.watch.manage`); Finance can read and add budget but cannot edit content; Staff and branch-scoped memberships are refused; another merchant gets 404. Admin: Campaign Ops reviews and controls; Finance and Marketing read; Risk inspects and decides cases and rewards; Support can only request adjustments and cannot approve; Analyst has no access.

## Screens

- **Customer (mobile, five tabs Home / Explore / Watch & Earn / Rewards / Profile):** Home rail, Watch & Earn hub (cards with points, availability states, daily progress, balance), campaign detail (sponsored label, how it works, not-cash note), full-screen player (no seek bar, progress, still-watching prompt, tap-to-play fallback), reward confirmation (earned / being checked / not counted with a plain reason, link to the merchant's offer), Rewards (balance, held points, activity, catalogue with confirm and code).
- **Merchant (desktop):** Watch & Earn hub with money summary; six-step builder (video + cover upload, bilingual content, audience and link, schedule and repeat window, budget and funding, review with live customer preview); campaign detail with Performance (verified numbers only), Budget (funding history, unused balance, "not final" note) and Activity.
- **Admin (desktop):** Watch & Earn (counts, review queue, all campaigns, live monitor); review workbench (merchant, video player, economics DealDash controls, both languages, issues, guardrails, preview, decisions, monitor, budget and ledger entries, history); Risk cases (signals, timeline, linked counts, decision); Rewards (liability, rules in force, balance check, ledger and account search, adjustments with checker, catalogue with sample flags).
- Arabic / RTL on every surface; dictionaries `dictionaries.stage6.ts` (working translation, native review needed).

## Video architecture status

Development adapter: files on local disk behind signed expiring URLs (private, range requests supported), MP4 / WebM, size and type checked by magic bytes, MP4 duration cross-checked server side. Completion is verified from server-stamped events, never from the client alone. No video vendor is selected; a managed provider (signed manifests, transcoding, delivery status) plugs in behind `VideoProvider` / the storage interface. `tooling/e2e/make-sample-video.mjs` generates the 12 s sample used by the seed and the browser QA.

## Seed data

`apps/api/src/seed/stage6-seed.ts`: campaigns in every state with consistent budgets and balanced journals, demo views and rewards, a held reward with an open risk case for the sample customer `+966500000001`, a nearly exhausted campaign, an employer-only (locked) campaign, and a sample catalogue (every item flagged `isSample`).

## Verification

`pnpm typecheck` green; `pnpm eslint .` 0 errors; `pnpm test` 785 tests (API 518, merchant 63, customer 59, admin 48, staff 34, others 63); browser QA in real Edge: Stage 6 88/88, with Stage 2 30/30, Stage 3 98/98, Stage 4 120/120, Stage 5 101/101 regressions. Screenshots in `docs/screenshots/stage6`.

Browser QA found and fixed a real bug that unit tests could not: the browser blocked the player's `x-view-token` header (CORS). A regression test now covers the preflight.

## Browser / real-device limits (honest)

QA ran in desktop Edge (mobile viewport emulation, headless, autoplay allowed). Not verified: real iOS Safari or Android Chrome autoplay, background-tab and screen-lock behaviour, low-end device video performance, real-network buffering, a production encode or CDN. The player has a tap-to-play fallback and reports visibility changes, but real-device QA is required before launch.

## Technical deviations

- Admin "credit a merchant's budget" removed (cannot apply under a hard cap). `ADMIN_CREDIT` stays as a reserved funding source.
- Campaign consumption posts the platform side to `PLATFORM_REVENUE` as a model-neutral placeholder; it is a ledger label, not an accounting conclusion.
- Customers do not see the campaign once its budget is exhausted (it leaves the hub and detail returns "no longer available"), rather than a long-lived "no longer earning" card.
- Budget exhaustion serialises concurrent completions per campaign (row lock); acceptable at pilot scale, to be revisited with sharded counters if one campaign becomes extremely hot.
- Qualification credit per heartbeat is capped (3 heartbeat intervals) so a client cannot claim time it did not report.

## Founder decisions required

1. Real commercial values: rate card (price per verified view), reward tiers, minimum watch share, daily / device / account limits, hold period (all mock defaults today).
2. Unused-budget treatment (refund, carry forward, retain) and whether merchants pre-fund through a real payment flow or invoice.
3. Points expiry (off today), negative-balance policy, adjustment checker threshold, and the real rewards catalogue and how items are fulfilled.
4. Still-watching prompt policy (frequency, on which videos) and whether to require a full-length watch.
5. Content rules and sponsored disclosure wording; whether merchants may target by age / gender (not built).
6. Video provider and delivery (managed service, signed manifests, maximum length and size).
7. Whether Watch & Earn campaigns need an ad-content review checklist beyond the current pilot manual review.

## VALIDATE-KSA items (kept open, no legal conclusions)

VK-17 legal classification and expiry of reward points; advertising / video content rules and a required sponsored disclosure; targeting rules (age, gender, geography) and any consent they need; device identification and its consent (random installation id today); handling of unused prepaid campaign budget (VK-08 / VK-16); VAT and accounting treatment of campaign charges; marketing-consent for reward notifications; whether rewards redeemable for third-party value change the classification.

## Run Stage 6 locally

```powershell
pnpm install
pnpm build:packages
$env:SEED_USER_PASSWORD = "<your own password, 12+ characters>"
pnpm db:migrate            # or: pnpm db:reset (wipe + migrate + seed)
pnpm db:seed
pnpm dev:api               # 4000
pnpm dev:customer          # 3001  (http://localhost:3001/en/watch)
pnpm dev:merchant          # 3002  (owner@harbourgrill.test -> /en/watch)
pnpm dev:admin             # 3005 (operations@dealdash.test, risk@dealdash.test, finance@dealdash.test)
node tooling/e2e/stage6-browser.mjs
```

Customer sign-in is a mobile code (printed in the API console); seeded customer `+966500000001` has points and a held reward. Admin accounts need the TOTP code the sign-in box shows in development.

## Recommended Stage 7 scope

Partner Portal MVP (read-only campaign / eligibility / reports for partners) and the settlement run for merchant payables, with real payment-provider and video-provider integrations behind the existing interfaces, native Arabic review, and real-device QA. Play & Win stays Phase 2.


## Addendum: commercial governance (Watch & Earn)

The campaign budget (paid views x rate card) is now also the DealDash charge in the shared commercial platform. The funded budget stays owned by this stage (hard cap by conditional SQL). Going live additionally needs the owner's acceptance, any configured approvals, and an agreement that states what happens to the unused budget (there is no default). watch.unused_budget_treatment remains recorded as undecided; the agreement decides. See [COMMERCIAL_FINANCE.md](COMMERCIAL_FINANCE.md).

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

Watch & Earn now supports a partner-owned budget (FD-S7-1): `sponsorOrganizationId` / `creatorOrganizationId` on the campaign; the
budget owner funds it and owns its ledger lines; the merchant still holds the campaign, its video and the viewer experience; DealDash
keeps points, qualification, fraud and reward rules; a sponsor-owned campaign is always reviewed by DealDash.
