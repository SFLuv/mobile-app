# SFLUV Wallet Mobile

Wallet-first Expo app for SFLUV, using the same Privy login and shared SFLUV app backend data model where possible.

## Current mobile surface

- Wallet-first shell with four primary sections:
  - `Wallet`
  - `Activity`
  - `Merchant Map`
  - `Contacts`
- Top-right `Settings` panel for app preferences and account details
- Privy OAuth login (`google`) and embedded wallet signer flow
- Legacy Citizen Wallet smart-account support only
- Auto-discovery across legacy smart-account indexes for the signed-in owner
- In-app wallet chooser when more than one legacy smart wallet is discovered
- QR-first send and receive flows
- Onchain recent activity with shared-backend memo overlay
- Shared contact sync through the SFLUV app backend
- Merchant map rendered natively on mobile
- Local light/dark theme preferences
- Phone haptics on send and receive

## Run

```bash
cd mobile
npm install
npx expo start --clear
```

## Expo Go team testing

This is the intended path for teammates testing on physical iPhones or Android devices.

1. Copy the local env template:

```bash
cd mobile
cp .env.example .env
```

2. Fill in the local-only values:
- `EXPO_PUBLIC_PRIVY_APP_ID`
- `EXPO_PUBLIC_PRIVY_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_MAP_ID`
- `EXPO_PUBLIC_APP_BACKEND_URL`

3. If you are testing from Expo Go on a real phone, do not leave `EXPO_PUBLIC_APP_BACKEND_URL` on `localhost`.
Use a host the phone can reach, usually your laptop LAN IP:
- `EXPO_PUBLIC_APP_BACKEND_URL=http://<lan-ip>:8080`

4. Start Expo in tunnel mode:

```bash
npx expo start --host tunnel --clear
```

5. Open the generated `exp://...` URL in Expo Go.

The app needs the shared SFLUV app backend running on `:8080` if you want synced profile, contacts, merchant status, activity data, and dynamic chain config.

These values are required for testing, but they are intentionally not committed to this repo.

Important:

- Expo Go is fine for wallet and backend testing.
- Expo Go cannot be used to properly test remote push notifications on this SDK.
- Real push-notification testing requires a development build. See [../docs/DEVELOPMENT_BUILD_SETUP.md](/Users/sanchezoleary/Projects/mobile-app-sanchezo/docs/DEVELOPMENT_BUILD_SETUP.md).

## Development build prep

This repo now includes the base files needed for an EAS development build:

- [app.config.ts](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/app.config.ts)
- [eas.json](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/eas.json)
- `expo-dev-client` in [package.json](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/package.json)

Useful commands:

```bash
cd mobile
npm run config:check
npm run start:dev-client
npm run build:ios:dev
```

Still required before the first iPhone dev build:

- Expo login / EAS project linkage (`npx expo login`, `npx eas login`, `npx eas init`)
- `EXPO_PUBLIC_EAS_PROJECT_ID` in `mobile/.env`
- Apple Developer signing for `org.sfluv.wallet`

## Required env

Shared SFLUV app backend:

- `EXPO_PUBLIC_APP_BACKEND_URL=http://localhost:8080`
  - replace `localhost` with a LAN IP or public host when testing on a real phone
  - the mobile app fetches chain, token, and smart-wallet config from this backend at startup

Merchant application / map search:

- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<google maps api key>`
- `EXPO_PUBLIC_MAP_ID=<google map id>` (optional for future native map styling support)

Citizen Wallet route discovery:

- `EXPO_PUBLIC_MAX_SMART_ACCOUNT_SCAN=5`
  - controls how many sequential smart-account indexes are scanned for a signed-in owner

Privy:

- `EXPO_PUBLIC_PRIVY_APP_ID=<privy app id>`
- `EXPO_PUBLIC_PRIVY_CLIENT_ID=<privy mobile client id>`

Development build / push registration:

- `EXPO_PUBLIC_EAS_PROJECT_ID=<expo eas project id>`
  - required for Expo push-token registration in a development build

## Notes

- OAuth deep-link callback uses app scheme `sfluvwallet`.
- Merchant application location search currently depends on a client-usable Google Maps key.
- Remote push notifications now have backend support, but they still require a development build because Expo Go does not support the needed native push path here.
- This branch intentionally matches the deployed web app wallet stack: Privy plus legacy Citizen Wallet smart accounts only.
- All `EXPO_PUBLIC_*` values are bundled client-side. Never place confidential secrets in those variables.
