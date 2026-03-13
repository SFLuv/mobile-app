# SFLUV AA Backend (First Implementation Pass)

This backend is a greenfield starting point for SFLUV sponsored ERC-4337 flows.

## What is implemented

- JSON-RPC endpoint compatible with wallet client expectations:
  - `pm_sponsorUserOperation`
  - `pm_ooSponsorUserOperation`
  - `eth_sendUserOperation`
  - `eth_chainId`
  - `eth_getTransactionReceipt`
- `GET /v1/accounts/{chainId}/{account}/exists`
- `GET /v1/activity/{chainId}/{account}`
- Push token registration/removal
- WebSocket account event stream (`/v1/events/{chainId}/{account}`)
- SQLite persistence for userop status and push tokens

## What is intentionally deferred

- Full indexer for ERC20 transfer history (currently activity is userop-centric)
- Paymaster anti-abuse policy controls (quotas/rate limits/allowlists beyond selector checks)
- Sponsor key management via KMS/HSM (currently private key in config/env)
- Multi-instance queue and worker split (currently synchronous + async receipt waiter)

## Quick start

1. Copy `chains.example.json` to a local `chains.json` and replace contract addresses with your deployed contracts:

- `entrypoint_address`: default entrypoint fallback for the chain
- `account_factory_address`: your deployed `AccountFactory`
- `paymasters.<address>.address`: paymaster address
- `paymasters.<address>.entrypoint_address`: entrypoint required for that paymaster route
- `token.address`: SFLUV token (already set to `0x881cad4f885c6701d8481c0ed347f6d35444ea7e`)

2. Provide sponsor key(s) via env (preferred):

- `SPONSOR_PRIVATE_KEY_80094_<PAYMASTER_ADDRESS_WITHOUT_0X_UPPERCASE>`
- `SPONSOR_PRIVATE_KEY_80094` (optional shared fallback for all paymasters on chain 80094)

Example for paymaster `0x2222...2222`:

- `SPONSOR_PRIVATE_KEY_80094_2222222222222222222222222222222222222222`

Use `backend/.env.example` as a template. This backend is intentionally `cw`-only.

Important:
- `backend/chains.json` is local-only and should not be committed.
- private keys belong in `backend/.env`, not in `chains.json`.

3. Run:

```bash
cd backend
cp chains.example.json chains.json
go mod tidy
go run ./cmd/server -config ./chains.json
```

4. Health check:

```bash
curl http://localhost:8088/health
```

## Notes

- This service assumes a supported paymaster contract exposing `getHash(userOp, validUntil, validAfter)`.
- `eth_sendUserOperation` sends `handleOps([userOp], beneficiary=sponsor)` directly from sponsor EOA.
- EntryPoint validation/submission is selected per paymaster route, so legacy and new routes can coexist in one backend.
- Supported paymaster mode in this project is `cw` only (Account `execute` / `executeBatch` selectors).
