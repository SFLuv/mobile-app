import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AppBetaAccess } from "../types/app";

/**
 * The last-known beta access, so the dock does not rearrange itself on every
 * cold start.
 *
 * Which beta surfaces somebody has decides how many tabs the dock has and
 * which slot each one sits in — and the answer is per-user, so it cannot ride
 * along in the config the boot cache already keeps. Fetched fresh, it arrives a
 * round trip after first paint, and the visible result is the dock laying out
 * with Bulletin and Messages missing and then reflowing once the reply lands.
 * Tabs move under the thumb of somebody already reaching for one.
 *
 * So the answer is cached and the dock is built from it immediately, with the
 * real fetch correcting it behind.
 *
 * ── Why caching this is not a way around the gate ────────────────────────────
 *
 * It cannot be, because nothing is authorised here. Every /bulletin and
 * /conversations route checks the caller's grant against the database on every
 * request, so a cache that wrongly says "enabled" buys a tab that answers 403
 * until the fetch corrects it — not access. The cache decides what to draw
 * first and nothing else, which is the same standing the boot cache's
 * wasSignedIn has.
 *
 * Keyed by user id, which is the part that matters for correctness: two people
 * share a device, and the second must not inherit the first's dock. A
 * mismatched id reads as no cache, and the tabs stay hidden until the server
 * answers for whoever is actually signed in.
 */

const STORAGE_KEY = "sfluv-wallet:beta-access:v1";

/**
 * How long a cached answer may be drawn from.
 *
 * Generous on purpose, and it can afford to be: unlike the version gate's
 * cache, nothing here is load-bearing. The worst a month-old entry does is
 * draw one dock for one round trip before the server replaces it. The expiry
 * exists only so an install nobody has opened since a beta ended does not
 * open on a tab that has since been withdrawn.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredBetaAccess = {
  userId: string;
  access: AppBetaAccess;
  savedAt: number;
};

export const emptyBetaAccess: AppBetaAccess = { features: [], available: {} };

/**
 * The in-memory mirror, so the first render can read this synchronously.
 *
 * AsyncStorage cannot be read during a useState initializer, and an effect
 * runs after the first paint — which is the reflow this file exists to remove.
 * primeBetaCache fills this during boot, before the signed-in shell mounts,
 * and cachedBetaFor is then an ordinary synchronous lookup.
 */
let mirror: StoredBetaAccess | null = null;

function usable(entry: StoredBetaAccess | null): StoredBetaAccess | null {
  if (!entry || !entry.userId || !entry.access) {
    return null;
  }
  if (!entry.savedAt || Date.now() - entry.savedAt > MAX_AGE_MS) {
    return null;
  }
  return entry;
}

/**
 * Warms the mirror from storage. Called once during boot, beside the boot
 * cache's own read, so both local reads happen in the same breath.
 */
export async function primeBetaCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    mirror = raw ? usable(JSON.parse(raw) as StoredBetaAccess) : null;
  } catch {
    // A corrupt entry is the same as none: draw the default dock and wait for
    // the server, which is what the app did before this existed.
    mirror = null;
  }
}

/**
 * The cached access for one user, or null when there is nothing for them.
 *
 * Synchronous, and safe to call before primeBetaCache has run — it simply
 * answers null, which is the same answer a first-ever launch gets.
 */
export function cachedBetaFor(userId: string | null | undefined): AppBetaAccess | null {
  const entry = usable(mirror);
  if (!entry || !userId || entry.userId !== userId) {
    return null;
  }
  return entry.access;
}

/**
 * Stores a fresh answer, and updates the mirror so a remount within the same
 * session does not have to wait for storage either.
 *
 * Best-effort: failing to write costs the next launch its head start.
 */
export async function saveBetaCache(userId: string, access: AppBetaAccess): Promise<void> {
  if (!userId) {
    return;
  }
  const entry: StoredBetaAccess = { userId, access, savedAt: Date.now() };
  mirror = entry;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Not worth surfacing.
  }
}

/** Clears the cache. */
export async function clearBetaCache(): Promise<void> {
  mirror = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not worth surfacing.
  }
}
