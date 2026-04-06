import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { TransactionDetailPayload, TransactionDetailsModal } from "../components/TransactionDetailsModal";
import { AppContact, AppLocation, AppTransaction } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  transactions: AppTransaction[];
  transactionsLoaded: boolean;
  contacts: AppContact[];
  merchants: AppLocation[];
  merchantLabels: Record<string, string>;
  activeAddress: string;
  selectedWalletLabel?: string;
  refreshing: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  showWalletChooser?: boolean;
  onOpenWalletChooser?: () => void;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
};

function shortAddress(address: string): string {
  if (!address) {
    return "";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveAddressLabel(
  address: string,
  activeAddress: string,
  contactNameByAddress: Record<string, string>,
  merchantNameByAddress: Record<string, string>,
): string {
  const normalizedAddress = address.toLowerCase();
  if (activeAddress && normalizedAddress === activeAddress.toLowerCase()) {
    return "You";
  }
  const contactName = contactNameByAddress[normalizedAddress];
  if (contactName) {
    return contactName;
  }
  const merchantName = merchantNameByAddress[normalizedAddress];
  if (merchantName) {
    return merchantName;
  }
  return shortAddress(address);
}

export function ActivityScreen({
  transactions,
  transactionsLoaded,
  contacts,
  merchants,
  merchantLabels,
  activeAddress,
  selectedWalletLabel,
  refreshing,
  loadingMore,
  canLoadMore,
  showWalletChooser,
  onOpenWalletChooser,
  onRefresh,
  onLoadMore,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetailPayload | null>(null);

  const contactNameByAddress = useMemo(() => {
    const next: Record<string, string> = {};
    for (const contact of contacts) {
      next[contact.address.toLowerCase()] = contact.name;
    }
    return next;
  }, [contacts]);

  const merchantNameByAddress = useMemo(() => {
    const next: Record<string, string> = { ...merchantLabels };
    for (const merchant of merchants) {
      if (!merchant.payToAddress) {
        continue;
      }
      const normalizedAddress = merchant.payToAddress.toLowerCase();
      if (!next[normalizedAddress]) {
        next[normalizedAddress] = merchant.name.trim();
      }
    }
    return next;
  }, [merchantLabels, merchants]);

  const decoratedTransactions = useMemo<TransactionDetailPayload[]>(() => {
    return transactions.map((transaction) => {
      const received = transaction.direction !== "send";
      const fromLabel = resolveAddressLabel(transaction.from, activeAddress, contactNameByAddress, merchantNameByAddress);
      const toLabel = resolveAddressLabel(transaction.to, activeAddress, contactNameByAddress, merchantNameByAddress);

      return {
        transaction,
        received,
        fromLabel,
        toLabel,
        typeLabel: "Currency Transfer",
        statusLabel: "Completed",
      };
    });
  }, [activeAddress, contactNameByAddress, merchantNameByAddress, transactions]);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={palette.primaryStrong}
            colors={[palette.primaryStrong]}
            progressBackgroundColor={palette.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.walletBar}>
          <View style={styles.walletBarCopy}>
            <Text style={styles.walletBarLabel}>Current wallet</Text>
            <Text style={styles.walletBarTitle}>{selectedWalletLabel || "Selected wallet"}</Text>
            <Text style={styles.walletBarMeta}>
              {activeAddress ? shortAddress(activeAddress) : "Wallet not loaded yet"}
            </Text>
          </View>
          {showWalletChooser && onOpenWalletChooser ? (
            <Pressable style={styles.chooseWalletButton} onPress={onOpenWalletChooser}>
              <Text style={styles.chooseWalletButtonText}>Choose Wallet</Text>
              <Ionicons name="chevron-down" size={14} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
        </View>

        {!transactionsLoaded ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator size="small" color={palette.primaryStrong} />
            <Text style={styles.emptyTitle}>loading transactions</Text>
          </View>
        ) : decoratedTransactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={22} color={palette.textMuted} />
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>Your sends and receives will show up here after the first payment.</Text>
          </View>
        ) : (
          decoratedTransactions.map((details) => {
            const incoming = details.received;
            const title = incoming ? `Received from ${details.fromLabel}` : `Sent to ${details.toLabel}`;

            return (
              <Pressable key={details.transaction.id} style={styles.card} onPress={() => setSelectedTransaction(details)}>
                <View style={[styles.iconWrap, incoming ? styles.iconReceive : styles.iconSend]}>
                  <Ionicons
                    name={incoming ? "arrow-down" : "arrow-up"}
                    size={16}
                    color={incoming ? palette.success : palette.primaryStrong}
                  />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text style={styles.cardMeta}>{formatDate(details.transaction.timestamp)}</Text>
                  {details.transaction.memo ? <Text style={styles.memo}>{details.transaction.memo}</Text> : null}
                </View>
                <View style={styles.amountWrap}>
                  <Text style={[styles.amount, incoming ? styles.amountReceive : styles.amountSend]}>
                    {incoming ? "+" : "-"}
                    {details.transaction.amountFormatted}
                  </Text>
                  <Text style={styles.currency}>SFLUV</Text>
                </View>
              </Pressable>
            );
          })
        )}

        {decoratedTransactions.length > 0 && canLoadMore ? (
          <Pressable
            style={[styles.loadMoreButton, loadingMore ? styles.loadMoreButtonDisabled : undefined]}
            disabled={loadingMore}
            onPress={() => void onLoadMore()}
          >
            {loadingMore ? <ActivityIndicator size="small" color={palette.white} /> : null}
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading..." : "Load 10 more"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <TransactionDetailsModal
        visible={Boolean(selectedTransaction)}
        details={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
      />
    </>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
      paddingBottom: 120,
    },
    walletBar: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      ...shadows.soft,
    },
    walletBarCopy: {
      flex: 1,
      gap: 4,
    },
    walletBarLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    walletBarTitle: {
      color: palette.text,
      fontSize: 17,
      fontWeight: "900",
    },
    walletBarMeta: {
      color: palette.textMuted,
      fontSize: 13,
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
    emptyCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.xl,
      alignItems: "flex-start",
      gap: spacing.sm,
      ...shadows.soft,
    },
    emptyTitle: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 18,
    },
    emptyBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
      ...shadows.soft,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
    },
    iconReceive: {
      backgroundColor: isDark ? palette.surfaceStrong : "#def3ea",
    },
    iconSend: {
      backgroundColor: palette.primarySoft,
    },
    cardBody: {
      flex: 1,
      gap: 3,
    },
    cardTitle: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 16,
    },
    cardMeta: {
      color: palette.textMuted,
      fontSize: 13,
    },
    memo: {
      color: palette.text,
      marginTop: 6,
      fontStyle: "italic",
    },
    amountWrap: {
      alignItems: "flex-end",
      gap: 2,
    },
    amount: {
      fontSize: 17,
      fontWeight: "900",
    },
    amountSend: {
      color: palette.primaryStrong,
    },
    amountReceive: {
      color: palette.success,
    },
    currency: {
      color: palette.textMuted,
      marginTop: 2,
      fontSize: 12,
      fontWeight: "700",
    },
    loadMoreButton: {
      minHeight: 48,
      borderRadius: radii.md,
      backgroundColor: palette.primaryStrong,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      ...shadows.soft,
    },
    loadMoreButtonDisabled: {
      opacity: 0.85,
    },
    loadMoreText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 14,
    },
  });
}
