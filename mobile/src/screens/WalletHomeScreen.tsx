import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppTransaction } from "../types/app";
import { RouteCandidate } from "../services/smartWallet";
import { palette, radii, spacing } from "../theme";

type Props = {
  balance: string;
  smartAddress: string;
  ownerBadge?: string;
  candidates: RouteCandidate[];
  selectedCandidateKey?: string;
  recentTransactions: AppTransaction[];
  onSelectCandidate: (key: string) => void;
  onOpenSend: () => void;
  onOpenReceive: () => void;
  onOpenActivity: () => void;
  onMigrateLegacyToNew?: () => void;
  showMigrateLegacyToNew?: boolean;
  canMigrateLegacyToNew?: boolean;
  migratingLegacyToNew?: boolean;
  legacyBalance?: string;
};

function shortAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function WalletHomeScreen({
  balance,
  smartAddress,
  ownerBadge,
  candidates,
  selectedCandidateKey,
  recentTransactions,
  onSelectCandidate,
  onOpenSend,
  onOpenReceive,
  onOpenActivity,
  onMigrateLegacyToNew,
  showMigrateLegacyToNew,
  canMigrateLegacyToNew,
  migratingLegacyToNew,
  legacyBalance,
}: Props) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Selected Wallet</Text>
        <Text style={styles.balanceValue}>{balance} SFLUV</Text>
        <Text style={styles.address}>{shortAddress(smartAddress)}</Text>
        {ownerBadge ? <Text style={styles.ownerBadge}>EOA {ownerBadge}</Text> : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable style={[styles.actionCard, styles.actionPrimary]} onPress={onOpenSend}>
          <Text style={styles.actionPrimaryLabel}>Send</Text>
          <Text style={styles.actionPrimarySub}>Pay someone fast</Text>
        </Pressable>
        <Pressable style={styles.actionCard} onPress={onOpenReceive}>
          <Text style={styles.actionLabel}>Receive</Text>
          <Text style={styles.actionSub}>Show your QR</Text>
        </Pressable>
      </View>

      {candidates.length > 1 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet Routes</Text>
          <View style={styles.routeList}>
            {candidates.map((candidate) => {
              const active = candidate.key === selectedCandidateKey;
              return (
                <Pressable
                  key={candidate.key}
                  style={[styles.routeCard, active ? styles.routeCardActive : undefined]}
                  onPress={() => onSelectCandidate(candidate.key)}
                >
                  <Text style={[styles.routeLabel, active ? styles.routeLabelActive : undefined]}>
                    {candidate.route.label} #{candidate.smartIndex + 1}
                  </Text>
                  <Text style={styles.routeMeta}>{shortAddress(candidate.accountAddress)}</Text>
                  <Text style={styles.routeBalance}>{candidate.tokenBalance} SFLUV</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {showMigrateLegacyToNew && onMigrateLegacyToNew ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Migration</Text>
          <Pressable
            style={[
              styles.migrateButton,
              (!canMigrateLegacyToNew || migratingLegacyToNew) ? styles.migrateButtonDisabled : undefined,
            ]}
            onPress={onMigrateLegacyToNew}
            disabled={!canMigrateLegacyToNew || migratingLegacyToNew}
          >
            <Text style={styles.migrateLabel}>
              {migratingLegacyToNew ? "Migrating..." : "Move legacy funds into your new wallet"}
            </Text>
          </Pressable>
          <Text style={styles.migrateMeta}>
            Legacy balance: {legacyBalance ?? "0"} SFLUV
          </Text>
          {!canMigrateLegacyToNew ? (
            <Text style={styles.emptyText}>No legacy balance available to move yet.</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <Pressable onPress={onOpenActivity}>
            <Text style={styles.sectionLink}>See all</Text>
          </Pressable>
        </View>
        {recentTransactions.length === 0 ? (
          <Text style={styles.emptyText}>Your latest payments will show up here.</Text>
        ) : (
          recentTransactions.slice(0, 4).map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View>
                <Text style={styles.txTitle}>{tx.direction === "send" ? "Sent" : "Received"}</Text>
                <Text style={styles.txMeta}>{new Date(tx.timestamp * 1000).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.txAmount, tx.direction === "send" ? styles.txSend : styles.txReceive]}>
                {tx.direction === "send" ? "-" : "+"}
                {tx.amountFormatted} SFLUV
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 110,
  },
  hero: {
    backgroundColor: palette.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  eyebrow: {
    color: "#fff6f6",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  balanceValue: {
    color: palette.white,
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8,
  },
  address: {
    color: "#fff3f3",
    marginTop: 8,
    fontFamily: "Courier",
    fontSize: 13,
  },
  ownerBadge: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: palette.white,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionCard: {
    flex: 1,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  actionPrimary: {
    backgroundColor: palette.surfaceStrong,
    borderColor: palette.borderStrong,
  },
  actionPrimaryLabel: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 18,
  },
  actionPrimarySub: {
    color: palette.textMuted,
    marginTop: 6,
  },
  actionLabel: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 18,
  },
  actionSub: {
    color: palette.textMuted,
    marginTop: 6,
  },
  section: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 18,
  },
  sectionLink: {
    color: palette.primary,
    fontWeight: "700",
  },
  routeList: {
    gap: 10,
  },
  routeCard: {
    backgroundColor: palette.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  routeCardActive: {
    borderColor: palette.primary,
    backgroundColor: "#fff4f4",
  },
  routeLabel: {
    color: palette.text,
    fontWeight: "800",
  },
  routeLabelActive: {
    color: palette.primary,
  },
  routeMeta: {
    color: palette.textMuted,
    fontFamily: "Courier",
    fontSize: 12,
    marginTop: 4,
  },
  routeBalance: {
    color: palette.text,
    marginTop: 4,
    fontWeight: "700",
  },
  migrateButton: {
    backgroundColor: palette.primaryMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  migrateButtonDisabled: {
    backgroundColor: palette.backgroundMuted,
  },
  migrateLabel: {
    color: palette.text,
    fontWeight: "800",
  },
  migrateMeta: {
    color: palette.textMuted,
    fontSize: 12,
  },
  disabled: {
    opacity: 0.65,
  },
  emptyText: {
    color: palette.textMuted,
    lineHeight: 20,
  },
  txRow: {
    backgroundColor: palette.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  txTitle: {
    color: palette.text,
    fontWeight: "800",
  },
  txMeta: {
    color: palette.textMuted,
    marginTop: 4,
  },
  txAmount: {
    fontWeight: "800",
  },
  txSend: {
    color: palette.danger,
  },
  txReceive: {
    color: palette.success,
  },
});
