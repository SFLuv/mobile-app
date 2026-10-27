import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, PanResponder, StyleSheet, ViewStyle } from "react-native";

/**
 * Swipe right to go back.
 *
 * Built on PanResponder, which ships with React Native, rather than on
 * react-native-gesture-handler — not from preference but because this app has
 * neither gesture-handler nor reanimated installed, and adding a native module
 * means a new binary. The 2.1 build is waiting on store approval and
 * expo-updates now carries JavaScript fixes over the air, so a change that can
 * ship OTA is worth more here than a slightly smoother one that cannot.
 *
 * ── Not stealing the list's gestures ─────────────────────────────────────────
 *
 * These screens are vertical lists, so the responder only claims a touch once
 * the movement is clearly horizontal and clearly rightward: past a few pixels,
 * and with horizontal travel at least twice the vertical. A thumb heading down
 * the list never qualifies, which is why the check is on the ratio rather than
 * on distance alone.
 *
 * The content follows the finger so the gesture says what it will do before it
 * commits, and springs back if the swipe is abandoned — a screen that moves and
 * then stays put is how somebody learns the gesture exists without being told.
 *
 * A committed swipe finishes the slide and only then tells the parent, which is
 * what keeps the dismissal from flickering. See onPanResponderRelease.
 */
/**
 * Lets a child dismiss the screen with the same animation the gesture uses.
 *
 * A back BUTTON that snaps away while the swipe glides is the same screen
 * leaving two different ways, and the difference is noticeable. Exposing the
 * animated close means every exit looks like the gesture.
 */
export type SwipeBackHandle = {
  close: () => void;
};

export const SwipeBack = forwardRef<
  SwipeBackHandle,
  {
    onBack: () => void;
    children: React.ReactNode;
    style?: ViewStyle;
    /** How far, or how fast, before the swipe counts. */
    threshold?: number;
    velocityThreshold?: number;
    enabled?: boolean;
    /**
     * Slide in from the right on mount.
     *
     * On by default: these screens are pushed onto something, and arriving
     * instantly while leaving with a slide is lopsided. Off for anything that
     * is already inside its own transition.
     */
    animateIn?: boolean;
  }
>(function SwipeBack(
  { onBack, children, style, threshold = 70, velocityThreshold = 0.35, enabled = true, animateIn = true },
  ref,
) {
  const screenWidth = Dimensions.get("window").width;
  const translateX = useRef(new Animated.Value(animateIn ? screenWidth : 0)).current;
  // Guards against a second dismissal while the first is still animating —
  // a fast double-tap on the back button would otherwise call onBack twice and
  // pop two screens.
  const dismissing = useRef(false);
  // Read by the responder callbacks, which are created once and must not close
  // over a stale prop.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // The entrance.
  useEffect(() => {
    if (!animateIn) {
      return;
    }
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      friction: 12,
      tension: 90,
    }).start();
  }, [animateIn, translateX]);

  const animateOut = useMemo(
    () => () => {
      if (dismissing.current) {
        return;
      }
      dismissing.current = true;
      Animated.timing(translateX, {
        toValue: screenWidth,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        onBackRef.current();
        // For a future mount: the next time this screen appears it should start
        // from its entrance position, not mid-exit.
        translateX.setValue(animateIn ? screenWidth : 0);
        dismissing.current = false;
      });
    },
    [animateIn, screenWidth, translateX],
  );

  useImperativeHandle(ref, () => ({ close: animateOut }), [animateOut]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (!enabledRef.current) return false;
          return gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2;
        },
        onPanResponderMove: (_event, gesture) => {
          // Rightward only. A leftward drag after claiming would otherwise pull
          // the screen off its own left edge.
          translateX.setValue(Math.max(0, gesture.dx));
        },
        onPanResponderRelease: (_event, gesture) => {
          const committed = gesture.dx > threshold || gesture.vx > velocityThreshold;
          if (committed) {
            // ── Why this animates out instead of snapping back ──────────────
            //
            // It used to call onBack() and then `translateX.setValue(0)`
            // immediately, on the reasoning that the screen behind replaces
            // this one anyway. It does not replace it in the same frame: the
            // parent's state change takes a render, so the sequence a person
            // actually saw was slide-right, SNAP back to centre showing the
            // screen they had just dismissed, and only then the new one. That
            // is the flicker — the swipe looked like it had failed and then
            // changed its mind.
            //
            // Finishing the slide and calling back on completion puts the
            // state change after the motion, so there is nothing to snap back
            // to. The reset happens afterwards, for a future mount, which is
            // the concern the original comment was really about.
            animateOut();
            return;
          }
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 9,
            tension: 110,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 9, tension: 110 }).start();
        },
      }),
    [animateOut, threshold, velocityThreshold, translateX],
  );

  return (
    <Animated.View style={[styles.fill, style, { transform: [{ translateX }] }]} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
