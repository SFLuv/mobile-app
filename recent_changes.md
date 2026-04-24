# Recent Changes Handoff

Generated on 2026-04-24 for continuation in a new GPT-5.5 chat.

This file summarizes the conversation and implementation context from commit `25c9a58` (`improver panel check in`) through the current branch state, so a new model can pick up without re-deriving recent decisions.

## Git Anchor

- Branch: `pjol/improver-panel`
- Base commit: `25c9a58` - `improver panel check in`
- Current HEAD at time of export: `162a741` - `navbar fix?`
- Commits after `25c9a58`:
  - `cfa3a71` - `send flow check in`
  - `4d4e3e0` - `wallet chooser, qr scanning, receive page, and navigation animation check-in`
  - `162a741` - `navbar fix?`
- Diff summary from `25c9a58..HEAD`:
  - `mobile/App.tsx`
  - `mobile/src/components/ScannerCornerGuide.tsx`
  - `mobile/src/components/TransactionDetailsModal.tsx`
  - `mobile/src/screens/ActivityScreen.tsx`
  - `mobile/src/screens/ReceiveScreen.tsx`
  - `mobile/src/screens/SendScreen.tsx`
  - `mobile/src/screens/SettingsScreen.tsx`
  - `mobile/src/screens/WalletHomeScreen.tsx`
  - `mobile/src/types/preferences.ts`
  - `mobile/src/utils/transactions.ts`
- Working tree note at time of export:
  - `preview/new-send-flow.html` is present under `preview/` and the `preview/` directory is currently untracked.

## Baseline At `25c9a58`

That commit was the main improver-panel check-in. It touched:

- `mobile/package-lock.json`
- `mobile/package.json`
- `mobile/src/screens/ImproverScreen.tsx`
- `mobile/src/services/appBackend.ts`

Before the later refinements below, the mobile app had already been updated to translate the improver panel from `../app` into mobile, including:

- requesting improver status
- requesting credentials
- viewing the workflow board
- claiming workflows
- completing workflows
- viewing and requesting payout for unpaid workflows
- viewing credentials and badges
- bottom-nav swap for approved improvers:
  - `Wallet / Improver / Map / More`
  - `More` contains `Activity` and `Contacts`
- settings entry point into the improver flow/panel

## Conversation Timeline And Product Decisions

### 1. Improver panel follow-up after `25c9a58`

User request:

- reduce improver-panel loading time
- paint panel tabs immediately when screen opens
- lazy-load heavy data as needed
- merge `Mine`, `Board`, `Unpaid`, and `Absence` into one `Workflows` tab
- use a dropdown for:
  - `My workflows`
  - `Workflow board`
  - `Unpaid workflows`
- only show `Unpaid workflows` if the user has unpaid workflows
- move absence coverage into edit mode on `My workflows`
- allow multi-select workflows
- let user revoke selected workflows or set an absence period on selected workflows
- show absence state on the workflow card
- allow `Revoke absence` from workflow detail if still reclaimable
- merge `Badges` and `Credentials` into a single `Credentials` tab
- add a `My badges` button that opens a dedicated badges page with back/swipe-back
- make badges searchable
- keep credential request search below it
- show search suggestions only after typing, and at most 4
- keep request history below that
- make workflow UI less verbose and closer to the web app
- do not show workflow/step/item IDs in the UI
- show submitted photos instead of just `photos: 1`
- make workflow items and chosen responses clearer
- ensure workflow item completion works correctly for both live photos and uploaded photos
- fix safe-area / top overlap issues where some close buttons or headers sit too high on notched iPhones

Implementation summary:

- `mobile/src/screens/ImproverScreen.tsx`
  - changed the panel to render its shell first and lazy-load heavier data by need
  - grouped workflow-related content into a consolidated `Workflows` flow
  - tightened the workflow UI and removed excess explanatory text
  - made workflow details more useful and closer to the web presentation
  - improved absence-edit behavior and absence indicators
  - improved rendering of step items and submitted responses
  - supported both live camera capture and library uploads for workflow photos
- `mobile/src/services/appBackend.ts`
  - added/fixed backend helpers needed for authenticated workflow photo preview and related improver operations
- `mobile/package.json`
  - added the dependency needed for library photo upload support

Reported verification at the time:

- `npm run typecheck` passed
- no simulator/device pass was done during that turn

### 2. Payment send-flow redesign

User request:

- make send a multi-step flow instead of a single screen
- step 1 should be recipient selection only
- remove the nearby merchants component
- use the existing search suggestion style with max 5 merchant/contact suggestions at once
- shorten the input helper text to `Search or paste an address`
- include a `Continue` button for manual address entry
- auto-continue when a contact or merchant is selected
- step 2 should focus mostly on amount entry
- use a custom number pad matching app styling instead of the system keypad
- show a small `To {recipient}` indicator above the amount
- show a small balance indicator
- add an `Add a note` field
- when note input is focused, hide the custom keypad and use the default keyboard
- keep the slide-to-send interaction, but remove extra helper text under it
- keep a back button and swipe-back behavior
- after swipe-to-send, show full-screen `Sending`
- success screen should show a large animated checkmark and terse success message
- failure screen should show a large animated X and terse failure message
- failure should have `Try again` and `Done`
- success should support a tip flow when tipping is enabled
- tip options: `10%`, `15%`, `20%`, `Custom`
- only show tip presets the remaining balance can cover
- successful tip should show a sending/loading state, then success, then return to wallet after 2 seconds
- failed tip should show an error, clear the chosen tip amount, and revert buttoning so the user can try again
- overall messaging should stay very terse

Implementation summary:

- `mobile/src/screens/SendScreen.tsx`
  - rebuilt the send experience into a recipient step and amount step
  - added custom keypad behavior
  - added result states for sending, success, failure
  - implemented tip selection and tip send flow
- `mobile/App.tsx`
  - updated routing/shell behavior so the send result returns to the wallet page
  - removed the older global-send toast path so the new full-screen flow owns feedback

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 3. App name / metadata + transaction modal improvements

User request:

- change app name references from `SFLUV Wallet` to `SFLuv`
- update the always-visible top message to match
- allow tapping a recent transaction in the wallet home screen to open the same modal used in Activity
- improve the activity transaction modal:
  - full-screen dark backdrop
  - backdrop should fade independently instead of sliding with the sheet
  - user should be able to swipe down from the `Transaction Details` title/header area to close

Implementation summary:

- `mobile/App.tsx`
  - updated the in-app title bar text to `SFLuv`
  - updated the default wallet subtitle/tagline to `Fast SFLuv payments`
- `mobile/app.config.ts`
  - was checked and already had the packaged app metadata set to `SFLuv`
- `mobile/src/screens/WalletHomeScreen.tsx`
  - wired recent activity rows to open the shared transaction-detail modal
- `mobile/src/components/TransactionDetailsModal.tsx`
  - changed the modal to use a full-screen fading backdrop with a separately animated sheet
  - added swipe-down-to-close from the header area
- `mobile/src/utils/transactions.ts`
  - added shared transaction-label / transaction-detail helper logic used across wallet home and Activity
- `mobile/src/screens/ActivityScreen.tsx`
  - aligned usage with the shared helpers/modal behavior

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 4. Wallet chooser modal polish

User request:

- fix the wallet chooser modal close button so it sits properly inside the modal header
- remove the `Switch between your...` helper subtitle

Implementation summary:

- `mobile/App.tsx`
  - constrained the chooser-header layout so the `x` stays inside the top-right corner
  - removed the subtitle/helper copy

Reported verification at the time:

- `npm run typecheck` passed

### 5. Setting for default send mode + inline QR scanning

User request:

- add a general-settings behavior option that chooses the default send entry mode:
  - manual flow
  - QR scanning mode
- in the send flow, QR scanning should happen inline on the recipient step instead of on a separate full-screen scanner
- the scanner overlay should show only the corners, not a full box
- the same corner-only overlay should be used for the `redeem qr` scanner as well

Implementation summary:

- `mobile/src/types/preferences.ts`
  - added the preference for default send entry mode
- `mobile/src/screens/SettingsScreen.tsx`
  - added the settings UI in the app-behavior section
- `mobile/App.tsx`
  - persisted and passed the preference into the send flow
- `mobile/src/components/ScannerCornerGuide.tsx`
  - added a reusable corner-only scanner overlay
- `mobile/src/screens/SendScreen.tsx`
  - changed the recipient step into `Manual` and `Scan` tabs
  - embedded the QR camera view inline as a square on the send screen
- `mobile/src/screens/ReceiveScreen.tsx`
  - reused the same corner-only scanner overlay for redeem-code scanning

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 6. Receive-screen overhaul

User request:

- make the receive screen fit on a single page with no scrolling
- add a toggle at the top for `Link` and `Address`
- `Link` mode should use a payment link
- `Address` mode should use the plain address
- show the QR under that toggle
- replace the `ready to scan` text in the top-right of the QR component with a copy button
- under the QR, show a very small single-line shortened address or shortened link
- bottom button should say `Redeem code` instead of `Redeem QR`

Implementation summary:

- `mobile/src/screens/ReceiveScreen.tsx`
  - rebuilt the screen into a fixed single-page layout
  - added the `Link / Address` toggle
  - used the universal pay link for link mode
  - moved the copy button into the QR-card header
  - added a one-line shortened-value caption under the QR
  - renamed the bottom action to `Redeem code`

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 7. Send / receive slide-over navigation

User request:

- send and receive should animate open like they are sliding over the wallet page from the right
- user should be able to swipe from the left edge to go back to wallet

Implementation summary:

- `mobile/App.tsx`
  - changed the shell so wallet home stays mounted underneath
  - added a sliding overlay for send and receive
  - added left-edge swipe-to-close for both flows
  - aligned the receive back button with the same animated close behavior
- `mobile/src/screens/SendScreen.tsx`
  - removed the older send-only edge-swipe implementation so the shell handles it consistently

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 8. Bottom navigation bar visual cleanup

User request:

- bottom nav background had too much bottom padding/margin and none above
- large bottom inset was only originally for some Android devices and should not remain that large on iPhones
- keep some spacing, but make it more balanced and reasonable
- add matching spacing above the component too
- make the nav background translucent rather than opaque
- if possible, give it a liquid-glass feel

Implementation summary:

- `mobile/App.tsx`
  - reworked the nav-shell spacing around the dock
  - reduced iPhone bottom inset while keeping a bit more room on Android
  - made the top/bottom spacing more symmetrical
  - changed the dock background to a translucent layered glass-like treatment
  - adjusted toast positioning so it still clears the dock

Reported verification at the time:

- `npm run typecheck` passed
- no device/simulator pass was done during that turn

### 9. HTML preview artifact for the new send/receive flow

User request:

- create an HTML rendering of:
  - wallet screen
  - each step of the send flow
  - the send QR-scanner view
  - the receive screen
- include navigation between the views
- export it to `/preview/new-send-flow.html`

Implementation summary:

- `preview/new-send-flow.html`
  - created as a self-contained interactive mock with navigation between the requested views
- `preview/`
  - created to hold the export

Reported verification at the time:

- file structure was sanity-checked
- the HTML was not opened in a browser during that turn

## File Hotspots For A New Model

These are the main files worth reading first in a follow-up session:

- `mobile/App.tsx`
  - app shell, navigation, wallet chooser, nav dock styling, send/receive slide-over handling, preferences plumbing
- `mobile/src/screens/ImproverScreen.tsx`
  - improver panel UI, lazy loading, workflows, absence flow, credentials/badges flow
- `mobile/src/services/appBackend.ts`
  - improver backend helpers, workflow detail/photo helpers, general backend wiring
- `mobile/src/screens/SendScreen.tsx`
  - multi-step send flow, inline QR scan, amount keypad, note input, send result states, tipping
- `mobile/src/screens/ReceiveScreen.tsx`
  - single-page receive layout, link/address toggle, QR, redeem-code scanner
- `mobile/src/screens/SettingsScreen.tsx`
  - send-mode preference UI and improver entry point
- `mobile/src/screens/WalletHomeScreen.tsx`
  - recent-activity interaction from wallet home
- `mobile/src/screens/ActivityScreen.tsx`
  - transaction modal usage in the activity tab
- `mobile/src/components/TransactionDetailsModal.tsx`
  - modal animation, backdrop behavior, swipe-down dismissal
- `mobile/src/components/ScannerCornerGuide.tsx`
  - shared corner-only scan overlay
- `mobile/src/utils/transactions.ts`
  - transaction label/detail formatting helpers
- `mobile/src/types/preferences.ts`
  - stored app preference types for send-mode default
- `preview/new-send-flow.html`
  - visual reference artifact for the updated wallet/send/receive flow

## Validation Status

Across the implementation waves above, the repeated reported verification was:

- `npm run typecheck` passed after each feature wave

What has not been fully validated in-chat:

- no complete simulator pass was performed
- no device pass was performed
- no explicit end-to-end improver workflow validation was performed on a real improver account
- no real-device QR/camera validation was performed for:
  - send scan
  - redeem code
  - live workflow photo capture
  - workflow library photo uploads
- no direct iPhone/Android visual safe-area comparison was done for the final nav-dock treatment
- the HTML preview was not opened in a browser during the chat

## Recommended Next Checks

If a new model picks this up, the highest-value follow-up checks are:

1. Run a real device/simulator pass on the send flow:
   - manual recipient
   - contact/merchant recipient
   - QR recipient
   - note input
   - send success
   - send failure retry
   - tip success/failure

2. Run a real device/simulator pass on the receive flow:
   - link mode
   - address mode
   - copy button behavior
   - redeem-code scan

3. Run an improver-account pass:
   - initial improver load time
   - workflows dropdown behavior
   - unpaid visibility logic
   - absence edit flow
   - absence revoke flow
   - workflow detail rendering
   - live photo and upload-photo completion

4. Check safe areas and gesture feel on notched iPhones:
   - modal close buttons
   - top headers
   - send/receive overlay swipe-back
   - transaction modal swipe-down

5. Check nav-dock appearance on both iPhone and Android:
   - translucency
   - top/bottom spacing balance
   - interaction with scrolling content
   - interaction with system navigation/buttons

6. Open `preview/new-send-flow.html` in a browser and compare it to the latest in-app implementation.

## Short Resume Prompt For The Next Model

If you want a compact prompt seed for the next chat, use this:

> We are on branch `pjol/improver-panel`. Please continue from `recent_changes.md`, using commit `25c9a58` as the handoff anchor. The mobile app already has a translated improver panel, a redesigned multi-step send flow, a single-page receive flow, shared transaction modals, inline QR scanning, send/receive slide-over navigation, and a glassy bottom nav. Read the hotspot files listed in `recent_changes.md`, check the current working tree, and continue from there.
