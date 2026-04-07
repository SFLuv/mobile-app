# Send And Activity Polish Checklist

This checklist captures the latest tester feedback for the mobile app without changing behavior yet.

Branch context:
- Current working branch: `codex/geolocation-and-transaction-history-updates`
- Important merge context: PJ's `merchant-payment-flow` changes were meant to layer on top of the newer dev branch state, not replace it.
- Execution rule: preserve the newer merchant-payment-wallet / tip flow and current backend compatibility while restoring the intended history and send-screen polish from PJ's work where it still makes sense.

## P0: Send Screen Recipient Layout

- Remove the duplicate merchant presentation in the send flow.
  - Current issue:
    - the selected merchant can appear in multiple places at once:
      - raw address in the recipient input
      - resolved merchant card
      - contact/merchant suggestion card for the same address
  - Target behavior:
    - once a merchant/contact is resolved, show that recipient only once in the visible UI
    - raw address should become secondary, not the dominant visual element
    - the selected recipient should not remain duplicated in autocomplete results

- Stop pre-populating the send modal with a broad merchant suggestion block directly under the recipient field.
  - Current issue:
    - the recipient area shows a stack of merchants immediately, then another nearby-merchants block later
    - this makes the screen feel crowded and duplicates locations
  - Target behavior:
    - autocomplete results should appear only when the user is actively typing or searching
    - merchants and contacts should still be searchable from the recipient field
    - idle/default state should not dump a list of merchants under the input

- Keep the send form order clear and compact.
  - Desired order:
    1. recipient input / recipient resolution
    2. amount entry
    3. nearby merchants
    4. notes
    5. swipe-to-send dock
  - Notes:
    - nearby merchants should support discovery, but not crowd the amount field
    - if PJ's location-aware suggestion logic improves this, preserve it while keeping the screen visually simpler

## P0: Nearby Merchant Behavior

- Keep nearby merchants as a secondary discovery surface, not the primary send UI.
  - Current issue:
    - merchant suggestions and nearby merchants both render prominently, creating duplication
  - Target behavior:
    - nearby merchants should live in a dedicated section lower in the form
    - the section should complement search/autocomplete, not compete with it

- Preserve the "closest merchant wins" behavior within the proximity threshold.
  - Requirement:
    - if multiple merchants are within 100ft, the suggested merchant should be the nearest one
  - Notes:
    - keep PJ's geolocation-aware work intact where possible

## P1: Refresh Indicator In Dark Mode

- Restore PJ's refresh affordance styling in dark mode.
  - Current issue:
    - the refresh icon/spinner is not visually obvious in dark mode
  - Target behavior:
    - refresh state should use the app highlight color in dark mode
    - the refresh affordance should look intentional and noticeable when a reload is happening

- Check both wallet-home and activity refresh controls.
  - Relevant surfaces:
    - wallet pull-to-refresh
    - activity pull-to-refresh
    - any explicit refresh icon or inline loading indicator added by PJ's history work

## P1: Transaction Details Modal Cleanup

- Redesign the transaction details modal to read like a clean details sheet.
  - Current issue:
    - lower portion looks visually strange / semi-transparent
    - bottom action banner creates awkward spacing
    - close affordance is duplicated
  - Target behavior:
    - simple full-sheet detail layout
    - all key transaction fields fit cleanly on one screen where possible
    - one close affordance only
    - `View on explorer` should sit inline near the transaction hash / id, not in a separate bottom banner

- Remove the bottom action bar if it is only being used for close/explorer actions.
  - Keep:
    - readable transaction fields
    - clear explorer link
  - Remove:
    - awkward bottom chrome that stretches the layout

## P1: Wallet Transaction Preview Rows

- Add better recipient identity to wallet transaction preview rows.
  - Current issue:
    - preview rows on the wallet page can lack name/address context
  - Target behavior:
    - if the counterparty is a saved contact, show contact name
    - if the counterparty is a known merchant, show merchant name
    - otherwise show a standard shortened crypto address

- Keep the preview rows lightweight but informative.
  - Notes:
    - this is the wallet-home preview, not the full activity detail view
    - the row should still immediately communicate who the transfer was to/from

## Implementation Notes

- Review PJ's changes before editing the send/history UI again.
  - Relevant branch:
    - `origin/pjol/merchant-payment-flow`
  - Focus areas:
    - transaction history refresh behavior
    - refresh indicator styling
    - activity modal layout intent
    - nearby merchant placement and geolocation logic

- Preserve current newer behavior while polishing:
  - swipe-to-send
  - backend wallet lookup for merchant payment wallets
  - post-payment tip prompt
  - current live-backend compatibility

- Do not reintroduce:
  - duplicated merchant/contact cards for the same address
  - top-heavy merchant lists in the send modal
  - the old jittery broad refresh behavior

## Likely Files To Touch Later

- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/src/screens/SendScreen.tsx`
- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/src/screens/WalletHomeScreen.tsx`
- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/src/screens/ActivityScreen.tsx`
- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/src/components/TransactionDetailsModal.tsx`
- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/App.tsx`
- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/src/utils/location.ts`
