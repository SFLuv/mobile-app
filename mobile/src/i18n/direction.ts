import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, DevSettings, I18nManager } from "react-native";
import * as Updates from "expo-updates";
import i18next from "i18next";

import { markReturnPointForRestart, peekReturnPoint } from "./returnPoint";

const t = (key: string) => i18next.t(key) as string;

const PENDING_KEY = "sfluv-wallet:rtl-pending-switch";
let reloadScheduled = false;

// Whether a direction restart is under way. The app covers the screen while it
// is, so nobody sees the half-switched layout in the moment before the restart.
let switching = false;
const switchingListeners = new Set<(value: boolean) => void>();
function setSwitching(value: boolean): void {
  if (switching === value) {
    return;
  }
  switching = value;
  switchingListeners.forEach((listener) => listener(value));
}

// After the restart the cover stays up until the screen the switch was made
// from is back as it was (SettingsScreen calls releaseDirectionCover), so the
// Wallet and an unscrolled Settings never flash by. Never longer than this.
const HOLD_AFTER_RESTART_MS = 6000;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * At launch, once the saved return point is loaded: if it was saved for a
 * direction restart, keep the cover up until the app is back there.
 */
export function holdDirectionCoverIfRestarted(): void {
  if (!peekReturnPoint()?.restart || holdTimer) {
    return;
  }
  setSwitching(true);
  holdTimer = setTimeout(releaseDirectionCover, HOLD_AFTER_RESTART_MS);
}

/** The screen is back where the person left it. */
export function releaseDirectionCover(): void {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (!reloadScheduled) {
    setSwitching(false);
  }
}

/** True from the moment a direction switch is scheduled until the restart. */
export function useDirectionSwitching(): boolean {
  const [value, setValue] = useState(switching);
  useEffect(() => {
    switchingListeners.add(setValue);
    setValue(switching);
    return () => {
      switchingListeners.delete(setValue);
    };
  }, []);
  return value;
}

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
  setSwitching(true);
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
      setSwitching(false);
      Alert.alert(t("direction.reopenTitle"), t("direction.reopenBody"));
      return;
    }
    try {
      await AsyncStorage.setItem(PENDING_KEY, rtl ? "rtl" : "ltr");
      markReturnPointForRestart();
    } catch {
      setSwitching(false);
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
