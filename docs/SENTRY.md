# Sentry: error reporting for the mobile app

The app reports crashes, failed requests and screens that hang to Sentry. When a
bug comes in, **look in Sentry before guessing**: the issue usually carries the
failing request, its status, the backend's answer and the taps that led there.

- Org `sfluv`, project `sfluv-mobile`, free plan (one login, `ops@sfluv.org`).
- All the code is in `mobile/src/services/observability.ts`. Nothing else
  imports Sentry.
- The backend does not report to Sentry; its errors are in the Railway logs.
  The request id joins the two (below).

## Reading errors

Nobody but ops@ has a Sentry login, so errors are read through the **SFLUV
admin MCP** (`api.sfluv.org/mcp`, the same server as the other admin tools):

| Tool | Use it for |
|---|---|
| `sentry_issues` | What is broken. Filter by environment (`preview`, `production`), release (`2.2.0`), status, sort by newest or most frequent. |
| `sentry_issue` | Why. The latest event of one issue: stack trace, the trail of taps and requests before it, tags, request id. |
| `sentry_events` | Who and when. Recent occurrences of one issue, e.g. to check whether a fix stopped it. |

A typical start on a bug report: `sentry_issues` for `environment:preview` and
the build in question, open the top match with `sentry_issue`, and read the
trail bottom-up.

## What gets reported

| Kind | When | Groups by |
|---|---|---|
| Crash or render error | Any uncaught error, native or JS | Stack trace |
| Request failure | A backend answer the app treats as an error (`throwRequestError`), or a failed `pm_sponsorUserOperation` / `eth_sendUserOperation` | Method, route, status |
| Still waiting | A watched wait passes 15s (payments: 150s) | What was being waited on |
| Handled error | Errors the app catches and shows as a message, where wired with `reportHandledError` | Where + message |

Every event carries the trail: tab changes, notification taps, each request
(method, route, status, duration, request id) and each watched wait.
Successful network calls the SDK sees on its own (mostly the Celo balance poll,
every two seconds) are left out so they do not push the useful steps off the
end; failed ones stay.

Watched waits: notifications feed, activity list, opening a chat, sending a
chat message, the chat list, starting a conversation, and payments. Add one
next to any new spinner with `useStuckWatch(label, isLoading)`.

## Request ids: matching an app error to the backend logs

Every request to the backend carries a random `X-Request-Id` header (16 hex
characters). It is on the Sentry issue as the `request_id` tag and in the trail,
and the backend prints it in its request log. To see what the server did for a
failed request, search the Railway logs for that id.

## What is never sent

`sendDefaultPii` is off, and `observability.ts` scrubs every event and trail
step before it leaves the phone:

- The user is the Privy DID only: no email, phone or name.
- URLs lose their query strings (W-9 form links carry a token there).
- Emails become `<email>`, wallet addresses `0x1234…abcd`, and runs of six or
  more digits (PINs, phone numbers) `<digits>`.
- No request or response bodies, except the backend's error text on a failure,
  after the same scrubbing, capped at 500 characters.

Turn on Sentry's server-side data scrubbing in the project settings as well, so
anything missed here is still not stored.

## Quota: 5,000 events a month, whole org

What keeps us under it:

- Expected failures are dropped: expired logins, the privacy-policy gate,
  offline and timed-out requests, and every 401.
- The same report from the same phone is sent at most once per 10 minutes.
- Receipt polling during payments only leaves trail steps, never reports.

If the quota runs out, Sentry drops events until the month resets; the app is
unaffected. Check usage on the Subscription page as ops@.

## Environments

Set per EAS build profile in `eas.json`: `development`, `preview`,
`production`. Filter on it: preview noise and production problems are different
questions. Local runs without `EXPO_PUBLIC_SENTRY_DSN` send nothing.

## Readable stack traces (source maps)

EAS builds upload source maps automatically, using the `SENTRY_AUTH_TOKEN` EAS
secret (an org token). Without it the build still succeeds but traces are
minified, so check the first issue from any new setup shows real file names.

**Over-the-air updates need one extra step.** After `eas update`, upload the
update's maps from `mobile/`:

```sh
npx eas-cli update --channel production --message "…"
npm run sentry:upload-update
```

Locally, the token lives in `mobile/.env` (never `.env.local`, which is not
ignored).

## Checking it works

There is no in-app test button any more (the long-press on the Settings version
line was removed after the first check in October 2026). On a fresh build, make
something fail on purpose, for example message someone outside the chat beta,
then:

1. `sentry_issues` for the environment and version shows it within a minute.
2. `sentry_issue` on it shows real file names and line numbers, the right
   release and build, and the Privy DID as the user, nothing else.
3. Airplane mode, then use the app: no new issues.

## Two build traps (from the first attempt, September 2026)

- `metro.config.js` must **chain** to Sentry's resolver for the `jose`
  override, not call `metro-resolver` directly; the latter overflows the stack
  with an error pointing at an unrelated module.
- `promise` is a direct dependency on purpose. Sentry imports it without
  declaring it; removing it breaks the bundle.

`tsc` passes in both cases. Run `npx expo export --platform ios` after any
change to the Sentry setup.
