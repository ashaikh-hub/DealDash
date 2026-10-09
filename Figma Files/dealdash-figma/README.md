# DealDash screens for Figma

> **Design source status (2026-10-08).** Customer screens **09, 22, 28, 29, 30, 32, 33 and 53 are OUTDATED / SUPERSEDED FOR MVP.** Do not implement them from these files; they are kept as history only. Use `figma-handoff/stage5/` and `docs/STAGE5_FIGMA_HANDOFF.md` for all Voucher journeys. Mapping: [docs/DESIGN_SOURCE_MAP.md](../../docs/DESIGN_SOURCE_MAP.md).

63 screens at 390 px wide (long screens are exported full length).

## What is in this folder
- `svg/` editable vector frames: text stays text, shapes stay shapes. Drag into Figma.
- `png/` exact 2x renders. Use as the visual reference, or place on top to compare.
- `design-tokens.json` colours (light and dark), type, radii, shadow, spacing.
- `dealdash-prototype.html` the live prototype.

## Import into Figma
1. Install the font **Plus Jakarta Sans** (free in Figma and Google Fonts) so text keeps its shape.
2. In Figma, open a new design file. Select all files in `svg/` and drag them onto the canvas. Each screen arrives as a separate frame-sized group.
3. Select each group and press **Ctrl/Cmd + Alt + G** to turn it into a Frame, then rename it (the file name is the screen name).
4. Optional: Frames > Auto layout and create colour and text styles from `design-tokens.json`.

**Note on the SVGs:** they are generated from the prototype, so they are an editable starting point. A few effects do not carry over exactly (soft gradient fades on photos and some image corner rounding). The PNGs are exact. For a one-click pixel-and-layer import of the live app, use the Figma plugin *html.to.design* with the prototype URL.

## Screen list

### Start
- 01 Sign in

### Home
- 02 Home - Food and Drink
- 03 Home - Electronics
- 04 Home - Location sheet
- 05 Home - Notifications
- 06 Home - Best Deal for Me

### Explore & offers
- 07 Explore - Live Deals
- 08 Explore - Hot Deals
- 09 Explore - Vouchers  **(OUTDATED / SUPERSEDED FOR MVP: see VC01-VC03, VC19-VC22)**
- 10 Explore - Bank Cards
- 11 Explore - Employer - not verified
- 12 Explore - Live Deals map
- 13 Explore - Offers by Riyad Bank
- 14 Employer - verification sheet
- 15 Employer - verified
- 16 Employer - employee pass

### Deal pages & sheets
- 17 Deal - Live overview
- 18 Deal - Details page
- 19 Deal - Reviews page
- 20 Deal - Hot limited reserve
- 21 Deal - Hot time-limited
- 22 Deal - Voucher  **(OUTDATED / SUPERSEDED FOR MVP: see VC04-VC08)**
- 23 Deal - Bank card offer 3 cards
- 24 Deal - Employer offer
- 25 Deal - Photo viewer
- 26 Deal - Reserve sheet
- 27 Deal - Write a review

### Checkout & codes
- 28 Checkout - voucher  **(OUTDATED / SUPERSEDED FOR MVP: see VC09-VC17)**
- 29 Checkout - gift with promo  **(OUTDATED / SUPERSEDED FOR MVP: gifting and promo are Phase 2)**
- 30 Checkout - gift voucher card  **(OUTDATED / SUPERSEDED FOR MVP: gifting is Phase 2)**
- 31 Code - reservation
- 32 Code - voucher  **(OUTDATED / SUPERSEDED FOR MVP: see VC23-VC27, VC36)**
- 33 Receipt sheet  **(OUTDATED / SUPERSEDED FOR MVP: see VC18, VC23)**

### Merchant pages
- 34 Merchant page - Offers
- 35 Merchant page - Info
- 36 Merchant page - Reviews

### Watch & Win
- 37 Watch and Earn
- 38 Play and Win - games
- 39 Reels - player
- 40 Reels - still watching check
- 41 Reels - instant reward unlocked
- 42 Game - Gift Box
- 43 Game - Spin the Wheel
- 44 Game - Scratch Card
- 45 Game - Memory Match
- 46 Game - Quick Quiz
- 47 Game - result

### Rewards
- 48 Rewards
- 49 Redeem points
- 50 Redeem - confirm sheet
- 51 Points activity
- 52 My Deals - active
- 53 My Deals - payments  **(OUTDATED / SUPERSEDED FOR MVP: see VC19-VC22, VC30)**
- 54 Savings

### Profile & cards
- 55 Profile
- 56 Profile - add card sheet
- 57 Profile - verify card sheet

### Business console
- 58 Business console - Campaigns
- 59 Business console - Redeem
- 60 Business console - Analytics
- 61 Business console - Boost
- 62 Business - Create Live Deal
- 63 Business - Create Hot Deal