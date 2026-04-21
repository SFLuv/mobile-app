# Backend Account Deletion Support Plan

## Goal

Implement backend support for:

- Apple-compliant in-app account deletion
- delayed deletion with a 30-day recovery window
- account deletion cancelation during that window
- account merge support for Apple/Google/email identity reconciliation
- wallet-history preservation across merged accounts

This plan assumes:

- account deletion is initiated in-app
- deleted accounts become inactive immediately
- final destructive purge happens after 30 days
- auto purge is supported but disabled by default at launch
- manual purge is acceptable until production operations are ready

## Product Decisions Locked In

- Account deletion uses a 30-day scheduled deletion model.
- Deletion is a real deletion flow, not simple deactivation.
- Users can cancel account deletion before final purge.
- The app should expose deletion status.
- Auto purge exists but is disabled by default:
  - `ACCOUNT_PURGE_ENABLED=false`
- Manual purge is supported while auto purge is disabled.
- Final deletion should include Apple token revocation for Apple-linked accounts.
- Merged accounts should preserve combined wallet history:
  - the surviving wallet remains canonical
  - swept source wallet addresses are recorded on the keeper wallet
  - history queries aggregate canonical wallet + merged wallet addresses

## Compliance Target

This design is intended to satisfy the Apple requirements that:

- users can initiate account deletion in-app
- the flow is not just deactivation
- the app can communicate the deletion timeline clearly
- Sign in with Apple credentials are fully revoked as part of final deletion

## Current Backend Shape

Prepared backend worktree:

- `/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main`

Relevant backend entry points:

- [backend/router/router.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/router/router.go)
- [backend/db/app.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app.go)
- [backend/db/app_user.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app_user.go)
- [backend/db/app_wallet.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app_wallet.go)
- [backend/db/app_contact.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app_contact.go)
- [backend/db/app_location.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app_location.go)
- [backend/db/app_ponder.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/db/app_ponder.go)
- [backend/handlers/app_user.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/handlers/app_user.go)
- [backend/handlers/app_contact.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/handlers/app_contact.go)
- [backend/structs/app_user.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/structs/app_user.go)
- [backend/structs/app_wallet.go](/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main/backend/structs/app_wallet.go)

## High-Level Design

### Soft-delete contract

All relevant account-owned records should support:

- `active BOOLEAN NOT NULL DEFAULT TRUE`
- `delete_date TIMESTAMPTZ NULL`

Deletion semantics:

- on delete request:
  - `active = FALSE`
  - `delete_date = now() + interval '30 days'`
- records are hidden from normal user queries immediately
- final physical deletion only happens after purge

### Account deletion lifecycle

1. user previews deletion consequences
2. user confirms deletion in-app
3. backend marks user and related data inactive
4. backend returns scheduled deletion date
5. user may cancel before purge deadline
6. purge process permanently deletes data after deadline
7. final deletion includes Apple token revocation where applicable

### Merge lifecycle

1. identify source account and keeper account
2. sweep funds from source wallet to keeper wallet
3. merge backend-owned profile data into keeper account
4. append source wallet addresses to keeper wallet `merged_wallets`
5. schedule source account data for deletion
6. complete Privy / Apple login-method reconciliation

## Schema Plan

### Required columns on relevant tables

Add `active` and `delete_date` to the current Phase 1 tables:

- `users`
- `user_verified_emails`
- `wallets`
- `contacts`
- `locations`
- `location_hours`
- `location_payment_wallets`
- `ponder_subscriptions`
- `memos`
- `affiliates`
- `proposers`
- `improvers`
- `supervisors`
- `issuers`

### Wallet-specific schema

Add to `wallets`:

- `merged_wallets`
  - preferred shape: `TEXT[]` of normalized wallet addresses
  - alternative: JSON array if array support becomes awkward in the current Go/pgx layer

Recommended wallet merge rules:

- the keeper wallet row remains active and canonical
- the source wallet is swept into the keeper wallet
- the source wallet address is appended to keeper `merged_wallets`
- source wallet row is marked inactive and scheduled for purge
- history queries for the keeper wallet aggregate:
  - keeper wallet address
  - all addresses in `merged_wallets`

### User/account deletion tracking

The minimum agreed contract is `active` + `delete_date`, but account deletion will be easier to operate if `users` also gets:

- `deletion_requested_at TIMESTAMPTZ NULL`
- `deletion_canceled_at TIMESTAMPTZ NULL`
- `deletion_completed_at TIMESTAMPTZ NULL`

These are not strictly required by the original ask, but they make `status`, ops review, and support debugging much cleaner.

### Merge-specific auditability

Add to `users` or a dedicated merge table:

- `merged_into_user_id TEXT NULL`
- `merged_at TIMESTAMPTZ NULL`
- `merge_status TEXT NULL`

Preferred approach:

- create a dedicated `user_merges` audit table

Suggested columns:

- `id`
- `source_user_id`
- `target_user_id`
- `source_privy_user_id`
- `target_privy_user_id`
- `source_primary_wallet_address`
- `target_primary_wallet_address`
- `sweep_tx_hash`
- `status`
- `created_at`
- `completed_at`
- `notes`

### Partial-index review

Soft delete will likely break some current uniqueness assumptions. Review and adjust unique indexes so active rows can be recreated after a soft delete.

Known likely candidates:

- wallets unique ownership/address combinations
- verified email uniqueness
- any merchant/payment-wallet default uniqueness

Where needed, replace broad unique indexes with partial indexes scoped to `active = TRUE`.

## Route Plan

### User-facing account deletion routes

Add to the authenticated user surface:

- `GET /users/delete-account/preview`
  - returns what will be affected
  - returns effective deletion date
  - returns whether account is already scheduled for deletion

- `POST /users/delete-account`
  - marks the account inactive
  - schedules deletion for 30 days out
  - cascades soft delete scheduling to account-owned records

- `POST /users/delete-account/cancel`
  - restores account and owned records if still within the 30-day window
  - clears `delete_date`
  - sets `active = TRUE`

- `GET /users/delete-account/status`
  - returns:
    - active/inactive
    - scheduled deletion date
    - whether cancellation is still allowed
    - whether purge has completed

### Merge-support routes

These should not be ordinary end-user CRUD routes. Keep them internal/admin/service protected.

- `POST /admin/users/merge/prepare`
  - resolves source user
  - resolves target user
  - previews wallets, contacts, locations, verified emails
  - reports blockers

- `POST /admin/users/merge/sweep-preview`
  - previews source and target wallet balances
  - indicates whether sweep is needed before merge

- `POST /admin/users/merge/execute`
  - performs merge transaction
  - updates keeper wallet `merged_wallets`
  - schedules source account data for deletion
  - records merge audit row

### Optional admin/ops routes

If operational visibility is needed via API:

- `GET /admin/users/deletion-queue`
- `POST /admin/users/{user_id}/purge`
- `POST /admin/users/{user_id}/cancel-deletion`

These are optional if manual purge is only done through a backend command/job runner.

## Handler / DB Implementation Plan

### New handler files

Recommended new handlers:

- `backend/handlers/app_account_deletion.go`
- `backend/handlers/app_account_merge.go`

### New DB files

Recommended new DB modules:

- `backend/db/app_account_deletion.go`
- `backend/db/app_account_merge.go`

This keeps account deletion and merge orchestration out of the existing user/contact/wallet files except where shared helpers are needed.

### Existing files likely to change

- `backend/router/router.go`
- `backend/db/app.go`
- `backend/bootstrap/schema_migrations.go`
- `backend/structs/app_user.go`
- `backend/structs/app_wallet.go`
- `backend/db/app_user.go`
- `backend/db/app_wallet.go`
- `backend/db/app_contact.go`
- `backend/db/app_location.go`
- `backend/db/app_ponder.go`
- any list/look-up queries that must stop returning inactive records

## Query Behavior Changes

### Global rule

Normal reads must exclude inactive rows by default.

That includes:

- authenticated user loads
- wallet list queries
- contact list queries
- location ownership queries
- address-owner lookups
- notification subscription queries
- verified-email queries

### Update rule

Updates against inactive rows should fail clearly.

Examples:

- cannot edit inactive contact
- cannot set an inactive wallet as primary
- cannot update inactive location ownership data

### Aggregated wallet history rule

Transaction history loaders must support:

- canonical wallet address
- all merged source wallet addresses in `merged_wallets`

This likely affects the mobile/backend contract more than SQL directly if transaction history is fetched by address parameter. The backend should expose a way to return the address set for a canonical wallet or user.

Possible follow-up API shape:

- extend wallet payloads to include `merged_wallets`
- add a helper endpoint to return a wallet history address set

## Account Deletion Cascade Rules

### Immediately schedule inactive state for

- user row
- verified emails
- wallets
- contacts
- locations and location child tables
- memos
- ponder subscriptions
- role/profile rows tied directly to the user

### Preserve until purge window ends

- audit records
- merge records
- ops logs

### Needs policy review before implementation

- workflow tables
- credential history
- faucet/event history

These may need archival rather than standard soft delete depending on business/audit requirements.

## Cancel Deletion Rules

Allowed when:

- current time is before `delete_date`
- purge has not completed

Behavior:

- set `active = TRUE`
- clear `delete_date`
- clear pending deletion markers on child rows
- restore normal account access

Open policy choice:

- whether cancellation restores all child rows automatically, or only rows that were deleted as part of the same account-deletion request

Recommended answer:

- restore all rows deleted as part of that account-deletion cascade

## Purge Service Plan

### Runtime flag

Use a backend config flag:

- `ACCOUNT_PURGE_ENABLED=false`

Default behavior:

- no automatic destructive purge
- queue/status can still be populated
- manual purge remains possible

### Purge implementation

Add a purge command/service that:

1. scans for inactive rows with `delete_date <= now()`
2. groups work by user/account
3. performs final cleanup in dependency order
4. revokes Apple tokens if needed
5. permanently deletes rows
6. marks deletion complete in audit/status records

### Manual purge support

While auto purge is disabled:

- operators can run purge manually
- support can confirm deletion completion
- the system still behaves correctly for scheduled deletions

### Apple token revocation

Final purge must include revocation for Apple-linked users.

Implementation dependency:

- confirm whether revocation is owned by:
  - Privy,
  - a backend Apple integration,
  - or a service-to-service admin path

This dependency must be resolved before production rollout of delete-account support.

## Merge Execution Rules

Inside one merge transaction:

1. lock source and target user rows
2. verify source != target
3. verify source is not already merged
4. load source wallets and target wallets
5. choose keeper wallet
6. append normalized source wallet addresses into keeper `merged_wallets`
7. reassign or retire relevant source-owned records
8. preserve target primary wallet by default
9. mark source user inactive with scheduled deletion
10. write merge audit row

### Merge conflict rules

- `primary_wallet_address`
  - keeper wins by default
- `merged_wallets`
  - append without duplicates
- contacts
  - dedupe by normalized address
- verified emails
  - dedupe by normalized email
- locations
  - reassign ownership unless blocked by business/admin rules

## Testing Plan

### Schema migration tests

- existing databases upgrade cleanly
- old rows default to `active = TRUE`
- old rows default to `delete_date = NULL`

### DB tests

- soft delete hides rows
- canceled deletion restores rows
- merge updates keeper `merged_wallets`
- reinsertion works with revised uniqueness constraints

### Handler/controller tests

Add coverage for:

- delete-account preview
- delete-account execute
- delete-account cancel
- delete-account status
- merge prepare
- merge execute

### Regression tests

- existing contact delete path becomes soft delete
- existing ponder delete path becomes soft delete
- existing user load paths ignore inactive rows
- wallet owner lookups ignore inactive wallets/locations

## Rollout Order

### Phase 1: account deletion foundation

1. schema columns and indexes
2. query filtering for inactive rows
3. user delete preview/execute/cancel/status
4. manual purge command

### Phase 2: merge support

1. merge audit schema
2. merge prepare/execute routes
3. wallet `merged_wallets`
4. history aggregation support

### Phase 3: automated purge

1. implement purge worker/service
2. integrate Apple token revocation
3. keep `ACCOUNT_PURGE_ENABLED=false` by default
4. enable in production when ready

### Phase 4: broader table coverage

1. workflow/credential/event policy review
2. extend soft delete to additional tables only where appropriate

## Open Questions

- Does the current backend already store a stable Privy user identifier separately from `users.id`, or is `users.id` itself the Privy identifier?
- Should `merged_wallets` be a Postgres `TEXT[]` or a normalized join table if a wallet can accumulate many merges?
- Which component owns Apple token revocation in a Privy-backed auth stack?
- Which workflow and credential records should be soft-deleted versus retained permanently for audit/legal reasons?
- Do we want a separate deletion audit table, or are extra columns on `users` enough for support visibility?
