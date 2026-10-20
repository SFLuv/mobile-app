import AsyncStorage from "@react-native-async-storage/async-storage";

import { getClientMetadata } from "./clientMetadata";
import type { AppClientConfig, AppClientVersionPolicy } from "../types/app";

/**
 * The last-known-good startup state, so a cold start does not wait on the
 * network before showing anything.
 *
 * Before this, the app did two serial network calls — the client-version policy
 * and the backend config — and rendered a full-screen "Checking app
 * compatibility…" until both landed. Nothing was interactive, nothing was on
 * screen, and on a slow or flaky connection that was the whole experience of
 * opening the app. Worse on a re-foreground, where the same gate could reappear
 * over a session that had been running fine.
 *
 * So the policy and the config are cached, the app boots from them, and the
 * real check runs behind it.
 *
 * ── Why this does not weaken the version gate ────────────────────────────────
 *
 * The gate exists so we can stop a broken or unsupported build from talking to
 * the backend, and that has to keep working. Four rules keep it intact:
 *
 *  1. Only a NON-blocking policy is ever cached. A maintenance window or a
 *     force-update is never written here, so a cached boot can never be a
 *     cached bypass of one.
 *  2. The cache is keyed by the binary — platform, version and build. The
 *     policy is a statement about a particular build, so a new build gets no
 *     use of the old one's verdict and falls back to waiting for the network,
 *     exactly as it does today.
 *  3. It expires. A device that has not completed a real check within the
 *     staleness window waits for one rather than booting from a week-old
 *     answer.
 *  4. The real check still runs on every launch and every foreground, and a
 *     blocking policy takes effect the moment it arrives, tearing down to the
 *     gate screen mid-session if that is what the server says.
 *
 * What is actually given up is the window between launch and that reply — a
 * second or two in which a build the server now wants updated is usable. That
 * is the trade, it is bounded by one round trip, and it buys every launch on a
 * slow connection.
 */

const STORAGE_KEY = "sfluv-wallet:boot-cache:v1";

/**
 * How long a cached startup state may be booted from.
 *
 * Seven days rather than hours: a daily user's cache is always "stale" by any
 * tighter measure, and making them wait for the network defeats the point. It
 * is short enough that an install nobody has opened in a week re-checks before
 * being used, which is the case where a missed force-update would matter.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type BootCache = {
  version: AppClientVersionPolicy;
  config: AppClientConfig;
  /**
   * Whether somebody was signed in when this was written.
   *
   * Used only to choose which skeleton to show while Privy initializes: the
   * signed-in shell, or the sign-in screen. It is never treated as
   * authentication — no request is made and nothing is unlocked on the strength
   * of it. Privy's own state replaces it a moment later, and if it disagrees
   * the screen simply changes.
   */
  wasSignedIn: boolean;
  savedAt: number;
};

type StoredBootCache = BootCache & {
  /** The binary this was written by. A different one does not get to use it. */
  client: string;
};

function clientKey(): string {
  const metadata = getClientMetadata();
  return `${metadata.platform}:${metadata.version}:${metadata.buildLabel}`;
}

/**
 * Reports whether a policy would stop the app, which is also the test for
 * whether it may be cached.
 *
 * Deliberately a superset of the fields the gate reads today. If the server
 * grows a new way to say "stop", the safe failure is to decline to cache a
 * policy we do not fully understand rather than to cache one that turns out to
 * have been a block.
 */
export function policyIsBlocking(version: AppClientVersionPolicy): boolean {
  return Boolean(
    version.maintenance ||
      version.forceUpdate ||
      version.status === "maintenance" ||
      version.status === "update_required" ||
      version.status === "unsupported_platform",
  );
}

/** Reads the cached startup state, or null when there is nothing usable. */
export async function loadBootCache(): Promise<BootCache | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredBootCache;
    if (!parsed?.version || !parsed?.config) {
      return null;
    }
    // Rule 2: a different binary does not get to use this.
    if (parsed.client !== clientKey()) {
      return null;
    }
    // Rule 3: too old to boot from.
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      return null;
    }
    // Rule 1, enforced on the way out as well as on the way in. A cache
    // written by an older build of this code, before the rule existed, could
    // hold a blocking policy; refusing to boot from one here means that is
    // harmless rather than a bypass.
    if (policyIsBlocking(parsed.version)) {
      return null;
    }
    return {
      version: parsed.version,
      config: parsed.config,
      wasSignedIn: parsed.wasSignedIn === true,
      savedAt: parsed.savedAt,
    };
  } catch {
    // A corrupt or unreadable cache is the same as no cache: wait for the
    // network, exactly as the app did before this existed.
    return null;
  }
}

/**
 * Stores a successful check.
 *
 * A blocking policy is refused rather than stored, which is rule 1. Everything
 * here is best-effort: failing to write the cache costs the next launch its
 * head start and nothing else.
 */
export async function saveBootCache(input: {
  version: AppClientVersionPolicy;
  config: AppClientConfig;
  wasSignedIn: boolean;
}): Promise<void> {
  if (policyIsBlocking(input.version)) {
    return;
  }
  try {
    const payload: StoredBootCache = {
      version: input.version,
      config: input.config,
      wasSignedIn: input.wasSignedIn,
      savedAt: Date.now(),
      client: clientKey(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Not worth surfacing.
  }
}

/**
 * Records whether somebody is signed in, without touching the cached policy.
 *
 * Separate from saveBootCache because sign-in and sign-out happen far more
 * often than a config check, and rewriting the whole entry on each would reset
 * its age — making a cache that is actually a week old look fresh, and
 * defeating rule 3.
 */
export async function rememberSignedIn(wasSignedIn: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as StoredBootCache;
    if (parsed.wasSignedIn === wasSignedIn) {
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, wasSignedIn }));
  } catch {
    // Not worth surfacing.
  }
}

/** Clears the cache. */
export async function clearBootCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not worth surfacing.
  }
}
