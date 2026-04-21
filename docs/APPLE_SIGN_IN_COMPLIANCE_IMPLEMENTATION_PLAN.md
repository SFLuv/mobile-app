# Apple Sign-In Compliance Implementation Plan

## Goal

Ship `Sign in with Apple` on the iOS app in a way that:

- satisfies Apple App Store login requirements
- preserves the existing in-app account deletion flow
- revokes Apple access when deletion is finalized
- avoids stranding returning users in duplicate Privy users / duplicate backend users / duplicate wallets

This plan is based on the current state of:

- backend branch: `codex/account-deletion-support`
- backend worktree: `/Users/sanchezoleary/Projects/SFLUV_DEV/app-origin-main`
- mobile iOS worktree: `/Users/sanchezoleary/Projects/mobile-app-ios-push`

## Current State

### Already in place

#### Account deletion backend

`codex/account-deletion-support` already contains:

- `GET /users/delete-account/preview`
- `POST /users/delete-account`
- `POST /users/delete-account/cancel`
- `GET /users/delete-account/status`
- `POST /admin/users/delete-account/purge`

Current behavior:

- user and owned rows are marked inactive immediately
- delete date is set 30 days out
- cancel restores the user and owned rows during the grace window
- manual purge exists
- auto purge is gated by `ACCOUNT_PURGE_ENABLED`

#### Account deletion UI

Delete-account UI and reactivation gating already exist in:

- mobile iOS
- mobile Android
- web

This covers the in-app initiation and recovery-window parts of Apple account deletion compliance.

#### Useful backend Privy integration

The backend already talks to the Privy management API in `backend/handlers/privy_sync.go`.

Current linked-email sync behavior:

- supports `email`
- supports `google_oauth`
- supports `google`

This is important because the backend already has a pattern for resolving Privy-linked identity data server-side.

### Not yet in place

#### Missing Apple login in the iOS app

The iOS app still only shows:

- `Continue with Google`
- `Continue with Email`

on the logged-out auth screen in `mobile/App.tsx`.

There is no Apple button or Apple login handler yet.

#### Missing iOS Apple config

`mobile/app.config.ts` currently does not include:

- `ios.usesAppleSignIn = true`
- the `expo-apple-authentication` config plugin

#### Missing final Apple token revocation

`backend/handlers/app_account_deletion.go` currently contains a stub:

- `revokeDeletedUserAppleAccess(...)` returns `nil`

So the delete-account system is close, but it is not yet fully Apple-complete for users authenticated with Apple.

#### Missing merge/linking implementation

There is no production merge flow yet for:

- `Sign in with Apple` users who hide their email
- Apple-only orphan Privy users that should be merged into an existing Google/email account

The earlier design notes exist in:

- `APPLE_PRIVY_ACCOUNT_MERGE_PLAN.md`

but the routes and merge UI have not been implemented.

## Compliance Requirements We Must Satisfy

### Compliance-critical

For the iOS app to be compliant once Google login exists on the logged-out screen:

1. `Sign in with Apple` must be available as a real sign-in option on the logged-out iOS auth screen.
2. Users must be able to initiate account deletion in-app.
3. The deletion flow must be a real deletion flow, not just deactivation.
4. The app must clearly communicate the deletion timeline.
5. Apple-linked accounts should have Apple access revoked when deletion is finalized.

### UX-critical but not the same thing as guideline compliance

These are not the direct rule, but we should treat them as launch-critical:

1. Existing Google/email users should have a deterministic way to add Apple to the same identity.
2. Users who accidentally create an Apple-only duplicate account must have a recovery/merge path.
3. We should not rely on email matching alone.
4. Apple relay addresses must not strand user funds or backend data.

## Recommended Delivery Order

### Phase 1: Finish delete-account compliance

This is the shortest path to having the delete-account system truly complete for Apple review.

#### 1. Persist revocable Apple auth material

Because Privy Apple login now has `Return OAuth tokens` enabled, we should add a secure server-side place to store the token material needed for revocation.

Recommended shape:

- new table: `user_oauth_credentials`
- columns:
  - `user_id`
  - `provider`
  - `provider_subject`
  - `refresh_token_encrypted`
  - `access_token_encrypted`
  - `scopes`
  - `created_at`
  - `updated_at`
  - `revoked_at`

Rules:

- store only what is needed for revocation
- encrypt at rest
- one active Apple credential row per user

#### 2. Add a backend write path for Apple OAuth tokens

Add a protected route for the authenticated user after Apple auth succeeds:

- `POST /users/oauth/apple`

Input:

- token payload returned from Privy Apple login
- provider subject / account metadata if available

Backend behavior:

- verify authenticated user
- upsert encrypted Apple token material

#### 3. Implement real Apple revocation

Replace the current no-op in `revokeDeletedUserAppleAccess(...)` with:

1. load stored Apple token for user
2. call Apple revoke endpoint
3. mark credential revoked
4. continue purge if revocation succeeds or if there is no Apple token
5. log failure details for manual follow-up if Apple revoke fails

#### 4. Keep launch operations simple

At launch:

- keep `ACCOUNT_PURGE_ENABLED=false`
- use manual purge initially
- require the manual purge flow to run Apple revocation before final delete

This preserves the current 30-day policy while keeping the Apple-specific final step in place.

### Phase 2: Add Sign in with Apple to the iOS login screen

This is the compliance-critical app-side login work.

#### 1. Update Expo config

In `mobile/app.config.ts`:

- set `ios.usesAppleSignIn = true`
- add the `expo-apple-authentication` plugin

#### 2. Add Apple to the logged-out iOS auth screen

In `mobile/App.tsx`:

- add an iOS-only Apple login control
- use Apple’s native sign-in presentation
- keep Google + email in place

Recommended UX:

- order:
  - `Continue with Apple` on iOS
  - `Continue with Google`
  - `Continue with Email`

#### 3. Wire Privy Apple login

Add an Apple login handler alongside the current Google/email handlers.

Expected behavior:

- call Privy login with `provider: "apple"`
- on success, continue through the existing app bootstrap pipeline
- on failure, surface a clean auth error

#### 4. Capture Apple OAuth tokens after login

Immediately after successful Apple login:

- send the Apple token payload to the new backend Apple-token route
- do this before or during backend bootstrap

If token persistence fails:

- do not crash login
- log and surface a recoverable error path
- flag the user for support follow-up if needed

### Phase 3: Add deterministic Apple account linking for existing users

This is the safest way to keep existing Google/email users on the same identity.

#### 1. Add `Link Apple` for authenticated users

Add an iOS-only account action in settings:

- `Link Apple`

Behavior:

- signed-in keeper account starts Apple linking
- Privy links Apple to the current user
- if Apple is already attached elsewhere, use Privy transfer behavior from the keeper session

This is the clean path for users who already know which account they want to keep.

#### 2. Sync Apple-linked identity metadata into the backend

Extend backend Privy sync or Apple token persistence to record:

- whether the user has Apple linked
- whether Apple returned a real email or relay email

We do not need to treat relay email as a verified user email for merge decisions.

### Phase 4: Add Apple duplicate-account detection and merge recovery

This is the part that handles the “user signed in with Apple and hid their email” problem.

#### 1. Add backend merge preparation routes

Implement the earlier planned merge routes:

- `POST /admin/users/merge/prepare`
- `POST /admin/users/merge/sweep-preview`
- `POST /admin/users/merge/execute`

Minimum first slice:

- preview source + target user
- preview wallet state
- preview contacts / locations / verified email reassignment
- execute safe reassignment
- update keeper wallet `merged_wallets`
- schedule source user for deletion

#### 2. Add a post-login identity resolution step

After Apple login, before treating the account as fully settled, run backend-side resolution logic.

Recommended states:

1. **New Apple user, no existing match**
   - continue normally

2. **Apple user with real email that uniquely matches an existing verified email on another active user**
   - do not silently auto-merge
   - show a recovery prompt:
     - `Continue with this new Apple account`
     - `Recover my existing account`

3. **Apple user with relay email or no unique match**
   - continue normally
   - provide a clear `I already have an account` path

4. **Apple already linked to the current Privy user**
   - continue normally

#### 3. Add a recovery/merge wizard

If the user says they already have an account:

1. keep the current Apple-authenticated user as the source candidate
2. ask the user to authenticate into the keeper account
3. preview merge
4. preview / perform wallet sweep
5. execute backend merge
6. from the keeper session, run Apple link / transfer
7. mark the source backend user inactive and scheduled for deletion

#### 4. Never silently merge on email alone

Rules:

- email match may be used to suggest recovery
- email match alone should not auto-delete or auto-merge another account
- relay email must never be treated as proof that two identities are different people; it only means we lack deterministic email evidence

### Phase 5: Wallet and history continuity

This is already partially planned and partially scaffolded.

#### 1. Keep `merged_wallets` as the history anchor

The backend already has `merged_wallets` support added on the account-deletion branch.

Use it as the canonical history-aggregation mechanism:

- surviving wallet stays active
- swept source wallet addresses are appended to `merged_wallets`
- history queries aggregate the keeper wallet plus merged addresses

#### 2. Sweep before destructive source cleanup

Before final source-user retirement:

- preview SFLUV balance
- require the user to sign the sweep from the source wallet
- confirm onchain success
- only then continue merge/deletion

## Concrete Implementation Sequence

### Slice A: Compliance minimum

1. Add `ios.usesAppleSignIn` and the Apple plugin.
2. Add `Continue with Apple` to the iOS auth screen.
3. Persist Apple OAuth tokens after successful login.
4. Implement Apple token revocation on final purge/manual purge.
5. Test account deletion end-to-end for Apple-authenticated users.

This gets the app to a much safer compliance state.

### Slice B: Existing-user protection

1. Add iOS-only `Link Apple` in settings.
2. Extend backend identity sync to understand Apple-linked accounts.
3. Add duplicate-account detection and a recovery prompt after Apple login.

### Slice C: Full merge flow

1. Implement merge prepare/sweep/execute routes.
2. Implement merge UI wizard.
3. Use Privy account linking / transfer from the keeper session.
4. Finalize source-user retirement using the existing 30-day deletion model.

## Test Matrix

### Account deletion

1. Google user deletes account, signs back in, reactivates.
2. Email user deletes account, signs back in, reactivates.
3. Apple user deletes account, signs back in, reactivates.
4. Manual purge after 30 days revokes Apple access before final delete.

### Apple login

1. First-time Apple login with real email.
2. First-time Apple login with `Hide My Email`.
3. Existing Google/email user links Apple successfully.
4. Apple already linked to orphan account, keeper account runs transfer flow.

### Merge safety

1. Source wallet has zero balance.
2. Source wallet has SFLUV balance and sweep succeeds.
3. Source wallet has unresolved assets and merge is blocked.
4. Verified email conflicts are deduped correctly.

## Current Recommendation

Do not wait for the full merge system before starting implementation.

Recommended next engineering step:

1. finish the Apple-specific delete-account gap
2. add iOS `Sign in with Apple`
3. add `Link Apple`
4. then implement the guided duplicate-account merge flow

That sequence gets the app compliant first, then closes the no-email / orphan-account UX gap without relying on unsafe auto-merge behavior.
