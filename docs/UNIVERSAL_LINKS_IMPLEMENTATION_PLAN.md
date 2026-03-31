# Universal Links Implementation Plan

Goal: ship iOS universal-link support for three QR/link flows without breaking existing raw-address or EIP-681 scanning.

Routes:
- `https://app.sfluv.org/pay/<address>`
- `https://app.sfluv.org/redeem/<code>`
- `https://app.sfluv.org/request/<address>?amount=<sfluv>&memo=<memo>`

Decisions locked:
- `pay` and `request` embed wallet address directly in path
- `redeem` embeds redeem code directly in path
- `request.amount` is human-readable SFLUV, not wei
- install/download is the primary fallback UX
- web-wallet fallback comes later for `pay` and `request`
- merchant payouts follow current prod wallet behavior

## Phase 0: Shared parsing contract

Create one canonical parser shape and reuse it everywhere.

Needed output types:
- `pay`: `{ type: "pay"; address: string }`
- `redeem`: `{ type: "redeem"; code: string }`
- `request`: `{ type: "request"; address: string; amount?: string; memo?: string }`

Rules:
- only accept hostname `app.sfluv.org`
- lowercase and checksum-normalize addresses after validation
- parse `amount` as decimal SFLUV string, not wei
- URL-decode `memo`
- normalize redeem code using the same logic as web/backend redeem path

Do this first:
- mobile parser util
- frontend parser util
- optionally shared copy/paste of redeem normalization rules if no shared package is worth creating

## Phase 1: Mobile universal-link intake

Files likely involved:
- `mobile/app.config.ts`
- `mobile/App.tsx`
- `mobile/src/screens/SendScreen.tsx`
- new utility file for link parsing/routing

Tasks:
- add `ios.associatedDomains` for `applinks:app.sfluv.org`
- keep existing `scheme: "sfluvwallet"`
- add app startup handler for initial URL
- add runtime listener for URLs opened while app is running
- centralize routing so OS-opened links and scanned HTTPS QR links use the same code path

Routing behavior:
- `/pay/<address>` -> open send pane with recipient prefilled
- `/redeem/<code>` -> open redeem flow / redeem loader
- `/request/<address>` -> open send pane with recipient + optional amount/memo prefilled

Do not regress:
- raw `0x...` QR support
- current EIP-681 parser support

## Phase 2: Redeem first

Reason:
- highest-value universal-link flow
- already backed by real backend semantics
- least new product ambiguity

Files likely involved:
- `mobile/App.tsx`
- possibly new redeem-specific mobile state/UI module
- `frontend/app/faucet/redeem/page.tsx`
- new `frontend/app/redeem/[code]/page.tsx` or redirect wrapper
- `frontend/lib/redeem-link.ts`

Mobile tasks:
- if unauthenticated, drive login first
- once wallet runtime is ready, submit existing backend `/redeem` request with selected wallet address
- preserve current error mappings:
  - code not started
  - code expired
  - code redeemed
  - user redeemed
  - W9 required/pending if backend returns it

Web tasks:
- add path-based redeem entry route
- route path-based code into existing redeem experience
- keep install/download as primary CTA
- keep web-wallet continue as secondary option only for redeem

Generator task:
- replace current legacy CitizenWallet plugin redeem QR generation with `https://app.sfluv.org/redeem/<code>`

Acceptance:
- installed app: Camera scan opens app and redeems
- no app: link opens install-first page
- web fallback still works if user explicitly continues there

## Phase 3: Merchant pay links

Files likely involved:
- `mobile/App.tsx`
- `mobile/src/screens/SendScreen.tsx`
- web merchant QR generation path in `Projects/SFLUV_Dev/app`
- backend wallet lookup routes if needed

Plan:
- generate merchant QR as `https://app.sfluv.org/pay/<merchantDefaultWalletAddress>`
- mobile universal-link router opens send flow with recipient locked/prefilled
- after recipient is set, call current wallet lookup logic to display merchant name if available

Need to decide during implementation:
- whether current auth-protected `/wallets/lookup/:address` is enough for in-app display after login
- whether we need a public-safe merchant preview endpoint later for prettier fallback pages

Phase 3 v1 fallback page:
- install/download first
- no need to build web-wallet pay immediately

Acceptance:
- merchant QR from web app opens mobile send flow
- recipient matches current prod merchant payout wallet
- merchant label appears once lookup completes

## Phase 4: User request links

Files likely involved:
- `mobile/src/screens/ReceiveScreen.tsx`
- `mobile/src/screens/SendScreen.tsx`
- mobile link parser/router
- optional web fallback route in `Projects/SFLUV_Dev/app`

Plan:
- replace receive QR generation with `https://app.sfluv.org/request/<address>?amount=<amount>&memo=<memo>`
- amount stays as user-facing SFLUV decimal string
- memo is optional
- scanning/opening should prefill recipient/amount/memo in send flow

Keep simple for v1:
- no backend-issued request tokens
- no expirations
- no revocation
- no analytics

Acceptance:
- user A creates QR from selected wallet
- user B scans it
- send flow opens with correct recipient
- optional amount and memo prefill cleanly

## Web fallback structure

Needed routes in web app:
- `/pay/[address]`
- `/redeem/[code]`
- `/request/[address]`

Desired behavior:
- show SFLUV branding
- primary CTA is app install / open app
- `redeem` may expose existing web fallback path
- `pay` and `request` can stay install-first initially

Do not overbuild first pass.

## Apple / platform plumbing

Needed in web app:
- host `/.well-known/apple-app-site-association`
- include:
  - `/pay/*`
  - `/redeem/*`
  - `/request/*`

Needed in mobile:
- associated domains entitlement via Expo config
- development build for real testing

Remember:
- cannot fully validate universal links in Expo Go
- use dev build once Apple signing is ready

## Implementation order

1. Shared parser contract
2. Mobile universal-link intake
3. Web AASA + route scaffolding
4. Redeem route end to end
5. Merchant pay route
6. Request route
7. Later: web-wallet fallback for pay/request

## Verification checklist

Mobile:
- cold open from each universal link route
- warm open from each universal link route
- scan same URLs inside in-app QR scanner
- malformed links fail cleanly

Redeem:
- valid code
- expired code
- already redeemed code
- user already redeemed
- W9 blocked path if relevant

Pay/request:
- address normalization works
- request amount parses as token amount, not wei
- memo survives URL encoding/decoding

## Do not forget

- keep existing raw address and EIP-681 support during rollout
- do not break Privy OAuth scheme callbacks
- do not block app open on merchant metadata lookup
- redeem flow should wait for wallet readiness, but not bounce the user through multiple loading screens
