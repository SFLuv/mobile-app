import React, { useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppTransaction } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

export type TransactionDetailPayload = {
  transaction: AppTransaction;
  fromLabel: string;
  toLabel: string;
  received: boolean;
  typeLabel: string;
  statusLabel: string;
};

type Props = {
  visible: boolean;
  details: TransactionDetailPayload | null;
  onClose: () => void;
};

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function signedAmount(details: TransactionDetailPayload): string {
  return `${details.received ? "+" : "-"}${details.transaction.amountFormatted} SFLUV`;
}

function explorerUrl(hash: string): string {
  return `https://berascan.com/tx/${hash}`;
}

export function TransactionDetailsModal({ visible, details, onClose }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedField) {
      return;
    }
    const timeout = setTimeout(() => {
      setCopiedField(null);
    }, 2000);
    return () => {
      clearTimeout(timeout);
    };
  }, [copiedField]);

  if (!details) {
    return null;
  }

  const copyField = async (value: string, field: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedField(field);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Transaction Details</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{details.typeLabel}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={palette.white} />
                    <Text style={styles.statusBadgeText}>{details.statusLabel}</Text>
                  </View>
                </View>
              </View>
              <Pressable style={styles.closeIconButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>

            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
              <View style={styles.amountCard}>
                <Text style={[styles.amountText, details.received ? styles.amountReceive : styles.amountSend]}>
                  {signedAmount(details)}
                </Text>
                <Text style={styles.amountDate}>{formatDate(details.transaction.timestamp)}</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>From</Text>
                <Text style={styles.sectionTitle}>{details.fromLabel}</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.codeText}>{details.transaction.from}</Text>
                  <Pressable style={styles.copyButton} onPress={() => void copyField(details.transaction.from, "from")}>
                    <Ionicons
                      name={copiedField === "from" ? "checkmark-circle" : "copy-outline"}
                      size={16}
                      color={copiedField === "from" ? palette.success : palette.primaryStrong}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>To</Text>
                <Text style={styles.sectionTitle}>{details.toLabel}</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.codeText}>{details.transaction.to}</Text>
                  <Pressable style={styles.copyButton} onPress={() => void copyField(details.transaction.to, "to")}>
                    <Ionicons
                      name={copiedField === "to" ? "checkmark-circle" : "copy-outline"}
                      size={16}
                      color={copiedField === "to" ? palette.success : palette.primaryStrong}
                    />
                  </Pressable>
                </View>
              </View>

              {details.transaction.memo ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Memo</Text>
                  <View style={styles.codeRow}>
                    <Text style={styles.memoText}>{details.transaction.memo}</Text>
                    <Pressable style={styles.copyButton} onPress={() => void copyField(details.transaction.memo || "", "memo")}>
                      <Ionicons
                        name={copiedField === "memo" ? "checkmark-circle" : "copy-outline"}
                        size={16}
                        color={copiedField === "memo" ? palette.success : palette.primaryStrong}
                      />
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Transaction ID</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.codeText}>{details.transaction.hash}</Text>
                  <Pressable style={styles.copyButton} onPress={() => void copyField(details.transaction.hash, "hash")}>
                    <Ionicons
                      name={copiedField === "hash" ? "checkmark-circle" : "copy-outline"}
                      size={16}
                      color={copiedField === "hash" ? palette.success : palette.primaryStrong}
                    />
                  </Pressable>
                </View>
                <Pressable
                  style={styles.inlineExplorerButton}
                  onPress={() => {
                    void Linking.openURL(explorerUrl(details.transaction.hash));
                  }}
                >
                  <Ionicons name="open-outline" size={16} color={palette.primaryStrong} />
                  <Text style={styles.inlineExplorerButtonText}>View on Explorer</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheet: {
      backgroundColor: palette.background,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingTop: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      maxHeight: "90%",
      gap: spacing.md,
    },
    scrollArea: {
      flexShrink: 1,
    },
    container: {
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    headerCopy: {
      flex: 1,
      gap: spacing.sm,
    },
    title: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "900",
    },
    badgeRow: {
      flexDirection: "row",
      gap: spacing.xs,
      flexWrap: "wrap",
    },
    typeBadge: {
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    typeBadgeText: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 12,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      backgroundColor: palette.success,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    statusBadgeText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 12,
    },
    closeIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    amountCard: {
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.xs,
      alignItems: "center",
      ...shadows.soft,
    },
    amountText: {
      fontSize: 30,
      fontWeight: "900",
      textAlign: "center",
    },
    amountReceive: {
      color: palette.success,
    },
    amountSend: {
      color: palette.primaryStrong,
    },
    amountDate: {
      color: palette.textMuted,
      fontSize: 13,
      textAlign: "center",
    },
    section: {
      gap: spacing.xs,
    },
    sectionLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    codeRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    codeText: {
      flex: 1,
      color: palette.textMuted,
      fontFamily: "Courier",
      fontSize: 12,
      lineHeight: 18,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    memoText: {
      flex: 1,
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 19,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    copyButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    inlineExplorerButton: {
      marginTop: spacing.sm,
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    inlineExplorerButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
  });
}
