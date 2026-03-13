import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppContact, AppTransaction } from "../types/app";
import { palette, radii, spacing } from "../theme";

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
    >
      <Text style={styles.title}>Activity</Text>
      <Text style={styles.subtitle}>Recent SFLUV transfers for your current wallet route.</Text>

      {transactions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No transactions yet</Text>
          <Text style={styles.emptyBody}>Your latest sends and receives will show up here.</Text>
        </View>
      ) : (
        transactions.map((tx) => {
          const counterparty = tx.direction === "send" ? tx.to : tx.from;
          return (
            <Pressable key={tx.id} style={styles.card}>
              <View>
                <Text style={styles.cardTitle}>{tx.direction === "send" ? "Sent" : "Received"}</Text>
                <Text style={styles.cardMeta}>{resolveLabel(counterparty, contacts, activeAddress)}</Text>
                <Text style={styles.cardMeta}>{new Date(tx.timestamp * 1000).toLocaleString()}</Text>
                {tx.memo ? <Text style={styles.memo}>{tx.memo}</Text> : null}
              </View>
              <View style={styles.amountWrap}>
                <Text style={[styles.amount, tx.direction === "send" ? styles.amountSend : styles.amountReceive]}>
                  {tx.direction === "send" ? "-" : "+"}
                  {tx.amountFormatted}
                </Text>
                <Text style={styles.currency}>SFLUV</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 110,
  },
  title: {
    color: palette.text,
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: palette.textMuted,
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 18,
  },
  emptyBody: {
    color: palette.textMuted,
    marginTop: 6,
    lineHeight: 20,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  cardTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 16,
  },
  cardMeta: {
    color: palette.textMuted,
    marginTop: 4,
  },
  memo: {
    color: palette.text,
    marginTop: 8,
    fontStyle: "italic",
  },
  amountWrap: {
    alignItems: "flex-end",
  },
  amount: {
    fontSize: 17,
    fontWeight: "900",
  },
  amountSend: {
    color: palette.danger,
  },
  amountReceive: {
    color: palette.success,
  },
  currency: {
    color: palette.textMuted,
    marginTop: 4,
    fontSize: 12,
  },
});
