import React, { useMemo, useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Palette, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";

/**
 * Swipe a row left to reveal actions behind it.
 *
 * ── Built on PanResponder, like SwipeBack ───────────────────────────────────
 *
 * Not from preference — react-native-gesture-handler's Swipeable is the better
 * component — but because this app has neither gesture-handler nor reanimated,
 * and adding a native module means a new binary. The same reasoning as
 * SwipeBack, and the same shape of implementation, so the two behave alike.
 *
 * ── Not stealing the list's scroll ──────────────────────────────────────────
 *
 * The responder only claims a touch once movement is clearly horizontal and
 * clearly leftward: past a few pixels, with horizontal travel at least twice
 * the vertical. A thumb heading down the inbox never qualifies.
 *
 * Released past half the action tray's width it opens and stays open; short of
 * that it springs shut, so an abandoned swipe leaves nothing behind.
 */

export type SwipeAction = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** "danger" is destructive and gets the red treatment. */
  tone?: "danger" | "neutral";
  onPress: () => void;
};

const ACTION_WIDTH = 76;

export function SwipeableRow({
  actions,
  children,
  hapticsEnabled,
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  hapticsEnabled: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const trayWidth = actions.length * ACTION_WIDTH;

  const settle = (toOpen: boolean) => {
    openRef.current = toOpen;
    Animated.spring(translateX, {
      toValue: toOpen ? -trayWidth : 0,
      useNativeDriver: true,
      friction: 11,
      tension: 110,
    }).start();
  };

  const close = () => settle(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (actions.length === 0) {
            return false;
          }
          // Leftward to open, rightward only when already open — so a closed
          // row never claims a rightward drag and the screen's own back-swipe
          // still works over the top of it.
          const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2;
          return horizontal && (gesture.dx < -8 || (openRef.current && gesture.dx > 8));
        },
        onPanResponderMove: (_event, gesture) => {
          const base = openRef.current ? -trayWidth : 0;
          // Clamped to the tray: dragging further than there is to reveal just
          // feels loose, and past the row's own width it would look detached.
          translateX.setValue(Math.max(-trayWidth, Math.min(0, base + gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          const base = openRef.current ? -trayWidth : 0;
          const position = base + gesture.dx;
          settle(position < -trayWidth / 2);
        },
        onPanResponderTerminate: () => settle(openRef.current),
      }),
    // trayWidth is derived from actions.length, so the two change together.
    [actions.length, trayWidth, translateX],
  );

  return (
    <View style={styles.wrap}>
      {/* The tray, behind the row. Laid out at full height so a tall row's
          buttons fill it rather than floating in the middle. */}
      <View style={styles.tray} pointerEvents={actions.length ? "auto" : "none"}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            style={[styles.action, action.tone === "danger" ? styles.actionDanger : styles.actionNeutral]}
            onPress={() => {
              triggerClickHaptic(hapticsEnabled);
              // Closed first so the row is not left hanging open behind
              // whatever the action opens.
              close();
              action.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Ionicons name={action.icon} size={20} color={palette.white} />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {/* Tapping an open row closes it rather than opening the conversation,
            which is what every list with this gesture does — the first tap
            after a swipe is almost always "put that back". */}
        {openRef.current ? <Pressable style={StyleSheet.absoluteFill} onPress={close} /> : null}
        {children}
      </Animated.View>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    wrap: { position: "relative", overflow: "hidden" },
    tray: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    action: {
      width: ACTION_WIDTH,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    actionDanger: { backgroundColor: palette.danger },
    actionNeutral: { backgroundColor: palette.navy },
    actionLabel: { color: palette.white, fontSize: 11, fontWeight: "700" },
  });
}

export { ACTION_WIDTH };
