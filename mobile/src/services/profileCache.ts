import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The last profile the server returned, so the app is usable the moment
 * sign-in is ready instead of when the wallet has finished bootstrapping.
 *
 * ── What this unblocks ──────────────────────────────────────────────────────
 *
 * The tabs, the dock and the bell all wait for `appUser`, and `appUser` used to
 * arrive only after the whole wallet bootstrap — profile, Privy provider,
 * smart-wallet discovery (several RPC round trips), the managed-wallet sync —
 * and then a second profile fetch on top. A returning user watched "Loading
 * your account…" for all of it, even though the balance, the contacts and the
 * inbox were already cached. With the profile cached as well, the shell
 * renders the person's own app on its first frame and the bootstrap runs
 * behind it, with the top-bar spinner saying so.
 *
 * ── Why caching this is safe ────────────────────────────────────────────────
 *
 * It decides what to DRAW, and nothing else: every request is still
 * authorised by the server, which is what replaces this the moment the live
 * profile lands. The gates that must block — terms not accepted, a deleted
 * account — still arrive from the bootstrap and take the screen over as they
 * always did. Keyed by user, so somebody else signing in on this phone reads
 * as no cache; and cleared on sign-out.
 *
 * Typed loosely on purpose: the shape is whatever `ensureUser` returns, and the
 * shell writes and reads it through its own types.
 */

const STORAGE_KEY = "sfluv-wallet:profile-cache:v1";

/** A month: a stale profile is corrected one round trip after first paint. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Stored<T> = { userId: string; profile: T; savedAt: number };

let mirror: Stored<unknown> | null = null;
let currentUser: string | null = null;

/** Reads the cache into memory before the shell mounts. Called at launch. */
export async function primeProfileCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Stored<unknown>) : null;
    mirror = parsed && Date.now() - parsed.savedAt < MAX_AGE_MS ? parsed : null;
  } catch {
    mirror = null;
  }
}

/** Who is signed in, as soon as sign-in knows. Until then every read misses. */
export function setProfileCacheUser(userId: string | null) {
  currentUser = userId;
}

/** The cached profile for whoever is signed in, or null. Synchronous. */
export function cachedProfile<T>(): T | null {
  return currentUser && mirror?.userId === currentUser ? (mirror.profile as T) : null;
}

/**
 * Files a profile under the user it belongs to — passed in, not read from
 * `currentUser`, so a response that lands after a sign-out and somebody else's
 * sign-in cannot be saved under the wrong person.
 */
export function saveProfileCache<T>(userId: string, profile: T) {
  if (!userId || userId !== currentUser) {
    return;
  }
  mirror = { userId, profile, savedAt: Date.now() };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mirror)).catch(() => {});
}

export async function clearProfileCache() {
  mirror = null;
  // Nobody, until sign-in says otherwise: a save racing the sign-out must not
  // write the cleared profile straight back.
  currentUser = null;
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
