import { useCallback, useRef, useState } from "react";
import { Dimensions, Platform, type View } from "react-native";

/**
 * The bottom safe-area inset on Face ID iPhones, which the dock's layout is
 * built around.
 */
const HOME_INDICATOR_INSET = 34;

/**
 * How much extra room a screen's bottom-anchored content needs to clear the
 * dock, measured rather than assumed.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * Every floating button and every list's bottom padding was sized for a Face ID
 * phone, where the screen already stops 34pt above the display edge. The dock is
 * pinned to the display rather than to the screen above it, so on a Home-button
 * phone — no inset — the dock reaches 34pt further into the screen, and anything
 * positioned against the screen's bottom lands underneath it. The add-contact
 * button sat on the dock; the last card in the list sat under the button.
 *
 * ── Why it is measured rather than read off an inset ────────────────────────
 *
 * An inset — whether from react-native-safe-area-context, which this app does
 * not have, or from the platform — describes the WINDOW. What matters here is
 * the gap between the bottom of THIS screen and the bottom of the display,
 * which is a different number: the shell puts the screen inside a SafeAreaView
 * and above the dock, so a screen's own bottom already sits somewhere in the
 * middle of the window. Measuring where the view actually ends is the only
 * thing that answers the question for every combination of device, orientation
 * and chrome, including ones nobody has tested on yet.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   const { ref, onLayout, lift } = useDockLift();
 *   <View ref={ref} onLayout={onLayout}>
 *     <Pressable style={[styles.fab, { bottom: styles.fab.bottom + lift }]} />
 *   </View>
 *
 * `lift` is 0 on a phone whose screen already stops above the dock, and on
 * Android, where the dock lays itself out against its own bottom inset.
 *
 * Originally written inline in ContactsScreen. Extracted when the Chats tab grew
 * a floating button of its own: two copies of a measurement this fiddly is two
 * places for it to be fixed on one screen and not the other.
 */
export function useDockLift() {
  // Starts at the Face ID inset, which makes the first frame correct on the
  // phones that need no lift and one frame late on the ones that do. The other
  // way round — starting at 0 — would briefly lift the button on every phone,
  // and a control that jumps on appear is more noticeable than one that settles.
  const [screenBottomGap, setScreenBottomGap] = useState(HOME_INDICATOR_INSET);
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (!height) {
        return;
      }
      setScreenBottomGap(Math.max(0, Dimensions.get("window").height - (y + height)));
    });
  }, []);

  const lift = Platform.OS === "ios" ? Math.max(0, HOME_INDICATOR_INSET - screenBottomGap) : 0;

  return { ref, onLayout, lift };
}

export { HOME_INDICATOR_INSET };
