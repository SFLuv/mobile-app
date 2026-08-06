import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { TransactionDetailsModal } from "../components/TransactionDetailsModal";
import { AppContact, AppLocation, AppTransaction } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import {
  buildAddressNameMaps,
  buildTransactionDetailPayload,
  isRewardTransaction,
  shortAddress,
  TransactionDetailPayload,
} from "../utils/transactions";

type Props = {
  transactions: AppTransaction[];
  tokenSymbol: string;
  explorerURL?: string;
  faucetAddress?: string;
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

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityScreen({
  transactions,
  tokenSymbol,
  explorerURL,
  faucetAddress,
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
  const refreshAccent = palette.primaryStrong;
  const refreshControlKey = `${isDark ? "dark" : "light"}:${refreshAccent}:${palette.surfaceStrong}`;

  const { contactNameByAddress, merchantNameByAddress } = useMemo(
    () => buildAddressNameMaps(contacts, merchants, merchantLabels),
    [contacts, merchantLabels, merchants],
  );

  const decoratedTransactions = useMemo<TransactionDetailPayload[]>(() => {
    return transactions.map((transaction) =>
      buildTransactionDetailPayload(transaction, activeAddress, contactNameByAddress, merchantNameByAddress, faucetAddress),
    );
  }, [activeAddress, contactNameByAddress, faucetAddress, merchantNameByAddress, transactions]);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            key={refreshControlKey}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={refreshAccent}
            colors={[refreshAccent]}
            progressBackgroundColor={isDark ? palette.backgroundMuted : palette.surfaceStrong}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.historyPanel}>
        {/* Names the wallet these transactions belong to, and still opens the
            chooser when there is more than one wallet to choose from. */}
        <Pressable
          style={styles.walletPill}
          disabled={!showWalletChooser || !onOpenWalletChooser}
          onPress={onOpenWalletChooser}
        >
          <Ionicons name="receipt-outline" size={16} color={palette.primaryStrong} />
          <Text style={styles.walletPillText} numberOfLines={1}>
            {selectedWalletLabel?.trim() || (activeAddress ? shortAddress(activeAddress) : "Wallet")}
          </Text>
          {showWalletChooser && onOpenWalletChooser ? (
            <Ionicons name="chevron-down" size={13} color={palette.textMuted} />
          ) : null}
        </Pressable>

        {!transactionsLoaded ? (
          <View style={styles.emptyCardInline}>
            <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
            <Text style={styles.emptyTitle}>Loading transactions</Text>
          </View>
        ) : decoratedTransactions.length === 0 ? (
          <View style={styles.emptyCardInline}>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>Your sends and receives will show up here after the first payment.</Text>
          </View>
        ) : (
          decoratedTransactions.map((details, index) => {
            const incoming = details.received;
            const reward = incoming && isRewardTransaction(details.transaction, faucetAddress);
            const title = reward ? "Received Reward" : incoming ? `Received from ${details.fromLabel}` : `Sent to ${details.toLabel}`;

            return (
              <Pressable
                key={details.transaction.id}
                style={[styles.row, index === decoratedTransactions.length - 1 ? styles.rowLast : undefined]}
                onPress={() => setSelectedTransaction(details)}
              >
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
                  <Text style={styles.currency}>{tokenSymbol}</Text>
                </View>
              </Pressable>
            );
          })
        )}

        </View>

        {decoratedTransactions.length > 0 && canLoadMore ? (
          <Pressable
            style={[styles.loadMoreButton, loadingMore ? styles.loadMoreButtonDisabled : undefined]}
            disabled={loadingMore}
            onPress={() => void onLoadMore()}
          >
            {loadingMore ? <ThemedActivityIndicator size="small" color={palette.white} /> : null}
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading..." : "Load 10 more"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <TransactionDetailsModal
        visible={Boolean(selectedTransaction)}
        details={selectedTransaction}
        tokenSymbol={tokenSymbol}
        explorerURL={explorerURL}
        onClose={() => setSelectedTransaction(null)}
      />
    </>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.md,
      paddingBottom: 120,
    },
    walletPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: "100%",
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    walletPillText: {
      flexShrink: 1,
      fontSize: 13,
      fontWeight: "800",
      color: palette.text,
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
    emptyCardInline: {
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.md,
    },
    emptyTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 18,
    },
    emptyBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    historyPanel: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.soft,
    },
    row: {
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    rowLast: {
      borderBottomWidth: 0,
      paddingBottom: 0,
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
      fontWeight: "800",
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
      fontWeight: "800",
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
