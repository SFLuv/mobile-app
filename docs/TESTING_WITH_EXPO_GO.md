# Expo Go Testing Checklist

Use this checklist when a teammate wants to run the mobile wallet on a real device.

## Required local inputs

These values are required for testing but are intentionally not committed:

- sponsor private key for the AA backend
- Privy mobile app id
- Privy mobile client id
- Google Maps API key
- Google Map ID
- backend hostnames or LAN IPs reachable from the phone

Optional:

- test owner private key for fallback mode when Privy is not configured

## Local files to create

Backend:

```bash
cd backend
cp chains.example.json chains.json
cp .env.example .env
```

Mobile:

```bash
cd mobile
cp .env.example .env
```

## Important network rule

If the mobile app is running in Expo Go on a real phone:

- `localhost` points to the phone, not your laptop
- `EXPO_PUBLIC_BACKEND_URL` and `EXPO_PUBLIC_APP_BACKEND_URL` must use a LAN IP or public host

Example:

- `EXPO_PUBLIC_BACKEND_URL=http://192.168.x.x:8088`
- `EXPO_PUBLIC_APP_BACKEND_URL=http://192.168.x.x:8080`

## Start order

1. Shared SFLUV app backend on `:8080`
2. AA backend on `:8088`
3. Expo Metro in tunnel mode

Example:

```bash
cd /path/to/SFLUV_DEV/app/backend
go run .

cd /path/to/sfluv-wallet-platform/backend
set -a; source .env; set +a
go run ./cmd/server -config ./chains.json

cd /path/to/sfluv-wallet-platform/mobile
npm install
npx expo start --host tunnel --clear
```

## What should work

- Privy login
- wallet discovery for `legacy` and `new` routes
- balance display
- send / receive / QR
- merchant map
- settings and merchant application flow

## Common failures

1. `Unable to load user profile`
- mobile app is pointed at a backend using a different Privy environment

2. Expo Go opens but wallet requests fail
- `EXPO_PUBLIC_BACKEND_URL` or `EXPO_PUBLIC_APP_BACKEND_URL` still points to `localhost`

3. Google login redirect errors
- Privy mobile client is missing the Expo/redirect scheme configuration

4. Map search fails
- missing or invalid Google Maps key
