import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, DevSettings, I18nManager } from "react-native";
import * as Updates from "expo-updates";
import i18next from "i18next";

const t = (key: string) => i18next.t(key) as string;

const PENDING_KEY = "sfluv-wallet:rtl-pending-switch";
let reloadScheduled = false;

/**
 * Right-to-left layout for Arabic.
 *
 * React Native mirrors layout (rows, margins, left/right) when I18nManager is
 * in RTL mode, but reads the mode when it starts, so a switch needs a restart.
 * forceRTL is saved natively and applies from the next start.
 *
 * Each switch gets exactly one restart. Before restarting, the wanted
 * direction is recorded; when the app comes back in that direction the record
 * is cleared, so the next switch (say straight back to English) gets its own
 * restart however soon it follows. If the app comes back still in the old
 * direction, the restart did not apply it (a JS-only reload does that in
 * development builds): instead of looping, the person is asked to reopen the
 * app, which always applies it.
 *
 * The restart is deferred a moment: reloading in the middle of the redraw a
 * language change causes crashes React Native's renderer.
 */
export function ensureDirection(rtl: boolean): void {
  if (I18nManager.isRTL === rtl) {
    void AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
    return;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (reloadScheduled) {
    return;
  }
  reloadScheduled = true;
  void (async () => {
    let pending: boolean | null = null;
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      pending = raw === null ? null : raw === "rtl";
    } catch {
      pending = null;
    }
    if (pending === rtl) {
      // Already restarted for exactly this switch and it didn't take.
      Alert.alert(t("direction.reopenTitle"), t("direction.reopenBody"));
      return;
    }
    try {
      await AsyncStorage.setItem(PENDING_KEY, rtl ? "rtl" : "ltr");
    } catch {
      return; // Can't record the attempt, so don't risk a loop.
    }
    setTimeout(() => {
      void Updates.reloadAsync().catch(() => {
        DevSettings.reload();
      });
    }, 700);
  })();
}

/** Whether a direction restart is about to happen in this session. */
export function directionRestartPending(): boolean {
  return reloadScheduled;
}

const MIRRORED: Record<string, string> = {
  "arrow-back": "arrow-forward",
  "arrow-forward": "arrow-back",
  "chevron-back": "chevron-forward",
  "chevron-forward": "chevron-back",
};

/**
 * An icon name that points the right way for the reading direction: "back"
 * points right in Arabic. Icons with meaning beyond direction (up, down) are
 * left alone.
 */
export function dirIcon<T extends string>(name: T): T {
  return (I18nManager.isRTL ? MIRRORED[name] ?? name : name) as T;
}

/**
 * +1 left to right, -1 right to left. React Native mirrors layout but not
 * transforms or gesture deltas, so anything that slides (a swipe-to-confirm
 * handle, a tab highlight) multiplies by this on the way in and out.
 */
export function dirSign(): 1 | -1 {
  return I18nManager.isRTL ? -1 : 1;
}
