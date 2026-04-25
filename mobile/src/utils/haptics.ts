import { Vibration } from "react-native";
import * as Haptics from "expo-haptics";

export type ClickHapticWeight = "selection" | "light" | "medium";

const impactStyles: Record<Exclude<ClickHapticWeight, "selection">, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
};

function fallbackClick(weight: ClickHapticWeight) {
  Vibration.vibrate(weight === "medium" ? 14 : 8);
}

export function triggerClickHaptic(enabled: boolean, weight: ClickHapticWeight = "light") {
  if (!enabled) {
    return;
  }

  const request =
    weight === "selection"
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(impactStyles[weight]);

  void request.catch(() => {
    fallbackClick(weight);
  });
}
