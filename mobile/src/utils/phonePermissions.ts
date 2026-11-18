import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import i18next from "../i18n";

/**
 * Where the phone stands on one of SFLuv's permissions.
 *
 * - granted: allowed.
 * - askable: not allowed yet, but the system popup can still be shown.
 * - blocked: refused, and the phone will not show the popup again. iOS gives
 *   one chance; Android two. From here only the phone's Settings app can turn
 *   it back on, and asking in code just returns "denied" with nothing on screen.
 * - checking: not read yet.
 */
export type PhoneAccess = "checking" | "granted" | "askable" | "blocked";

type PermissionLike = { granted: boolean; canAskAgain: boolean } | null | undefined;

export function phoneAccessOf(permission: PermissionLike): PhoneAccess {
  if (!permission) {
    return "checking";
  }
  if (permission.granted) {
    return "granted";
  }
  return permission.canAskAgain ? "askable" : "blocked";
}

/** Opens SFLuv's own page in the phone's Settings app. */
export function openPhoneSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/**
 * Explains a blocked permission and offers the way out. Used where there is no
 * room on screen for a card that says it.
 */
export function promptOpenSettings(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: i18next.t("common.notNow"), style: "cancel" },
    { text: i18next.t("common.openSettings"), onPress: openPhoneSettings },
  ]);
}

/**
 * Runs `onActive` each time the app comes back to the foreground: after a trip
 * to the Settings app, a permission may have changed. (On iOS, turning camera
 * or photo access on restarts the app, so this mostly matters on Android and
 * for notifications, which do not.)
 */
export function useOnForeground(onActive: () => void): void {
  const latest = useRef(onActive);
  latest.current = onActive;
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (previous !== "active" && next === "active") {
        latest.current();
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);
}

/** The Settings prompt for a blocked camera, in the current language. */
export function promptCameraBlocked(): void {
  promptOpenSettings(i18next.t("permissions.camera.offTitle"), i18next.t("permissions.camera.blockedMessage"));
}

/** The Settings prompt for blocked photo access, in the current language. */
export function promptPhotosBlocked(): void {
  promptOpenSettings(i18next.t("permissions.photos.offTitle"), i18next.t("permissions.photos.blockedMessage"));
}

/**
 * Camera permission with a way out of the blocked state.
 *
 * `ask()` shows the system popup when the phone still allows it. When the
 * camera was already blocked, it explains and offers Settings instead, since
 * asking again would silently do nothing. It resolves to whether the camera
 * is now allowed.
 */
export function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  useOnForeground(() => {
    void getPermission();
  });

  const access = phoneAccessOf(permission);

  const ask = useCallback(async (): Promise<boolean> => {
    if (permission?.granted) {
      return true;
    }
    if (permission && !permission.canAskAgain) {
      promptCameraBlocked();
      return false;
    }
    const next = await requestPermission();
    return next.granted;
  }, [permission, requestPermission]);

  return { access, permission, granted: access === "granted", ask };
}
