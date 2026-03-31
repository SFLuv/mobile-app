# Proprietary Contract Deployment Checklist

Use this after your own contracts are deployed on Berachain.

This checklist is for the custom AA backend in this repo. The legacy-only mobile wallet build does not require it unless you intentionally override the hosted Citizen Wallet engine.

## 1) Fill Backend Contract Config

Create a local `backend/chains.json` from `backend/chains.example.json` and edit it:

- `chains.80094.entrypoint_address` = default/fallback entrypoint
- `chains.80094.account_factory_address` = deployed `AccountFactory`
- `chains.80094.paymasters.<paymaster>.address` = deployed `Paymaster`
- `chains.80094.paymasters.<paymaster>.entrypoint_address` = entrypoint this paymaster should serve
- `chains.80094.paymasters.<paymaster>.type` = `cw`
- `chains.80094.token.address` = `0x881cad4f885c6701d8481c0ed347f6d35444ea7e`

## 2) Set Sponsor Key (Do Not Commit)

Set:

- `SPONSOR_PRIVATE_KEY_80094_<PAYMASTER_ADDRESS_WITHOUT_0X_UPPERCASE>`

Example:

- `SPONSOR_PRIVATE_KEY_80094_AABBCC...=your_private_key`

Optional shared fallback for all paymasters:

- `SPONSOR_PRIVATE_KEY_80094=your_private_key`

## 3) Optional Env Overrides

- `CHAIN_RPC_URL_80094`
- `ENTRYPOINT_ADDRESS_80094`
- `ACCOUNT_FACTORY_ADDRESS_80094`

## 4) Run Backend

```bash
cd backend
cp chains.example.json chains.json
go mod tidy
go run ./cmd/server -config ./chains.json
```

Check:

```bash
curl http://localhost:8088/health
```

## 5) Configure Mobile for Same Contracts

Set Expo public env vars:

- `EXPO_PUBLIC_CHAIN_ID=80094`
- `EXPO_PUBLIC_LEGACY_ENTRYPOINT_ADDRESS=<legacy TokenEntryPoint>`
- `EXPO_PUBLIC_LEGACY_ACCOUNT_FACTORY_ADDRESS=<legacy AccountFactory>`
- `EXPO_PUBLIC_LEGACY_PAYMASTER_ADDRESS=<legacy Paymaster>`
- `EXPO_PUBLIC_TOKEN_ADDRESS=0x881cad4f885c6701d8481c0ed347f6d35444ea7e`
- `EXPO_PUBLIC_LEGACY_BACKEND_URL=http://<your-backend-host>:8088`
- `EXPO_PUBLIC_PRIVY_APP_ID=<Privy app id>`
- `EXPO_PUBLIC_PRIVY_CLIENT_ID=<Privy client id>`

If testing from Expo Go on a real phone, the backend host must be phone-reachable. Do not leave it as `localhost`.

## 6) Run Mobile

```bash
cd mobile
npm install
npm run start
```

## 7) Smoke Test in Prod Chain

1. Open receive screen, generate QR.
2. Scan from send flow.
3. Build, sponsor, and send a legacy UserOperation.
4. Confirm `eth_getTransactionReceipt` resolves via the configured legacy backend.
