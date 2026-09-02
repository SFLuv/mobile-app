import * as Sentry from "@sentry/react-native";

import { mobileConfig } from "../config";
import { getClientMetadata } from "./clientMetadata";

/*
 * Sentry wiring lives here rather than in App.tsx, which is already past 8,000
 * lines. App.tsx should only ever import initSentry, syncSentryUser, and the
 * Sentry.wrap on its default export.
 *
 * Phase 2 of docs/SENTRY_IMPLEMENTATION_PLAN.md. Errors only: no tracing, no
 * profiling, no replay.
 */

const IOS_BUNDLE_ID = "org.sfluv.wallet";

/**
 * Errors that are normal app lifecycle, not faults. These are dropped before
 * they reach Sentry — a wallet on a mobile network generates enough of them to
 * exhaust the monthly quota on their own, and a project full of expected noise
 * is a project nobody reads.
 *
 * Matched on `name` rather than `instanceof` so this module does not have to
 * import appBackend.ts (a 3,600-line module) purely for three error classes.
 * Each of those constructors assigns `this.name` explicitly, so the string is
 * as reliable here as the prototype chain would be.
 */
const EXPECTED_ERROR_NAMES = new Set([
  // Access token expiry. Handled by the app; the user is asked to sign in again.
  "AppBackendAuthError",
  // Privacy-policy gate. A product state, not a failure.
  "AppBackendPolicyRequiredError",
  // fetchWithTimeout aborting — slow network or backgrounded app.
  "AbortError",
]);

const EXPECTED_MESSAGE_PATTERNS = [
  // React Native's offline fetch rejection.
  /network request failed/i,
  /the network connection was lost/i,
  /the request timed out/i,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EVM_ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;
/** Six or more consecutive digits — covers merchant-mode PINs and phone numbers. */
const LONG_DIGIT_RUN_PATTERN = /\b\d{6,}\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)\]]+/g;

/**
 * Shortens an EVM address to `0x1234…abcd`.
 *
 * Addresses are pseudonymous, not secret, but a full one ties a Sentry event to
 * an on-chain balance and transaction history. The truncated form is still
 * enough to correlate an issue against a support report.
 */
function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Strips the query string and fragment from a URL.
 *
 * This is what keeps the W-9 flow safe. `App.tsx` logs the minted tax-form URL,
 * and Sentry turns console calls into breadcrumbs automatically, so that link
 * would otherwise reach Sentry the moment this module initialises. The vendor
 * token lives in the query string; the path alone is safe and still tells you
 * which endpoint was involved.
 */
function stripUrlSecrets(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : `${url.slice(0, cut)}?<redacted>`;
}

/**
 * Removes identifying values from free text.
 *
 * Applied to every message, exception value, and breadcrumb before send. It is
 * deliberately blunt: over-redacting a log line costs a little context, while
 * under-redacting puts a user's email or tax link in a third-party system.
 */
export function redact(input: string): string {
  return input
    .replace(URL_PATTERN, stripUrlSecrets)
    .replace(EMAIL_PATTERN, "<email>")
    .replace(EVM_ADDRESS_PATTERN, truncateAddress)
    .replace(LONG_DIGIT_RUN_PATTERN, "<digits>");
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactUnknown(entry);
    }
    return output;
  }
  return value;
}

function isExpected(event: Sentry.ErrorEvent): boolean {
  const values = event.exception?.values ?? [];
  for (const value of values) {
    if (value.type && EXPECTED_ERROR_NAMES.has(value.type)) {
      return true;
    }
    const message = value.value ?? "";
    if (EXPECTED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
      return true;
    }
  }
  const topLevel = event.message ?? "";
  return EXPECTED_MESSAGE_PATTERNS.some((pattern) => pattern.test(topLevel));
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) {
    event.message = redact(event.message);
  }

  for (const value of event.exception?.values ?? []) {
    if (value.value) {
      value.value = redact(value.value);
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) {
      breadcrumb.message = redact(breadcrumb.message);
    }
    if (breadcrumb.data) {
      breadcrumb.data = redactUnknown(breadcrumb.data) as Record<string, unknown>;
    }
  }

  if (event.extra) {
    event.extra = redactUnknown(event.extra) as Record<string, unknown>;
  }

  /*
   * The SDK collects a request URL on some transports. Keep the path, drop the
   * query, same reasoning as stripUrlSecrets.
   */
  if (event.request?.url) {
    event.request.url = stripUrlSecrets(event.request.url);
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }

  /*
   * Belt and braces. `sendDefaultPii: false` already suppresses these, but this
   * module is the single place a reviewer should have to trust.
   */
  if (event.user) {
    event.user = { id: event.user.id };
  }

  return event;
}

export function initSentry(): void {
  const dsn = mobileConfig.sentryDsn.trim();
  if (!dsn) {
    // No DSN configured — local Expo Go runs and any build that omits it stay
    // entirely offline rather than half-initialised.
    return;
  }

  const metadata = getClientMetadata();

  Sentry.init({
    dsn,
    environment: mobileConfig.sentryEnvironment,

    /*
     * These two must match what the Expo plugin uploads source maps under, or
     * every stack trace stays minified. Both come from the native build, not
     * from app.config.ts's `version`, so a JS-only change cannot drift them.
     */
    release: `${IOS_BUNDLE_ID}@${metadata.version}+${metadata.buildLabel}`,
    dist: metadata.buildLabel,

    /*
     * This app shows balances, wallet addresses, contact details, and tax
     * status. Nothing is sent about a user beyond the Privy DID set in
     * syncSentryUser.
     */
    sendDefaultPii: false,

    // Errors only for now. See the plan's "Follow-on" section before raising.
    tracesSampleRate: 0,

    beforeSend: (event) => (isExpected(event) ? null : scrubEvent(event)),

    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.message) {
        breadcrumb.message = redact(breadcrumb.message);
      }
      if (breadcrumb.data) {
        breadcrumb.data = redactUnknown(breadcrumb.data) as Record<string, unknown>;
      }
      return breadcrumb;
    },
  });
}

/**
 * Wraps the root component in Sentry's error boundary.
 *
 * Re-exported here so App.tsx never imports Sentry directly — everything this
 * integration does should be reviewable in this one file. Safe to call with no
 * DSN configured; the wrapper degrades to a passthrough.
 */
export const wrapRoot = Sentry.wrap;

/**
 * Mirrors the signed-in Privy DID into Sentry, and clears it on sign-out.
 *
 * The DID is the backend's own opaque key for a user, so an issue can be tied
 * to a support report without putting an email address in Sentry.
 *
 * Deliberately not the merchant-mode installation ID: the backend stores only a
 * hash of that (see AGENTS.md, "Preserve device scoping"), and copying the raw
 * value into a third party would undo the point of hashing it.
 */
export function syncSentryUser(privyUserId: string | undefined): void {
  if (!mobileConfig.sentryDsn.trim()) {
    return;
  }
  Sentry.setUser(privyUserId ? { id: privyUserId } : null);
}
