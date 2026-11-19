import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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
  /** An admin asked for the form directly; see AppW9Status.adminRequested. */
  adminRequested?: boolean;
  /** The year the form is for, named in the admin-request wording. */
  taxYear?: number;
  /** Their last W-9 failed the IRS check once; see AppW9Status.correctionNeeded. */
  correctionNeeded?: boolean;
  /** It failed again and support has to help; see AppW9Status.supportNeeded. */
  supportNeeded?: boolean;
  busy?: boolean;
  onStartForm: () => void;
  onDismiss: () => void;
  /**
   * Fired when the modal has actually left the screen — the platform's own
   * dismissal callback, not a guess. The form flow presents the browser from
   * here, because presenting over a modal that is still animating out is what
   * froze the app three different ways.
   */
  onClosed?: () => void;
};

type Presentation = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** The blunt second line the last two tiers get and the first two do not. */
  emphasis?: string;
  dismiss: string;
  tone: "notice" | "warning" | "stopped";
  /** False when there is no form to open: the backend refuses one and says why. */
  startable?: boolean;
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
function presentationFor(
  t: TFunction,
  tier: AppW9Tier,
  threshold: string,
  symbol: string,
  adminRequested: boolean,
  taxYear?: number,
  correctionNeeded = false,
  supportNeeded = false,
  pastLimit = false,
): Presentation {
  // Failed the IRS TIN match more than once. The backend no longer hands out a
  // form on its own, so this beats every tier, including the two that say a
  // form will fix things.
  if (supportNeeded) {
    return {
      icon: "mail",
      tone: "warning",
      title: t("w9.supportTitle"),
      body: t("w9.supportBody"),
      dismiss: t("common.ok"),
      startable: false,
    };
  }
  // Failed it once. That is nearly always a typo, so say what to check before
  // they open the fresh form. Escrow and blocked keep their own wording, as for
  // admin requests below.
  if (correctionNeeded && (tier === "notice_400" || tier === "warning_500")) {
    return {
      icon: "create",
      tone: "warning",
      title: t("w9.correctionTitle"),
      body: t("w9.correctionBody"),
      emphasis: t("w9.correctionEmphasis"),
      dismiss: t("common.later"),
    };
  }
  // Asked for by an admin. The backend delivers the request as the notice or
  // warning tier, because those are the prompts older builds can draw; this
  // build says what actually happened. The escrow and blocked tiers keep their
  // own wording: when money is held or refused, that is the news.
  if (adminRequested && (tier === "notice_400" || tier === "warning_500")) {
    return {
      icon: "document-text",
      tone: "notice",
      title: t("w9.adminTitle"),
      body: taxYear ? t("w9.adminBodyYear", { year: taxYear }) : t("w9.adminBody"),
      dismiss: t("common.later"),
    };
  }
  switch (tier) {
    case "notice_400":
      return {
        icon: "information-circle",
        tone: "notice",
        title: t("w9.noticeTitle"),
        body: t("w9.noticeBody", { threshold, symbol }),
        dismiss: t("common.later"),
      };
    case "warning_500":
      // While enforcement is off, the warning is also what somebody already
      // past the line is shown, and "close to the limit" would be wrong.
      if (pastLimit) {
        return {
          icon: "alert-circle",
          tone: "warning",
          title: t("w9.pastLimitTitle"),
          body: t("w9.pastLimitBody", { threshold, symbol }),
          dismiss: t("common.later"),
        };
      }
      return {
        icon: "alert-circle",
        tone: "warning",
        title: t("w9.warningTitle", { threshold, symbol }),
        body: t("w9.warningBody", { threshold, symbol }),
        emphasis: t("w9.warningEmphasis"),
        dismiss: t("common.later"),
      };
    case "escrow_600":
      return {
        icon: "lock-closed",
        tone: "stopped",
        title: t("w9.escrowTitle"),
        body: t("w9.escrowBody", { threshold, symbol }),
        emphasis: t("w9.escrowEmphasis"),
        dismiss: t("common.later"),
      };
    case "blocked":
    default:
      return {
        icon: "close-circle",
        tone: "stopped",
        title: t("w9.blockedTitle"),
        body: t("w9.blockedBody", { threshold, symbol }),
        emphasis: t("w9.blockedEmphasis"),
        dismiss: t("common.notNow"),
      };
  }
}

/** Compared in base units as integers, so 599.999999 is never read as 600. */
function isPastLimit(earnedBase: string, thresholdBase: string): boolean {
  try {
    const threshold = BigInt(thresholdBase || "0");
    return threshold > 0n && BigInt(earnedBase || "0") >= threshold;
  } catch {
    return false;
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
  adminRequested = false,
  taxYear,
  correctionNeeded = false,
  supportNeeded = false,
  busy = false,
  onStartForm,
  onDismiss,
  onClosed,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { t } = useTranslation();
  const presentation = useMemo(
    () =>
      tier
        ? presentationFor(
            t,
            tier,
            thresholdSfluv,
            tokenSymbol,
            adminRequested,
            taxYear,
            correctionNeeded,
            supportNeeded,
            isPastLimit(earnedBase, thresholdBase),
          )
        : null,
    [adminRequested, correctionNeeded, earnedBase, supportNeeded, t, taxYear, thresholdBase, thresholdSfluv, tier, tokenSymbol],
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} onDismiss={onClosed}>
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
            <Text style={styles.meterCaption}>{t("w9.earnedSoFar")}</Text>
          </View>

          <Text style={styles.body}>{presentation.body}</Text>
          {presentation.emphasis ? (
            <Text style={[styles.emphasis, { color: accent }]}>{presentation.emphasis}</Text>
          ) : null}

          {presentation.startable === false ? null : (
            <>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: accent }, busy ? styles.primaryButtonBusy : null]}
                onPress={onStartForm}
                disabled={busy}
                accessibilityRole="button"
                // Role alone is not enough: the button wraps an unlabelled icon and
                // the text, and iOS builds the name by concatenating them, so this
                // announces as ", Fill out my W-9" — leading comma — without an
                // explicit label.
                accessibilityLabel={busy ? t("w9.opening") : t("w9.fillOut")}
              >
                <Ionicons name="open-outline" size={16} color={palette.white} />
                <Text style={styles.primaryButtonText}>{busy ? t("w9.openingEllipsis") : t("w9.fillOut")}</Text>
              </Pressable>

              {/*
                The form opens in the system browser, which leaves the app. Said out
                loud so that is expected rather than alarming — the address bar is
                the point.
              */}
              <Text style={styles.footnote}>{t("w9.opensOutside")}</Text>
            </>
          )}

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
