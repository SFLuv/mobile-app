import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";

export type Segment<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  segments: Array<Segment<T>>;
  value: T;
  onChange: (next: T) => void;
  hapticsEnabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Segmented control with an indicator that slides between options rather than
 * the active fill jumping from one to the next.
 *
 * Positions come from each segment's own layout instead of dividing the row
 * width: Yoga rounds children to whole pixels, and computed positions drift
 * against that — the error is most visible on the last segment.
 */
export function SegmentedTabs<T extends string>({
  segments,
  value,
  onChange,
  hapticsEnabled,
  style,
}: Props<T>) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [slots, setSlots] = useState<Array<{ x: number; width: number }>>([]);

  const measureSlot = useCallback((index: number, x: number, width: number) => {
    setSlots((current) => {
      const existing = current[index];
      if (existing && Math.abs(existing.x - x) < 0.5 && Math.abs(existing.width - width) < 0.5) {
        return current;
      }
      const next = current.slice();
      next[index] = { x, width };
      return next;
    });
  }, []);

  const activeIndex = Math.max(
    0,
    segments.findIndex((segment) => segment.value === value),
  );
  const measured = slots.length === segments.length && slots.every(Boolean);
  const activeSlot = measured ? slots[activeIndex] : undefined;

  const translateX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const placedRef = useRef(false);

  useEffect(() => {
    if (!activeSlot) {
      return;
    }
    // First placement lands without a slide; there is nothing to animate from.
    if (!placedRef.current) {
      placedRef.current = true;
      translateX.setValue(activeSlot.x);
      indicatorWidth.setValue(activeSlot.width);
      return;
    }
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: activeSlot.x,
        useNativeDriver: false,
        friction: 12,
        tension: 110,
      }),
      Animated.spring(indicatorWidth, {
        toValue: activeSlot.width,
        useNativeDriver: false,
        friction: 12,
        tension: 110,
      }),
    ]).start();
  }, [activeSlot, indicatorWidth, translateX]);

  return (
    <View style={[styles.wrap, style]}>
      {measured ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { width: indicatorWidth, transform: [{ translateX }] }]}
        />
      ) : null}
      {segments.map((segment, index) => {
        const active = segment.value === value;
        const onSlotLayout = (event: LayoutChangeEvent) =>
          measureSlot(index, event.nativeEvent.layout.x, event.nativeEvent.layout.width);
        return (
          <Pressable
            key={segment.value}
            onLayout={onSlotLayout}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) {
                return;
              }
              triggerClickHaptic(hapticsEnabled === true);
              onChange(segment.value);
            }}
          >
            <Text
              numberOfLines={1}
              style={[styles.segmentText, active ? styles.segmentTextActive : undefined]}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    wrap: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    indicator: {
      position: "absolute",
      top: 6,
      bottom: 6,
      left: 0,
      borderRadius: radii.md,
      backgroundColor: palette.primary,
    },
    segment: {
      flex: 1,
      minWidth: 0,
      flexShrink: 1,
      borderRadius: radii.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },
    segmentTextActive: {
      color: palette.white,
    },
  });
}
