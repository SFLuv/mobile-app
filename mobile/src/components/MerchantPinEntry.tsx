import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Palette, radii, spacing, useAppTheme } from "../theme";

/**
 * The merchant PIN pad, in one place because a till now asks for the PIN in
 * three situations — setting a device up, moving it to another counter, and
 * leaving merchant mode on the accounts that can still do that. Whoever is at
 * the counter should meet the same keypad every time.
 */

export function MerchantPinDisplay({
  value,
  visible,
  onToggleVisible,
  placeholder = "Enter PIN",
}: {
  value: string;
  visible: boolean;
  onToggleVisible: () => void;
  placeholder?: string;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const empty = value.length === 0;
  return (
    <View style={styles.pinDisplay}>
      <Text style={[styles.pinDisplayText, empty ? styles.pinPlaceholder : undefined]}>
        {empty ? placeholder : visible ? value : "•".repeat(value.length)}
      </Text>
      <Pressable style={styles.pinEye} onPress={onToggleVisible}>
        <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={palette.primaryStrong} />
      </Pressable>
    </View>
  );
}

export function MerchantPinKeypad({
  onDigit,
  onBackspace,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["blank", "0", "backspace"],
  ];
  return (
    <View style={styles.keypad}>
      {rows.map((row, rowIndex) => (
        <View key={`merchant-pin-row-${rowIndex}`} style={styles.keypadRow}>
          {row.map((key) =>
            key === "blank" ? (
              <View key={key} style={styles.keypadKey} />
            ) : (
              <Pressable
                key={key}
                style={[styles.keypadKey, key === "backspace" ? styles.keypadAction : undefined]}
                onPress={() => {
                  if (key === "backspace") {
                    onBackspace();
                    return;
                  }
                  onDigit(key);
                }}
              >
                {key === "backspace" ? (
                  <Ionicons name="backspace-outline" size={22} color={palette.primaryStrong} />
                ) : (
                  <Text style={styles.keypadText}>{key}</Text>
                )}
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * A slide, not a button. Everything behind it either redirects the shop's money
 * or ends the shift, and a tablet on a counter gets knocked.
 */
export function MerchantPinSlider({
  disabled,
  loading,
  label,
  loadingLabel = "Checking",
  onComplete,
}: {
  disabled: boolean;
  loading: boolean;
  label: string;
  loadingLabel?: string;
  onComplete: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbWidth = 54;
  const swipeDistance = Math.max(trackWidth - thumbWidth - 8, 0);

  useEffect(() => {
    if (!loading) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 0,
      }).start();
    }
  }, [loading, translateX]);

  const resetSwipe = React.useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 0,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !loading && swipeDistance > 0,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !disabled && !loading && swipeDistance > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(Math.max(0, Math.min(gesture.dx, swipeDistance)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx >= swipeDistance * 0.72) {
            Animated.timing(translateX, {
              toValue: swipeDistance,
              duration: 120,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished) onComplete();
            });
            return;
          }
          resetSwipe();
        },
        onPanResponderTerminate: resetSwipe,
      }),
    [disabled, loading, onComplete, resetSwipe, swipeDistance, translateX],
  );

  return (
    <View
      style={[styles.swipeTrack, disabled ? styles.swipeTrackDisabled : undefined]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      <Text style={[styles.swipeText, disabled ? styles.swipeTextDisabled : undefined]}>
        {loading ? loadingLabel : label}
      </Text>
      <Animated.View
        style={[styles.swipeThumb, disabled ? styles.swipeThumbDisabled : undefined, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Ionicons name={loading ? "hourglass-outline" : "arrow-forward"} size={18} color={palette.primaryStrong} />
      </Animated.View>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    pinDisplay: {
      minHeight: 54,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.surface,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: spacing.md,
    },
    pinDisplayText: {
      flex: 1,
      color: palette.text,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 4,
      textAlign: "center",
    },
    pinPlaceholder: {
      color: palette.textMuted,
      fontSize: 15,
      letterSpacing: 0,
      textAlign: "left",
    },
    pinEye: {
      width: 48,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    keypad: {
      gap: spacing.xs,
    },
    keypadRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    keypadKey: {
      flex: 1,
      minHeight: 48,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    keypadAction: {
      backgroundColor: palette.primarySoft,
    },
    keypadText: {
      color: palette.text,
      fontSize: 22,
      fontWeight: "800",
    },
    swipeTrack: {
      minHeight: 58,
      borderRadius: radii.pill,
      backgroundColor: palette.primaryStrong,
      justifyContent: "center",
      paddingHorizontal: 8,
      position: "relative",
      overflow: "hidden",
    },
    swipeTrackDisabled: {
      backgroundColor: palette.borderStrong,
    },
    swipeText: {
      color: palette.white,
      textAlign: "center",
      fontSize: 15,
      fontWeight: "800",
      paddingHorizontal: 72,
    },
    swipeTextDisabled: {
      color: palette.surface,
    },
    swipeThumb: {
      position: "absolute",
      left: 4,
      top: 4,
      bottom: 4,
      width: 54,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    swipeThumbDisabled: {
      backgroundColor: palette.surfaceStrong,
    },
  });
}
