import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Keyboard, Platform, type KeyboardEvent, type View } from "react-native";

/**
 * The iOS keyboard's own curve, as near as a cubic Bézier gets to it: off the
 * mark fast, then a long gentle settle.
 *
 * ── Why the composer trailed the keyboard ───────────────────────────────────
 *
 * This used to configure a LayoutAnimation of type "keyboard" with the event's
 * duration, which is what KeyboardAvoidingView does and what reads as exact on
 * the old architecture: UIKit animates the layout change on the keyboard's
 * private curve. The New Architecture's LayoutAnimation has no such curve. It
 * implements linear, the eases and spring, and anything else — "keyboard"
 * included — falls through to LINEAR (calculateAnimationProgress, in React
 * Native's renderer/animations). A linear move starts slowly while the keyboard
 * leaps away, so the composer visibly trailed it on the way up and on the way
 * down, though both took the same quarter of a second.
 *
 * It also waited on React: the padding was state, so every keyboard event
 * re-rendered the whole chat screen before the move could start.
 *
 * Now the padding is an Animated value driven on this curve and the event's
 * duration, started inside the keyboard event itself, with no render between
 * the keyboard moving and the composer moving.
 *
 * Exact coupling, frame for frame, including an interactive swipe-down that
 * drags the keyboard under the finger, needs the keyboard's frames from native
 * code. That is react-native-keyboard-controller, on the 2.5 branch.
 */
const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);

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
 *   <Animated.View ref={ref} onLayout={onLayout} style={{ flex: 1, paddingBottom: lift }}>
 *     <FlatList inverted ... />
 *     <Composer />
 *   </Animated.View>
 *
 * With an inverted list above the composer, that is the whole Telegram
 * behaviour: the content stays anchored to the bottom of the shrinking box, so
 * the newest message rides up with the composer and scrolling still works.
 */
export function useKeyboardLift() {
  // The keyboard's height, read by the animation without being state: setting
  // it must not re-render the screen. See KEYBOARD_EASING.
  const heightRef = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const lift = useRef(new Animated.Value(0)).current;
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
  const bottomGapRef = useRef(0);
  const ref = useRef<View>(null);

  /** Moves the padding to where the keyboard is going, over `duration`. */
  const follow = useCallback(
    (duration: number) => {
      // Never negative: a keyboard shorter than the inset the view already has
      // needs no lift at all, and a negative padding would pull the composer
      // off the bottom of the screen.
      const target = Math.max(0, heightRef.current - bottomGapRef.current);
      lift.stopAnimation();
      if (duration <= 0) {
        lift.setValue(target);
        return;
      }
      // Not the native driver: padding is layout, which only the JS driver can
      // animate. It does so without React, by writing the prop directly.
      Animated.timing(lift, { toValue: target, duration, easing: KEYBOARD_EASING, useNativeDriver: false }).start();
    },
    [lift],
  );

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (!height) {
        return;
      }
      const gap = Math.max(0, Dimensions.get("window").height - (y + height));
      if (gap !== bottomGapRef.current) {
        bottomGapRef.current = gap;
        // A measurement, not a keyboard move: corrected in place.
        if (Platform.OS === "ios" && heightRef.current > 0) {
          follow(0);
        }
      }
    });
  }, [follow]);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }
    // "Will" rather than "Did": the padding changes in the same frame the
    // keyboard starts moving, so the composer travels with it instead of
    // jumping once it has arrived.
    // Only when the height really changes: show and change-frame both fire for
    // one keyboard, and a second animation to the same place would restart
    // the curve from wherever the first had got to.
    const apply = (next: number, event?: KeyboardEvent) => {
      if (next === heightRef.current) {
        return;
      }
      heightRef.current = next;
      follow(event?.duration ?? 0);
      setKeyboardVisible(next > 0);
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
  }, [follow]);

  // `lift` is an Animated value: give it to an Animated.View's paddingBottom.
  // It stays 0 on Android, where the window itself resizes (see above).
  return { ref, onLayout, lift, keyboardVisible };
}
