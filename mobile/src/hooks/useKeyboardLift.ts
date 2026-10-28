import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from "react-native";

/**
 * Animates the next layout change on the keyboard's own curve and duration.
 *
 * Setting the padding in the same frame the keyboard starts moving was half the
 * fix: the padding still changed in ONE step, so the composer jumped to its end
 * position while the keyboard was still sliding up to meet it. This is how
 * React Native's KeyboardAvoidingView makes its content travel with the
 * keyboard — iOS's keyboard curve, the event's duration, applied to the layout
 * update the padding change causes.
 */
function followKeyboard(event?: KeyboardEvent) {
  const duration = event?.duration ?? 0;
  if (duration <= 0) {
    return;
  }
  LayoutAnimation.configureNext({
    duration,
    update: { duration, type: LayoutAnimation.Types.keyboard },
  });
}

/**
 * How much bottom padding a screen needs so its own bottom edge sits on top of
 * the keyboard.
 *
 * ── Why not KeyboardAvoidingView ────────────────────────────────────────────
 *
 * The chat screen used `<KeyboardAvoidingView behavior="padding">` with no
 * offset, and the composer still sat in the wrong place. KAV with "padding"
 * adds the keyboard's height — which the OS reports from the bottom of the
 * WINDOW — to the bottom of the KAV. Those are only the same point when the KAV
 * reaches the window's bottom edge, and here it does not: the shell wraps every
 * screen in a SafeAreaView, so on a Face ID phone the chat's bottom edge is
 * already 34pt up. The padding overshoots by exactly that much and the composer
 * floats above the keyboard with a band of background under it.
 *
 * Giving KAV a `keyboardVerticalOffset` would fix it for one device and break
 * it on the next, because the number is the bottom inset and that varies. So
 * the gap is measured instead — the same approach, and the same reasoning, as
 * `useDockLift`, which exists because bottom-anchored content kept landing in
 * the wrong place for the same family of reasons.
 *
 * ── iOS only ────────────────────────────────────────────────────────────────
 *
 * Android's default `softwareKeyboardLayoutMode` is "resize": the window itself
 * shrinks when the keyboard opens, so the layout has already accounted for it
 * and adding padding here would lift the composer twice as far as it should go.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   const { ref, onLayout, lift } = useKeyboardLift();
 *   <View ref={ref} onLayout={onLayout} style={{ flex: 1, paddingBottom: lift }}>
 *     <FlatList inverted ... />
 *     <Composer />
 *   </View>
 *
 * With an inverted list above the composer, that is the whole Telegram
 * behaviour: the content stays anchored to the bottom of the shrinking box, so
 * the newest message rides up with the composer and scrolling still works.
 */
export function useKeyboardLift() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The height last applied, so a repeat event with the same height is ignored.
  const heightRef = useRef(0);
  /**
   * How far this view's bottom edge sits above the bottom of the display.
   *
   * Starts at 0 rather than at a guessed inset: 0 means "lift by the full
   * keyboard height", which is correct on a phone with no bottom inset and only
   * ever an overshoot of one frame on one that has one. Guessing 34 the other
   * way would under-lift on every Home-button phone until the measurement
   * landed, and under-lifting hides the text field behind the keyboard — the
   * exact failure being fixed.
   */
  const [bottomGap, setBottomGap] = useState(0);
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (!height) {
        return;
      }
      setBottomGap(Math.max(0, Dimensions.get("window").height - (y + height)));
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }
    // "Will" rather than "Did": the padding changes in the same frame the
    // keyboard starts moving, so the composer travels with it instead of
    // jumping once it has arrived.
    // Only when the height really changes. Show and change-frame both fire for
    // one keyboard; a layout animation configured for a change that commits
    // nothing stays pending and animates whatever lays out next — a message
    // arriving, say — which is LayoutAnimation's best-known trap.
    const apply = (next: number, event?: KeyboardEvent) => {
      if (next === heightRef.current) {
        return;
      }
      heightRef.current = next;
      followKeyboard(event);
      setKeyboardHeight(next);
    };
    const show = Keyboard.addListener("keyboardWillShow", (event: KeyboardEvent) => {
      apply(event.endCoordinates.height, event);
    });
    const hide = Keyboard.addListener("keyboardWillHide", (event: KeyboardEvent) => apply(0, event));
    // A hardware keyboard, or a language switch, changes the height without a
    // show/hide pair.
    const change = Keyboard.addListener("keyboardWillChangeFrame", (event: KeyboardEvent) => {
      const screenHeight = Dimensions.get("window").height;
      // A frame that starts at or below the bottom of the screen is the
      // keyboard leaving, not a resize.
      apply(event.endCoordinates.screenY >= screenHeight ? 0 : event.endCoordinates.height, event);
    });
    return () => {
      show.remove();
      hide.remove();
      change.remove();
    };
  }, []);

  // Never negative: a keyboard shorter than the inset the view already has
  // needs no lift at all, and a negative padding would pull the composer off
  // the bottom of the screen.
  const lift = Platform.OS === "ios" ? Math.max(0, keyboardHeight - bottomGap) : 0;

  return { ref, onLayout, lift, keyboardVisible: keyboardHeight > 0 };
}
