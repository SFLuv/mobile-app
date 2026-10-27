import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getShadows, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";

/**
 * Notifications while the app is open, drawn over the top bar.
 *
 * ── Why these are not system notifications ──────────────────────────────────
 *
 * A push arriving while somebody is using the app is drawn by the OS over
 * whatever they are doing — including over the very chat the message belongs
 * to, where they can already see it. It also goes through Apple or Google, so it
 * lands a second or two late, and it leaves a row in the tray that has to be
 * cleared separately.
 *
 * So the backend suppresses the push for any device holding a live socket, and
 * sends the event down the socket instead. This is what draws it: in-app,
 * instantly, dismissible, and tappable to the same place the push would have
 * gone.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * Instagram-style: a rounded card that slides down over the top bar, sits for a
 * few seconds, and leaves. It covers the bar rather than pushing the screen
 * down, because displacing the layout would move whatever the person was
 * reading or about to tap.
 */

export type BannerNotification = {
  /** Distinguishes one banner from the next; also the dedupe key. */
  id: string;
  title: string;
  body: string;
  /** Left-hand glyph. Defaults to a chat bubble. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Run when the banner is tapped. The banner closes either way. */
  onPress?: () => void;
};

/** How long a banner stays before leaving on its own. */
const VISIBLE_MS = 4200;
const ENTER_MS = 260;
const EXIT_MS = 200;

export function InAppBanner({
  notification,
  onDismiss,
  hapticsEnabled,
}: {
  /** The banner to show, or null for none. */
  notification: BannerNotification | null;
  onDismiss: (id: string) => void;
  hapticsEnabled: boolean;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = React.useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const slide = useRef(new Animated.Value(0)).current;
  // Kept in state so the card stays mounted through its exit animation: reading
  // `notification` directly would unmount it the instant the parent cleared it,
  // and the slide-out would never be seen.
  const [visible, setVisible] = useState<BannerNotification | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(
    (id: string) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      Animated.timing(slide, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setVisible(null);
        onDismiss(id);
      });
    },
    [onDismiss, slide],
  );

  useEffect(() => {
    if (!notification) {
      return;
    }
    // A second banner arriving while one is up replaces it rather than queueing.
    // A queue would mean somebody who gets five messages at once watches
    // twenty-one seconds of banners, and the last one is the only one still
    // worth reading by then.
    setVisible(notification);
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => close(notification.id), VISIBLE_MS);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [close, notification, slide]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-96, 0] }),
            },
          ],
        },
      ]}
      // Only the card itself is interactive: the wrapper spans the width so the
      // card can be centred, and a full-width catcher would swallow taps on the
      // bell and the settings button beside it.
      pointerEvents="box-none"
    >
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${visible.title}. ${visible.body}`}
        onPress={() => {
          triggerClickHaptic(hapticsEnabled);
          visible.onPress?.();
          close(visible.id);
        }}
      >
        <View style={styles.iconWrap}>
          <Ionicons name={visible.icon ?? "chatbubble"} size={16} color={palette.primaryStrong} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {visible.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {visible.body}
          </Text>
        </View>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => close(visible.id)}
        >
          <Ionicons name="close" size={16} color={palette.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(palette: ReturnType<typeof useAppTheme>["palette"], shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      // Sits over the top bar rather than above it, so nothing on screen moves.
      top: Platform.OS === "ios" ? spacing.xs : spacing.sm,
      left: spacing.md,
      right: spacing.md,
      zIndex: 90,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      ...shadows.card,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryMuted,
    },
    text: { flex: 1 },
    title: { fontSize: 14, fontWeight: "700", color: palette.text },
    body: { fontSize: 13, color: palette.textMuted, marginTop: 1 },
  });
}
