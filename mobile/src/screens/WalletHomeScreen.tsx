import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppTransaction } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  balance: string;
  smartAddress: string;
  ownerBadge?: string;
  selectedWalletLabel?: string;
  recentTransactions: AppTransaction[];
  onOpenSend: () => void;
  onOpenReceive: () => void;
  onOpenActivity: () => void;
  onOpenWalletChooser: () => void;
  showWalletChooser?: boolean;
};

function shortAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatTxTitle(tx: AppTransaction): string {
  return tx.direction === "send" ? "Sent" : "Received";
}

export function WalletHomeScreen({
  balance,
  smartAddress,
  ownerBadge,
  selectedWalletLabel,
  recentTransactions,
  onOpenSend,
  onOpenReceive,
  onOpenActivity,
  onOpenWalletChooser,
  showWalletChooser,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroWrap}>
        <View style={styles.heroGlowLarge} />
        <View style={styles.heroGlowSmall} />

        <View style={styles.heroTopRow}>
          <View style={styles.heroBadge}>
            <Ionicons name="shield-checkmark" size={14} color={palette.primaryStrong} />
            <Text style={styles.heroBadgeText}>Wallet ready</Text>
          </View>
          {showWalletChooser ? (
            <Pressable style={styles.chooseWalletButton} onPress={onOpenWalletChooser}>
              <Text style={styles.chooseWalletButtonText}>Choose Wallet</Text>
              <Ionicons name="chevron-down" size={14} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.heroEyebrow}>Selected wallet</Text>
        <Text style={styles.heroBalance}>{balance}</Text>
        <Text style={styles.heroCurrency}>SFLUV available</Text>

        <View style={styles.addressBar}>
          <Ionicons name="wallet-outline" size={16} color={palette.primaryStrong} />
          <Text style={styles.addressText}>{shortAddress(smartAddress)}</Text>
        </View>

        <View style={styles.metaRow}>
          {selectedWalletLabel ? (
            <View style={styles.routePill}>
              <Text style={styles.routePillText}>{selectedWalletLabel}</Text>
            </View>
          ) : null}
          {ownerBadge ? <Text style={styles.ownerText}>Owner {ownerBadge}</Text> : null}
        </View>

        <View style={styles.heroActionRow}>
          <Pressable style={styles.heroPrimaryAction} onPress={onOpenSend}>
            <Ionicons name="arrow-up" size={16} color={palette.white} />
            <Text style={styles.heroPrimaryActionText}>Send</Text>
          </Pressable>
          <Pressable style={styles.heroSecondaryAction} onPress={onOpenReceive}>
            <Ionicons name="arrow-down" size={16} color={palette.primaryStrong} />
            <Text style={styles.heroSecondaryActionText}>Receive</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            <Text style={styles.sectionMeta}>Your latest SFLUV movement</Text>
          </View>
          <Pressable onPress={onOpenActivity}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>

        {recentTransactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={22} color={palette.textMuted} />
            <Text style={styles.emptyTitle}>No payments yet</Text>
            <Text style={styles.emptyBody}>Your latest sends and receives will appear here after the first transfer.</Text>
          </View>
        ) : (
          recentTransactions.slice(0, 4).map((tx) => {
            const incoming = tx.direction !== "send";
            return (
              <View key={tx.id} style={styles.txCard}>
                <View style={[styles.txIconWrap, incoming ? styles.txIconReceive : styles.txIconSend]}>
                  <Ionicons
                    name={incoming ? "arrow-down" : "arrow-up"}
                    size={16}
                    color={incoming ? palette.success : palette.primaryStrong}
                  />
                </View>
                <View style={styles.txBody}>
                  <Text style={styles.txTitle}>{formatTxTitle(tx)}</Text>
                  <Text style={styles.txMeta}>{new Date(tx.timestamp * 1000).toLocaleDateString()}</Text>
                </View>
                <View style={styles.txAmountWrap}>
                  <Text style={[styles.txAmount, incoming ? styles.txAmountReceive : styles.txAmountSend]}>
                    {incoming ? "+" : "-"}
                    {tx.amountFormatted}
                  </Text>
                  <Text style={styles.txCurrency}>SFLUV</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.lg,
      paddingBottom: 140,
    },
    heroWrap: {
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      padding: spacing.lg,
      overflow: "hidden",
      borderWidth: 1.5,
      borderColor: palette.primary,
      ...shadows.card,
    },
    heroGlowLarge: {
      position: "absolute",
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: isDark ? "rgba(239,109,102,0.13)" : "rgba(239,109,102,0.08)",
      top: -120,
      right: -60,
    },
    heroGlowSmall: {
      position: "absolute",
      width: 160,
      height: 160,
      borderRadius: 80,
      backgroundColor: isDark ? "rgba(239,109,102,0.1)" : "rgba(239,109,102,0.05)",
      bottom: -50,
      left: -24,
    },
    heroTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    heroBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    heroBadgeText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    chooseWalletButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    chooseWalletButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    heroEyebrow: {
      marginTop: spacing.xl,
      color: palette.primaryStrong,
      fontSize: 13,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    heroBalance: {
      marginTop: 10,
      color: palette.primaryStrong,
      fontSize: 42,
      fontWeight: "900",
      letterSpacing: -1,
    },
    heroCurrency: {
      color: palette.textMuted,
      fontSize: 15,
      fontWeight: "600",
    },
    addressBar: {
      marginTop: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    addressText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    metaRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    routePill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    routePillText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    ownerText: {
      color: palette.textMuted,
      fontSize: 12,
      flex: 1,
      textAlign: "right",
    },
    heroActionRow: {
      marginTop: spacing.xl,
      flexDirection: "row",
      gap: spacing.sm,
    },
    heroPrimaryAction: {
      flex: 1,
      minHeight: 56,
      backgroundColor: palette.primary,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    heroPrimaryActionText: {
      color: palette.white,
      fontWeight: "900",
      fontSize: 16,
    },
    heroSecondaryAction: {
      flex: 1,
      minHeight: 56,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    heroSecondaryActionText: {
      color: palette.primaryStrong,
      fontWeight: "900",
      fontSize: 16,
    },
    sectionCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
      letterSpacing: -0.3,
    },
    sectionMeta: {
      color: palette.textMuted,
      lineHeight: 19,
    },
    link: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 13,
    },
    emptyState: {
      borderRadius: radii.md,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      alignItems: "flex-start",
      gap: 8,
    },
    emptyTitle: {
      color: palette.text,
      fontSize: 17,
      fontWeight: "800",
    },
    emptyBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    txCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
    },
    txIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
    },
    txIconReceive: {
      backgroundColor: palette.surfaceStrong,
    },
    txIconSend: {
      backgroundColor: palette.primarySoft,
    },
    txBody: {
      flex: 1,
      gap: 3,
    },
    txTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    txMeta: {
      color: palette.textMuted,
      fontSize: 13,
    },
    txAmountWrap: {
      alignItems: "flex-end",
      gap: 2,
    },
    txAmount: {
      fontSize: 17,
      fontWeight: "900",
    },
    txAmountSend: {
      color: palette.primaryStrong,
    },
    txAmountReceive: {
      color: palette.success,
    },
    txCurrency: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "700",
    },
  });
}
