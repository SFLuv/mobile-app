import { useCallback, useEffect, useRef } from "react";
import { Dimensions, type View } from "react-native";
import { useKeyboardController, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

/**
 * How much bottom padding a screen needs so its own bottom edge sits on top of
 * the keyboard — following the keyboard frame for frame.
 *
 * ── Why native frames ───────────────────────────────────────────────────────
 *
 * 2.4 started an Animated timing in the keyboard event, on a Bézier close to
 * the iOS keyboard's curve and for the event's duration. Close, not coupled:
 * it began a frame or two after the keyboard did, it could not follow an
 * interactive swipe-down that drags the keyboard under the finger, and Android
 * sends no event before the keyboard moves at all.
 *
 * react-native-keyboard-controller reads the keyboard's position from native
 * code on every frame, on both platforms, interactive dismissal included, and
 * Reanimated applies it on the UI thread. The composer is wherever the
 * keyboard's top edge is, because it is told where that is each frame rather
 * than predicting it.
 *
 * ── Why the module is switched on only here ─────────────────────────────────
 *
 * On Android, enabling it stops the window resizing for the keyboard: the
 * keyboard draws over the app and whatever must stay visible has to move
 * itself, as this does. Every other screen with a text field relies on the
 * window resizing. So the provider at the root starts disabled, and a screen
 * using this hook switches it on while mounted and off again when it goes.
 *
 * ── Why not KeyboardAvoidingView ────────────────────────────────────────────
 *
 * The chat screen used `<KeyboardAvoidingView behavior="padding">` with no
 * offset, and the composer sat in the wrong place. The keyboard's height is
 * measured from the bottom of the WINDOW; the chat's bottom edge is already
 * above it, because the shell wraps every screen in a SafeAreaView. So the
 * padding overshot by the bottom inset. The gap is measured instead, as
 * `useDockLift` does, and taken off the keyboard's height.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   const { ref, onLayout, liftStyle } = useKeyboardLift();
 *   <Reanimated.View ref={ref} onLayout={onLayout} style={[{ flex: 1 }, liftStyle]}>
 *     <FlatList inverted ... />
 *     <Composer />
 *   </Reanimated.View>
 *
 * With an inverted list above the composer, that is the whole Telegram
 * behaviour: the content stays anchored to the bottom of the shrinking box, so
 * the newest message rides up with the composer and scrolling still works.
 */
export function useKeyboardLift() {
  const { setEnabled } = useKeyboardController();
  useEffect(() => {
    setEnabled(true);
    return () => setEnabled(false);
  }, [setEnabled]);

  // 0 with the keyboard down, minus its height with it up, every frame between.
  const { height } = useReanimatedKeyboardAnimation();
  /**
   * How far this view's bottom edge sits above the bottom of the display.
   * Starts at 0, which over-lifts by at most one frame on a phone with a
   * bottom inset; guessing an inset the other way would hide the text field
   * behind the keyboard on every phone without one.
   */
  const bottomGap = useSharedValue(0);
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, viewHeight) => {
      if (!viewHeight) {
        return;
      }
      bottomGap.value = Math.max(0, Dimensions.get("window").height - (y + viewHeight));
    });
  }, [bottomGap]);

  // Never negative: a keyboard shorter than the inset the view already has
  // needs no lift at all.
  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -height.value - bottomGap.value),
  }));

  return { ref, onLayout, liftStyle };
}
