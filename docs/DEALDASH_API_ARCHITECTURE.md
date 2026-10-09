# DEALDASH API ARCHITECTURE

Version 0.2 (lean startup revision: NestJS API serving five Next.js PWA/web clients and a future native client; draft for approval) · 2026-10-07
Scope: API design for the frozen MVP across five surfaces, implemented by **one NestJS backend** and consumed by **Next.js PWA/web apps** through a **generated typed client** (`packages/api-client`). Resource and behaviour specification, not code. Endpoint lists are the **contract skeleton**; the OpenAPI description is produced from this at build time.
Companions: `DEALDASH_TECH_ARCHITECTURE.md`, `DEALDASH_DATA_MODEL.md`, `DEALDASH_BUILD_PLAN.md`.
Inputs: UX Architecture v0.4, Customer MVP Final v0.2, Merchant / Staff / Admin / Partner designs, Business Rules.

---

## 1. PRINCIPLES

1. **API-first, one backend, five audiences.** Separate route groups per surface, shared domain services. No UI logic in the API.
2. **REST/JSON, resource-oriented**, described in OpenAPI 3.x. Commands that are not CRUD (reserve, redeem, submit, approve) are explicit action sub-resources (`POST /…/reserve`).
3. **Server is the source of truth.** Clients never assert a payment succeeded, a view qualified, a code is valid, or a customer is eligible.
4. **Idempotent commands.** Any command that moves money, stock, points or state requires an `Idempotency-Key`.
5. **Permission-aware responses.** Responses omit fields and `actions` the caller cannot use; each resource may include an `allowed_actions` list so clients hide, not grey, controls.
6. **Privacy by contract.** Partner endpoints return aggregates only, with suppression flags; no customer-level data exists in any partner response.
7. **Bilingual by default.** Content fields return both `ar` and `en`, plus a resolved `text` for the requested locale; publication gates require both.
8. **Stable, versioned, evolvable.** URL major version (`/v1`), additive changes only within a version, deprecation policy.
9. **Small, predictable payloads.** Cursor pagination, field selection where useful, ETags/conditional requests on cacheable reads.
10. **The contract is the boundary.** OpenAPI is generated from the NestJS controllers and shared validation schemas (`packages/validation`); the typed client (`packages/api-client`) and shared types are generated from it; CI flags unreviewed breaking changes. Frontends contain **no business logic**.
11. **Native-ready.** Nothing assumes a browser: web apps use secure cookie sessions; a future React Native/Expo client uses bearer tokens on the same routes.
12. **Product domains are separate resources.** Live Deals, Exclusive Deals, Vouchers and Watch & Earn have their own resources and lifecycles; only discovery lists present them together.

---

## 2. SURFACES AND BASE PATHS

| Surface | Base path | Clients | Auth |
|---|---|---|---|
| **Customer API** | `/v1/app` | Customer PWA (Next.js); future React Native/Expo app | Customer session (mobile OTP), guest tokens for browse |
| **Staff API** | `/v1/staff` | Staff PWA | Staff session (mobile OTP), branch-scoped |
| **Merchant API** | `/v1/merchant` | Merchant Portal | Portal session (email, password, MFA-ready), org and branch scope |
| **Partner API** | `/v1/partner` | Partner Portal | Portal session, partner scope |
| **Admin API** | `/v1/admin` | Admin Portal | Portal session, MFA mandatory, role permissions, maker-checker |
| **Public API** | `/v1/public` | Legal documents, health, app config | None or app key |
| **Webhooks** | `/v1/hooks/{provider}` | PSP, SMS, email delivery receipts | Signature verification, IP allow-lists |
| **Internal** | not exposed | Worker, service modules | Internal tokens |

Third-party/partner open APIs are **Phase 3**.

---

## 3. AUTHENTICATION AND AUTHORISATION

| Topic | Design |
|---|---|
| Tokens and sessions | **Web apps (PWA and portals): secure, httpOnly, same-site cookies** carrying a short-lived access token with a rotating refresh token, plus **CSRF protection** on state-changing requests. **Native clients (future): bearer tokens** in secure device storage against the same endpoints. Revocable sessions; provider-neutral Identity layer (OTP, password+MFA now; Google, Apple, enterprise SSO later) |
| Customer login | `POST /auth/otp/request` (mobile) → `POST /auth/otp/verify` → session. OTP TTL, attempts, resend and cooldown from configuration; rate limits per number, device and IP |
| Staff login | Same OTP mechanism with staff identity and branch binding |
| Portal login | Email + password → MFA challenge where enabled → session; invitation acceptance sets password and MFA |
| Guest | Anonymous app token for read-only discovery; gated actions return `AUTH_REQUIRED` with a `sign_in_sheet` hint |
| Scopes | Token carries user id, user type, org id, branch scope, role set. Every handler enforces **scope + permission**; org scoping applied in queries, not only in handlers |
| Sensitive operations | Step-up OTP for account deletion, mobile change; Admin maker-checker through `pending_change` |
| Device binding | Device id on session; new-device events recorded |
| CSRF/CORS | Cookie sessions require a CSRF token or double-submit pattern plus same-site policy; strict CORS allow-lists per app origin; bearer-token clients are exempt from CSRF checks |

---

## 4. REQUEST AND RESPONSE STANDARDS

| Aspect | Standard |
|---|---|
| Headers | `Authorization`, `Accept-Language` (`ar`, `en`), `X-Client-Version` (web build or native version), `X-Device-Id`, `X-Request-Id`, `Idempotency-Key` (commands), `If-None-Match` (cacheable reads) |
| Response envelope | `{ "data": …, "meta": { "request_id", "next_cursor", "locale" }, "errors": [] }`; single resource returns `data` object, lists return array |
| Money | Integer halalas with currency: `{ "amount": 8000, "currency": "SAR" }`; display formatting is client-side |
| Dates | ISO 8601 UTC; clients render Riyadh time and Gregorian calendar |
| Pagination | Cursor-based (`limit`, `cursor`); stable ordering; no offset for large sets |
| Filtering/sorting | Documented query parameters per endpoint; unknown parameters rejected |
| IDs | UUIDv7 plus `public_ref` for user-facing references |
| Errors | RFC 7807 style problem details with a stable `code` (section 17), `message` (localised), `fields` for validation, `retryable` flag |
| Idempotency | Same key + same body returns the original result; same key + different body returns `IDEMPOTENCY_CONFLICT`; keys retained 24–72 hours |
| Concurrency | `ETag`/`version` with `If-Match` on mutable resources (campaign edits, settings); conflicts return `VERSION_CONFLICT` |
| Rate limiting | Per user, device, IP and route class; headers `X-RateLimit-*`; stricter for OTP and view streams |
| Localisation | Messages and enumerations carry codes; localised text provided for user-visible strings |
| Compression and caching | gzip/br; public catalogue reads cacheable with short TTL; user-specific data `no-store` |

---

## 5. CUSTOMER API (`/v1/app`)

### 5.1 Auth and onboarding
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/otp/request` | Request mobile OTP (rate limited) |
| POST | `/auth/otp/verify` | Verify OTP; returns session and `onboarding_state` |
| POST | `/auth/refresh` · `/auth/logout` | Refresh and revoke session |
| GET | `/me` | Profile, onboarding state, consents, counts |
| PUT | `/me/profile` | Name, email (required), DOB, gender (optional), city, language |
| POST | `/me/age-check` | 18+ validation result (blocks under 18) |
| PUT | `/me/interests` | Categories |
| PUT | `/me/consents` | Terms, privacy, location, notifications, marketing (versioned) |
| POST | `/me/onboarding/complete` | Mark profile complete |
| POST | `/me/mobile/change` (+ `/verify`) | Change mobile with OTP |
| POST | `/me/delete-request` (+ `/confirm`) | Account deletion with OTP; status via `GET /me/delete-request` |
| POST | `/me/data-request` | Data export request |
| GET | `/me/devices` · DELETE `/me/devices/{id}` | Sessions/devices |

### 5.2 Discovery
| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | App config: enabled cities, feature flags, locales, supported versions, legal versions |
| GET | `/home` | Home feed (sections: Live, Hot, Vouchers, Watch strip) by location and category |
| GET | `/deals` | Unified **discovery list** across Live Deals, Exclusive Deals and Vouchers (Watch & Earn through `/watch`): filters `type` (live, hot, voucher), `category`, `area`, `distance`/`radius`, `open_now`, `eligibility=for_my_benefits`, `sort`, `q` (PostgreSQL text search); each item carries its `type` and a type-specific summary |
| GET | `/deals/map` | Pins for map view (bounds, type filter) |
| GET | `/live-deals/{id}` · `/hot-deals/{id}` | Type-specific deal detail with `eligibility` block (`eligible`, `locked_unlockable` + `unlock_action`, hidden items are not returned), per-branch stock, requirement text, `allowed_actions` |
| GET | `/vouchers` · `/vouchers/{id}` | Voucher products and detail |
| GET | `/merchants/{id}` | Merchant page; `/merchants/{id}/deals`, `/reviews` |
| GET | `/search/suggest` · `/search/recent` · DELETE `/search/recent` | Search aids |
| GET | `/areas` | Location sheet reference |
| POST/DELETE | `/saved/{object_type}/{id}` · GET `/saved` | Save/unsave |
| POST | `/impressions` | Batched impression/view analytics (discovery signals) |
| POST | `/live-deals/{id}/direction-click` · `/hot-deals/{id}/direction-click` | Direction/call tap event (also covered by `/impressions` batching) |

### 5.3 Eligibility and benefits
| Method | Path | Purpose |
|---|---|---|
| GET | `/benefits` | My benefits hub: added cards, employer status, matching offers, locked offers |
| GET | `/benefits/issuers` · `/issuers/{id}/products` · `/products/{id}/tiers` | Add-card selection data |
| POST | `/benefits/cards` | Add card (issuer, product, tier) **only; no card numbers**; returns offers unlocked |
| PUT/DELETE | `/benefits/cards/{id}` | Edit tier / remove |
| GET | `/benefits/employers` | Active partner employers (search) |
| POST | `/benefits/employer/start` | Choose employer + work email → sends email OTP |
| POST | `/benefits/employer/verify` | Verify email OTP → `verified` |
| POST | `/benefits/employer/resend` | Resend |
| DELETE | `/benefits/employer` | Remove employer |
| POST | `/benefits/employer/request` | Employer not listed |

### 5.4 Exclusive Deals and reservations
| Method | Path | Purpose |
|---|---|---|
| POST | `/hot-deals/{id}/reservations` | **Reserve (free)**; body: branch, quantity; `Idempotency-Key`; result: reservation with code and expiry, or `OUT_OF_STOCK`, `LIMIT_REACHED`, `RESERVATIONS_PAUSED`, `NOT_ELIGIBLE`, `TOO_MANY_ACTIVE`, `OFFER_UNAVAILABLE` |
| GET | `/reservations` · `/reservations/{id}` | List and detail (code, hold timer, branch, status) |
| POST | `/reservations/{id}/cancel` | Cancel (stock released) |
| GET | `/me/restrictions` | Active restrictions (reservation pause) with end date and appeal link |

### 5.5 Vouchers, checkout, orders
| Method | Path | Purpose |
|---|---|---|
| POST | `/orders` | Create order for a voucher (qty), holds stock; returns `order`, hold expiry, payment options |
| POST | `/orders/{id}/payment` | Start PSP payment (returns hosted payment URL / SDK token) |
| GET | `/orders/{id}` | Order status (processing, pending, paid, failed, refunded) – **polled or push-updated; source of truth** |
| POST | `/orders/{id}/cancel` | Cancel before payment completes |
| GET | `/me/vouchers` · `/me/vouchers/{id}` | My vouchers with state and code |
| POST | `/me/vouchers/{id}/refund-request` | Full refund before redemption (window from config) |
| GET | `/orders/{id}/receipt` | Receipt data/PDF link |
| GET | `/me/payment-methods` · DELETE | PSP token references (if supported) |

### 5.6 My Deals aggregate
| GET | `/me/deals?tab=active|past&filter=reservations|vouchers|prizes` | Unified My Deals list |

### 5.7 Watch & Earn and rewards
| Method | Path | Purpose |
|---|---|---|
| GET | `/watch` | W&E hub: eligible campaigns, progress, caps |
| GET | `/watch/campaigns/{id}` | Campaign detail (video manifest URL, link target) |
| POST | `/watch/views` | Start view → `view_token`, policy hints (still-watching schedule is server-controlled) |
| POST | `/watch/views/{id}/events` | Batched events: heartbeat, background, foreground, prompt shown/answered |
| POST | `/watch/views/{id}/complete` | Complete → `pending`; |
| GET | `/watch/views/{id}` | Result: `qualified`, `not_qualified(reason_class)`, `capped`, `held` |
| GET | `/rewards` | Balance, pending/held, terms |
| GET | `/rewards/activity` | Ledger view (earn, hold, release, redeem, reverse, expire) |
| GET | `/rewards/catalogue` · POST `/rewards/redeem` | Catalogue and redemption (confirm) |
| GET | `/savings` · POST `/savings` | **Reported savings** (self-reported entries) |

### 5.8 Social, reviews, notifications, support
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/merchants/{id}/reviews` | Read; submit (signed-in only); response includes `verified` flag computed server-side |
| PUT/DELETE | `/reviews/{id}` | Edit/delete own |
| POST | `/reports` | Report review, merchant, reel |
| GET | `/notifications` · POST `/notifications/{id}/read` · POST `/notifications/read-all` | Feed |
| GET/PUT | `/notification-settings` | Channels and categories; marketing opt-in |
| GET | `/help/faqs` | Help centre |
| GET/POST | `/cases` · `/cases/{id}` · POST `/cases/{id}/messages` | My cases; create with linked object; attachments by upload flow |
| POST | `/cases/appeal` | Appeal a restriction/hold/decision |
| GET | `/legal/{kind}` | Terms/privacy (also public) |

---

## 6. STAFF API (`/v1/staff`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/otp/request` · `/verify` | Staff login |
| GET | `/me` | Staff identity, branch, org |
| POST | `/redemptions/validate` | Submit scanned/typed code; returns **preview** (object, branch match, state, eligibility flags) without redeeming |
| POST | `/redemptions` | **Redeem** (idempotent): atomic transition; results: `REDEEMED`, `ALREADY_REDEEMED`, `WRONG_BRANCH`, `EXPIRED`, `NOT_YET_VALID`, `SUSPENDED`, `INELIGIBLE`, `INVALID` |
| GET | `/redemptions` | Branch history (limited fields; no customer PII beyond masked first name) |
| POST | `/redemptions/{id}/reverse-request` | Reversal request where permitted (Phase 2 workflow for staff; MVP reversal by Merchant/Admin per rules) |
| GET | `/branch/status` | Branch open state and active deals summary |

---

## 7. MERCHANT API (`/v1/merchant`)

| Area | Endpoints (representative) |
|---|---|
| Auth | `POST /auth/login`, `/auth/mfa`, `/auth/invitations/{token}/accept`, `/auth/password/reset` |
| Onboarding | `GET/PUT /application`, `POST /application/documents`, `POST /application/agreement/accept`, `POST /application/submit`, `GET /application/status` |
| Business | `GET/PUT /profile`, `/branches`, `/branches/{id}`, `/branches/{id}/hours`, `/staff`, `POST /staff/invite`, `PUT /staff/{id}`, `/users`, `/roles` |
| Live Deals | `GET/POST /live-deals`, `GET/PUT /live-deals/{id}`, `POST /live-deals/{id}/submit`, `/pause`, `/resume`, `/cancel`, `GET /live-deals/{id}/preview`, `GET /live-deals/{id}/performance` |
| Exclusive Deals | `GET/POST /hot-deals`, `GET/PUT /hot-deals/{id}`, `POST /hot-deals/{id}/submit`, `/pause`, `/resume`, `/cancel`, `GET /hot-deals/{id}/preview`, `GET/PUT /hot-deals/{id}/inventory` (per-branch units; decrease below reserved + redeemed rejected), `GET /hot-deals/{id}/reservations`, `GET /hot-deals/{id}/performance` |
| Vouchers | `GET/POST /vouchers`, `PUT /vouchers/{id}`, `POST /vouchers/{id}/submit`, `/pause`, `/resume`, `GET /vouchers/{id}/sales` |
| Watch & Earn | `GET/POST /watch-campaigns`, `PUT /{id}`, `POST /{id}/submit`, `/fund` (budget funding via PSP), `/pause`, `/resume`, `GET /{id}/performance`, `GET /rate-card` (read-only) |
| Redemptions | `GET /redemptions`, `GET /reservations`, `POST /redemptions/{id}/reverse` (role/window rules), `GET /vouchers/{id}/redemptions` |
| Insights | `GET /insights/overview|live-deals|hot-deals|vouchers|watch|branches` (discovery signals vs redemptions separated) |
| Finance | `GET /finance/balance`, `/statements`, `/statements/{id}`, `/payouts`, `POST /statements/{id}/dispute`, `GET/PUT /finance/bank-account` (change triggers re-review) |
| Reviews | `GET /reviews`, `POST /reviews/{id}/report` |
| Support | `GET/POST /cases`, `/cases/{id}/messages`, `GET /help` |
| Settings/notifications | `GET/PUT /settings`, `/notifications` |
| Translation completeness | `GET /{live-deals|hot-deals|vouchers|watch-campaigns}/{id}/completeness` |

All writes subject to guardrails: submit returns decision `auto_published`, `in_review` or `rejected` with reasons. Material edits to live items re-run guardrails (LD-41).

---

## 8. PARTNER API (`/v1/partner`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/mfa`, invitations as above |
| Onboarding | `GET/PUT /application`, `POST /application/documents`, `POST /application/agreement/accept`, `POST /application/submit`, `GET /application/status` |
| Dashboard | `GET /dashboard` (aggregates, alerts, attention items; reach as **range**) |
| Campaigns (proposals) | `GET/POST /campaigns`, `GET/PUT /campaigns/{id}` (editable only in Draft/Needs changes), `POST /campaigns/{id}/submit`, `/withdraw`, `GET /campaigns/{id}/performance`, `/budget`, `/activity` |
| Change requests | `POST /campaigns/{id}/change-requests`, `GET /campaigns/{id}/change-requests`, `GET /change-requests/{id}`, `POST /change-requests/{id}/replies` |
| Eligibility rules | `GET/POST /eligibility/rules`, `GET/PUT /eligibility/rules/{id}`, `POST /…/submit`, `POST /…/reach-estimate` (range or suppressed), `POST /…/validate` (conflicts, guardrails), `GET /eligibility/attributes` (allowed building blocks by partner type) |
| Bank module | `GET/POST /cards/products`, `PUT /cards/products/{id}`, `/tiers`, `/bin-ranges` (propose only; DealDash verifies) |
| Scheme module | `GET /network`, `/issuers`, `POST /issuers/invite`, `GET /issuers/{id}/aggregate` |
| Employer module | `GET/PUT /company`, `GET/POST /domains`, `PUT /domains/{id}`, `GET/PUT /verification-settings` (within DealDash limits) |
| Merchants | `GET /merchants` (participating only), `GET /merchants/{id}`, `GET/POST /merchant-requests`, `POST /merchant-requests/{id}/cancel` |
| Reports | `GET /reports/overview|campaigns|engagement|merchants|segments`, `POST /reports/exports`, `GET /reports/exports/{id}`; **all responses carry suppression metadata** (section 16) |
| Organization | `GET/PUT /organization`, `GET /agreement`, `GET /documents`, `GET /data-sharing`, `POST /data-sharing/requests`, `GET /funding`, `/statements`, `GET /activity` (org-scoped audit) |
| Users | `GET/POST /users`, `PUT /users/{id}` (role), `POST /users/{id}/suspend`, `/revoke`, `GET /invitations`, `/access-history` |
| Support | `GET/POST /cases`, `/cases/{id}/messages` (public replies only), `GET /help` |
| Notifications / settings | `GET /notifications`, `GET/PUT /settings/notifications` |

Partner responses never contain customer identifiers. Partner users cannot call Admin routes or other organisations' resources (404, not 403, for other-org ids).

---

## 9. ADMIN API (`/v1/admin`)

| Area | Endpoints (representative; each protected by permission matrix and audited) |
|---|---|
| Auth | login, mandatory MFA, session management, break-glass request |
| Dashboard | `GET /dashboard` (queues, KPIs), global search `GET /search?q=` (customer, merchant, order, code, case) |
| Customers | `GET /customers`, `/customers/{id}` (masked 360 view), `POST /customers/{id}/restrict`, `/unrestrict`, `GET /customers/{id}/eligibility`, `/reservations`, `/orders`, `/rewards` |
| Merchants | `GET /merchants`, `GET /merchants/{id}`, `POST /merchants/{id}/review-decision`, `/suspend`, `/reactivate`, `/offboard`, `PUT /merchants/{id}/trust-level`, `/fee-rule` (maker-checker), `GET /merchants/{id}/documents` |
| Partners | `GET /partners`, `GET /partners/{id}`, `POST /partners/{id}/review-decision`, `/suspend`, `GET/POST /partners/{id}/verification-queue` (domains, BIN ranges): `POST …/{item}/approve|reject`, `GET/PUT /partners/{id}/data-sharing` |
| Campaign review | `GET /review-queue`, `GET /review-queue/{id}`, `POST /review-queue/{id}/decision` (approve, request changes, reject; reasons mandatory), `POST /campaigns/{type}/{id}/pause|suspend|resume` |
| Partner proposals and change requests | `GET /partner-proposals`, `POST /partner-proposals/{id}/decision`, `GET /change-requests`, `POST /change-requests/{id}/decision` (approve, clarify, reject) |
| Eligibility oversight | `GET /eligibility/rules`, `POST /eligibility/rules/{id}/decision|pause|retire`, `GET/PUT /eligibility/segments` |
| Payments | `GET /orders`, `/payments`, `/refunds`, `POST /refunds`, `GET /reconciliation/exceptions`, `POST /reconciliation/exceptions/{id}/resolve` |
| Money / ledger | `GET /ledger/accounts`, `/journals`, `POST /adjustments` (maker-checker), `GET /settlement/runs`, `POST /settlement/runs`, `/approve`, `GET /statements`, `POST /payouts/{id}/mark-paid|failed` |
| Rewards | `GET /rewards/accounts/{id}`, `POST /rewards/adjustments` (maker-checker), `GET/PUT /rewards/rules`, `/catalogue` |
| Watch & Earn | `GET /watch-campaigns`, `/views` (monitoring), `POST /views/{id}/override` |
| Risk | `GET /risk/flags`, `POST /risk/flags/{id}/decision`, `GET/POST /risk/blocklist`, `GET/PUT /risk/rules`, appeals `GET /appeals`, `POST /appeals/{id}/decision` |
| Support | `GET /cases`, `/cases/{id}`, `POST /cases/{id}/assign|messages|resolve|escalate` |
| Content & moderation | `GET /reviews/reports`, `POST /reviews/{id}/hide|restore`, `GET/PUT /content/faqs|legal|templates` |
| Notifications | `GET/PUT /notifications/templates`, `POST /notifications/broadcast` (restricted) |
| Reports | `GET /reports/*` internal; exports with audit |
| Administration | `GET/POST /users`, `/roles`, `/permissions`, `GET/PUT /config`, `GET /config/{key}/history`, `/pending-changes` (`POST /{id}/approve|reject`), `/feature-flags`, `GET /audit` (restricted), `/access-reviews` |

---

## 10. WEBHOOKS AND PROVIDER CALLBACKS (`/v1/hooks`)

| Provider | Path | Handling |
|---|---|---|
| PSP | `/v1/hooks/psp/{psp}` | Verify signature and timestamp; store `payment_event` with unique provider event id; return 2xx quickly; process asynchronously; **idempotent and order-independent** (late "pending" after "paid" ignored); only verified events change order/payment state |
| SMS provider | `/v1/hooks/sms/{provider}` | Delivery receipts update `notification_outbox` and OTP delivery stats |
| Email provider | `/v1/hooks/email/{provider}` | Bounces/complaints update preferences; bounce signals feed employer verification risk (EM-21) |
| Video platform | `/v1/hooks/video/{provider}` | Transcode complete/failed updates `media_asset` |
| Storage scanner | internal | Quarantine result |

Failure policy: retries with backoff; dead-letter after limit; alerting; manual replay tool in Admin (Finance, Support).

---

## 11. REAL-TIME AND PUSH (PWA-aware)

| Need | Approach |
|---|---|
| Order status after payment | Customer app polls `GET /orders/{id}` with backoff and also receives a push/in-app event; the screen always reflects server state |
| Reservation hold timer | Client counts down from `expires_at` (server time offset provided); server job enforces expiry; expiry pushes a notification; state fetched on foreground |
| Stock updates | Pull with short cache; optional server-sent events for Exclusive Deal detail in a later phase |
| W&E result | Poll `GET /watch/views/{id}` (short) and push when held/credited |
| Merchant and staff dashboards | Polling in MVP (30–60 seconds); websockets Phase 2 |
| Notifications | **Web Push** (works for installed PWAs on supported browsers; opt-in rate to be measured), in-app feed as the reliable channel, SMS only for critical/OTP, email for receipts and statements; a future native client adds FCM/APNs through the same notification module |

---

## 12. DOMAIN EVENTS (outbox, internal pub/sub)

| Event | Producer | Typical consumers |
|---|---|---|
| `customer.registered` / `customer.profile_completed` | Identity | Notifications, Reporting |
| `eligibility.attribute_changed` | Eligibility | Discovery cache, Reporting, Notifications |
| `live_deal.*` / `hot_deal.*` / `voucher_product.*` / `wande_campaign.*` (`submitted`, `published`, `paused`, `suspended`, `ended`) | Live Deals, Exclusive Deals, Vouchers, Watch & Earn (each its own) | Guardrails, Discovery, Notifications, Reporting |
| `hot_deal.low_stock` / `hot_deal.sold_out` | Exclusive Deals | Notifications, Merchant dashboard |
| `reservation.created` / `.cancelled` / `.expired` / `.noshow_marked` | Reservation | Notifications, Risk, Reporting, Customer restriction |
| `order.created` / `order.paid` / `order.failed` | Orders | Vouchers, Ledger, Notifications |
| `voucher.activated` / `.expired` / `.refunded` | Vouchers | Ledger, Notifications |
| `refund.completed` | Orders | Ledger, Notifications |
| `redemption.completed` / `.reversed` | Redemption | Ledger, Reviews (verified evidence), Reporting, Notifications |
| `ledger.journal_posted` | Ledger | Settlement, Reconciliation, Reporting |
| `settlement.statement_issued` / `payout.updated` | Settlement | Notifications (merchant) |
| `view.qualified` / `view.invalid` / `view.held` | Watch & Earn | Ledger (campaign consumption), Rewards, Risk, Notifications |
| `campaign.budget_exhausted` / `.completed` | Watch & Earn | Notifications, Ledger |
| `reward.earned` / `.released` / `.reversed` / `.expiring` | Rewards | Notifications |
| `risk.flag_raised` / `risk.decision_made` | Risk | Admin queue, Notifications |
| `partner.proposal_submitted` / `.decided`, `change_request.*` | Catalogue/Partner | Notifications |
| `case.created` / `.updated` | Support | Notifications, SLA timers |
| `review.reported` / `.moderated` | Reviews | Admin queue |

Events are versioned, carry `event_id`, `occurred_at`, `actor`, `aggregate`, and a minimal payload; consumers are idempotent.

---

## 13. WATCH & EARN VIEW PROTOCOL

1. `POST /watch/views` (campaign id) → server checks eligibility, targeting, caps, device and risk → returns `view_id`, `view_token` (short-lived, signed), media URL, and **opaque** policy (client does not learn thresholds).
2. Player sends batched `events` with timeline positions: heartbeats, background/foreground, prompt shown and answered. Seeking and skipping do not count watched time.
3. **Still-watching prompts** are scheduled server-side; the response to events can carry `prompt_at` instructions; failure invalidates the view.
4. `POST …/complete` finishes the session; the server validates the timeline against thresholds and fraud rules, then marks the view `qualified`, `invalid(reason_class)`, `capped` or `held`.
5. `GET …/{id}` returns the outcome; reward and billing entries are created by events. Clients display only the outcome class.
6. Replays of tokens, parallel sessions on one account and device limit breaches are rejected with `VIEW_NOT_ALLOWED`.

---

## 14. REDEMPTION AND QR PROTOCOL

- **Code payload** (QR or typed code): opaque, server-generated; QR contains `{ v, kid, object_type, object_id, nonce, exp, sig }`; signature verifies integrity, no personal data (VC-20).
- `POST /staff/redemptions/validate` → returns preview only. `POST /staff/redemptions` → atomic state transition `Active→Redeemed` (or `Reserved→Redeemed`), unique constraint prevents duplicates, returns outcome; ledger posting by event.
- **Typed code entry** allowed as fallback with rate limiting; **no "use latest customer code" shortcut** exists.
- Eligibility recheck at redemption follows configuration (FDR-40).
- Reversal: Merchant Owner/Admin roles within configured window; Admin any with reason; counter-entries in ledger; audit.

---

## 15. FILE UPLOADS

1. `POST /files` (kind, mime, size, sha256) → pre-signed upload URL and `file_id`.
2. Client uploads directly to storage; `POST /files/{id}/complete`.
3. Server scans (type, malware), validates dimensions/duration, transcodes video; status `quarantine → clean | rejected`.
4. Resources reference `file_id` only when `clean`. Documents are served through short-lived signed URLs with access logging. Limits per kind configured (video duration and size from W&E policy).

---

## 16. REPORTING AND SUPPRESSION CONTRACT (Partner API)

Every report response includes, per metric or cell:
`{ "value": 3120, "state": "shown" }` · `{ "value": null, "state": "suppressed", "reason": "below_cohort_threshold" }` · `{ "value": null, "state": "merged", "group": "other_suppressed" }` · reach values as `{ "range": [12000, 12500], "state": "range" }`.
Rules enforced server-side:
1. A cell with fewer customers than the configured threshold is never returned; it becomes `suppressed` or is merged into `other_suppressed` (itself suppressed if still small).
2. **Totals and dependent breakdowns are suppressed** when they would reveal a hidden cell by subtraction (merged-remainder rule); percentages of total are replaced by counts or omitted.
3. Rankings and sorts never use hidden values.
4. Exports contain the same suppressed structure; watermarked; rate-limited; logged.
5. The threshold and rounding rules come from configuration (pilot setting 10; VK-12 open). Clients render the "Not shown to protect customer privacy" state from the `state` field and do not compute it.
Automated tests include differencing scenarios (hide one cell, vary filters) to verify no reconstruction.

---

## 17. ERROR CODE CATALOGUE (stable)

| Group | Codes |
|---|---|
| Auth | `AUTH_REQUIRED`, `AUTH_INVALID`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_RATE_LIMITED`, `SESSION_EXPIRED`, `MFA_REQUIRED`, `FORBIDDEN`, `NOT_FOUND` |
| Onboarding | `UNDER_AGE`, `CONSENT_REQUIRED`, `MOBILE_ALREADY_REGISTERED`, `PROFILE_INCOMPLETE` |
| Eligibility | `NOT_ELIGIBLE`, `LOCKED_UNLOCKABLE`, `EMPLOYER_NOT_LISTED`, `EMAIL_DOMAIN_MISMATCH`, `EMAIL_ALREADY_LINKED`, `VERIFICATION_EXPIRED`, `CARD_LIMIT_REACHED`, `CARD_DUPLICATE`, `ISSUER_UNSUPPORTED` |
| Reservation | `OUT_OF_STOCK`, `LIMIT_REACHED`, `TOO_MANY_ACTIVE`, `RESERVATIONS_PAUSED`, `OFFER_UNAVAILABLE`, `BRANCH_CLOSED`, `RESERVATION_EXPIRED`, `RESERVATION_NOT_CANCELLABLE` |
| Orders/payments | `HOLD_EXPIRED`, `PAYMENT_FAILED`, `PAYMENT_PENDING`, `ALREADY_PAID`, `REFUND_NOT_ALLOWED`, `REFUND_WINDOW_CLOSED`, `VOUCHER_NOT_ACTIVE` |
| Redemption | `ALREADY_REDEEMED`, `WRONG_BRANCH`, `EXPIRED`, `NOT_YET_VALID`, `SUSPENDED`, `INELIGIBLE`, `INVALID_CODE` |
| Watch & Earn | `VIEW_NOT_ALLOWED`, `DAILY_CAP_REACHED`, `FREQUENCY_LIMIT`, `CAMPAIGN_ENDED`, `BUDGET_EXHAUSTED`, `VIDEO_UNAVAILABLE`, `VIEW_NOT_QUALIFIED`, `REWARD_HELD` |
| Rewards | `INSUFFICIENT_POINTS`, `ITEM_OUT_OF_STOCK` |
| Generic | `VALIDATION_FAILED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `MAINTENANCE`, `UPDATE_REQUIRED` |
| Portal | `GUARDRAIL_REJECTED`, `APPROVAL_REQUIRED`, `EDIT_LOCKED` (approved/live partner proposals: use change request), `PENDING_CHANGE_REQUIRED`, `MAKER_CHECKER_VIOLATION`, `AR_EN_INCOMPLETE` |

Customer-facing codes map one-to-one to the states in the Customer MVP Final (section 14).

---

## 18. SECURITY CONTROLS AT THE API

| Control | Detail |
|---|---|
| Transport | TLS 1.2+; HSTS; strict content security policy on web apps; certificate pinning only for a future native client |
| Input | Schema validation on every route; reject unknown fields on commands; size limits |
| Output | Field allow-lists per audience; PII masked by default; no internal ids of other orgs |
| Abuse | Rate limits and burst controls; OTP route protections (per number, per device, per IP, per prefix); bot defence at edge; request signing for sensitive partner operations optional |
| Authorisation tests | Automated matrix test per role per endpoint |
| Logging | Request logs without bodies for sensitive routes; no OTP, tokens, card data; correlation ids; audit events for sensitive reads (Admin customer 360, document access, exports) |
| Secrets | Never in responses; webhook secrets rotated |
| Content | Upload scanning; HTML sanitisation for any rich text; Arabic/English bidi-safe output |
| Replay | Idempotency keys, timestamps and nonces on signed payloads |

---

## 19. VERSIONING, DEPRECATION, DOCUMENTATION

- **Major version in URL**; additive changes (new optional fields, new endpoints, new enum values documented as extensible) within a version. Breaking changes need `/v2`.
- Client compatibility: `X-Client-Version` with `UPDATE_REQUIRED` for forced reload/update (service-worker update flow for PWAs); minimum supported versions in `/config`; the server supports the current and previous web builds because PWAs may run cached versions for a short time; a future native app adds N and N-1 version support.
- Deprecation: marked in OpenAPI and response header `Deprecation`/`Sunset`; minimum notice period long enough for cached PWA builds (and, later, native release cycles).
- Documentation: OpenAPI generated and published per surface; examples for each state; Postman/test collections; changelog.
- Contract testing between the generated client, the apps and the API in CI; breaking-change detection on the OpenAPI diff.

---

## 20. TRACEABILITY TO FROZEN DESIGNS

| Frozen design element | API support |
|---|---|
| Customer: free Exclusive Deal reservation (S20, S26, S31) | `POST /hot-deals/{id}/reservations`, `GET /reservations` |
| Customer: no generic Activate | No activation endpoint; controlled offers use the product action only |
| Customer: add card selection-only | `POST /benefits/cards` with issuer/product/tier only |
| Customer: employer OTP | `/benefits/employer/*` |
| Customer: voucher purchase and refund | `/orders`, `/me/vouchers/*/refund-request` |
| Customer: Watch & Earn | `/watch/*`, `/rewards/*` |
| Customer: My Deals, support, appeals, deletion | `/me/deals`, `/cases/*`, `/cases/appeal`, `/me/delete-request` |
| Staff: scan, validate, redeem | `/staff/redemptions/*` |
| Merchant: builders, redemptions, insights, finance | `/merchant/*` |
| Partner: shell, dashboard, eligibility builder, reports with suppression, proposals, change requests | `/partner/*` |
| Admin: queues, maker-checker, config, audit | `/admin/*` |

*End of API Architecture v0.1. No production code was written.*


---

## Addendum (Oct 2026) — Subscription, licensing & entitlement API

Detail: `SUBSCRIPTION_LICENSING_ENTITLEMENT.md` §12. Contract regenerated (`packages/api-client/openapi.json`).

- **Admin** `/v1/admin/subscriptions` (`admin.subscriptions.read | manage | approve`): `plans`, `plans/:code`, `plans/:code/versions`,
  `plan-versions/:id` (+ `publish`, `retire`), `price-items` (+ `/:code/versions`), `price-item-versions/:id/publish`, `add-ons`,
  `contracts` (+ `/:id`, `terms`, `price`, `acceptances`, `assign`, `accept-on-behalf`, `past-due`, `suspend`, `reinstate`, `cancel`,
  `renewal-state`, `renew`, `promotions`, `rates`, `amendments`, `amendments/preview`), `amendments` (+ `/:id`, `accept-on-behalf`, `apply`,
  `reject`), `organizations/:orgId` (+ `explain`, `financial-status`, `usage`), `billing-events`, `signals`, `readiness/unassigned`, `run-due`.
- **Business** `/v1/orgs/:orgId/subscription` (merchant `merchant.subscription.read | manage`, `merchant.commercial.accept`; partner
  `partner.subscription.read | manage`; scoped members refused): `GET /`, `usage`, `plans`, `explain`, `pending`, `amendments`;
  `POST preview`, `amendments`, `amendments/:id/accept`, `amendments/:id/cancel`, `accept`, `stop-renewal`.
- Commands are idempotent (`Idempotency-Key`). Publishing / applying needs a different person than the author.
- New stable error codes: `ENTITLEMENT_LIMIT_REACHED`, `ENTITLEMENT_REQUIRED`, `COMMERCIAL_SUSPENDED`, `FINANCIAL_HOLD`, `CONTRACT_ENDED`,
  `DOWNGRADE_BLOCKED`, `PLAN_NOT_AVAILABLE`, `PRICING_NOT_AVAILABLE`, `AMENDMENT_INVALID` (plus existing `APPROVAL_REQUIRED`,
  `COMMERCIAL_ACCEPTANCE_REQUIRED`, `VERSION_CONFLICT`, `INVALID_STATE`, `SCOPE_FORBIDDEN`).
- Phase 5 interface (not an HTTP API yet): `BillingEventService.list / markConsumed`, `FINANCIAL_STATUS_PROVIDER`. Phase 4: `SignalService.list / markConsumed`.


## Addendum (Oct 2026) — Phase 4 / Phase 5 API

OpenAPI regenerated (`pnpm api:contract`, 502+ paths). All state-changing calls keep CSRF and idempotency keys.

- **Visibility (business)** `/v1/orgs/:orgId/`: `performance/overview`, `performance/report`, `performance/campaigns/:product/:campaignId`,
  `targets`, `targets/:id/archive`, `alerts`, `alerts/:id/(acknowledge|resolve)`, `alert-rules`, `alert-rules/:id`, `integration-health`.
- **Personal**: `/v1/me/notification-preferences`.
- **Visibility (DealDash)** `/v1/admin/visibility/`: `overview`, `report`, `campaigns/:product/:id`, `refresh`, `targets`, `alerts`,
  `alerts/evaluate`, `alerts/:id/:action`, `alert-rules`, `command-centre`, `integrations`, `platform-health`, `customers`,
  `customers/:userId/timeline`.
- **Billing (business)** `/v1/orgs/:orgId/billing/`: `accounts`, `accounts/:id`, `accounts/:id/statement`, `documents`, `documents/:id`,
  `documents/:id/dispute`, `receivables`, `purchase-orders`, `reconciliation`, `quotations/:caseId/decline`.
- **Billing (DealDash)** `/v1/admin/billing/`: `accounts`, `accounts/:id`, `accounts/:id/status`, `accounts/:id/statement` (GET, POST to
  issue), `run`, `documents`, `documents/:id`, `documents/:id/(issue|send|cancel|notes|write-off|dispute/resolve)`, `proforma`, `payments`,
  `payments/:id/allocate`, `receivables`, `purchase-orders`, `fx-rates`, `fx-rates/:id/(approve|reject)`, `reconciliation`.
- **AI**: `/v1/app/ai/ask` (customer); `/v1/orgs/:orgId/ai/ask`, `ai/drafts`, `ai/drafts/:id/(approve|reject)` (merchant / partner);
  `/v1/admin/ai/ask`, `drafts`, `drafts/:id/:decision`, `interactions`, `interactions/:id`, `usage`, `governance`, `evaluations`.

New error codes: ALERT_RULE_INVALID, TARGET_INVALID, DOCUMENT_IMMUTABLE, PO_REQUIRED, PO_INSUFFICIENT, FX_RATE_REQUIRED, QUOTATION_EXPIRED,
OVERPAYMENT, AI_NOT_ENTITLED, AI_AUTONOMY_EXCEEDED, AI_APPROVAL_REQUIRED, AI_TOOL_DENIED. Another tenant's resource is always 404.
