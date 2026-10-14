# Customer "My benefits"

**Status:** Priority 1 from the platform completion audit (2026-10-14). Built and tested; awaiting founder approval. Not pushed.

**Rules implemented:** Business Rules §5 (EL), §6 (EM) and §7 (BC), and Master Blueprint §5 / §18.

**Approved screens:** S10, S11, S13, S14, S15, S23 and S24 from the customer MVP alignment. They are realised in the approved Home visual language, with no redesign of any approved screen.

## What it does

### Employer
1. The customer chooses an employer from the ACTIVE partner employer programmes in their market (EM-01).
2. They enter their official work email.
3. The email is checked:
   - the domain must match one of the programme's approved domains, with subdomains accepted when configured (EM-02);
   - shared mailboxes and personal domains are refused (EM-07);
   - an address already linked to another active account is refused, and the attempt is audited for risk (EM-06).
4. A 6-digit code is emailed (EM-03). It is single-use and has a TTL, an attempt limit, an hourly limit and a cool-down. The code is bound to the customer, the programme and the email's hash.
5. On success, the benefit becomes `EMPLOYER` with level `OTP_VERIFIED` and status `VERIFIED`, and an expiry date (EM-04, EM-20).
6. Only one employer is active at a time; a new employer replaces the current one (EM-08).
7. The address is stored as an HMAC lookup plus an AES-GCM encrypted value. The customer only ever sees it masked (EM-05).
8. The customer can remove the employer at any time (EM-21, EL-12). Removal locks the dependent offers immediately and clears the stored address. Issued reservations and vouchers are untouched (EL-13).

### Cards
- The customer picks a card from the ACTIVE partner card programmes: issuer, product, scheme and tier only.
- No card digits of any kind are collected (BC-01..BC-03).
- A card is stored as three self-declared attributes: `CARD` (issuer), `CARD_PRODUCT` and `CARD_TIER`. It is never described as "verified" (BC-04): the UI says "Added".
- The number of cards is capped by configuration (BC-14). Removing a card locks the offers that depended on it, while offers still covered by another card stay open.

### Offers
- **Unlocked:** partner-benefit offers across Live Deals, Exclusive Deals and Vouchers that the customer's benefits open now.
- **To unlock:** partner-benefit offers they could still unlock.
- Both lists come through each product's own discovery: the same visibility rules and the same eligibility engine. The partner behind each offer is named.
- Locked offers' unlock buttons now open My benefits on the right sheet.

### Usage
- Reservations and vouchers from partner-benefit offers, under "In use", "Used" and "Expired".
- Each shows its redemption status and the partner behind it, and links to the existing reservation or voucher screen.

### History and notifications
- Every benefit event is audited against the customer, and that audit trail is the history:
  - code sent;
  - verified;
  - renewal due;
  - expired;
  - removed;
  - card added or removed.
- An in-app `BENEFIT_UPDATED` notification goes out on verify, remove, card added or removed, renewal due and expiry. Push is tracked by the existing notification sweep.

### Renewal, grace period and expiry (EM-20)
EM-20 says the verification expires after the configured period, the customer re-verifies by a new work-email code, and "a grace
period applies". Implemented as follows:

| When | Status shown | Offers | Customer sees |
|---|---|---|---|
| Verified, before `renewFrom` | Verified employee | Unlocked | "Renew by {renewal date}" |
| From `renewFrom` (= renewal date − `reverifyNoticeDays`) | Verified employee | Unlocked | "Confirm your work email again before {renewal date}"; reminder 1 |
| From `renewDueAt` (verified + `employerReverifyDays`) | **Renewal due** (`REVERIFICATION_DUE`) | **Still unlocked (grace)** | "Your staff offers keep working until {end}"; reminder 2 |
| At `expiresAt` (= `renewDueAt` + `employerGraceDays`) | Expired | Locked | "Confirm your work email again to unlock" |

- Confirming the work email at any point starts a new period.
- The hourly job `benefits.sweep` marks expired employer benefits `EXPIRED` and sends at most one "coming up" and one "grace started"
  reminder per verification period.
- The engine never uses an expired benefit, even before the sweep runs (it compares `expiresAt` directly).
- Verifications made before the grace period existed keep their end date as their renewal date (migration
  `20270109000000_customer_account`); no grace is added to them retroactively.

## API (customer audience; signed-in customer only; keyed by the session)
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/app/benefits` | Overview: employer, cards, card limit, counts |
| GET | `/v1/app/benefits/options` | Employer and card programmes the customer may choose |
| GET | `/v1/app/benefits/offers?tab=unlocked\|available` | Benefit offers with partner attribution |
| GET | `/v1/app/benefits/usage?tab=active\|used\|expired` | Benefit reservations and vouchers with status |
| GET | `/v1/app/benefits/history` | Benefit events |
| POST | `/v1/app/benefits/employer/code` | Send the work-email code |
| POST | `/v1/app/benefits/employer/verify` | Confirm the code |
| DELETE | `/v1/app/benefits/employer` | Remove the employer |
| POST | `/v1/app/benefits/cards` | Add a card (idempotent) |
| DELETE | `/v1/app/benefits/cards/:programId` | Remove a card |

## Data
- Migration `20270108000000_customer_benefits` is additive only:
  - `EligibilityAttribute.programId`, `contactHash`, `contactEnc`, `contactMasked`, `updatedAt`;
  - an index on (`attrType`, `contactHash`);
  - notification type `BENEFIT_UPDATED`.
- Existing rows keep their meaning. No new table was added: benefits are rows of the one eligibility model every product already evaluates.

## Configuration (`customer.benefits`): values are configuration, never code

| Key | Default | Note |
|---|---|---|
| `employerReverifyDays` | 180 | **PLACEHOLDER: founder value pending** (FDR-28, closed as "configurable") |
| `employerGraceDays` | 14 | **PLACEHOLDER: founder value pending.** EM-20 grace after the renewal date (0 = none) |
| `reverifyNoticeDays` | 14 | Reminder before the renewal date |
| `emailOtpTtlSeconds` / `MaxAttempts` / `MaxPerHour` / `CooldownSeconds` | 600 / 5 / 5 / 60 | EM-03 |
| `allowSubdomains` | true | EM-02 |
| `blockedLocalParts` / `blockedDomains` | common shared and personal addresses | EM-07 |
| `maxCardEntries` | 5 | BC-14 |

## Flagged (not decided here)
1. **FDR-28:** the re-verification period (180 days) is a placeholder.
2. **EM-20 grace:** now a real grace period *after* the renewal date (the benefit keeps working, status "Renewal due"), then expiry.
   The length (14 days) is a placeholder for the founder's value; 0 turns the grace off.
3. **EM-22 / EM-06 risk flags:** a reused work email is audited as a risk event, but no fraud-queue case is opened automatically.
4. **EM-21 email bounce signal:** not available until a real email provider with bounce callbacks is selected (provider P3).
5. **Scheme / membership attributes (`SCHEME`, `MEMBERSHIP`):** customers cannot add these yet. Partner card programmes carry the scheme only as text, with no scheme-partner link. Offers whose rules need a scheme partner stay "To unlock".
6. **BC-15 (wallet, insurance and student memberships):** out of scope, FDR-37.
7. **Development data:** the development database needs ACTIVE partner employer and card programmes, set up through the partner portal, before My benefits shows choices there.
