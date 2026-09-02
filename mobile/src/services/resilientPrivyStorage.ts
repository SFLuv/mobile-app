import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Privy token storage that survives a broken keychain.
 *
 * The keychain is the right place for session tokens and is where they go on
 * every healthy install. But a local simulator build made without signing
 * certificates carries no keychain entitlement, and there every SecureStore
 * call throws "A required entitlement isn't present". With the default adapter
 * that error surfaces as Privy hanging on "Initializing…" forever, which reads
 * as anything except what it is. So the keychain is tried first, and if it is
 * unusable there is a fallback — loudly, once — so a dev-stack session beats no
 * session.
 *
 * What the fallback is depends on the build, and that distinction is the whole
 * point of this file:
 *
 *   - Development: AsyncStorage, exactly as before. Unencrypted, on disk, and
 *     acceptable only because the entitlement problem it exists for is a
 *     development problem.
 *
 *   - Release: memory, for the life of the process. A signed build was assumed
 *     never to reach the fallback at all, but SecureStore also throws on real
 *     devices — Keystore invalidation after an OS upgrade, keychain errors
 *     restoring from a backup, biometric re-enrolment. Catching those the same
 *     way wrote a refresh token to unencrypted disk on a device whose owner had
 *     done nothing wrong, and merchant tills sit unattended on a counter where
 *     physical access is the normal case rather than the exception. Degrading
 *     to memory keeps the session working for this launch and costs a sign-in
 *     on the next one, which is the right price for a wallet.
 *
 * Two failures made the old plaintext copy permanent rather than transient, so
 * both are handled explicitly below: a successful keychain write left any
 * earlier fallback entry in place forever, and a read preferred that stale copy
 * over re-authenticating. Every successful keychain access now clears the
 * plaintext copy, and a release build migrates a legacy entry into the keychain
 * (or into memory, if the keychain is the thing that is broken) and deletes it
 * on the way past — so an install carrying one from a previous version is
 * cleaned up on the next read without logging anybody out.
 *
 * Privy sanitizes keys before calling this adapter (":" and "/" become "-"),
 * which also keeps them legal for SecureStore. getKeys returning [] mirrors
 * the SDK's own adapter.
 */
const FALLBACK_PREFIX = "privy-fallback.";
const KEYCHAIN_OPTS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// The unsigned-simulator case this file was written for is by definition a
// development build, so nothing the fallback was meant to rescue is lost by
// confining it to one.
const PLAINTEXT_FALLBACK_ALLOWED = __DEV__;

// Release-build fallback. Never written to disk, and gone when the process is.
const memoryFallback = new Map<string, string>();

export type PrivyStorageDegradation = "none" | "memory" | "plaintext";

let degradation: PrivyStorageDegradation = "none";

/**
 * Whether the keychain failed this session, and what took its place.
 *
 * Nothing reads this yet — the app has no error reporting to send it to. It is
 * exported because the assumption this file rests on ("the fallback never runs
 * on a signed build") has never been measured, and a single console.error that
 * fires once per process is not a way to measure it.
 */
export const getPrivyStorageDegradation = (): PrivyStorageDegradation => degradation;

const noteDegraded = (error: unknown) => {
  const mode: PrivyStorageDegradation = PLAINTEXT_FALLBACK_ALLOWED
    ? "plaintext"
    : "memory";
  if (degradation === mode) return;
  degradation = mode;
  console.error(
    `[privy-storage] keychain unavailable — falling back to ${mode} storage:`,
    (error as Error)?.message,
  );
};

// A plaintext copy is only ever a transient rescue, so any successful keychain
// access is the moment to be rid of it. Failing to remove it is not worth
// failing the surrounding operation over.
const discardPlaintext = async (key: string): Promise<void> => {
  await AsyncStorage.removeItem(FALLBACK_PREFIX + key).catch(() => undefined);
};

export const resilientPrivyStorage = {
  async get(key: string): Promise<string | null> {
    let keychainUsable = true;
    try {
      const value = await SecureStore.getItemAsync(key, KEYCHAIN_OPTS);
      if (value !== null) {
        await discardPlaintext(key);
        return value;
      }
    } catch (error) {
      keychainUsable = false;
      noteDegraded(error);
    }

    const remembered = memoryFallback.get(key);
    if (remembered !== undefined) return remembered;

    const stored = await AsyncStorage.getItem(FALLBACK_PREFIX + key).catch(
      () => null,
    );
    if (stored === null) return null;

    if (PLAINTEXT_FALLBACK_ALLOWED) return stored;

    // A release build has found a plaintext token written by an older version.
    // Keep the session — logging somebody out to fix our own bug would be the
    // wrong trade — but do not let the copy on disk survive this read.
    if (keychainUsable) {
      try {
        await SecureStore.setItemAsync(key, stored, KEYCHAIN_OPTS);
      } catch (error) {
        noteDegraded(error);
        memoryFallback.set(key, stored);
      }
    } else {
      memoryFallback.set(key, stored);
    }
    await discardPlaintext(key);
    return stored;
  },

  async put(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTS);
      memoryFallback.delete(key);
      await discardPlaintext(key);
      return;
    } catch (error) {
      noteDegraded(error);
    }

    if (PLAINTEXT_FALLBACK_ALLOWED) {
      await AsyncStorage.setItem(FALLBACK_PREFIX + key, value);
      return;
    }
    memoryFallback.set(key, value);
  },

  async del(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key, KEYCHAIN_OPTS);
    } catch (error) {
      noteDegraded(error);
    }
    memoryFallback.delete(key);
    await discardPlaintext(key);
  },

  async getKeys(): Promise<string[]> {
    return [];
  },
};
