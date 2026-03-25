import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppContact, AppTransaction } from "../types/app";
import { palette, radii, shadows, spacing } from "../theme";

type Props = {
  transactions: AppTransaction[];
  contacts: AppContact[];
  activeAddress: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

function resolveLabel(address: string, contacts: AppContact[], activeAddress: string): string {
  if (address.toLowerCase() === activeAddress.toLowerCase()) {
    return "You";
  }
  const match = contacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase());
  if (match) {
    return match.name;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function ActivityScreen({ transactions, contacts, activeAddress, refreshing, onRefresh }: Props) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>Track the latest SFLUV payments for the wallet you currently have selected.</Text>
      </View>

      {transactions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="receipt-outline" size={22} color={palette.textMuted} />
          <Text style={styles.emptyTitle}>No transactions yet</Text>
          <Text style={styles.emptyBody}>Your sends and receives will show up here after the first payment.</Text>
        </View>
      ) : (
        transactions.map((tx) => {
          const incoming = tx.direction !== "send";
          const counterparty = tx.direction === "send" ? tx.to : tx.from;
          return (
            <View key={tx.id} style={styles.card}>
              <View style={[styles.iconWrap, incoming ? styles.iconReceive : styles.iconSend]}>
                <Ionicons
                  name={incoming ? "arrow-down" : "arrow-up"}
                  size={16}
                  color={incoming ? palette.success : palette.primaryStrong}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{incoming ? "Money received" : "Money sent"}</Text>
                <Text style={styles.cardMeta}>{resolveLabel(counterparty, contacts, activeAddress)}</Text>
                <Text style={styles.cardMeta}>{new Date(tx.timestamp * 1000).toLocaleString()}</Text>
                {tx.memo ? <Text style={styles.memo}>{tx.memo}</Text> : null}
              </View>
              <View style={styles.amountWrap}>
                <Text style={[styles.amount, incoming ? styles.amountReceive : styles.amountSend]}>
                  {incoming ? "+" : "-"}
                  {tx.amountFormatted}
                </Text>
                <Text style={styles.currency}>SFLUV</Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    paddingBottom: 120,
  },
  heroCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.soft,
  },
  title: {
    color: palette.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  subtitle: {
    color: palette.textMuted,
    lineHeight: 21,
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
    backgroundColor: "#def3ea",
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
});
