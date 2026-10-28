import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import * as Clipboard from "expo-clipboard";

/**
 * Copies a value and reports `copied` for a moment afterwards, so a copy
 * button can turn into a checkmark where it was pressed.
 *
 * The button changing is the confirmation, the way it is in Settings and
 * Safari. A toast at the bottom of the screen is a long way from the thumb
 * that pressed the button, and under some screens it was not drawn at all.
 * VoiceOver and TalkBack get the same confirmation spoken.
 */
export function useCopyFeedback(resetMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = useCallback(
    async (value: string, announcement = "Copied") => {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      AccessibilityInfo.announceForAccessibility(announcement);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setCopied(false);
      }, resetMs);
    },
    [resetMs],
  );

  return { copied, copy };
}
