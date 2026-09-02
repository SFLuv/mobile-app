# Sentry Implementation Plan

Goal: replace console-log-archaeology with real crash and error reporting, starting with the mobile app and following with the web app.

Today there is no crash reporting anywhere. The only release-build diagnostic is `console.error` read off the device's unified log — see commit `7d4cdba`, "Trace the W-9 flow at error level, so release builds surface it". That is the practice this plan retires.

Decisions locked:
- Sentry account is new and unused. Nothing to migrate, no existing conventions to honour.
- **Errors only to start.** No tracing, no profiling, no session replay. `tracesSampleRate: 0`.
- Two projects in one org: `sfluv-mobile` (platform `react-native`) and `sfluv-web` (platform `nextjs`).
- Environments: `development`, `preview`, `production`.
- `sendDefaultPii: false` everywhere, plus an explicit scrubber. This is a wallet app that handles tax forms.
- Mobile ships first. Web follows once mobile is proven in a `preview` build.
- Go backend is out of scope. Noted at the end as follow-on work.

---

## Status

Last updated 2026-09-02. Branch `pjol/sentry-plan`, three commits on top of `main`.

| Phase | State | Commit |
| --- | --- | --- |
| 1 — Install and build wiring | **Done** | `4b1218e` |
| 2 — Init, release identity, scrubber | **Done** | `8a566d4` |
| 3 — Error plumbing and noise control | Not started | — |
| 4 — Source maps and secrets | **Blocked** — needs the org auth token | — |
| 5 — Store privacy disclosure | Not started | — |
| 6 — Web | Not started | — |

The Sentry org exists and the `sfluv-mobile` project is created. `sfluv-web` is not.

### What is actually verified

- `tsc --noEmit` clean.
- The iOS bundle builds (`npx expo export --platform ios`), 8.93 MB.
- The DSN is embedded when `EXPO_PUBLIC_SENTRY_DSN` is set, and the app stays
  entirely offline when it is not.
- No auth token appears in the bundle.
- The redaction functions were exercised against the real W-9 log line from
  `App.tsx` — the vendor token is stripped, the endpoint path survives.
- `eas.json` profile inheritance resolves as intended: `preview` inherits the
  DSN and production backend from `production` while overriding only the
  environment. Confirmed against `@expo/eas-json`'s `mergeProfiles`, which
  merges `env` per key rather than replacing it.

### What is NOT verified

Nothing has ever reached Sentry. No build has been installed on a device, so:

- **No event has been sent.** The DSN is wired but unproven end to end.
- **Source maps have never been uploaded**, because that needs
  `SENTRY_AUTH_TOKEN`, which nobody has created yet. This is the highest-risk
  remaining item: if `release`/`dist` do not match the uploaded artifact, every
  stack trace stays minified and the integration looks like it works while
  being nearly useless. See Phase 4.
- The native `sentry.properties` files have not been observed. The plugin is
  confirmed registered via `_internal.pluginHistory`, but `expo prebuild` was
  never run to see the files it writes.

### Picking this up

1. Create an **organization** auth token (Settings → Developer Settings →
   Organization Tokens). Not a personal token — see Phase 4.
2. Put it in `mobile/.env` as `SENTRY_AUTH_TOKEN`, and add it as an EAS secret.
   Use `mobile/.env`, **not** `.env.local` — see Phase 4 for why that
   distinction bites here.
3. Build `preview` and install it on a device.
4. Trigger a deliberate error and walk the Verification checklist below. Item 2
   (unminified frames) is the one that matters most.
5. Then Phase 3, which is where the real diagnostic value is — the
   UserOperation sponsor/submit path is currently the hardest thing in this app
   to debug from a user report.

Do Phase 4 before Phase 3. Until the pipeline is proven, Phase 3's work cannot
be measured.

### Notes for whoever owns this next

- `promise` is a direct dependency now and looks unused. It is not. Removing it
  breaks the bundle — see "Two traps found while doing Phase 1".
- `eas.json` carries the DSN in every profile, including `development`. Local
  dev builds will report to the shared project tagged `environment=development`.
  That is deliberate; drop the key from the `development` profile if it turns
  out to be noise.
- The scrubber in `src/services/observability.ts` is not optional hardening. It
  is what stops the existing `[w9]` console traces from shipping tokenized tax
  URLs, because Sentry converts `console.*` into breadcrumbs automatically.
  Read that file before changing any logging in the W-9 flow.

---

## Current State

### Mobile (`mobile/`)

- Expo SDK 54, React Native 0.81.5, React 19.1.0.
- `main: expo/AppEntry`. No `expo-router` — navigation is component state inside `App.tsx`, so there is no router instrumentation to install.
- No `expo-updates`. No OTA. A release is a store build, which keeps release identity simple.
- Dynamic config in `app.config.ts` (a function export, not a static `app.json`).
- `metro.config.js` carries a `resolveRequest` override forcing `jose` to its browser entry. Privy depends on this.
- No CI. Builds run locally through `npm run build:ios:dev` / `eas-cli`, with env injected by `scripts/with-local-env.sh` from a gitignored `mobile/.env`.
- `App.tsx` is 8,322 lines. Root component was `export default function App()` at `App.tsx:7331`.
- No error boundary, no `ErrorUtils.setGlobalHandler`, no unhandled-rejection handler.
- 10 `console.error` and 37 `console.warn` call sites across `App.tsx` and `src/`.

Phases 1 and 2 have since changed three of these: the root component is now
`function App()` wrapped by `wrapRoot(App)` at the bottom of the file, which
supplies the error boundary that line four says was missing. The 47 console call
sites are untouched and are Phase 3's job.

### Web (`SFLuv/app/frontend`, separate repo)

- Next 15.2.6, App Router, React 19.
- No `instrumentation.ts`, no `error.tsx`, no `global-error.tsx`.
- `next.config.mjs` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`. A broken Sentry config will not fail the build.
- `middleware.ts` builds a strict nonce-based CSP with an explicit `connect-src` allowlist.

---

## Phase 1: Mobile install and build wiring

Files involved:
- `mobile/package.json`
- `mobile/app.config.ts`
- `mobile/metro.config.js`
- `mobile/.env.example`

Tasks:

1. `npx expo install @sentry/react-native` — let Expo resolve the SDK-54-compatible version rather than pinning by hand. Confirm with `npx expo-doctor`.

2. Wrap the config in `app.config.ts`. The export is a function, so wrap the object it returns:

```typescript
import { withSentry } from "@sentry/react-native/expo";

export default ({ config }: ConfigContext): ExpoConfig =>
  withSentry(
    {
      ...config,
      name: "SFLuv",
      // ...existing config unchanged...
    },
    {
      url: "https://sentry.io/",
      organization: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    },
  );
```

3. Switch Metro to the Sentry config **without losing the `jose` override**:

```javascript
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// unchanged — Privy needs jose's browser entry
config.resolver.resolveRequest = (context, moduleName, platform) => { ... };
```

Do not regress:
- the `jose` resolution override
- `expo-dev-client` behaviour on `npm run start:dev-client`

---

### Two traps found while doing Phase 1

Both were caught by `npx expo export`, not by `tsc` or `expo config`. Bundle the
app before believing this integration works.

**The Metro resolver must chain, not replace.** `getSentryExpoConfig` installs
its own `resolveRequest`. The pre-existing `jose` override replaced it and
called `metro-resolver`'s `resolve` directly, which re-enters and blows the
stack. It surfaces as `RangeError: Maximum call stack size exceeded` while
resolving an unrelated module, which points nowhere near the cause. The override
now delegates to the upstream resolver instead.

**`promise` is now a direct dependency, and is not unused.** It is required by
`@sentry/react-native/dist/js/integrations/reactnativeerrorhandlersutils.js`,
which imports `promise/setimmediate/done` without declaring the dependency —
it assumes React Native's copy is hoisted to the root of `node_modules`. npm
keeps it nested under `react-native/node_modules/`, so the import fails to
resolve and the bundle does not build. Declaring `promise` at React Native's
own version (8.3.0) hoists it and dedupes to a single copy. Do not remove it as
an unused dependency; the build breaks.

## Phase 2: Init, release identity, and the scrubber

Files involved:
- new `mobile/src/services/observability.ts`
- `mobile/App.tsx`
- `mobile/src/services/clientMetadata.ts` (read only)
- `mobile/src/config.ts`

`App.tsx` is already 8,322 lines. All Sentry setup goes in a new service module; `App.tsx` gains an import, an init call, and a wrap.

### Release and dist

`src/services/clientMetadata.ts` already computes exactly what Sentry needs. Reuse `getClientMetadata()` rather than re-deriving:

- `release`: `org.sfluv.wallet@${metadata.version}+${metadata.buildLabel}`
- `dist`: `metadata.buildLabel`

These must match what the plugin uploads source maps under, or stack traces stay minified. This is the single most common way this integration silently fails — verify it on the first `preview` build before doing anything else.

### Environment and DSN

- `EXPO_PUBLIC_SENTRY_DSN` added to `src/config.ts` alongside the other `EXPO_PUBLIC_*` values. The DSN is public by design; treat it like the Privy app ID.
- `EXPO_PUBLIC_SENTRY_ENVIRONMENT` set per EAS build profile in `eas.json`: `development` for both dev profiles, `preview` for `preview`, `production` for `production`.
- If the DSN is empty, `initSentry()` returns without initialising. Local Expo Go runs should not ship events.

### Init shape

```typescript
Sentry.init({
  dsn: mobileConfig.sentryDsn,
  environment: mobileConfig.sentryEnvironment,
  release,
  dist,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  enableNativeCrashHandling: true,
  beforeSend,
  beforeBreadcrumb,
});
```

Then wrap the root at `App.tsx:7331`:

```typescript
export default Sentry.wrap(function App() { ... });
```

### PII policy

This is the part that needs care. The app holds Privy DIDs, contact details, wallet addresses, merchant PINs, and tokenized W-9 form URLs.

**User identity** — set only the Privy DID:

```typescript
Sentry.setUser({ id: privyUserId });
```

That is already the backend's opaque key. Do **not** attach `contact_email`, `contact_phone`, or `contact_name`. Do **not** reuse the merchant-mode installation ID — the backend deliberately stores only its hash (`AGENTS.md`, "Preserve device scoping"), and mirroring the raw value into a third party undoes that.

**Never send:**
- `contact_email`, `contact_phone`, `contact_name`
- merchant-mode PINs and any PIN-entry state
- W-9 hosted form URLs. `App.tsx:2594` currently logs `formUrl` at error level. That is a tokenized link to a tax vendor. It must be redacted at the scrubber, not merely left out of new code.
- full wallet addresses. If an address helps triage, truncate to `0x1234…abcd` and attach as a tag.

**Defence in depth:** enable server-side scrubbing in the Sentry project settings as well, so a field missed in `beforeSend` is never stored. This applies to events already in flight and needs no app release, which matters when the fix window is an App Store review cycle.

Clear the user on logout, and on account deletion (`src/services/accountDeletion.ts`).

---

## Phase 3: Error plumbing and noise control

Files involved:
- `mobile/src/services/observability.ts`
- `mobile/src/services/appBackend.ts`
- `mobile/src/api/client.ts`
- `mobile/App.tsx`

### Filter expected failures first

The free tier is 5,000 errors/month and a wallet app on mobile networks generates a lot of non-bugs. `appBackend.ts` already defines typed errors — use them in `beforeSend` to drop:

- `AppBackendAuthError` — token expiry is a normal lifecycle event
- `AppBackendPolicyRequiredError` — a product gate, not a fault
- `AbortError` from the `fetchWithTimeout` helpers — offline and slow-network noise

Fingerprint what survives by endpoint plus status, so one failing route groups into one issue rather than hundreds.

Getting this filter right before the first production release matters more than it sounds. An unfiltered first week will exhaust the quota and train everyone to ignore the project.

### Breadcrumbs on the paths that actually break

Two `fetchWithTimeout` choke points cover essentially all network I/O:

- `src/services/appBackend.ts:716` — 6 call sites, the SFLUV app backend
- `src/api/client.ts` — the ERC-4337 `pm_sponsorUserOperation` / `eth_sendUserOperation` / receipt-poll path

The second is the valuable one. The build → sponsor → sign → submit → poll lifecycle is the hardest thing in this app to diagnose from a user report, and a breadcrumb trail per stage is most of the fix. Record method, endpoint, status, and duration. No request or response bodies — they carry addresses and amounts.

### Retire the console-as-logging hack

Convert the existing call sites deliberately rather than in bulk:

- the `[w9]` traces (`App.tsx:2516`–`5729`) become `Sentry.addBreadcrumb`, with the `formUrl` argument dropped
- genuine faults become `Sentry.captureException`
- the rest stay as `console.warn` for local development only

Once this lands, `console.error` is no longer the release-logging mechanism and commit `7d4cdba`'s workaround can be reverted.

### Global handlers

`Sentry.wrap()` covers React render errors. Confirm on a real build that the native crash handler and the JS global handler are both active — RN has no error boundary above the root component, and an uncaught error in an async handler outside React's tree is exactly the class of bug that is currently invisible.

---

## Phase 4: Source maps and secrets

Files involved:
- `mobile/.env.example`
- `mobile/README.md`
- EAS secrets

The Expo plugin uploads source maps automatically during native release builds. What it needs is an auth token.

- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` go in `mobile/.env`, which `scripts/with-local-env.sh` already loads into every `npm run` script.
- **Use `mobile/.env`, not `.env.local`.** The root `.gitignore` ignores `mobile/.env` by exact path. A `.env.local` holding an auth token would be committed. Sentry's own docs suggest `.env.local`; do not follow that here.
- Add all three to `.env.example` as documented empty keys.
- Add `SENTRY_AUTH_TOKEN` as an EAS secret so cloud builds can upload.
- Scope the token to project read/write and release admin only.
- Extend the security section of `mobile/README.md`, which already enumerates what must not be committed.

Verification: build `preview`, trigger a deliberate error, and confirm the Sentry issue shows TypeScript frames with real file names and line numbers. Minified frames mean the release/dist pair in Phase 2 does not match the uploaded artifact.

---

## Phase 5: Store privacy disclosure

Files involved:
- `docs/APP_STORE_SUBMISSION_METADATA.md`
- `SFLuv/app/frontend/app/privacy-policy` (web repo)

Adding a third-party SDK that transmits diagnostic data changes the answers already given to both stores:

- **Apple** — the privacy nutrition label needs Crash Data and Performance Data declared under Diagnostics. Because the Privy DID is attached as the user ID, it is *linked to identity*, not anonymous. Answer accordingly.
- **Google Play** — the Data Safety form needs the equivalent Crash Logs / Diagnostics entry.
- The published privacy policy needs Sentry named as a processor.

Do this before the next submission, not after. It is easy to forget and expensive to forget.

---

## Phase 6: Web

Separate repo: `SFLuv/app/frontend`. Start only once mobile is verified.

Files involved:
- `frontend/next.config.mjs`
- new `frontend/instrumentation.ts`
- new `frontend/instrumentation-client.ts`
- new `frontend/sentry.server.config.ts`
- new `frontend/sentry.edge.config.ts`
- new `frontend/app/global-error.tsx`
- `frontend/middleware.ts`

Tasks:

1. `npm install @sentry/nextjs`.
2. The five standard config files, plus `export const onRequestError = Sentry.captureRequestError` in `instrumentation.ts`.
3. `withSentryConfig` in `next.config.mjs` with `org`, `project`, `authToken: process.env.SENTRY_AUTH_TOKEN`, `silent: !process.env.CI`.
4. `app/global-error.tsx` — the app has no error boundary at any level today, so this is new UI, not just instrumentation. It renders outside the root layout and therefore outside `ThemeProvider`; style it standalone.
5. `tracesSampleRate: 0`, matching mobile.

### CSP

`middleware.ts` builds a nonce-based CSP with a curated `connect-src` allowlist. Two options:

- allowlist `https://*.ingest.sentry.io` in `connect-src`
- **use `tunnelRoute`** — recommended

`tunnelRoute` routes events through the app's own origin, already covered by `'self'`. It needs no CSP change, survives ad blockers, and keeps a carefully-maintained allowlist from growing. Check that the middleware `matcher` does not intercept the tunnel path, and that the route is excluded from auth gating.

### Build-error blindness

`next.config.mjs` sets `ignoreBuildErrors` and `ignoreDuringBuilds`. A malformed Sentry config will build and deploy successfully while doing nothing. Run `npx tsc --noEmit` against the new files by hand — per `CLAUDE.md`, expect pre-existing errors elsewhere and read only the new ones.

### Secrets

`SENTRY_AUTH_TOKEN` as a Vercel environment variable. The Sentry Vercel integration can provision it and wire the release automatically.

---

## Verification

Testing here is human-in-the-loop per `TESTING.md`. No test harness is added.

Mobile, on a physical iPhone with a `preview` build:

1. Deliberate throw behind a hidden gesture in Settings → issue appears in `sfluv-mobile`.
2. Stack frames are unminified TypeScript, with correct file and line.
3. `release` and `dist` on the issue match the installed build.
4. Event user is the Privy DID and nothing else.
5. Airplane mode during a backend call produces **no** issue — the filter works.
6. Expired token produces **no** issue.
7. A forced sponsor-path failure produces one issue carrying the full UserOperation breadcrumb trail.
8. No email, phone, name, PIN, W-9 URL, or full wallet address anywhere in the payload. Check the raw JSON, not the summary view.
9. Logout clears the user.

Web: repeat 1–4 and 8 against a Vercel preview deployment.

---

## Sequence

- Slice A — Phases 1, 2, 4. Install, init, source maps. Proves the pipeline end to end with a deliberate error and nothing else. **Phases 1 and 2 are done; Phase 4 is the remaining half and is blocked on the org auth token.**
- Slice B — Phase 3. Filters, breadcrumbs, converting the existing console sites. Do not ship A to production without B; the quota will not survive it.
- Slice C — Phase 5. Store disclosure. Gates the next submission.
- Slice D — Phase 6. Web.

Slice A is deliberately not finished. Phases 1 and 2 are inert on their own —
they will report errors, but with minified stack traces until Phase 4 uploads
source maps. That is not a state to ship to production; it is a state to hand
over.

---

## Follow-on, not in scope

- **Tracing.** Revisit once error volume is known. `tracesSampleRate: 0.1` on the UserOperation path would be the first candidate.
- **Distributed tracing** mobile → Go backend. Needs `sentry-go` in `SFLuv/app/backend` and trace-header propagation through `fetchWithTimeout`. Real value for the sponsor/submit path, but it is a third integration and a separate decision.
- **Session replay.** Probably never on mobile — the app displays balances, addresses, and tax status on nearly every screen.
- **Alerting.** Once real volume exists, route new-issue alerts somewhere a person actually reads.

---

## Notes

- Concurrent implementation work in this repo goes through the `agent-work-coordinator` skill and `LIBRARY.md`. Reserve `App.tsx` before starting Phase 2 or 3 — it is one file and everything touches it.
- Record the work in `SFLuv/app/branch-scopes/<branch-name>.md` before merge, per `CLAUDE.md`. The web slice touches the `app` repo and belongs in the same scope document.
