# Expo Go Testing Runbook

Use this runbook when you need the SFLUV mobile app to appear in Expo Go on a real phone and load successfully.

Expo Go is not the right runtime for real remote push-notification testing on this branch. For that, use a development build and follow [DEVELOPMENT_BUILD_SETUP.md](/Users/sanchezoleary/Projects/mobile-app-sanchezo/docs/DEVELOPMENT_BUILD_SETUP.md).

## Required local files

These files are intentionally untracked and must exist locally before testing:

Backend:

```bash
cd /Users/sanchezoleary/Projects/SFLUV_Dev/app/backend
cp .env.example .env
```

Mobile:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
cp .env.example .env
```

## Required mobile env values

At minimum, `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/.env` needs:

- `EXPO_PUBLIC_PRIVY_APP_ID`
- `EXPO_PUBLIC_PRIVY_CLIENT_ID`
- `EXPO_PUBLIC_APP_BACKEND_URL`

Usually also required:

- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_MAP_ID`
- `EXPO_PUBLIC_LEGACY_BACKEND_URL`

Notes:

- The mobile app does not need a Privy secret.
- The Privy secret belongs on the backend only.
- The old test-key fallback was removed from the legacy-only branch, so missing Privy config now blocks app startup.

## Network rules that matter

When running Expo Go on a real phone:

- `localhost` means the phone, not the laptop.
- Any backend the phone must reach needs either a LAN IP or a public hostname.
- Both the phone and the laptop must be on the same Wi-Fi if you are using LAN mode.

Good example:

```env
EXPO_PUBLIC_APP_BACKEND_URL=http://192.168.1.166:8080
EXPO_PUBLIC_LEGACY_BACKEND_URL=https://80094.engine.citizenwallet.xyz
```

Bad example:

```env
EXPO_PUBLIC_APP_BACKEND_URL=http://localhost:8080
```

## How Expo Go discovery actually works

Expo Go does not reliably discover local projects just because Metro is reachable on the LAN.

For the project to show up automatically inside Expo Go, Expo CLI must publish a development session. That only happens if at least one of these is true:

1. The CLI is authenticated with Expo.
2. The project already has a remembered Expo Go device in `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/.expo/devices.json`.

In practice, the reliable fix is to provide Expo auth before starting Metro.

## Recommended startup flow

1. Start the shared SFLUV app backend.
2. Start Expo with LAN mode.
3. Open Expo Go on the same Wi-Fi.
4. Confirm the project appears under the local or recently-in-development section.

Backend:

```bash
cd /Users/sanchezoleary/Projects/SFLUV_Dev/app/backend
go run .
```

Mobile:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
EXPO_TOKEN=your_token_here npx expo start --lan --clear --go
```

Alternative auth flow:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx expo login
npx expo start --lan --clear --go
```

Do not commit `EXPO_TOKEN` into the repo or save it in tracked files.

## Quick verification commands

Check Expo auth:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx expo whoami
```

Expected:

- If logged in, Expo prints the username.
- If not logged in, Expo prints `Not logged in`.

Check that Metro is reachable on the LAN:

```bash
curl -I http://192.168.x.x:8081
```

Expected:

- `HTTP/1.1 200 OK`

Check that the project has remembered Expo Go devices:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
cat .expo/devices.json
```

Expected after a successful open from Expo Go:

- `devices` contains at least one `installationId`

## Common failures and fixes

### 1. Expo Go does not show the project at all

Symptoms:

- Metro says `waiting on exp://...`
- The phone is on the same Wi-Fi
- The app still does not list the project

Most likely cause:

- Expo CLI is not authenticated, and `.expo/devices.json` is empty.

How to confirm:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx expo whoami
cat .expo/devices.json
```

Fix:

- Start Expo with `EXPO_TOKEN=...`, or run `npx expo login`, then restart `npx expo start --lan --clear --go`.

Debug log to look for:

- `Development session will not ping because the user is not authenticated and there are no devices.`

### 2. Expo tunnel fails to start

Symptoms:

- `npx expo start --host tunnel --clear`
- Error like `failed to start tunnel`
- Error like `remote gone away`

Most likely cause:

- ngrok or Expo tunnel instability.

Fix:

- Prefer `--lan` for normal phone testing on the same Wi-Fi.
- Use tunnel only when LAN is not possible.

### 3. App starts but immediately blocks on config

Symptoms:

- App shows the missing configuration screen.

Most likely cause:

- `/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/.env` is missing.
- `EXPO_PUBLIC_PRIVY_APP_ID` or `EXPO_PUBLIC_PRIVY_CLIENT_ID` is missing.

Fix:

- Restore or recreate `mobile/.env` with the required Privy values.

### 4. Wallet or profile requests fail after the app opens

Symptoms:

- Login succeeds, but profile or wallet data fails to load.

Most likely causes:

- `EXPO_PUBLIC_APP_BACKEND_URL` points to `localhost`.
- The backend is not running.
- The backend uses a different Privy environment than the mobile app.

Fix:

- Point `EXPO_PUBLIC_APP_BACKEND_URL` at a reachable LAN IP or public host.
- Start the backend.
- Ensure the backend and mobile app use the same Privy environment.

### 5. Google login redirect issues

Symptoms:

- Google auth returns to the wrong place or errors out.

Most likely cause:

- Privy mobile redirect configuration is incomplete.

Fix:

- Verify the mobile client configuration in Privy matches the Expo/mobile redirect setup for this app.

### 6. Map search fails

Symptoms:

- Map screen loads but places/search do not work.

Most likely cause:

- Missing or invalid Google Maps key or map ID.

Fix:

- Verify `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` and `EXPO_PUBLIC_MAP_ID`.

## Known-good default for this branch

This branch is legacy-only:

- Privy login
- Citizen Wallet legacy smart-account discovery
- Multiple legacy smart-account indexes supported
- Shared SFLUV app backend integration

This branch does not include:

- New account infrastructure
- migration UI
- test-key fallback login
