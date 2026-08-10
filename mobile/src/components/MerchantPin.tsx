import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { Palette, useAppTheme } from "../theme";
import { merchantGradient, merchantInitials, pinColor } from "../utils/merchantIcon";
import { OpenState } from "../utils/openingHours";

type MerchantIconProps = {
  name: string;
  iconUrl?: string;
  size: number;
  /** Rounds the tile; the map pin passes half the size for a circle. */
  radius?: number;
  onReady?: () => void;
};

/**
 * A merchant's square mark: their upload when they have one, otherwise a
 * generated initials tile.
 *
 * The generated tile is not a placeholder awaiting a real logo — most merchants
 * will never upload one, and a map of identical grey dots is worse than a map
 * of distinct, on-brand initials.
 */
export function MerchantIcon({ name, iconUrl, size, radius, onReady }: MerchantIconProps) {
  const trimmed = (iconUrl ?? "").trim();
  const corner = radius ?? Math.round(size * 0.28);

  if (trimmed !== "") {
    return (
      <Image
        source={{ uri: trimmed }}
        style={{ width: size, height: size, borderRadius: corner }}
        resizeMode="cover"
        onLoadEnd={onReady}
      />
    );
  }

  const [from, to] = merchantGradient(name);
  const initials = merchantInitials(name);
  const gradientId = `merchant-${from.replace("#", "")}-${to.replace("#", "")}`;

  return (
    <View style={{ width: size, height: size, borderRadius: corner, overflow: "hidden" }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${gradientId})`} />
      </Svg>
      {/* Text is laid over the SVG rather than drawn inside it: RN's own text
          layout centres reliably across platforms, SvgText's baseline handling
          does not. */}
      <View style={[StyleSheet.absoluteFill, styles.initialsWrap]}>
        <Text
          style={{
            color: "#ffffff",
            fontWeight: "800",
            fontSize: Math.max(9, Math.round(size * (initials.length > 1 ? 0.38 : 0.48))),
          }}
        >
          {initials}
        </Text>
      </View>
    </View>
  );
}

type MerchantMapPinProps = {
  name: string;
  iconUrl?: string;
  state: OpenState;
  size?: number;
};

/**
 * The map pin: a teardrop in the merchant's state colour with their mark inset
 * at the top. Brand red while open, muted slate while shut, so the map answers
 * "can I go there now?" before anything is tapped.
 */
export function MerchantMapPin({ name, iconUrl, state, size = 40 }: MerchantMapPinProps) {
  const color = pinColor(state);
  const height = Math.round(size * 1.2);
  const iconSize = Math.round(size * 0.68);

  return (
    <View style={{ width: size, height }}>
      <Svg width={size} height={height} viewBox="0 0 38 46">
        <Path
          d="M19 45.5C19 45.5 3.5 27.6 3.5 17.5a15.5 15.5 0 1 1 31 0C34.5 27.6 19 45.5 19 45.5Z"
          fill={color}
          stroke="#ffffff"
          strokeWidth={2}
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          left: (size - iconSize) / 2,
          top: size * 0.1,
          width: iconSize,
          height: iconSize,
          borderRadius: iconSize / 2,
          overflow: "hidden",
          backgroundColor: "#ffffff",
        }}
      >
        <MerchantIcon name={name} iconUrl={iconUrl} size={iconSize} radius={iconSize / 2} />
      </View>
    </View>
  );
}

/**
 * The open/closed line on a merchant card.
 *
 * The dot pulses only while open. A steady dot beside "Open now" reads as a
 * status light that might be stale; a pulsing one reads as live, which it is —
 * recomputed against the clock every minute.
 */
export function OpenStatusBadge({ state }: { state: OpenState }) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createBadgeStyles(palette), [palette]);
  const pulse = useRef(new Animated.Value(0)).current;
  const open = state === "open";

  useEffect(() => {
    if (!open) {
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [open, pulse]);

  if (state === "unknown") {
    return (
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: palette.textMuted, opacity: 0.4 }]} />
        <Text style={styles.mutedText}>Hours not available</Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.dotWrap}>
        {open ? (
          <Animated.View
            style={[
              styles.dot,
              styles.pulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
              },
            ]}
          />
        ) : null}
        <View style={[styles.dot, { backgroundColor: open ? palette.primary : palette.textMuted }]} />
      </View>
      <Text style={[styles.text, { color: open ? palette.primaryStrong : palette.textMuted }]}>
        {open ? "Open now" : "Closed"}
      </Text>
    </View>
  );
}

/**
 * Whether a marker's contents are still settling.
 *
 * `tracksViewChanges` has to stay true until a custom marker has painted or the
 * pin renders blank on Android, and has to go false afterwards or every marker
 * re-renders on each frame and the map crawls. Remote icons need the extra
 * beat, generated ones do not.
 */
export function useMarkerTracking(hasRemoteIcon: boolean): boolean {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), hasRemoteIcon ? 1500 : 300);
    return () => clearTimeout(timer);
  }, [hasRemoteIcon]);

  return tracking;
}

const styles = StyleSheet.create({
  initialsWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});

function createBadgeStyles(palette: Palette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    dotWrap: {
      width: 8,
      height: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    pulse: {
      position: "absolute",
      backgroundColor: palette.primary,
    },
    text: {
      fontSize: 12,
      fontWeight: "700",
    },
    mutedText: {
      fontSize: 12,
      color: palette.textMuted,
    },
  });
}
