import { useCallback, useEffect, useRef, useState } from "react";
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
 * `lift` is 0 when the screen already stops above the dock.
 *
 * ── Measured from both ends (October 2026) ──────────────────────────────────
 *
 * The first version measured only the screen and assumed where the dock was:
 * 34pt into it on a Home-button phone, nothing on a Face ID one. That was right
 * on an iPhone SE and wrong on PJ's phone, where the new-chat button still sat
 * behind the dock. Now the dock reports where its top really is
 * (`reportDockTop`, from App), and the lift is simply how far this screen
 * reaches below that line. The 34pt guess is only the fallback for the frame
 * before the dock has been measured.
 *
 * Originally written inline in ContactsScreen. Extracted when the Chats tab grew
 * a floating button of its own: two copies of a measurement this fiddly is two
 * places for it to be fixed on one screen and not the other.
 */
/** Where the dock's top edge is, in window coordinates; null when no dock. */
let dockTopY: number | null = null;
const dockTopListeners = new Set<(y: number | null) => void>();

/** Called by the dock whenever it lays out, and with null when it goes away. */
export function reportDockTop(y: number | null): void {
  if (y === dockTopY || (y !== null && dockTopY !== null && Math.abs(y - dockTopY) < 0.5)) {
    return;
  }
  dockTopY = y;
  dockTopListeners.forEach((listener) => listener(y));
}

/** The dock's top edge in window coordinates, kept current; null when none. */
export function useDockTop(): number | null {
  const [dockTop, setDockTop] = useState<number | null>(dockTopY);
  useEffect(() => {
    dockTopListeners.add(setDockTop);
    setDockTop(dockTopY);
    return () => {
      dockTopListeners.delete(setDockTop);
    };
  }, []);
  return dockTop;
}

export function useDockLift() {
  // Starts at the Face ID inset, which makes the first frame correct on the
  // phones that need no lift and one frame late on the ones that do. The other
  // way round — starting at 0 — would briefly lift the button on every phone,
  // and a control that jumps on appear is more noticeable than one that settles.
  const [screenBottom, setScreenBottom] = useState<number | null>(null);
  const dockTop = useDockTop();
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (!height) {
        return;
      }
      setScreenBottom(y + height);
    });
  }, []);

  let lift = 0;
  if (screenBottom !== null && dockTop !== null) {
    lift = Math.max(0, screenBottom - dockTop);
  } else if (Platform.OS === "ios") {
    const gap = screenBottom === null ? HOME_INDICATOR_INSET : Dimensions.get("window").height - screenBottom;
    lift = Math.max(0, HOME_INDICATOR_INSET - gap);
  }

  return { ref, onLayout, lift };
}

export { HOME_INDICATOR_INSET };
