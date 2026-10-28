import React, { useMemo, useRef, useState } from "react";
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
  const { palette, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  /**
   * The colour on top of a danger action.
   *
   * `palette.danger` is a DARK red in light mode (#b00020) and a LIGHT one in
   * dark mode (#ff8a80), so a fixed white foreground is correct in one theme
   * and nearly invisible in the other. The neutral action had it worse:
   * `palette.navy` inverts outright — #0b303b light, #d8e6ea dark — so white
   * icons disappeared completely. The neutral action now uses surfaceStrong
   * with the ordinary text colour, which tracks the theme on its own, and
   * danger picks a foreground that contrasts with whichever red it got.
   */
  const dangerForeground = isDark ? palette.background : palette.white;
  const translateX = useRef(new Animated.Value(0)).current;
  /**
   * Open-ness twice over, deliberately.
   *
   * The ref is what the PanResponder reads: its callbacks are created once and
   * would close over a stale value of state. The state is what the render
   * reads, because changing a ref does not re-render — which is why the
   * tap-to-close overlay never appeared.
   */
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const trayWidth = actions.length * ACTION_WIDTH;

  const settle = (toOpen: boolean) => {
    openRef.current = toOpen;
    setOpen(toOpen);
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
            <Ionicons
              name={action.icon}
              size={20}
              color={action.tone === "danger" ? dangerForeground : palette.text}
            />
            <Text
              style={[
                styles.actionLabel,
                { color: action.tone === "danger" ? dangerForeground : palette.text },
              ]}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* OPAQUE, and that is the whole fix for two reported faults.
          The tray sits behind this view, so anything translucent lets it
          through — which is why the mute and delete buttons were visible on
          every row without swiping, and why the row's timestamp appeared to
          overlap the mute button. The row's own styles set no background (it
          inherits the screen's), so the background has to be set here. */}
      <Animated.View
        style={[styles.content, { transform: [{ translateX }] }]}
        {...responder.panHandlers}
      >
        {/* Tapping an open row closes it rather than opening the conversation,
            which is what every list with this gesture does — the first tap
            after a swipe is almost always "put that back".
            Driven by state, not the ref: a ref change does not re-render, so
            this overlay never appeared when the row opened. */}
        {open ? <Pressable style={StyleSheet.absoluteFill} onPress={close} /> : null}
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
    // borderStrong, not navy and not surfaceStrong.
    //
    // navy inverts between themes (#0b303b light, #d8e6ea dark), so a fixed
    // foreground on it is unreadable in one of them. surfaceStrong fixes that
    // but is within a shade of the row's own background in light mode, so the
    // button would read as a gap rather than a control. borderStrong is a
    // mid-tone in both themes — #d3c5bd and #3f6472 — which keeps it distinct
    // from the row AND readable under palette.text.
    actionNeutral: { backgroundColor: palette.borderStrong },
    // The colour is applied inline, per action, because it depends on the tone.
    actionLabel: { fontSize: 11, fontWeight: "700" },
    // The row's own surface, so the tray behind it stays hidden until swiped.
    content: { backgroundColor: palette.background },
  });
}

export { ACTION_WIDTH };
