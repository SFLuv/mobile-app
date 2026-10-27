import React, { useMemo, useRef } from "react";
import { Animated, PanResponder, StyleSheet, ViewStyle } from "react-native";

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
 */
export function SwipeBack({
  onBack,
  children,
  style,
  /** How far, or how fast, before the swipe counts. */
  threshold = 70,
  velocityThreshold = 0.35,
  enabled = true,
}: {
  onBack: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
  threshold?: number;
  velocityThreshold?: number;
  enabled?: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  // Read by the responder callbacks, which are created once and must not close
  // over a stale prop.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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
            onBackRef.current();
            // Reset rather than animate out: the screen behind replaces this
            // one immediately, and animating a view that is about to unmount
            // leaves it mid-slide if it is remounted.
            translateX.setValue(0);
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
    [threshold, velocityThreshold, translateX],
  );

  return (
    <Animated.View style={[styles.fill, style, { transform: [{ translateX }] }]} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
