import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { t } from "../i18n";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";
import type { EmailVerificationOutcome, OrganizationJoinOutcome } from "../types/app";

/** What the card says, and which buttons it offers. */
export type EmailLinkCard = {
  tone: "working" | "success" | "error";
  title: string;
  body: string;
  /** Offered when trying again could work: no connection, or a server error. */
  retry?: boolean;
  /** A page on the web that finishes what the app cannot. */
  web?: { label: string; path: string };
};

type Props = {
  card: EmailLinkCard | null;
  onClose: () => void;
  onRetry: () => void;
  onOpenWeb: (path: string) => void;
};

export function workingCard(kind: "join" | "verify", body?: string): EmailLinkCard {
  return kind === "join"
    ? { tone: "working", title: t("emailLinks.joinWorkingTitle"), body: body ?? t("emailLinks.workingBody") }
    : { tone: "working", title: t("emailLinks.verifyWorkingTitle"), body: body ?? t("emailLinks.workingBody") };
}

const ORGANIZATION_PAGE = "/organization";
const SETTINGS_PAGE = "/settings";

export function joinOutcomeCard(outcome: OrganizationJoinOutcome): EmailLinkCard {
  switch (outcome.status) {
    case "joined":
      return {
        tone: "success",
        title: t("emailLinks.joinedTitle"),
        body: outcome.organizationName
          ? t("emailLinks.joinedBody", { name: outcome.organizationName })
          : t("emailLinks.joinedBodyNoName"),
        web: { label: t("emailLinks.openOnTheWeb"), path: ORGANIZATION_PAGE },
      };
    case "invalid":
      return {
        tone: "error",
        title: t("emailLinks.inviteInvalidTitle"),
        body: outcome.organizationName
          ? t("emailLinks.inviteInvalidMemberBody", { name: outcome.organizationName })
          : t("emailLinks.inviteInvalidBody"),
      };
    case "wrong_email":
      return {
        tone: "error",
        title: t("emailLinks.wrongEmailTitle"),
        body: t("emailLinks.wrongEmailBody"),
        web: { label: t("emailLinks.addItOnTheWeb"), path: SETTINGS_PAGE },
      };
    case "already_member":
      return {
        tone: "error",
        title: t("emailLinks.alreadyMemberTitle"),
        body: outcome.organizationName
          ? t("emailLinks.alreadyMemberBody", { name: outcome.organizationName })
          : t("emailLinks.alreadyMemberBodyNoName"),
        web: { label: t("emailLinks.openOnTheWeb"), path: ORGANIZATION_PAGE },
      };
    case "offline":
      return { tone: "error", title: t("emailLinks.offlineTitle"), body: t("emailLinks.offlineBody"), retry: true };
    case "failed":
      return { tone: "error", title: t("emailLinks.joinFailedTitle"), body: t("emailLinks.joinFailedBody"), retry: true };
  }
}

export function verifyOutcomeCard(outcome: EmailVerificationOutcome): EmailLinkCard {
  switch (outcome.status) {
    case "verified":
      return {
        tone: "success",
        title: t("emailLinks.verifiedTitle"),
        body: outcome.email ? t("emailLinks.verifiedBody", { email: outcome.email }) : t("emailLinks.verifiedBodyNoEmail"),
      };
    case "already_verified":
      return { tone: "success", title: t("emailLinks.verifiedTitle"), body: t("emailLinks.alreadyVerifiedBody") };
    case "expired":
      return {
        tone: "error",
        title: t("emailLinks.verifyExpiredTitle"),
        body: t("emailLinks.verifyExpiredBody"),
        web: { label: t("emailLinks.openSettingsOnTheWeb"), path: SETTINGS_PAGE },
      };
    case "invalid":
      return {
        tone: "error",
        title: t("emailLinks.verifyInvalidTitle"),
        body: t("emailLinks.verifyInvalidBody"),
        web: { label: t("emailLinks.openSettingsOnTheWeb"), path: SETTINGS_PAGE },
      };
    case "offline":
      return { tone: "error", title: t("emailLinks.offlineTitle"), body: t("emailLinks.offlineBody"), retry: true };
    case "failed":
      return { tone: "error", title: t("emailLinks.verifyFailedTitle"), body: t("emailLinks.verifyFailedBody"), retry: true };
  }
}

/**
 * Where a link from one of SFLuv's emails lands: accepting an organization
 * invitation, or verifying an email address. Says what is happening, then
 * what happened, with the way forward when it did not work.
 *
 * Drawn in the view tree rather than as a Modal, for the reason W9CompleteModal
 * gives: iOS presents one modal at a time, and a link opening the app can land
 * while another (the W-9 prompt, a redemption) is already up. A refused
 * presentation would leave the result unseen.
 */
export function EmailLinkModal({ card, onClose, onRetry, onOpenWeb }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  if (!card) {
    return null;
  }

  const working = card.tone === "working";
  const accent = card.tone === "success" ? palette.success : card.tone === "error" ? palette.danger : palette.primaryStrong;

  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityLiveRegion="polite">
          {working ? (
            <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
          ) : (
            <Ionicons name={card.tone === "success" ? "checkmark-circle" : "alert-circle"} size={44} color={accent} />
          )}
          <Text style={styles.title}>{card.title}</Text>
          <Text style={styles.body}>{card.body}</Text>

          {working ? null : (
            <View style={styles.actions}>
              {card.retry ? (
                <Pressable style={[styles.button, styles.primaryButton]} onPress={onRetry} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>{t("emailLinks.tryAgain")}</Text>
                </Pressable>
              ) : null}
              {card.web ? (
                <Pressable
                  style={[styles.button, card.retry ? styles.secondaryButton : styles.primaryButton]}
                  onPress={() => onOpenWeb(card.web!.path)}
                  accessibilityRole="button"
                >
                  <Text style={card.retry ? styles.secondaryButtonText : styles.primaryButtonText}>{card.web.label}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.button, card.retry || card.web ? styles.secondaryButton : styles.primaryButton]}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={card.retry || card.web ? styles.secondaryButtonText : styles.primaryButtonText}>
                  {card.tone === "success" ? t("common.done") : t("common.close")}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    host: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1000,
      elevation: 1000,
    },
    overlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 360,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      alignItems: "center",
      gap: spacing.md,
    },
    title: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
      textAlign: "center",
    },
    body: {
      color: palette.textMuted,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
    },
    actions: {
      alignSelf: "stretch",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    button: {
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    primaryButton: {
      backgroundColor: palette.primaryStrong,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 15,
      fontWeight: "800",
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: palette.border,
    },
    secondaryButtonText: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
