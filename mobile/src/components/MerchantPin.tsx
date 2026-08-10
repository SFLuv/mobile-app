import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { Palette, useAppTheme } from "../theme";
import {
  ICON_TEXT_COLOR,
  ICON_TEXT_NUDGE_EM,
  PIN_EDGE_COLOR,
  PIN_GLYPH_RADIUS,
  PIN_RING_RADIUS,
  PIN_HEAD_CENTRE,
  PIN_PATH,
  PIN_VIEWBOX_HEIGHT,
  PIN_VIEWBOX_WIDTH,
  PIN_WIDTH,
  ICON_FACE,
  merchantInitials,
  pinColor,
} from "../utils/merchantIcon";
import { OpenState } from "../utils/openingHours";

type MerchantIconProps = {
  name: string;
  iconUrl?: string;
  size: number;
  /** Rounds the tile; the map pin passes half the size for a circle. */
  radius?: number;
  /** Open state, which decides the face colour behind a generated mark. */
  state?: OpenState;
  onReady?: () => void;
};

/**
 * A merchant's square mark: their upload when they have one, otherwise a
 * generated initials tile.
 *
 * The generated tile is not a placeholder awaiting a real logo — most merchants
 * will never upload one, and a map of identical grey dots is worse than a map
 * of distinct initials on a clean white face.
 */
export function MerchantIcon({ name, iconUrl, size, radius, state = "open", onReady }: MerchantIconProps) {
  const trimmed = (iconUrl ?? "").trim();
  const corner = radius ?? Math.round(size * 0.28);

  if (trimmed !== "") {
    return (
      <Image
        source={{ uri: trimmed }}
        style={{ width: size, height: size, borderRadius: corner, opacity: state === "closed" ? 0.9 : 1 }}
        resizeMode="cover"
        onLoadEnd={onReady}
      />
    );
  }

  const initials = merchantInitials(name);
  const fontSize = Math.max(8, Math.round(size * (initials.length > 1 ? 0.4 : 0.5)));

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: corner,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ICON_FACE,
      }}
    >
      <Text
        style={{
          color: ICON_TEXT_COLOR,
          fontWeight: "800",
          fontSize,
          // See ICON_TEXT_NUDGE_EM: capitals centre high in their own line box.
          marginTop: fontSize * ICON_TEXT_NUDGE_EM,
        }}
      >
        {initials}
      </Text>
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
 * The map pin: a teardrop in the merchant's state colour with their mark in the
 * head. Brand red while open, muted slate while shut, so the map answers "can I
 * go there now?" before anything is tapped.
 *
 * Geometry comes from utils/merchantIcon so this stays identical to the pin the
 * web app and the marketing site draw.
 */
export function MerchantMapPin({ name, iconUrl, state, size = PIN_WIDTH }: MerchantMapPinProps) {
  const height = Math.round((size * PIN_VIEWBOX_HEIGHT) / PIN_VIEWBOX_WIDTH);
  const unit = size / PIN_VIEWBOX_WIDTH;
  const glyphSize = Math.round(PIN_GLYPH_RADIUS * 2 * unit);

  return (
    <View style={{ width: size, height }}>
      <Svg width={size} height={height} viewBox={`0 0 ${PIN_VIEWBOX_WIDTH} ${PIN_VIEWBOX_HEIGHT}`}>
        <Path d={PIN_PATH} fill={ICON_FACE} stroke={PIN_EDGE_COLOR} strokeWidth={0.6} />
        <Circle
          cx={PIN_HEAD_CENTRE.x}
          cy={PIN_HEAD_CENTRE.y}
          r={PIN_RING_RADIUS}
          fill={pinColor(state)}
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          left: PIN_HEAD_CENTRE.x * unit - glyphSize / 2,
          top: PIN_HEAD_CENTRE.y * unit - glyphSize / 2,
          width: glyphSize,
          height: glyphSize,
          borderRadius: glyphSize / 2,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ICON_FACE,
        }}
      >
        <MerchantIcon name={name} iconUrl={iconUrl} size={glyphSize} radius={glyphSize / 2} state={state} />
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
