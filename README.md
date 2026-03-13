# SFLUV Wallet Platform

Greenfield platform for SFLUV account-abstraction payments:

- `backend/`: ERC-4337 sponsorship gateway + UserOperation submission service
- `mobile/`: Expo React Native wallet for QR-first send/receive

## Current status

- Backend: runnable, now supports paymaster-specific EntryPoint routing (legacy + new routes in one service).
- Mobile: supports Privy OAuth login + embedded signer, auto-detects legacy/new smart wallets, and can route transactions through either path.

## Implemented mobile highlights

- Privy login (`google`) and embedded wallet signer path.
- Smart-account derivation from owner EOA across dual routes:
  - legacy factory/entrypoint/paymaster
  - new factory/entrypoint/paymaster
- Auto route resolution with legacy-first behavior for existing users.
- Manual route switching in-app.
- UserOperation lifecycle: build -> sponsor -> sign -> submit -> receipt poll.
- QR send/receive flow using EIP-681 format.
- Amount input in whole SFLUV (converts to token decimals internally).
- Transaction confirmation pop-up with transaction hash.
- Saved contacts (local persistence) and quick recipient autofill.
- Clipboard copy button for receive address.

## Quick run

Backend:

```bash
cd backend
cp chains.example.json chains.json
set -a; source .env; set +a
go run ./cmd/server -config ./chains.json
```

Mobile:

```bash
cd mobile
npm install
npx expo start --host tunnel --clear
```

## Expo Go testing

Use this when a teammate wants to run the mobile wallet on a real phone with Expo Go.

1. Prepare local config files:

```bash
cd backend
cp chains.example.json chains.json

cd ../mobile
cp .env.example .env
```

2. Fill in the required local values. These are required for testing but are intentionally not committed:
- sponsor private key for the AA backend
- Privy mobile app id and client id
- Google Maps API key and map id
- backend host values reachable from the phone

3. If the phone is using Expo Go against local backends, do not leave backend URLs on `localhost`.
Replace them with your laptop's LAN IP or another phone-reachable host:
- `EXPO_PUBLIC_BACKEND_URL=http://<your-lan-ip>:8088`
- `EXPO_PUBLIC_APP_BACKEND_URL=http://<your-lan-ip>:8080`

4. Start services in order:

```bash
cd backend
set -a; source .env; set +a
go run ./cmd/server -config ./chains.json

cd ../mobile
npm install
npx expo start --host tunnel --clear
```

5. Open the tunnel URL in Expo Go and sign in with Privy.

Note: Privy integration may require a development build on some environments, but the current setup is intended to work in Expo Go for team testing.

Detailed checklist:
- `docs/TESTING_WITH_EXPO_GO.md`

## Security

- Do not commit secret files (`backend/.env`, `mobile/.env` are gitignored).
- Do not commit `backend/chains.json`; create it locally from `backend/chains.example.json`.
- Treat all `EXPO_PUBLIC_*` variables as public in client bundles.
- Use test keys only for local development; rotate before any shared environment.
- This repo documents which values are required for testing, but it does not include live private keys, sponsor keys, Expo tokens, or Privy secrets.
