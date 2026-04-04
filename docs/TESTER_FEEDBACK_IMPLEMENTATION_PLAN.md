# Tester Feedback Implementation Plan

This plan collates informal tester feedback into concrete workstreams.

Definitions:
- `Phase 1`: mobile-app-only changes. Safe to implement and test in the app without web/backend rollout.
- `Phase 2`: changes that require the shared web app and/or backend to be updated and deployed.

Priority labels:
- `P0`: blocks trust/usability during active testing
- `P1`: important polish or flow improvements
- `P2`: valuable follow-up, but not urgent

## Phase 1: Mobile App

### P0: Payment Flow UX

- Default send flow to QR scanning instead of manual entry.
  - Current issue: send opens in manual-entry mode and QR scan is hidden behind a small button.
  - Proposed change:
    - Make QR the default tab/view.
    - Add a visible switch between `Scan` and `Manual`.
    - Keep manual entry as an explicit fallback.
  - Notes:
    - Scanner should feel like the primary happy path.

- Remove or replace native alert popups for normal actions.
  - Current issue: Apple-style popups for copy/send states feel clunky and visually disconnected.
  - Proposed change:
    - Replace success/info alerts with in-app toasts or inline banners.
    - Keep blocking modals only for real errors or destructive confirmation.
  - Candidate cases:
    - copied address
    - transaction submitted
    - transaction confirmed

- Improve send confirmation UX.
  - Current issue: current flow feels basic and easy to misclick.
  - Proposed change:
    - Explore a `swipe to send` control similar to Citizen Wallet.
    - If swipe-to-send feels strong enough, remove the extra confirmation alert.
  - Notes:
    - This is both a UX improvement and an accidental-send guardrail.

- Improve keyboard behavior on send amount entry.
  - Current issue: dismissing the keyboard is awkward and the send button becomes inconvenient.
  - Proposed change:
    - Tapping outside the inputs dismisses the keyboard.
    - When keyboard is open, keep the primary send action visible.
    - Consider moving the send CTA above the keyboard area.
  - Optional follow-up:
    - evaluate a custom numeric keypad later if native keyboard still feels poor.

### P0: Live Updates / Refresh Behavior

- Remove jittery periodic refresh behavior.
  - Current issue: repeated automatic refresh causes visible page movement/jitter.
  - Status:
    - already adjusted locally; verify in the next test build.
  - Keep:
    - transfer-driven updates
    - foreground refresh
    - manual pull-to-refresh

- Tighten live balance/activity update ordering.
  - Current issue: testers see balance update first and transaction history later.
  - Proposed change:
    - Keep balance/activity refresh tied to detected transfers.
    - Reduce lag between balance refresh and activity refresh.
    - Ensure cached balance and fetched balance are reconciled consistently.

- Add explicit pull-to-refresh affordance.
  - Current issue: users are not sure whether swipe-down refresh exists.
  - Proposed change:
    - Add standard pull-to-refresh behavior where appropriate.
    - Show visible refresh feedback instead of silent reload.

- Fix stale cached balance fallback.
  - Current issue: when connectivity drops, balance can revert to an older cached value.
  - Proposed change:
    - Only fall back to cache when necessary.
    - Do not replace fresher known balance with older cached balance.
    - Track freshness timestamp/source in state.

### P1: Merchant Payment UX

- Show merchant identity in send flow, not just raw address.
  - Current issue: selecting a merchant from the map populates the send field with a hex address.
  - Proposed change:
    - carry merchant display name into the send draft
    - render merchant name/chip in the send UI
    - keep raw address secondary

- Include merchants in manual-send search results.
  - Current issue: typing merchant names into send only searches contacts, not merchants.
  - Proposed change:
    - merge payable merchants into search/autocomplete results
    - visually distinguish contacts vs merchants

- Improve merchant details actions.
  - Current issue: merchant detail screens show text but not enough live actions.
  - Proposed change:
    - make website tappable
    - make phone tappable
    - add direct links to Apple Maps / Google Maps

- Make merchant list mode more discoverable.
  - Current issue: users do not immediately realize there is a list under the map.
  - Proposed change:
    - ensure list toggle is obvious at initial open
    - keep map visible immediately but make list access more prominent

### P1: QR / Contact UX

- Improve QR scanner presentation.
  - Current issue: scanner feels generic and less polished than Citizen Wallet.
  - Proposed change:
    - use a square scan region
    - add a visible square overlay/frame
    - add scan success feedback, possibly subtle haptic

- Improve contact creation UX.
  - Current issue: adding contacts feels clunky.
  - Proposed change:
    - simplify manual add flow
    - later consider contact QR flow similar to Telegram
  - Notes:
    - lower priority than send/pay improvements

### P1: Theming / Shell

- Fix `System` theme preference behavior.
  - Current issue: `System` does not appear to pick up device appearance correctly.
  - Proposed change:
    - verify Appearance listener/state handling
    - ensure theme provider reacts to OS theme changes

- Remove layout-shifting top loading banners.
  - Current issue: temporary loading bars at top push content down.
  - Proposed change:
    - replace with non-layout-shifting treatment
    - options:
      - bottom toast/banner
      - inline skeleton/spinner
      - no banner for short loads

### P2: Merchant Branding

- Add merchant logo support in the mobile experience.
  - Current issue: map/details lack merchant-specific branding.
  - Proposed change:
    - show merchant logos in detail cards
    - later consider logos on markers if performance/readability hold up

## Phase 2: Web App / Backend / Shared Rollout

### P0: Universal Links

- Add dormant universal-link infrastructure and rollout plan.
  - Goal:
    - support app-first flows like scanning a volunteer/faucet QR and being directed into SFLUV app install/open flow.
  - Required components:
    - shared link routes on `app.sfluv.org`
    - Apple association file / Android app links
    - web fallback pages
    - mobile link handling
  - Rollout note:
    - keep public QR behavior stable until the full compatibility path is ready.

### P0: Merchant Tipping Support

- Add a first-class merchant tipping account in the shared backend.
  - Current issue:
    - backend stores merchant tipping metadata, but no dedicated tip payout address.
  - Proposed backend work:
    - add a tipping account column/field for merchants
    - expose it in merchant/public location payloads
  - Proposed web work:
    - let merchants configure tip account in the web wallet/admin surfaces
  - Proposed mobile work after backend exists:
    - allow `Pay merchant` flow to include a tip cleanly
    - decide whether this is:
      - a single split transaction abstraction, or
      - two coordinated transfers

### P1: Merchant Search / Identity Backed by Shared Data

- Improve merchant lookup/search behavior through shared backend.
  - Goal:
    - cleaner merchant identity in mobile send flow
    - unified merchant metadata across map/list/manual send
  - Possible shared changes:
    - public-safe merchant lookup endpoint
    - richer merchant payload including name/logo/category

### P1: Merchant Logos

- Add merchant logo upload/storage on the web app/backend.
  - Goal:
    - support QR printing, merchant branding, and map/detail presentation.
  - Required work:
    - upload/storage path
    - merchant settings UI
    - public payload exposure

### P2: Contact / QR Interop

- Design a better shared QR-based contact-add flow.
  - This likely touches both app and web patterns if we want a durable contact exchange format.

## Suggested Execution Order

### First pass

- Verify jitter fix in the new build.
- Fix system theme handling.
- Replace native success/info alerts with in-app feedback.
- Make QR scanning the default send entry point.
- Improve keyboard dismissal + send CTA behavior.

### Second pass

- Improve merchant identity in send flow.
- Add merchants into manual-send search results.
- Improve merchant detail actions and list discoverability.
- Improve scanner overlay/scan feedback.

### Third pass

- Scope and spec Phase 2:
  - universal links
  - merchant tipping account
  - merchant logo upload/shared metadata

## Open Questions

- For tips, should merchant payout and tip payout remain separate addresses by design?
- For swipe-to-send, should manual entry and QR entry share the exact same confirmation control?
- Should merchant logos appear only in detail/list views first, or also on map markers in the first release?
