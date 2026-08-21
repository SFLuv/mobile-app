import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { AppW9Tier } from "../types/app";

type Props = {
  visible: boolean;
  tier: AppW9Tier | null;
  /** Formatted year-to-date total, e.g. "430". */
  earnedSfluv: string;
  /** Formatted reporting limit, e.g. "600". */
  thresholdSfluv: string;
  /** Raw base units, so no formatted string is re-parsed to draw the meter. */
  earnedBase: string;
  thresholdBase: string;
  tokenSymbol: string;
  busy?: boolean;
  onStartForm: () => void;
  onDismiss: () => void;
};

type Presentation = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** The blunt second line the last two tiers get and the first two do not. */
  emphasis?: string;
  dismiss: string;
  tone: "notice" | "warning" | "stopped";
};

/**
 * One modal, four presentations — the escalation is the whole design, so the
 * copy and the colour escalate with it.
 *
 * The first two arrive while money is still being paid and say so, because a
 * warning that reads like a problem when nothing has gone wrong teaches people
 * to dismiss the one that matters. The last two arrive after money has stopped
 * and are plain about it.
 */
function presentationFor(tier: AppW9Tier, threshold: string, symbol: string): Presentation {
  switch (tier) {
    case "notice_400":
      return {
        icon: "information-circle",
        tone: "notice",
        title: "You're on your way to a tax form",
        body: `Once you've earned ${threshold} ${symbol} in a year, we need a W-9 on file before we can send you any more.`,
        dismiss: "Later",
      };
    case "warning_500":
      return {
        icon: "alert-circle",
        tone: "warning",
        title: `You're close to the ${threshold} ${symbol} limit`,
        body: `We'll need a W-9 on file before we can send anything past ${threshold} ${symbol}. It takes a couple of minutes.`,
        emphasis: "Do it now and your rewards keep arriving without interruption.",
        dismiss: "Later",
      };
    case "escrow_600":
      return {
        icon: "lock-closed",
        tone: "stopped",
        title: "Your reward is being held",
        body: `You've reached ${threshold} ${symbol} for the year, so we're holding this reward until your W-9 is on file.`,
        emphasis: "The money is yours. Complete the form and we'll send it straight over.",
        dismiss: "Later",
      };
    case "blocked":
    default:
      return {
        icon: "close-circle",
        tone: "stopped",
        title: "We can't send your rewards yet",
        body: `You have earned more than ${threshold} ${symbol} this year already. Please fill out a W-9 here.`,
        emphasis: "Your QR code is still good — scan it again once the form is in.",
        dismiss: "Not now",
      };
  }
}

/**
 * The meter is always drawn against the limit, never against the tier that
 * triggered the modal. The limit is the number that actually costs somebody
 * money, so it is the number every tier measures itself against.
 */
function progressFraction(earnedBase: string, thresholdBase: string): number {
  const earned = Number(earnedBase);
  const threshold = Number(thresholdBase);
  if (!Number.isFinite(earned) || !Number.isFinite(threshold) || threshold <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, earned / threshold));
}

export function W9TierModal({
  visible,
  tier,
  earnedSfluv,
  thresholdSfluv,
  earnedBase,
  thresholdBase,
  tokenSymbol,
  busy = false,
  onStartForm,
  onDismiss,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const presentation = useMemo(
    () => (tier ? presentationFor(tier, thresholdSfluv, tokenSymbol) : null),
    [thresholdSfluv, tier, tokenSymbol],
  );

  if (!presentation) {
    return null;
  }

  const accent =
    presentation.tone === "notice"
      ? palette.success
      : presentation.tone === "warning"
        ? palette.warning
        : palette.danger;
  const percent = Math.round(progressFraction(earnedBase, thresholdBase) * 100);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.iconWrap, { backgroundColor: `${accent}1f` }]}>
            <Ionicons name={presentation.icon} size={30} color={accent} />
          </View>

          <Text style={styles.title}>{presentation.title}</Text>

          <View style={styles.meterBlock}>
            <View style={styles.meterLabelRow}>
              <Text style={[styles.meterEarned, { color: accent }]}>
                {earnedSfluv} {tokenSymbol}
              </Text>
              <Text style={styles.meterLimit}>
                of {thresholdSfluv} {tokenSymbol}
              </Text>
            </View>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${percent}%`, backgroundColor: accent }]} />
            </View>
            <Text style={styles.meterCaption}>Earned so far this year</Text>
          </View>

          <Text style={styles.body}>{presentation.body}</Text>
          {presentation.emphasis ? (
            <Text style={[styles.emphasis, { color: accent }]}>{presentation.emphasis}</Text>
          ) : null}

          <Pressable
            style={[styles.primaryButton, { backgroundColor: accent }, busy ? styles.primaryButtonBusy : null]}
            onPress={onStartForm}
            disabled={busy}
            accessibilityRole="button"
            // Role alone is not enough: the button wraps an unlabelled icon and
            // the text, and iOS builds the name by concatenating them, so this
            // announces as ", Fill out my W-9" — leading comma — without an
            // explicit label.
            accessibilityLabel={busy ? "Opening your form" : "Fill out my W-9"}
          >
            <Ionicons name="open-outline" size={16} color={palette.white} />
            <Text style={styles.primaryButtonText}>{busy ? "Opening your form…" : "Fill out my W-9"}</Text>
          </Pressable>

          {/*
            The form opens in the system browser, which leaves the app. Said out
            loud so that is expected rather than alarming — the address bar is
            the point.
          */}
          <Text style={styles.footnote}>Opens the secure tax form outside the app.</Text>

          <Pressable
            style={styles.secondaryButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={presentation.dismiss}
          >
            <Text style={styles.secondaryButtonText}>{presentation.dismiss}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      alignItems: "center",
      gap: spacing.md,
    },
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
      textAlign: "center",
    },
    meterBlock: {
      width: "100%",
      gap: spacing.xs,
    },
    meterLabelRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
    },
    meterEarned: {
      fontSize: 18,
      fontWeight: "900",
    },
    meterLimit: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },
    meterTrack: {
      height: 10,
      borderRadius: 5,
      backgroundColor: palette.surfaceMuted,
      overflow: "hidden",
    },
    meterFill: {
      height: "100%",
      borderRadius: 5,
    },
    meterCaption: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "600",
    },
    body: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    emphasis: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "800",
      textAlign: "center",
    },
    primaryButton: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
    },
    primaryButtonBusy: {
      opacity: 0.7,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 15,
      fontWeight: "800",
    },
    footnote: {
      color: palette.textMuted,
      fontSize: 11,
      textAlign: "center",
      marginTop: -spacing.xs,
    },
    secondaryButton: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    secondaryButtonText: {
      color: palette.textMuted,
      fontSize: 14,
      fontWeight: "700",
    },
  });
}
