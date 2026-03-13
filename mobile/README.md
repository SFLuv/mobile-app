# SFLUV Wallet Mobile

Wallet-first Expo app for SFLUV, using the same Privy login and shared SFLUV app backend data model where possible.

## Current mobile surface

- Wallet-first shell with four primary sections:
  - `Wallet`
  - `Activity`
  - `Merchant Map`
  - `Settings`
- Dual AA route support:
  - `legacy`: CW-era factory/entrypoint/paymaster path
  - `new`: proprietary SFLUV factory/entrypoint/paymaster path
- Route auto-resolution on login:
  - existing legacy users default to legacy when deployed/balanced
  - new users default to the new route
- Route switcher and one-tap legacy -> new migration
- Privy OAuth login (`google`) and embedded wallet signer flow
- Test-key fallback mode when Privy vars are omitted
- QR-first send and receive flows
- Transaction history from the shared SFLUV app backend
- Shared contact sync through the SFLUV app backend
- Merchant map rendered natively on mobile
- Merchant application form wired to the existing app backend
- Verified email + email-alert settings wired to the existing backend

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
- `EXPO_PUBLIC_BACKEND_URL`
- `EXPO_PUBLIC_APP_BACKEND_URL`

3. If you are testing from Expo Go on a real phone, do not leave the backend URLs on `localhost`.
Use a host the phone can reach, usually your laptop LAN IP:
- `EXPO_PUBLIC_BACKEND_URL=http://<lan-ip>:8088`
- `EXPO_PUBLIC_APP_BACKEND_URL=http://<lan-ip>:8080`

4. Start Expo in tunnel mode:

```bash
npx expo start --host tunnel --clear
```

5. Open the generated `exp://...` URL in Expo Go.

The app needs:
- the AA backend running on `:8088`
- the shared SFLUV app backend running on `:8080` if you want synced profile, contacts, merchant status, and activity data

These values are required for testing, but they are intentionally not committed to this repo.

## Required env

Shared chain + token:

- `EXPO_PUBLIC_CHAIN_ID=80094`
- `EXPO_PUBLIC_RPC_URL=https://rpc.berachain.com`
- `EXPO_PUBLIC_TOKEN_ADDRESS=0x881cad4f885c6701d8481c0ed347f6d35444ea7e`
- `EXPO_PUBLIC_TOKEN_DECIMALS=18`

AA backend:

- `EXPO_PUBLIC_BACKEND_URL=http://localhost:8088`
  - replace `localhost` with a LAN IP or public host when testing on a real phone

Shared SFLUV app backend:

- `EXPO_PUBLIC_APP_BACKEND_URL=http://localhost:8080`
  - replace `localhost` with a LAN IP or public host when testing on a real phone

Merchant application / map search:

- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<google maps api key>`
- `EXPO_PUBLIC_MAP_ID=<google map id>` (optional for future native map styling support)

New route:

- `EXPO_PUBLIC_ENTRYPOINT_ADDRESS=<new TokenEntryPoint>`
- `EXPO_PUBLIC_ACCOUNT_FACTORY_ADDRESS=<new AccountFactory>`
- `EXPO_PUBLIC_PAYMASTER_ADDRESS=<new Paymaster>`
- `EXPO_PUBLIC_NEW_PAYMASTER_TYPE=cw`
- `EXPO_PUBLIC_NEW_BACKEND_KIND=sfluv`

Legacy route:

- `EXPO_PUBLIC_LEGACY_ENTRYPOINT_ADDRESS=0x7079253c0358eF9Fd87E16488299Ef6e06F403B6`
- `EXPO_PUBLIC_LEGACY_ACCOUNT_FACTORY_ADDRESS=0x7cC54D54bBFc65d1f0af7ACee5e4042654AF8185`
- `EXPO_PUBLIC_LEGACY_PAYMASTER_ADDRESS=0x9A5be02B65f9Aa00060cB8c951dAFaBAB9B860cd`
- `EXPO_PUBLIC_LEGACY_PAYMASTER_TYPE=cw-safe`
- `EXPO_PUBLIC_LEGACY_BACKEND_URL=https://80094.engine.citizenwallet.xyz`
- `EXPO_PUBLIC_LEGACY_BACKEND_KIND=cw-engine`

Route behavior:

- `EXPO_PUBLIC_ROUTE_PRIORITY=legacy,new`
- `EXPO_PUBLIC_FORCE_ROUTE=legacy|new` (optional override)
- `EXPO_PUBLIC_PREFER_LEGACY_IF_DEPLOYED=true`

Privy:

- `EXPO_PUBLIC_PRIVY_APP_ID=<privy app id>`
- `EXPO_PUBLIC_PRIVY_CLIENT_ID=<privy mobile client id>`

Fallback mode:

- `EXPO_PUBLIC_TEST_OWNER_PRIVATE_KEY=<test private key>`
  - only for local fallback testing when Privy vars are not set
  - do not commit a real key

## Notes

- OAuth deep-link callback uses app scheme `sfluvwallet`.
- Merchant application location search currently depends on a client-usable Google Maps key.
- Email alerts mirror the existing web behavior today; native push still needs backend support for device-token registration and delivery.
- All `EXPO_PUBLIC_*` values are bundled client-side. Never place confidential secrets in those variables.
