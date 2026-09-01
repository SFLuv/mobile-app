import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Privy token storage that survives a broken keychain.
 *
 * The keychain is the right place for session tokens, and on any properly
 * signed build that is exactly where they go — the fallback never runs. But a
 * local simulator build made without signing certificates carries no keychain
 * entitlement, and there every SecureStore call throws "A required entitlement
 * isn't present". With the default adapter that error surfaces as Privy
 * hanging on "Initializing…" forever, which reads as anything except what it
 * is. So: keychain first, and if the keychain itself is unusable, fall back
 * to AsyncStorage — loudly, once — so a dev-stack session beats no session.
 *
 * Privy sanitizes keys before calling this adapter (":" and "/" become "-"),
 * which also keeps them legal for SecureStore. getKeys returning [] mirrors
 * the SDK's own adapter.
 */
const FALLBACK_PREFIX = "privy-fallback.";
const KEYCHAIN_OPTS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let warned = false;
const warnOnce = (error: unknown) => {
  if (warned) return;
  warned = true;
  console.error(
    "[privy-storage] keychain unavailable — falling back to AsyncStorage:",
    (error as Error)?.message,
  );
};

export const resilientPrivyStorage = {
  async get(key: string): Promise<string | null> {
    try {
      const value = await SecureStore.getItemAsync(key, KEYCHAIN_OPTS);
      if (value !== null) return value;
    } catch (error) {
      warnOnce(error);
    }
    return AsyncStorage.getItem(FALLBACK_PREFIX + key);
  },
  async put(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTS);
      return;
    } catch (error) {
      warnOnce(error);
    }
    await AsyncStorage.setItem(FALLBACK_PREFIX + key, value);
  },
  async del(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key, KEYCHAIN_OPTS);
    } catch (error) {
      warnOnce(error);
    }
    await AsyncStorage.removeItem(FALLBACK_PREFIX + key).catch(() => undefined);
  },
  async getKeys(): Promise<string[]> {
    return [];
  },
};
