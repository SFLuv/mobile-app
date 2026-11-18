import { DevSettings, I18nManager } from "react-native";
import * as Updates from "expo-updates";

/**
 * Right-to-left layout for Arabic.
 *
 * React Native mirrors layout (rows, margins, left/right) when I18nManager is
 * in RTL mode, but the mode is read once at startup, so switching it means
 * restarting the app. forceRTL persists natively, which is why this only
 * restarts when the wanted direction differs from the running one: no loop.
 */
export function ensureDirection(rtl: boolean): void {
  if (I18nManager.isRTL === rtl) {
    return;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  // Updates.reloadAsync is the production path; a development build has no
  // update to reload into, so it falls back to the dev menu's reload.
  void Updates.reloadAsync().catch(() => {
    DevSettings.reload();
  });
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
