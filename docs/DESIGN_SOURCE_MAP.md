# Design source map

Which design file a developer should implement from. Updated 2026-10-08 after Stage 5 was approved as functionally and visually frozen.

## Rule of thumb

1. **Voucher journeys (discovery, detail, checkout, payment states, My Vouchers, QR / code, receipt, refunds, staff voucher redemption, merchant voucher builder, admin voucher review and finance):** the current MVP visual source of truth is **`figma-handoff/stage5/`** together with **`docs/STAGE5_FIGMA_HANDOFF.md`** (and `docs/STAGE5.md` for behaviour).
2. **Exclusive Deals, free reservations, staff scanner and results:** `figma-handoff/stage4/` and `docs/STAGE4_FIGMA_HANDOFF.md`.
3. **Everything else:** the approved originals in `Figma Files/dealdash-figma/` plus the approved portal designs, as modified by `docs/DEALDASH_CUSTOMER_MVP_FINAL.md`.
4. The historical files under `Figma Files/` are **never deleted or edited**. They stay as reference. A screen marked OUTDATED below must not be implemented from the original file.

## Original Customer screens that are OUTDATED / SUPERSEDED FOR MVP

| Original screen | File (`Figma Files/dealdash-figma/png` and `svg`) | Status | Why it must not be implemented | Replaced by (Stage 5 handoff frames) |
|---|---|---|---|---|
| 09 Explore - Vouchers | `09 Explore - Vouchers` | **OUTDATED / SUPERSEDED FOR MVP** | Gift button on every card (gifting), "Pay X / Get Y" and "Save N%" claims, "Buy / My vouchers" switch, "Best Deal for Me" banner, Reviews / Watch & Earn / Rewards tab bar | `VC01` Home vouchers rail, `VC02` Vouchers discovery, `VC03` voucher card states; `VC19`-`VC22` My Vouchers (replaces the "My vouchers" switch); `VC08` not available |
| 22 Deal - Voucher | `22 Deal - Voucher` | **OUTDATED / SUPERSEDED FOR MVP** | "Buy as a gift", star reviews, video "watch to earn points", "use in one visit or several" (partial redemption), "Sale ends" counters as social pressure | `VC04` voucher detail, `VC05` locked, `VC06` sold out, `VC07` ended / limit reached / not on sale |
| 28 Checkout - voucher | `28 Checkout - voucher` | **OUTDATED / SUPERSEDED FOR MVP** | Contact e-mail field, "874+ bought", quantity stepper, "Buy as a gift", promo code, loyalty-points payment, saved cards (Visa, Mastercard, mada, Apple Pay, STC Pay), "VAT included" claim | `VC09` checkout, `VC10` terms error, `VC11` retry after failure, `VC12` hold expired, `VC13` payment page (provider hosted), `VC14`-`VC17` payment states |
| 29 Checkout - gift with promo | `29 Checkout - gift with promo` | **OUTDATED / SUPERSEDED FOR MVP** (gifting and promo codes are Phase 2) | Gift checkout with promo code | No Stage 5 frame (not in the MVP). Use `VC09` |
| 30 Checkout - gift voucher card | `30 Checkout - gift voucher card` | **OUTDATED / SUPERSEDED FOR MVP** (gifting is Phase 2) | Gift voucher card | No Stage 5 frame (not in the MVP) |
| 32 Code - voucher | `32 Code - voucher` | **OUTDATED / SUPERSEDED FOR MVP** | "Spend your SAR 100 in one or more visits" (partial redemption) | `VC23` active ticket (QR + manual code), `VC24` used, `VC25` expired, `VC26` refunded, `VC27` refund in progress, `VC36` refund under review |
| 33 Receipt sheet | `33 Receipt sheet` | **OUTDATED / SUPERSEDED FOR MVP** | Paid reservation-token receipt, "Paid with Visa ••4417" (card data never shown), token credited to bill | `VC18` payment success and order reference; `VC23` ticket (order reference, price paid). A downloadable receipt / tax invoice is not designed (VALIDATE-KSA) |
| 53 My Deals - payments | `53 My Deals - payments` | **OUTDATED / SUPERSEDED FOR MVP** | Paid-token payments tab, total paid / refunded banner, token "held until redeemed" rows, saved-card text | `VC19`-`VC22` My Vouchers (Active, Used, Expired, Refunded), `VC30` refund status wording |

Also partly superseded (not on the list above, but do not copy the outdated parts): **52 My Deals - active** (reservations and vouchers mixed, five-tab bar with Watch & Earn and Rewards before they existed) is replaced by `VC19` for vouchers and by the Stage 4 My Deals for reservations.

## Concepts that stay OUT of the MVP wherever they appear in an original

Gifting, promo codes, loyalty points as a payment method, partial redemption, saved-card selection inside DealDash, social-proof counters ("874+ bought"), streaks, milestones, "points equal seconds watched", "10 points = SAR 1" or any SAR value per point, Play & Win. See `docs/DEALDASH_CUSTOMER_MVP_FINAL.md` sections 8 to 10 and `docs/DEALDASH_UX_ARCHITECTURE.md`.

## Watch & Earn and Rewards (Stage 6)

The original screens 37, 39, 40, 41, 48, 49, 50 and 51 contain removed concepts (streak, daily goal, milestone claim, Play & Win entry, "Points equal seconds watched", "10 points = SAR 1", "Worth SAR..." on catalogue items, payments tab inside Rewards). Stage 6 implements them as described in `docs/DEALDASH_CUSTOMER_MVP_FINAL.md` sections 9 and 10 and records the result in `docs/STAGE6.md`.


## Commercial terms (shared across Vouchers, Exclusive Deals and Watch & Earn)

No original design exists for the commercial summary, the acknowledgement, the funding panel or the DealDash finance workspace. They are built with the existing design system (cards, key-value lists, status chips, checkboxes, tables) and are listed in docs/COMMERCIAL_FINANCE.md. A visual pass in Figma is still to be done; until then these screens are functional drafts. The original merchant campaign wizards (live-deal builder, voucher builder, watch builder) gain a commercial section in the Review step; the original admin finance screens are unchanged and the new /commercial workspace sits beside them.
