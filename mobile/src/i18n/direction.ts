import AsyncStorage from "@react-native-async-storage/async-storage";
import { DevSettings, I18nManager } from "react-native";
import * as Updates from "expo-updates";

const RELOAD_ATTEMPT_KEY = "sfluv-wallet:rtl-reload-attempt";
let reloadScheduled = false;

/**
 * Right-to-left layout for Arabic.
 *
 * React Native mirrors layout (rows, margins, left/right) when I18nManager is
 * in RTL mode, but reads the mode when it starts, so a switch needs a restart.
 * forceRTL is saved natively and takes effect on the next start.
 *
 * Restarting is guarded two ways, because a restart that does not apply the
 * new direction (a JS-only reload in a development build) would otherwise
 * loop forever:
 *  - at most one attempt a minute, recorded in storage so it survives the
 *    reload itself; after that the text is still Arabic and the mirrored
 *    layout applies at the next full launch;
 *  - deferred by a moment: reloading in the middle of the redraw that a
 *    language change causes crashes React Native's renderer.
 */
export function ensureDirection(rtl: boolean): void {
  if (I18nManager.isRTL === rtl) {
    return;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (reloadScheduled) {
    return;
  }
  reloadScheduled = true;
  void (async () => {
    try {
      const last = Number((await AsyncStorage.getItem(RELOAD_ATTEMPT_KEY)) || 0);
      if (Date.now() - last < 60_000) {
        return;
      }
      await AsyncStorage.setItem(RELOAD_ATTEMPT_KEY, String(Date.now()));
    } catch {
      // Storage unavailable: don't risk a loop.
      return;
    }
    // A short delay, not InteractionManager: the app runs looping animations,
    // so "after interactions" may never arrive. The language change's redraw
    // has committed well within this.
    setTimeout(() => {
      void Updates.reloadAsync().catch(() => {
        DevSettings.reload();
      });
    }, 700);
  })();
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
