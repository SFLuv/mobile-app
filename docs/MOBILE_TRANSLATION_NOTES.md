# Mobile Translation Notes

Purpose: keep the mobile app in feature parity with the web app without making the mobile app feel like a compressed desktop dashboard.

## Source Of Truth

- Web repo to study before translating a feature: `SFLUV/app`
- User instruction for future web-side work:
  - switch to the dev-style branch the team uses for bespoke AA integration
  - pull/merge the latest `codex/w9-compliance-hotfix` changes before making web updates
- Mobile repo that receives the translation: `sfluv-wallet-platform/mobile`

## Product Rules

- Web stays map-first.
- Mobile stays wallet-first.
- Do not invent mobile-only product features unless explicitly requested.
- Preserve the same backend behavior and data model wherever possible.
- Hide AA infrastructure details from normal users.
- Keep `legacy` + `new` route support as infrastructure, not as the primary UX.

## Translation Heuristics

When a new web feature appears, classify it first:

1. `Wallet core`
- send
- receive
- QR
- activity
- contacts
- wallet notifications
- wallet settings

Rule:
- translate these to native mobile first
- these belong in `Wallet`, `Activity`, or `Settings`

2. `Map / merchant discovery`
- merchant map
- merchant details
- merchant status
- merchant application

Rule:
- mobile gets these, but as a secondary surface
- mobile can simplify the layout, but should preserve the same capability

3. `Heavy ops / admin / workflow`
- admin panel
- issuer
- supervisor
- voter
- improver
- dense review tables
- event/code generation

Rule:
- keep these web-first unless the team explicitly asks for mobile support

## Current Feature Mapping

Web `map/page.tsx`
- Mobile equivalent: `MapScreen.tsx`
- Keep map browsing and location details
- Do not let map overtake the wallet as the default landing experience

Web wallet detail/send/receive/history
- Mobile equivalents:
  - `WalletHomeScreen.tsx`
  - `SendScreen.tsx`
  - `ReceiveScreen.tsx`
  - `ActivityScreen.tsx`
- Mobile should optimize for fewer taps, bigger touch targets, and fast QR access

Web contacts page
- Mobile equivalent: contacts section inside `SettingsScreen.tsx`
- Contacts should support send-flow suggestions and shared backend sync when available

Web merchant approval form
- Mobile equivalent: `MerchantApplicationScreen.tsx`
- Same backend payload, but mobile-native entry flow

Web settings / verified emails / email alerts
- Mobile equivalent: `SettingsScreen.tsx`
- Preserve the existing email-alert model first
- Add native push later without changing the screen hierarchy

## Implementation Sequence For Future Translations

For every new web feature:

1. Read the web page/component and identify:
- screen entry point
- backend endpoints used
- required auth/role state
- whether it is user-facing or ops-facing

2. Decide the mobile home:
- `Wallet`
- `Activity`
- `Map`
- `Settings`
- or explicitly `web-only`

3. Translate the data flow first:
- same endpoint if possible
- same auth model if possible
- same persisted records if possible

4. Translate the UX second:
- reduce dense tables into cards/lists
- prefer one clear action per surface
- avoid desktop sidebars and multi-panel layouts
- for maps, fit the viewport to real merchant bounds on mobile instead of relying on a static city-center region
- when multiple merchants are very close together, mobile may need deterministic visual spreading of pins so all merchants remain discoverable without adding a full clustering system

5. Preserve existing priorities:
- if the feature touches payments, it should feel fast and first-class on mobile
- if the feature is auxiliary, it should not crowd the wallet path

## Theme Alignment

- Mobile visual tokens should come from the web app theme source, not from memory:
  - `frontend/app/globals.css` in the web repo
- Use the same background/card/primary/border palette first.
- Then adapt spacing and component density for touch instead of copying desktop layout literally.
- Current visual direction for the wallet shell:
  - white-first surfaces with SFLUV coral used for outlines, emphasis, and primary actions
  - warm charcoal only as a support neutral, not as a dominant brand color
  - wallet switching should stay off the main home canvas when possible; use a focused chooser modal instead
- For payment-heavy screens, prefer a single high-contrast hero card followed by one obvious primary action.
- `Send` and `Receive` should feel like dedicated payment tools, not generic forms:
  - quick actions first
  - large amount typography
  - contact suggestions embedded directly in the send flow
  - keep the structure closer to a payment app sheet than a general settings form
  - first-pass send surfaces should fit cleanly on one iPhone screen whenever possible; remove nonessential recap blocks before shrinking core actions
  - if the app shell already shows the page title and wallet route, do not repeat that header inside the payment screen

## Known Gaps

- Native push notifications still need backend support in the shared SFLUV app backend:
  - device token registration
  - token deletion/update
  - delivery pipeline
- Merchant application search depends on a client-usable Google Maps key
- When testing the mobile app against a local backend on a real phone, do not use `localhost`; use the host machine LAN IP instead
- If future wallet parity needs DB-backed wallet registration for both `legacy` and `new`, confirm the current web/backend branch actually contains the route-aware wallet schema before implementing

## Guardrails

- Do not touch unrelated web branches casually.
- If web changes are required, work from the correct team branch and sync it with the latest W9 hotfix branch first.
- Do not break the current mobile prototype’s AA route behavior while polishing the UI.
- If a web feature is too desktop-specific, document why it stays web-only instead of forcing a poor mobile translation.
