import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// All dates are handled as calendar days in UTC (matching the "YYYY-MM-DD"
// absence values), so month math never drifts across timezones/DST.
function parseYmd(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return { year, month: month - 1, day };
}

function toYmd(year: number, monthIndex: number, day: number): string {
  const mm = `${monthIndex + 1}`.padStart(2, "0");
  const dd = `${day}`.padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function todayYmd(): string {
  const now = new Date();
  return toYmd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function longLabel(value: string): string {
  const parsed = parseYmd(value);
  if (!parsed) return "Select a date";
  return `${MONTHS[parsed.month]} ${parsed.day}, ${parsed.year}`;
}

export interface DatePickerSheetProps {
  visible: boolean;
  value: string;
  title: string;
  /** Inclusive minimum selectable day, as "YYYY-MM-DD" (optional). */
  minDate?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

// A dependency-free calendar date picker rendered as a bottom-anchored sheet.
// The currently-selected date is hoisted above the calendar grid; tapping the
// dimmed area outside the sheet closes it without changing the value.
export function DatePickerSheet({ visible, value, title, minDate, onSelect, onClose }: DatePickerSheetProps) {
  const { palette, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);

  const initial = useMemo(() => parseYmd(value) || parseYmd(todayYmd())!, [value]);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  // Re-anchor the visible month whenever the sheet reopens or the value changes.
  useEffect(() => {
    if (!visible) return;
    const anchor = parseYmd(value) || parseYmd(todayYmd())!;
    setViewYear(anchor.year);
    setViewMonth(anchor.month);
  }, [visible, value]);

  const min = minDate ? parseYmd(minDate) : null;
  const minValue = min ? toYmd(min.year, min.month, min.day) : null;

  const cells = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const out: Array<number | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) out.push(day);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewYear, viewMonth]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((year) => year - 1);
    } else {
      setViewMonth((month) => month - 1);
    }
  };
  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((year) => year + 1);
    } else {
      setViewMonth((month) => month + 1);
    }
  };

  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* Hoisted selection: the chosen date sits above the calendar. */}
          <Text style={styles.title}>{title}</Text>
          <View style={styles.selectedBadge}>
            <Ionicons name="calendar-outline" size={16} color={palette.primary} />
            <Text style={styles.selectedText}>{longLabel(value)}</Text>
          </View>

          <View style={styles.monthRow}>
            <Pressable style={styles.navButton} onPress={goPrevMonth} hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color={palette.text} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTHS[viewMonth]} {viewYear}
            </Text>
            <Pressable style={styles.navButton} onPress={goNextMonth} hitSlop={8}>
              <Ionicons name="chevron-forward" size={20} color={palette.text} />
            </Pressable>
          </View>

          <View style={styles.weekHeader}>
            {WEEKDAYS.map((weekday, index) => (
              <Text key={`${weekday}-${index}`} style={styles.weekHeaderCell}>
                {weekday}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (day === null) {
                return <View key={`empty-${index}`} style={styles.dayCell} />;
              }
              const cellValue = toYmd(viewYear, viewMonth, day);
              const selected = cellValue === value;
              const disabled = minValue !== null && cellValue < minValue;
              return (
                <Pressable
                  key={cellValue}
                  style={[styles.dayCell, selected ? styles.dayCellSelected : undefined]}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(cellValue);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      styles.dayText,
                      selected ? styles.dayTextSelected : undefined,
                      disabled ? styles.dayTextDisabled : undefined,
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(palette: Palette, isDark: boolean) {
  const shadows = getShadows(palette);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      padding: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    card: {
      width: "100%",
      maxWidth: 360,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    title: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
    },
    selectedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      alignSelf: "flex-start",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: isDark ? palette.surfaceStrong : palette.primarySoft,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    selectedText: {
      color: palette.primaryStrong,
      fontSize: 14,
      fontWeight: "800",
    },
    monthRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    navButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.sm,
    },
    monthLabel: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    weekHeader: {
      flexDirection: "row",
    },
    weekHeaderCell: {
      flex: 1,
      textAlign: "center",
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    dayCell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    dayCellSelected: {
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
    },
    dayText: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "600",
    },
    dayTextSelected: {
      color: palette.white,
      fontWeight: "900",
    },
    dayTextDisabled: {
      color: palette.textMuted,
      opacity: 0.4,
    },
  });
}
