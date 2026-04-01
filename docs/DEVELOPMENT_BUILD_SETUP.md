# Development Build Setup

Use this runbook when you need a real Expo development build for the mobile wallet, especially for push-notification testing.

## What this solves

A development build is required for native features that Expo Go does not fully support in this repo, most importantly:

- remote push notifications
- app-specific native runtime behavior
- testing the exact signed mobile app binary instead of Expo Go

Expo Go is still fine for normal wallet UI and backend iteration, but not for real push-notification testing.

## Repo status

This repo is already prepared for the build side:

- [app.config.ts](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/app.config.ts) is now EAS-aware
- [eas.json](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/eas.json) includes a `development` profile
- `expo-dev-client` is installed in [mobile/package.json](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/package.json)

## Still needed from accounts and signing

Before the first mobile dev build, these external prerequisites must exist:

1. An Expo account
2. An Apple Developer Program account for iPhone builds
3. Access to the Expo project that will own this app
4. An Android test device or emulator if you want to test Android locally

## One-time setup

### 1. Log into Expo and EAS

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx expo login
npx eas login
```

### 2. Link the app to EAS

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx eas init
```

This creates or links the Expo project and gives the app its EAS project ID.

### 3. Generate Android signing credentials

The first Android EAS build will create or attach the Android keystore for `org.sfluv.wallet`.

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npx eas credentials -p android
```

After Android credentials exist, record the SHA-256 signing fingerprint. That value is needed by `app.sfluv.org` for Android App Links.

### 4. Add the EAS project ID locally

Put the project ID into [mobile/.env](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/.env):

```env
EXPO_PUBLIC_EAS_PROJECT_ID=your-project-id
```

This value is used by the mobile app when registering Expo push tokens.

Optional: if you want local Expo / EAS commands to work without re-running `expo login`, also put an Expo token in the same gitignored file:

```env
EXPO_TOKEN=your-expo-token
```

The npm Expo/EAS scripts in [package.json](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/package.json) source `mobile/.env` automatically, so a local `EXPO_TOKEN` there will be picked up for builds and related commands.

If you are building on a personal Apple Developer account and do not want to use the production-style bundle identifier, override it locally in the same gitignored file:

```env
IOS_BUNDLE_IDENTIFIER=org.sanchezoleary.sfluvwallet.dev
```

That lets you ship a personal development build without claiming the final production app identifier first.

### 5. Add the Android App Links fingerprint to the web app env

The web app serves `https://app.sfluv.org/.well-known/assetlinks.json`, which Android uses to verify that `app.sfluv.org` belongs to this app.

Set the frontend env var to the SHA-256 fingerprint from the Android keystore:

```env
ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS=AA:BB:CC:...:ZZ
```

If you use multiple signing certificates, provide them as a comma-separated list.

## Build commands

Validate the config first:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npm run config:check
```

Start Metro for a dev client:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npm run start:dev-client
```

Create an iPhone development build:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npm run build:ios:dev
```

Optional Android development build:

```bash
cd /Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile
npm run build:android:dev
```

## Android-specific notes

- The Android package is `org.sfluv.wallet`
- Android App Links for `/pay/*`, `/redeem/*`, and `/request/*` are configured in [app.config.ts](/Users/sanchezoleary/Projects/mobile-app-sanchezo/mobile/app.config.ts)
- The matching web file is served from [route.ts](/Users/sanchezoleary/Projects/SFLUV_Dev/app/frontend/app/.well-known/assetlinks.json/route.ts)
- A Google Play developer account is not required for a development build
- Firebase / FCM is only required if you want real Android push notifications

## iPhone-specific notes

- The default bundle identifier is `org.sfluv.wallet`
- Local development builds can override it with `IOS_BUNDLE_IDENTIFIER`
- The first iOS build will require Apple signing setup through EAS
- EAS will prompt for Apple credentials or guide signing setup when needed
- The phone may require iOS Developer Mode to run the installed development build

## Push notifications

After a development build is installed:

1. Open the dev build instead of Expo Go
2. Sign in normally
3. Allow notification permissions on the phone
4. The app will register an Expo push token and sync it to the shared app backend
5. Incoming transfers can then trigger remote push delivery through the backend/Ponder callback flow

## Common blockers

### Missing EAS project ID

Symptoms:

- app runs, but push registration logs a warning
- no Expo push token is registered

Fix:

- run `npx eas init`
- copy the project ID into `EXPO_PUBLIC_EAS_PROJECT_ID`

### Apple signing not ready

Symptoms:

- `eas build --platform ios --profile development` cannot complete

Fix:

- finish Apple Developer Program setup
- let EAS create/manage certificates and provisioning for your chosen iOS bundle identifier

### Using Expo Go by mistake

Symptoms:

- app opens, but remote push never works

Fix:

- use the installed development build, not Expo Go

### Android App Links not verifying

Symptoms:

- `https://app.sfluv.org/pay/...` opens in the browser instead of the Android app

Fix:

- make sure Android signing credentials exist in EAS
- copy the SHA-256 certificate fingerprint into `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`
- deploy the frontend so `/.well-known/assetlinks.json` is live on `app.sfluv.org`

### Android push missing

Symptoms:

- app build installs, but remote push notifications never arrive on Android

Fix:

- create a Firebase project
- configure FCM credentials for Expo/EAS
- add any required Android push config before testing remote push
