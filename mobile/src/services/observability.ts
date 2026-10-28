import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";
import * as Updates from "expo-updates";

import { mobileConfig } from "../config";

/*
 * Every piece of Sentry wiring lives in this file. App.tsx and the services
 * call the small functions exported below and never import Sentry directly, so
 * the whole integration, and above all what it is allowed to send, is
 * reviewable in one place. See docs/SENTRY.md.
 *
 * Errors only: no tracing, no profiling, no replay. The free plan is 5,000
 * events a month for the whole org, so everything here leans towards sending
 * less.
 */

const enabled = () => mobileConfig.sentryDsn.trim().length > 0;

// ── Noise ────────────────────────────────────────────────────────────────────

/**
 * Errors that are normal app lifecycle, not faults, dropped before they reach
 * Sentry. Matched on `name` so this module does not import appBackend.ts; each
 * of those classes sets `this.name` explicitly.
 */
const EXPECTED_ERROR_NAMES = new Set([
  // Access token expiry: the user is asked to sign in again.
  "AppBackendAuthError",
  // Privacy-policy gate: a product state, not a failure.
  "AppBackendPolicyRequiredError",
  // fetchWithTimeout aborting: slow network or a backgrounded app.
  "AbortError",
]);

const EXPECTED_MESSAGE_PATTERNS = [
  /network request failed/i,
  /the network connection was lost/i,
  /the request timed out/i,
  /unable to reach the shared app backend/i,
];

/**
 * The same report from the same phone is sent at most once per window. A
 * screen that retries a failing call every few seconds would otherwise spend
 * the month's quota on one bug, and the first report already says everything
 * the later ones would.
 */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const lastSentAt = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < REPEAT_WINDOW_MS) {
    return false;
  }
  lastSentAt.set(key, now);
  return true;
}

// ── Redaction ────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EVM_ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;
/** Six or more digits in a row: merchant-mode PINs and phone numbers. */
const LONG_DIGIT_RUN_PATTERN = /\b\d{6,}\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)\]]+/g;

/** `0x1234…abcd`: still enough to match a support report, not a whole wallet. */
function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Drops a URL's query string and fragment.
 *
 * This is what keeps the W-9 flow safe: App.tsx logs the minted tax-form URL,
 * Sentry turns console calls into breadcrumbs, and the vendor token lives in
 * the query string. The path alone still says which endpoint was involved.
 */
function stripUrlSecrets(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : `${url.slice(0, cut)}?<redacted>`;
}

/**
 * Removes identifying values from free text. Deliberately blunt: losing a
 * little context costs less than a user's email or tax link in a third party.
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
  for (const value of event.exception?.values ?? []) {
    if (value.type && EXPECTED_ERROR_NAMES.has(value.type)) {
      return true;
    }
    if (EXPECTED_MESSAGE_PATTERNS.some((pattern) => pattern.test(value.value ?? ""))) {
      return true;
    }
  }
  return EXPECTED_MESSAGE_PATTERNS.some((pattern) => pattern.test(event.message ?? ""));
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
  if (event.request?.url) {
    event.request.url = stripUrlSecrets(event.request.url);
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }
  // `sendDefaultPii: false` already limits this; restated so this file is the
  // only thing a reviewer has to trust.
  if (event.user) {
    event.user = { id: event.user.id };
  }
  return event;
}

// ── Setup ────────────────────────────────────────────────────────────────────

export function initSentry(): void {
  if (!enabled()) {
    // No DSN: local runs stay entirely offline rather than half-initialised.
    return;
  }

  Sentry.init({
    dsn: mobileConfig.sentryDsn.trim(),
    environment: mobileConfig.sentryEnvironment,
    /*
     * release and dist are left to the SDK, which reads them from the native
     * build (`org.sfluv.wallet@2.2.0+19`). Source maps are matched by the debug
     * ID metro stamps into each bundle, so an over-the-air update maps
     * correctly without its own release. The SDK also attaches the update's
     * id and channel as the `ota_updates` context.
     */
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 60,
    beforeSend: (event) => (isExpected(event) ? null : scrubEvent(event)),
    beforeBreadcrumb: (breadcrumb) => {
      if (isRoutineAutoRequest(breadcrumb)) {
        return null;
      }
      if (breadcrumb.message) {
        breadcrumb.message = redact(breadcrumb.message);
      }
      if (breadcrumb.data) {
        breadcrumb.data = redactUnknown(breadcrumb.data) as Record<string, unknown>;
      }
      return breadcrumb;
    },
  });

  /*
   * Searchable copies of what the ota_updates context carries, so "everything
   * since update X" is a filter rather than a scroll.
   */
  Sentry.setTag("ota.embedded", Updates.isEmbeddedLaunch ? "yes" : "no");
  if (Updates.updateId) {
    Sentry.setTag("ota.update_id", Updates.updateId);
  }
  if (Updates.channel) {
    Sentry.setTag("ota.channel", Updates.channel);
  }
}

/**
 * The root error boundary. React Native has none above the root component, so
 * without it a render error blanks the app with nothing reported.
 */
export const wrapRoot = Sentry.wrap;

/**
 * Mirrors the signed-in Privy DID into Sentry and clears it on sign-out.
 *
 * The DID is the backend's own opaque key for a person, so an issue can be
 * matched to a support report without an email address reaching Sentry. Not
 * the merchant-mode installation id, which the backend only stores hashed.
 */
export function syncSentryUser(privyUserId: string | undefined): void {
  if (!enabled()) {
    return;
  }
  Sentry.setUser(privyUserId ? { id: privyUserId } : null);
}

// ── Request IDs ──────────────────────────────────────────────────────────────

/** The header every backend request carries; the backend prints it in its logs. */
export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * A short random id for one request. It is what joins a Sentry report to the
 * matching lines in the Railway logs: search the logs for it.
 */
export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A request path with its ids replaced, so `/conversations/41/messages` and
 * `/conversations/97/messages` group as one issue. Query strings are dropped.
 */
export function routeTemplate(url: string): string {
  let path = url.replace(/^https?:\/\/[^/]+/, "");
  const cut = path.search(/[?#]/);
  if (cut !== -1) {
    path = path.slice(0, cut);
  }
  return path
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) ||
      /^0x[a-fA-F0-9]{8,}$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ||
      /^did(:|%3A)/i.test(segment) ||
      segment.length > 24
        ? ":id"
        : segment,
    )
    .join("/");
}

export type RequestRecord = {
  /** `backend` for api.sfluv.org routes, `rpc` for the UserOperation path. */
  kind: "backend" | "rpc";
  method: string;
  /** Route template or RPC method; never a raw URL or body. */
  target: string;
  status?: number;
  durationMs: number;
  requestId: string;
  /** Set when the request never got a response. */
  failure?: string;
};

/**
 * The SDK records every fetch and XHR on its own. Successful ones are mostly
 * the balance poll to the Celo node every two seconds, which pushed everything
 * useful out of the trail; backend calls already get a richer step from
 * recordRequest. Failed ones are kept.
 */
function isRoutineAutoRequest(breadcrumb: Sentry.Breadcrumb): boolean {
  if (breadcrumb.category !== "http" && breadcrumb.category !== "xhr" && breadcrumb.category !== "fetch") {
    return false;
  }
  const data = breadcrumb.data;
  if (!data || typeof data.url !== "string" || "request_id" in data) {
    return false;
  }
  const status = typeof data.status_code === "number" ? data.status_code : 0;
  return status >= 200 && status < 400;
}

/**
 * One step in the trail an issue carries. Method, target, status, timing and
 * request id only: bodies carry addresses and amounts and are never recorded.
 */
export function recordRequest(record: RequestRecord): void {
  if (!enabled()) {
    return;
  }
  Sentry.addBreadcrumb({
    category: record.kind === "rpc" ? "rpc" : "http",
    level: record.failure || (record.status ?? 0) >= 400 ? "warning" : "info",
    message: `${record.method} ${record.target}${record.status ? ` → ${record.status}` : ""}${
      record.failure ? ` (${record.failure})` : ""
    }`,
    data: {
      status: record.status,
      duration_ms: Math.round(record.durationMs),
      request_id: record.requestId,
    },
  });
}

/**
 * Reports a backend answer the app treated as an error.
 *
 * Grouped by method, route and status, so one failing route is one issue
 * however many people hit it. The response detail is included because it is
 * usually the whole diagnosis ("conversation not found"), after redaction.
 */
export function reportRequestFailure(record: RequestRecord & { detail?: string }): void {
  if (!enabled()) {
    return;
  }
  const status = record.status ?? 0;
  if (status === 401) {
    // Expired session: handled by signing in again.
    return;
  }
  const key = `${record.kind}|${record.method}|${record.target}|${status || record.failure || ""}`;
  if (!shouldSend(key)) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setLevel(status >= 500 || !status ? "error" : "warning");
    scope.setFingerprint(["request-failure", record.kind, record.method, record.target, String(status)]);
    scope.setTag("request_id", record.requestId);
    scope.setTag("request.route", record.target);
    scope.setTag("request.status", String(status));
    scope.setContext("request", {
      kind: record.kind,
      method: record.method,
      route: record.target,
      status,
      duration_ms: Math.round(record.durationMs),
      request_id: record.requestId,
      detail: record.detail ? redact(record.detail).slice(0, 500) : undefined,
    });
    Sentry.captureMessage(
      `${record.method} ${record.target} failed${status ? ` with ${status}` : ""}${
        record.failure ? `: ${record.failure}` : ""
      }`,
    );
  });
}

// ── Steps and stuck screens ──────────────────────────────────────────────────

/**
 * A user-visible step for the trail: a tab change, a notification tap, a
 * screen opening. `data` must not carry names, emails, addresses or amounts.
 */
export function recordStep(category: string, message: string, data?: Record<string, unknown>): void {
  if (!enabled()) {
    return;
  }
  Sentry.addBreadcrumb({ category, message, level: "info", data });
}

const STUCK_AFTER_MS = 15_000;

/**
 * Starts a timer for something the user is waiting on. Call the returned
 * function when it finishes, successfully or not. If it is still running after
 * fifteen seconds, one warning is sent with the trail that led there: the
 * "loads forever" class of bug, which never throws and so is otherwise
 * invisible.
 *
 * Calling the finish function late, after the warning, is harmless.
 */
export function watchForStuck(
  label: string,
  context?: Record<string, string | number | boolean | undefined>,
  timeoutMs = STUCK_AFTER_MS,
): () => void {
  if (!enabled()) {
    return () => {};
  }
  const startedAt = Date.now();
  recordStep("wait", `${label} started`, context);
  const timer = setTimeout(() => {
    if (!shouldSend(`stuck|${label}`)) {
      return;
    }
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setFingerprint(["stuck", label]);
      scope.setTag("stuck", label);
      scope.setContext("wait", { label, waited_ms: Date.now() - startedAt, ...context });
      Sentry.captureMessage(`Still waiting: ${label} after ${Math.round(timeoutMs / 1000)}s`);
    });
  }, timeoutMs);
  return () => {
    clearTimeout(timer);
    recordStep("wait", `${label} finished`, { after_ms: Date.now() - startedAt });
  };
}

/**
 * watchForStuck for a screen's loading state: the timer runs while `active` is
 * true. Put it next to a spinner and a spinner that never stops is reported.
 */
export function useStuckWatch(
  label: string,
  active: boolean,
  context?: Record<string, string | number | boolean | undefined>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    return watchForStuck(label, context);
    // The context describes the wait when it starts; later changes to it are
    // not a new wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, active]);
}

/**
 * A handled error worth knowing about: caught, shown to the user as a message,
 * and otherwise lost. `where` names the code path and groups the issue.
 */
export function reportHandledError(where: string, error: unknown, context?: Record<string, unknown>): void {
  if (!enabled()) {
    return;
  }
  const message = (error as Error)?.message ?? String(error);
  if (!shouldSend(`handled|${where}|${message}`)) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag("where", where);
    if (context) {
      scope.setContext("handled", context);
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(`${where}: ${message}`);
    }
  });
}

/**
 * Settings → About, long-press the version: proves the pipeline end to end.
 * The issue should show this function, in this file, at this line.
 */
export function sendTestError(): void {
  if (!enabled()) {
    return;
  }
  Sentry.captureException(new Error(`Sentry test error (${mobileConfig.sentryEnvironment})`));
}
