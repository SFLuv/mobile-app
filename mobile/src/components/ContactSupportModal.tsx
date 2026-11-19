import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { BulletinRequestError } from "../types/bulletin";
import i18next, { t } from "../i18n";

/**
 * Writing to SFLuv from inside the app.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Support requests could only be written on the website, which meant somebody
 * with a problem in the app had to leave it, find the site, and type their email
 * address — and then be answered by email, because an address was all we had.
 *
 * Submitting from here goes through the authenticated client, so the request
 * carries the account that wrote it. That is what lets the alert offer staff a
 * "Message" button that opens a chat, rather than only a mailto. The sender is
 * told nothing about that: from their side they wrote in and somebody replied.
 */

/**
 * The categories, matching the backend's own catalog.
 *
 * Duplicated rather than fetched because the list is the routing key and is
 * already duplicated in the website's form — an unrecognised slug is treated as
 * no category and reaches everybody, so the failure mode of drift is "more
 * people see it", not "it is lost".
 */
const CATEGORIES: Array<{ id: string; labelKey: string }> = [
  { id: "technical-support", labelKey: "components.contactSupportModal.somethingIsnTWorking" },
  { id: "general", labelKey: "components.contactSupportModal.aGeneralQuestion" },
  { id: "merchant-onboarding", labelKey: "components.contactSupportModal.becomingAMerchant" },
  { id: "become-an-improver", labelKey: "components.contactSupportModal.becomingAnImprover" },
  { id: "events", labelKey: "components.contactSupportModal.eventsAndVolunteering" },
  // The W-9 card and pop-ups send people here, and until this was added they
  // had to pick something that was not what they were writing about.
  { id: "w9", labelKey: "components.contactSupportModal.myW9OrTaxes" },
  { id: "other", labelKey: "components.contactSupportModal.somethingElse" },
];

export function ContactSupportModal({
  visible,
  backendClient,
  /** Prefilled from the account, and editable: it is where the reply goes. */
  defaultEmail,
  defaultName,
  onClose,
}: {
  visible: boolean;
  backendClient: AppBackendClient | null;
  defaultEmail?: string;
  defaultName?: string;
  onClose: () => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setCategory(CATEGORIES[0].id);
    setEmail(defaultEmail ?? "");
    setMessage("");
    setError(null);
    setReference(null);
  }, [defaultEmail, visible]);

  const chosen = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0];
  const ready = message.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const send = async () => {
    if (!backendClient || !ready || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await backendClient.submitSupportRequest({
        email: email.trim(),
        name: defaultName?.trim() || "",
        // Staff read the inbox in English, whatever language the app is in.
        subject: i18next.t(chosen.labelKey, { lng: "en" }),
        subject_slug: chosen.id,
        message: message.trim(),
      });
      setReference(result.reference);
    } catch (e) {
      setError(
        e instanceof BulletinRequestError ? e.message : t("components.contactSupportModal.couldnTSendThatTry"),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          {reference ? (
            // The acknowledgement, in place of the form. The reference is what
            // they quote back, so it is the largest thing on the screen.
            <View style={styles.sent}>
              <View style={styles.sentIcon}>
                <Ionicons name="checkmark" size={26} color={palette.white} />
              </View>
              <Text style={styles.title}>{t("components.contactSupportModal.messageSent")}</Text>
              <Text style={styles.body}>
                We&apos;ll get back to you at {email.trim()}. Your reference is:
              </Text>
              <Text style={styles.reference}>{reference}</Text>
              <Pressable style={styles.primary} onPress={onClose}>
                <Text style={styles.primaryText}>{t("components.contactSupportModal.done")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>{t("components.contactSupportModal.contactSfluv")}</Text>
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t("components.contactSupportModal.close")}>
                  <Ionicons name="close" size={20} color={palette.textMuted} />
                </Pressable>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>What&apos;s this about?</Text>
                <View style={styles.categories}>
                  {CATEGORIES.map((entry) => (
                    <Pressable
                      key={entry.id}
                      style={[styles.category, category === entry.id && styles.categoryActive]}
                      onPress={() => setCategory(entry.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t(entry.labelKey)}
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          category === entry.id && styles.categoryTextActive,
                        ]}
                      >
                        {t(entry.labelKey)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>{t("components.contactSupportModal.yourMessage")}</Text>
                <TextInput
                  style={styles.message}
                  value={message}
                  onChangeText={setMessage}
                  placeholder={t("components.contactSupportModal.tellUsWhatYouNeed")}
                  placeholderTextColor={palette.textMuted}
                  multiline
                  maxLength={8000}
                  textAlignVertical="top"
                />

                <Text style={styles.label}>{t("components.contactSupportModal.whereReplyQ")}</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />

                {error ? <Text style={styles.error}>{error}</Text> : null}
              </ScrollView>

              <Pressable
                style={[styles.primary, (!ready || sending) && styles.primaryDisabled]}
                onPress={() => void send()}
                disabled={!ready || sending}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{sending ? t("components.contactSupportModal.sending") : t("components.contactSupportModal.sendMessage")}</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 440,
      maxHeight: "86%",
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      padding: spacing.lg,
      ...shadows.card,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    title: { fontSize: 18, fontWeight: "700", color: palette.text },
    body: { fontSize: 14, color: palette.textMuted, textAlign: "center", lineHeight: 20 },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.text,
      marginTop: spacing.md,
      marginBottom: 7,
    },
    categories: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    category: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: palette.surfaceMuted,
    },
    categoryActive: { borderColor: palette.primary, backgroundColor: palette.primaryMuted },
    categoryText: { fontSize: 13, color: palette.textMuted },
    categoryTextActive: { color: palette.primaryStrong, fontWeight: "600" },
    message: {
      minHeight: 120,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceMuted,
      padding: 12,
      fontSize: 15,
      color: palette.text,
      lineHeight: 21,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontSize: 15,
      color: palette.text,
    },
    error: { fontSize: 13, color: palette.danger, marginTop: spacing.md },
    primary: {
      marginTop: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingVertical: 13,
      alignItems: "center",
    },
    primaryDisabled: { opacity: 0.45 },
    primaryText: { color: palette.white, fontWeight: "700", fontSize: 15 },
    sent: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
    sentIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: palette.success,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xs,
    },
    reference: {
      fontSize: 22,
      fontWeight: "800",
      color: palette.primaryStrong,
      letterSpacing: 1,
      marginVertical: spacing.sm,
      fontVariant: ["tabular-nums"],
    },
  });
}
