import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SwipeBack } from "../components/SwipeBack";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { TransactionDetailsModal } from "../components/TransactionDetailsModal";
import { AppContact, AppLocation, AppTransaction } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import {
  buildAddressNameMaps,
  buildTransactionDetailPayload,
  isRewardTransaction,
  TransactionDetailPayload,
} from "../utils/transactions";

type Props = {
  transactions: AppTransaction[];
  tokenSymbol: string;
  explorerURL?: string;
  /**
   * Offers "Send to a chat" on the transaction sheet. Absent when messaging is
   * off for this account. See TransactionDetailsModal for what travels.
   */
  onShareTransaction?: (txHash: string) => void;
  faucetAddress?: string;
  transactionsLoaded: boolean;
  contacts: AppContact[];
  merchants: AppLocation[];
  merchantLabels: Record<string, string>;
  activeAddress: string;
  selectedWalletLabel?: string;
  /** Back to the wallet. Also what a rightward swipe does. */
  onBack: () => void;
  refreshing: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  /**
   * A transaction to open as soon as it is in the list: the one a payment
   * notification was about. Cleared through onFocusHandled once shown.
   */
  focusTxHash?: string | null;
  onFocusHandled?: () => void;
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
  onBack,
  refreshing,
  loadingMore,
  canLoadMore,
  onRefresh,
  onLoadMore,
  onShareTransaction,
  focusTxHash,
  onFocusHandled,
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

  const [query, setQuery] = useState("");

  /**
   * What the search box matches.
   *
   * Built from the row as it is displayed rather than from the raw transaction:
   * somebody searching "Gus's" is looking for the name on screen, and that name
   * came from a contact or a merchant lookup, not from the chain. The raw
   * addresses and the hash are in there too, because the other reason to search
   * this list is that somebody has an address or a transaction id in hand.
   */
  const haystackFor = useCallback(
    (details: TransactionDetailPayload) =>
      [
        details.fromLabel,
        details.toLabel,
        details.typeLabel,
        details.received ? "received in" : "sent out",
        details.transaction.from,
        details.transaction.to,
        details.transaction.hash,
        details.transaction.memo ?? "",
        details.transaction.amountFormatted,
      ]
        .join(" ")
        .toLowerCase(),
    [],
  );

  const visibleTransactions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return decoratedTransactions;
    return decoratedTransactions.filter((details) => haystackFor(details).includes(term));
  }, [decoratedTransactions, haystackFor, query]);

  // Opened from a payment notification: show that payment, once it has
  // loaded. A push can arrive before the indexer has the transfer, so this
  // waits on the list rather than giving up on the first render.
  useEffect(() => {
    if (!focusTxHash) {
      return;
    }
    const wanted = focusTxHash.toLowerCase();
    const match = decoratedTransactions.find((details) => details.transaction.hash?.toLowerCase() === wanted);
    if (match) {
      setSelectedTransaction(match);
      onFocusHandled?.();
    }
  }, [decoratedTransactions, focusTxHash, onFocusHandled]);

  // onEndReached fires repeatedly on a fast scroll, and will fire again before
  // an in-flight page resolves. The ref is what stops three identical requests
  // for page two.
  const loadingMoreRef = useRef(false);
  const reachedEnd = useCallback(() => {
    // Not while filtering: the end of a filtered list is not the end of the
    // data, and fetching more rows that the filter will also hide reads as the
    // search doing nothing.
    if (query.trim() || loadingMoreRef.current || !canLoadMore || loadingMore) return;
    loadingMoreRef.current = true;
    void onLoadMore().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [canLoadMore, loadingMore, onLoadMore, query]);

  const renderRow = useCallback(
    ({ item: details, index }: { item: TransactionDetailPayload; index: number }) => {
      const incoming = details.received;
      const reward = incoming && isRewardTransaction(details.transaction, faucetAddress);
      const title = reward
        ? "Received Reward"
        : incoming
          ? `Received from ${details.fromLabel}`
          : `Sent to ${details.toLabel}`;

      return (
        <Pressable
          style={[styles.row, index === visibleTransactions.length - 1 ? styles.rowLast : undefined]}
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
    },
    [faucetAddress, palette, styles, tokenSymbol, visibleTransactions.length],
  );

  return (
    <SwipeBack onBack={onBack} style={styles.screen}>
      {/* Back arrow and search, in the row the wallet pill used to hold. The
          pill named the wallet these transactions belong to, which the wallet
          screen one tap back already says; what this list actually needed was a
          way through it. */}
      <View style={styles.searchRow}>
        <Pressable
          style={styles.backButton}
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to wallet"
        >
          <Ionicons name="chevron-back" size={22} color={palette.primaryStrong} />
        </Pressable>
        <View style={styles.searchField}>
          <Ionicons name="search" size={15} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Address, tx id, merchant, type, contact"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search transactions"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={visibleTransactions}
        keyExtractor={(details) => details.transaction.id}
        renderItem={renderRow}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            key={refreshControlKey}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={refreshAccent}
            colors={[refreshAccent]}
            progressBackgroundColor={palette.surfaceStrong}
          />
        }
        /* A screen and a half ahead, so the next page is usually in hand before
           the scroll reaches where the button used to be. */
        onEndReached={reachedEnd}
        onEndReachedThreshold={1.5}
        ListEmptyComponent={
          !transactionsLoaded ? (
            <View style={styles.emptyCardInline}>
              <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
              <Text style={styles.emptyTitle}>Loading transactions</Text>
            </View>
          ) : query.trim() ? (
            <View style={styles.emptyCardInline}>
              <Text style={styles.emptyTitle}>Nothing matches that</Text>
              <Text style={styles.emptyBody}>
                Try part of an address, a transaction id, or the name you know them by.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyCardInline}>
              <Text style={styles.emptyTitle}>No transactions yet</Text>
              <Text style={styles.emptyBody}>
                Your sends and receives will show up here after the first payment.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
            </View>
          ) : null
        }
      />

      <TransactionDetailsModal
        visible={Boolean(selectedTransaction)}
        details={selectedTransaction}
        tokenSymbol={tokenSymbol}
        explorerURL={explorerURL}
        onClose={() => setSelectedTransaction(null)}
        onShare={onShareTransaction}
      />
    </SwipeBack>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      // No `gap` here, deliberately.
      //
      // This is what made the rows look lopsided. Each row has its own bottom
      // border acting as the divider, AND the container put 16px between rows —
      // so the divider was not centred between two items. Measuring from one
      // divider to the next: 16 (gap) + 16 (top padding) above a row's content,
      // and only 16 (bottom padding) below it. Hence "much more space on the
      // top than the bottom", on every row.
      //
      // The gap and the border were doing the same job twice. With the gap
      // gone, a row's padding IS the space either side of its content and the
      // divider sits exactly between them.
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
    row: {
      // Raised from spacing.sm to keep the rows the same height now that the
      // container's 16px gap is gone — the space moved inside the row, where it
      // is symmetric, instead of sitting outside it, where it was not.
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    // The last row drops its divider — there is nothing under it to divide
    // from — but keeps its padding.
    //
    // It used to drop `paddingBottom` too, which made the final item visibly
    // shorter than every other one: `spacing.sm` of space above its content and
    // none below. Within a row the two should match, and now they do.
    rowLast: {
      borderBottomWidth: 0,
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
    screen: {
      flex: 1,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      // Clear of the app header above, for the same reason the notification
      // screen's row is.
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceMuted,
    },
    searchField: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      height: 36,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceMuted,
    },
    searchInput: {
      flex: 1,
      fontSize: 13,
      color: palette.text,
      padding: 0,
      includeFontPadding: false,
    },
    footerLoading: {
      paddingVertical: spacing.lg,
      alignItems: "center",
    },
  });
}
