import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./AppText";

import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { AppAlertAction, AppNotificationItem } from "../types/notifications";
import { t } from "../i18n";
import { appLocale } from "../i18n";

type Props = {
  item: AppNotificationItem | null;
  /** Set to an action id while that action runs. */
  busyActionId: string;
  onAction: (action: AppAlertAction) => void;
  onClose: () => void;
};

function formatWhen(at: number): string {
  if (!at) {
    return "";
  }
  return new Date(at).toLocaleString(appLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One team notification, in full.
 *
 * The list shows only what it is about and who: its topic and one line. This
 * is everything else — the headline, the message whole, every detail, how it
 * ended — and the same buttons the card has, so it can be dealt with here.
 */
export function NotificationDetailModal({ item, busyActionId, onAction, onClose }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const internal = item?.internal ?? null;
  if (!item || !internal) {
    return null;
  }
  const actions = internal.resolved ? [] : internal.actions;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {internal.topicLabel || internal.setLabel || t("components.notificationDetail.notification")}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("components.notificationDetail.close")}
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={palette.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} selectable>
              {item.title}
            </Text>
            <Text style={styles.meta}>{formatWhen(item.createdAt)}</Text>
          </View>

          {item.body ? (
            <View style={styles.section}>
              <Text style={styles.label}>{t("components.notificationDetail.message")}</Text>
              <Text style={styles.body} selectable>
                {item.body}
              </Text>
            </View>
          ) : null}

          {internal.fields.length > 0 ? (
            <View style={styles.section}>
              {internal.fields.map((field, index) => (
                <View
                  key={`${field.label}:${field.value}`}
                  style={[styles.fieldRow, index > 0 ? styles.fieldRowDivided : null]}
                >
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text style={styles.fieldValue} selectable>
                    {field.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {internal.resolved && internal.outcome ? (
            <View style={styles.outcome}>
              <Ionicons name="checkmark-circle-outline" size={16} color={palette.textMuted} />
              <Text style={styles.outcomeText}>{internal.outcome}</Text>
            </View>
          ) : null}
        </ScrollView>

        {actions.length > 0 ? (
          <View style={styles.footer}>
            {actions.map((action) => {
              const filled = action.style === "primary" || action.style === "danger";
              const busy = busyActionId === action.id;
              return (
                <Pressable
                  key={action.id}
                  style={[
                    styles.footerButton,
                    action.style === "primary" ? styles.footerPrimary : null,
                    action.style === "danger" ? styles.footerDanger : null,
                    busy ? styles.busy : null,
                  ]}
                  disabled={Boolean(busyActionId)}
                  onPress={() => onAction(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={filled ? palette.white : palette.text} />
                  ) : (
                    <Text style={[styles.footerLabel, filled ? styles.footerLabelFilled : null]}>{action.label}</Text>
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
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    headerTitle: { color: palette.text, fontSize: 17, fontWeight: "800", flexShrink: 1 },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    titleBlock: { gap: spacing.xs },
    title: { color: palette.text, fontSize: 20, fontWeight: "800" },
    meta: { color: palette.textMuted, fontSize: 13 },
    section: {
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
    body: { color: palette.text, fontSize: 15, lineHeight: 22 },
    fieldRow: { gap: 2, paddingVertical: spacing.sm },
    fieldRowDivided: { borderTopWidth: 1, borderTopColor: palette.border },
    fieldLabel: { color: palette.textMuted, fontSize: 12, fontWeight: "700" },
    fieldValue: { color: palette.text, fontSize: 15 },
    outcome: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    outcomeText: { color: palette.textMuted, fontSize: 14, flexShrink: 1 },
    footer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      backgroundColor: palette.background,
    },
    footerButton: {
      flexGrow: 1,
      flexBasis: 120,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    footerPrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
    footerDanger: { backgroundColor: palette.danger, borderColor: palette.danger },
    footerLabel: { color: palette.text, fontSize: 15, fontWeight: "800" },
    footerLabelFilled: { color: palette.white },
    busy: { opacity: 0.7 },
  });
}
