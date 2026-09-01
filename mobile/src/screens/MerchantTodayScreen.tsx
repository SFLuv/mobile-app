import { useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette } from "../theme";
import type { MerchantDayRow, MerchantToday } from "../types/app";

type Props = {
  today: MerchantToday | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  locationName?: string;
  tokenSymbol: string;
  /** Offered only when the merchant has more than one shop to switch between. */
  canSwitchLocation?: boolean;
  onSwitchLocation?: () => void;
};

/** Base units to a display string. One conversion, at the edge, so nothing rounds twice. */
export function formatBase(base: string, decimals: number): string {
  const negative = base.startsWith("-");
  const digits = (negative ? base.slice(1) : base).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "";

  // Whole numbers are the common case at a till; trailing ".00" is noise.
  const trimmed = fraction.replace(/0+$/, "");
  const withGrouping = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${withGrouping}${trimmed ? `.${trimmed}` : ""}`;
}

function timeOfDay(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Row({ row, decimals }: { row: MerchantDayRow; decimals: number }) {
  const tip = row.tipBase !== "0" ? formatBase(row.tipBase, decimals) : null;

  return (
    <View style={styles.row}>
      <Text style={styles.rowTime}>{timeOfDay(row.at)}</Text>
      <View style={styles.rowAmounts}>
        <Text style={[styles.rowPayment, row.refund ? styles.rowRefund : undefined]}>
          {formatBase(row.paymentBase, decimals)}
        </Text>
        {tip ? <Text style={styles.rowTip}>+{tip} tip</Text> : null}
        {row.refund ? <Text style={styles.rowRefundLabel}>refund</Text> : null}
      </View>
    </View>
  );
}

/**
 * The merchant-mode home screen: what this till has taken today, and the lines
 * behind it. Deliberately not a wallet — there is no balance, no wallet picker
 * and no send. An employee needs the day, not the account.
 */
export function MerchantTodayScreen({
  today,
  loading,
  refreshing,
  onRefresh,
  locationName,
  tokenSymbol,
  canSwitchLocation,
  onSwitchLocation,
}: Props) {
  const decimals = today?.tokenDecimals ?? 6;
  const rows = useMemo(() => today?.transactions ?? [], [today]);

  if (loading && !today) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.primaryStrong} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primaryStrong} />}
    >
      <View style={styles.paymentsCard}>
        <Text style={styles.paymentsLabel}>TODAY'S PAYMENTS</Text>
        <Text style={styles.paymentsValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
          {formatBase(today?.paymentsBase ?? "0", decimals)}
        </Text>
        <Text style={styles.paymentsSymbol}>{tokenSymbol}</Text>
        {locationName ? (
          canSwitchLocation && onSwitchLocation ? (
            // Sits where the wallet chooser used to be. Opens the counter list;
            // actually moving to a different one asks for the merchant PIN,
            // because the shop decides where the money lands.
            //
            // Labelled explicitly because the chip wraps the name and a swap
            // icon: without it iOS announces "Maestro Test Shop, " — the name
            // with a trailing comma where the icon is, and no clue it does
            // anything.
            <Pressable
              style={styles.locationSwitch}
              accessibilityRole="button"
              accessibilityLabel={locationName}
              accessibilityHint="Move this device to another location"
              onPress={onSwitchLocation}
            >
              <Text style={styles.locationName}>{locationName}</Text>
              <Ionicons name="swap-horizontal" size={14} color={palette.textMuted} />
            </Pressable>
          ) : (
            <Text style={[styles.locationName, styles.locationNamePlain]}>{locationName}</Text>
          )
        ) : null}
      </View>

      <View style={styles.tipsCard}>
        <Text style={styles.tipsLabel}>Tips today</Text>
        {today?.tipsWalletConfigured ? (
          <Text style={styles.tipsValue}>
            {formatBase(today?.tipsBase ?? "0", decimals)} {tokenSymbol}
          </Text>
        ) : (
          // Not "0": a zero here reads as "nobody tipped", when the truth is that
          // no tipping wallet is set up for this location.
          <Text style={styles.tipsUnset}>Not set up</Text>
        )}
      </View>

      <View style={styles.list}>
        {rows.length === 0 ? (
          <Text style={styles.empty}>No payments yet today.</Text>
        ) : (
          rows.map((row, index) => (
            <Row key={`${row.paymentHash ?? row.tipHash ?? "row"}-${index}`} row={row} decimals={decimals} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  paymentsCard: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  paymentsLabel: { fontSize: 12, letterSpacing: 1.2, color: palette.textMuted, fontWeight: "700" },
  paymentsValue: { fontSize: 56, fontWeight: "800", color: palette.text, marginTop: 6 },
  paymentsSymbol: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  locationName: { fontSize: 13, color: palette.textMuted },
  locationNamePlain: { marginTop: 10 },
  locationSwitch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  tipsCard: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tipsLabel: { fontSize: 15, color: palette.textMuted },
  tipsValue: { fontSize: 20, fontWeight: "700", color: palette.text },
  tipsUnset: { fontSize: 14, color: palette.textMuted, fontStyle: "italic" },
  list: { backgroundColor: palette.surface, borderRadius: 16, paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowTime: { fontSize: 14, color: palette.textMuted },
  rowAmounts: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowPayment: { fontSize: 17, fontWeight: "700", color: palette.text },
  rowRefund: { color: palette.danger },
  rowRefundLabel: { fontSize: 12, color: palette.danger },
  rowTip: { fontSize: 14, color: palette.primaryStrong, fontWeight: "600" },
  empty: { padding: 24, textAlign: "center", color: palette.textMuted },
});

export { Ionicons };
