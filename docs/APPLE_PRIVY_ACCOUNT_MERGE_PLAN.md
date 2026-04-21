# Apple Privy Account Merge Plan

## Goal

Support `Sign in with Apple` on iOS for App Store compliance without stranding existing users in duplicate Privy identities, duplicate backend users, or duplicate embedded wallets.

## Problem Shape

- A user can already have a canonical Privy user created through Google or email.
- The same human can later sign in with Apple.
- Apple may return either:
  - the user's real email, or
  - a relay email ending in `privaterelay.appleid.com`.
- If Apple login creates a separate Privy user, the app can bootstrap:
  - a second backend user,
  - a second embedded wallet,
  - separate contacts / locations / settings ownership.

## Product Rule

- `Sign in with Apple` must exist on the logged-out iOS auth screen.
- We should not rely on first-login email matching as the only merge mechanism.
- The deterministic recovery path is:
  1. user signs into the account they want to keep,
  2. user links Apple to that account,
  3. if an orphan Apple-only account exists, migrate data and funds before final transfer/deletion.

## Canonical Merge Flow

### Case A: No orphan Apple account exists

1. User signs into their existing Google/email account.
2. User taps `Link Apple`.
3. Privy links Apple to the current user.
4. No backend merge is needed.

### Case B: Orphan Apple-only account already exists

1. User authenticates into the keeper account they want to keep.
2. App/backend identifies the orphan Apple-backed account.
3. Sweep funds from orphan wallet(s) to keeper wallet if needed.
4. Merge backend-owned records from orphan user to keeper user.
5. Transfer Apple login method onto keeper account.
6. Delete/archive orphan backend user record.

## Backend Responsibilities

The current mobile client only supports self-service CRUD for the authenticated user. A real merge requires dedicated backend support.

### New Route Candidates

- `POST /users/merge/prepare`
  - Input:
    - `source_privy_user_id`
    - `target_privy_user_id`
  - Returns:
    - source user summary
    - target user summary
    - source wallet list
    - target wallet list
    - merge blockers
    - merge preview counts for contacts / locations / verified emails

- `POST /users/merge/execute`
  - Input:
    - `source_privy_user_id`
    - `target_privy_user_id`
    - `target_primary_wallet_address`
    - optional conflict resolution flags
  - Behavior:
    - runs DB transaction
    - reassigns eligible records
    - records audit metadata
    - marks source user merged

- `POST /users/merge/sweep-preview`
  - Input:
    - `source_wallet_address`
    - `target_wallet_address`
  - Returns:
    - token balances
    - whether sweep is needed
    - whether wallet is safe to retire

These routes should be admin/service protected, not ordinary end-user CRUD endpoints.

## Schema Changes To Consider

### `app_user`

Add fields to support merges and auditability:

- `merged_into_user_id` nullable
- `merge_status` nullable or enum-like text
- `merged_at` nullable timestamp
- `merge_source` nullable text
- `privy_user_id` unique if not already modeled explicitly

### `app_wallet`

Add fields if we need to preserve provenance:

- `merged_wallets` nullable array/json column containing wallet addresses merged into the surviving wallet
- `merge_origin_user_id` nullable
- `retired_at` nullable timestamp
- `retired_reason` nullable text

#### Wallet merge behavior

- When two accounts are merged, the keeper wallet remains the canonical active wallet.
- Any source wallet addresses that are swept into that keeper wallet should be recorded in `merged_wallets`.
- Transaction history for the keeper account should then load:
  - the canonical wallet address, and
  - any addresses listed in `merged_wallets`
- This gives the user one surviving wallet with:
  - the combined funds after sweep, and
  - combined transaction history from previously merged wallets
- Source wallet rows can still be marked inactive/scheduled for deletion after the merge, while their addresses remain referenced in `merged_wallets` for history aggregation.

### Optional dedicated merge log table

Create `app_user_merge` if we want an audit trail:

- `id`
- `source_user_id`
- `target_user_id`
- `source_privy_user_id`
- `target_privy_user_id`
- `status`
- `source_primary_wallet_address`
- `target_primary_wallet_address`
- `sweep_tx_hash`
- `created_at`
- `completed_at`
- `notes`

This is cleaner than overloading user rows with operational history.

## Data To Reassign

### Safe to migrate directly

- contacts owned by source user
- owned merchant/location records tied to source user
- wallet metadata rows when the wallet should remain visible under the target user
- verified email rows, if no uniqueness conflict exists

### Needs conflict rules

- `primary_wallet_address`
  - keeper account wins unless explicitly overridden
- contacts
  - dedupe by normalized address
- wallet names / hidden flags
  - preserve target preferences when conflicts occur
- `merged_wallets`
  - append normalized source wallet addresses onto the keeper wallet without duplicates
- verified emails
  - dedupe by normalized email

### Likely not migrated

- raw onchain history itself
  - history is address-based, so it remains queryable by wallet address and can be aggregated via `merged_wallets`
- anything that depends on destroyed Privy user state unless copied beforehand

## Suggested Merge Transaction Rules

Inside one DB transaction:

1. Lock source + target user rows.
2. Refuse merge if source already merged.
3. Refuse merge if target equals source.
4. Reassign contacts after dedupe.
5. Reassign owned locations.
6. Update keeper wallet `merged_wallets` with swept source wallet addresses.
7. Reassign or retire source wallet rows depending on sweep outcome.
8. Preserve target `primary_wallet_address` by default.
9. Mark source user as merged/inactive.
10. Insert merge log row.

## Fund Sweep Rule

Before final account transfer:

1. source user signs into orphan account
2. app shows destination keeper wallet
3. source user signs transfer of all SFLUV balance
4. backend/app waits for confirmation
5. merge continues

If the source wallet still has non-SFLUV assets or other unresolved balances, block automatic retirement.

## Safety Checks

- never merge into a target user without explicit confirmation
- never delete source backend user until merge + sweep succeed
- never auto-overwrite target primary wallet
- block merge if source user owns merchant/admin records that require manual review
- record every merge in an audit log

## Recommended First Backend Slice

1. Add merge audit table and merge status columns.
2. Add `POST /users/merge/prepare`.
3. Add `POST /users/merge/execute` for:
   - contacts
   - locations
   - wallet row reassignment / retirement markers
   - keeper wallet `merged_wallets` updates for combined history
4. Keep Privy login-method transfer as a later step after backend merge succeeds.

## Open Questions

- What exact column currently stores the Privy user identifier in backend `app_user`?
- Are there unique constraints on contact email / verified email / wallet ownership that will block reassignment?
- Should `merged_wallets` live on the keeper wallet row as a Postgres array, JSON array, or separate join table if one wallet can accumulate many merged sources?
- Should source wallets remain visible in target account after sweep for history access, or be marked retired once their addresses are captured in `merged_wallets`?
- Do merchant / admin roles require special-case approval when user ownership changes?
