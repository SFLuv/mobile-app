# Apple Compliance Status

## Current Status

SFLUV is now close to the minimum compliant state for Apple's account and login policies.

Implemented:

- In-app account deletion is supported on mobile and web.
- Deleted accounts are marked inactive immediately and scheduled for permanent deletion 30 days later.
- Users can reactivate during that 30-day window by signing in again.
- Apple OAuth tokens are stored so final deletion can revoke Apple credentials during purge.
- iOS now has an Apple sign-in path and a guarded Apple recovery flow before a new SFLUV account is created.
- Existing users can link Apple from Settings instead of accidentally creating a second account.
- The web app now mirrors the same Apple warning/linking behavior for parity, even though the App Store requirement applies to iOS.
- App submission metadata now explains that SFLUV bounties are nonprofit-administered real-world task rewards, not app engagement, app install, social-media, ad-viewing, or other digital promotional rewards. See [APP_STORE_SUBMISSION_METADATA.md](APP_STORE_SUBMISSION_METADATA.md).

Still intentionally deferred:

- There is no full post-facto cleanup wizard yet for users who already created two separate accounts and need funds/history merged afterward.
- There is no silent auto-merge when Apple hides the user's real email.

This is acceptable for the current rollout because there are currently no Apple-created SFLUV accounts in the system.

## What Is Compliant Now

### 1. Sign in with Apple is treated as a real primary-account login path

Apple requires Sign in with Apple when a third-party login like Google is used for the primary account on iOS. The app now supports Apple sign-in as an actual login path instead of a settings-only add-on.

### 2. Account deletion is available in-app

Users can:

- open Settings
- schedule account deletion
- be logged out immediately
- reactivate by signing in again during the 30-day recovery window

The backend marks the account inactive right away and keeps it recoverable until the purge date.

### 3. Apple token revocation is part of final deletion

When Apple-linked users are eventually purged, the backend now has the token material needed to revoke Apple credentials as part of the final deletion process.

## Current Apple Sign-In Behavior

### New Apple user with no existing SFLUV account

- The user signs in with Apple.
- The app checks whether a backend SFLUV account already exists for that Privy identity.
- If no SFLUV account exists and no recovery warning is needed, the app creates the new SFLUV account normally.

### Existing SFLUV user signs in with Apple and Apple shares the same real email

- The app checks for an existing active SFLUV account with that verified email.
- If it finds exactly one likely keeper account, it does **not** silently create the new SFLUV account immediately.
- Instead it shows a warning telling the user to go back, sign in with Google or email, and then link Apple in Settings.

This avoids accidental duplicate wallets.

### Existing SFLUV user signs in with Apple and Apple hides the email

- The app cannot safely prove which existing SFLUV account should be reused.
- It shows a stronger warning:
  if the user creates the Apple-backed SFLUV account without sharing the real email, SFLUV will not be able to link the accounts automatically and the user can end up with two separate accounts.
- The user can either go back and sign in with the existing account first, or continue and intentionally create the separate Apple-backed account.

This is the current safety tradeoff.

### Existing SFLUV user who is already signed in

- The user can open Settings and choose `Link Apple`.
- That links Apple to the already-authenticated keeper account.
- Future Apple sign-ins can then land on that same account directly.

This is the preferred path for existing users.

## Why The Warning Exists

Apple allows users to hide their real email with Private Relay.

When that happens, SFLUV cannot safely assume:

- the Apple identity belongs to the same person as an existing Google/email account
- which existing account should be reused
- that linking by email would be correct

Because of that, the app now warns before creating the new SFLUV account and tells the user how to avoid duplicate accounts.

## What We Are Not Claiming Yet

We are **not** claiming that SFLUV can always merge Apple, Google, and email accounts automatically.

Current behavior is:

- prevent accidental duplicates when possible
- warn clearly when Apple hides the user's email
- provide `Link Apple` for users who are already in the correct account

What is still missing is the cleanup wizard for the case where a user already made the wrong choice and now has:

- two Privy identities
- two backend users
- two wallets
- funds and history split between them

That later wizard will need to handle:

- keeper-account selection
- asset sweep / transfer
- backend record reassignment
- merged wallet history presentation
- final retirement of the duplicate account

## Recommended Explanation To Stakeholders

Short version:

> We now support Sign in with Apple, in-app account deletion, and account reactivation during a 30-day grace window. We also block or warn against accidental duplicate Apple accounts before the SFLUV account is created. What we have not built yet is the later cleanup wizard for merging two accounts after a user has already created both.

## Next Phase

The next Apple-related improvement should be the duplicate-account cleanup flow:

- detect source and keeper accounts
- sweep funds from the duplicate wallet
- merge backend-owned data
- preserve combined wallet history through `merged_wallets`
- retire the duplicate account safely
