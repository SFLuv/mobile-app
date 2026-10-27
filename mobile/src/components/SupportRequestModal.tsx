import React, { useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { AppAlertAction } from "../types/notifications";
import { categoryLabel, type SupportRequestDetails } from "../utils/supportRequests";

type Props = {
  visible: boolean;
  request: SupportRequestDetails | null;
  /** The alert's buttons: "Reply by email" (a link) and "Archive". Empty once archived. */
  actions: AppAlertAction[];
  /** Set to an action id while that action runs. */
  busyActionId: string;
  onAction: (action: AppAlertAction) => void;
  onClose: () => void;
};

function formatReceived(at: number): string {
  if (!at) {
    return "";
  }
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One support request, everything needed to answer it.
 *
 * The list shows a request as a card, which is enough to see that it came in
 * but not to deal with it: the sender's address and the reference are what a
 * reply needs, and both have to be copied into a mail app. So they get copy
 * buttons here, the reference is shown large because it is what gets quoted
 * back and forth, and the message is shown whole.
 */
export function SupportRequestModal({ visible, request, actions, busyActionId, onAction, onClose }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!visible) {
      setCopied("");
    }
  }, [visible]);

  if (!request) {
    return null;
  }

  const copy = async (value: string, key: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(key);
  };

  const CopyButton = ({ value, id, label }: { value: string; id: string; label: string }) => (
    <Pressable
      style={styles.copyButton}
      onPress={() => void copy(value, id)}
      accessibilityRole="button"
      accessibilityLabel={copied === id ? `${label} copied` : `Copy ${label}`}
      hitSlop={8}
    >
      <Ionicons
        name={copied === id ? "checkmark-circle" : "copy-outline"}
        size={16}
        color={copied === id ? palette.success : palette.primaryStrong}
      />
      <Text style={[styles.copyLabel, copied === id ? { color: palette.success } : null]}>
        {copied === id ? "Copied" : "Copy"}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Support request</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {request.reference ? (
            <View style={styles.referenceCard}>
              <View>
                <Text style={styles.label}>Ticket</Text>
                <Text style={styles.reference} selectable>
                  {request.reference}
                </Text>
              </View>
              <CopyButton value={request.reference} id="reference" label="ticket number" />
            </View>
          ) : null}

          <Text style={styles.subject}>{request.subject}</Text>
          <View style={styles.metaRow}>
            {request.category ? (
              <View style={styles.categoryChip}>
                <Text style={styles.categoryText}>{categoryLabel(request.category)}</Text>
              </View>
            ) : null}
            <Text style={styles.meta}>{formatReceived(request.receivedAt)}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>From</Text>
            {request.name ? <Text style={styles.senderName}>{request.name}</Text> : null}
            {request.email ? (
              <View style={styles.emailRow}>
                <Text style={styles.email} selectable numberOfLines={1}>
                  {request.email}
                </Text>
                <CopyButton value={request.email} id="email" label="email address" />
              </View>
            ) : (
              <Text style={styles.meta}>No email address was given.</Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Message</Text>
            <Text style={styles.message} selectable>
              {request.message || "(No message)"}
            </Text>
          </View>
        </ScrollView>

        {actions.length > 0 ? (
          <View style={styles.footer}>
            {actions.map((action) => {
              const primary = action.style === "primary";
              const busy = busyActionId === action.id;
              return (
                <Pressable
                  key={action.id}
                  style={[styles.footerButton, primary ? styles.footerPrimary : null, busy ? styles.busy : null]}
                  disabled={Boolean(busyActionId)}
                  onPress={() => onAction(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={primary ? palette.white : palette.text} />
                  ) : (
                    <>
                      <Ionicons
                        name={action.url ? "mail-outline" : "archive-outline"}
                        size={16}
                        color={primary ? palette.white : palette.text}
                      />
                      <Text style={[styles.footerLabel, primary ? styles.footerLabelPrimary : null]}>
                        {action.label}
                      </Text>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    headerTitle: { color: palette.text, fontSize: 17, fontWeight: "800" },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    referenceCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    label: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    reference: { color: palette.text, fontSize: 20, fontWeight: "900", letterSpacing: 0.5 },
    subject: { color: palette.text, fontSize: 20, fontWeight: "800" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: -spacing.xs },
    meta: { color: palette.textMuted, fontSize: 13 },
    categoryChip: {
      backgroundColor: palette.primarySoft,
      borderRadius: 999,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    categoryText: { color: palette.text, fontSize: 12, fontWeight: "700" },
    section: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    senderName: { color: palette.text, fontSize: 16, fontWeight: "700", marginBottom: 2 },
    emailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    email: { color: palette.text, fontSize: 15, flexShrink: 1 },
    message: { color: palette.text, fontSize: 15, lineHeight: 22 },
    copyButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    copyLabel: { color: palette.primaryStrong, fontSize: 13, fontWeight: "700" },
    footer: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      backgroundColor: palette.background,
    },
    footerButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    footerPrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
    footerLabel: { color: palette.text, fontSize: 15, fontWeight: "800" },
    footerLabelPrimary: { color: palette.white },
    busy: { opacity: 0.7 },
  });
}
