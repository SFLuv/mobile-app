import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type PaymentReceipt = {
  /** Display amount, already converted out of base units. */
  amount: string;
  tokenSymbol: string;
  /** Optional second line — a tip, or who it came from. */
  detail?: string;
};

type Props = {
  receipt: PaymentReceipt | null;
  onDismiss: () => void;
  /** How long the confirmation holds before returning to the till. */
  durationMs?: number;
};

/**
 * The full-screen confirmation a card terminal gives: a green tick, the amount,
 * then back to the till. It exists so the person at the counter can see from
 * arm's length that the payment landed, without reading anything.
 *
 * Driven by the incoming-payment push rather than a poll, so it appears when the
 * money actually arrives instead of up to a poll-interval later.
 */
export function PaymentReceivedOverlay({ receipt, onDismiss, durationMs = 3200 }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!receipt) {
      return;
    }

    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => dismissRef.current(), durationMs);
    return () => clearTimeout(timer);
    // Keyed on the receipt identity: a second payment arriving while this is up
    // restarts the animation and the timer rather than being swallowed.
  }, [receipt, durationMs, progress]);

  if (!receipt) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Animated.View
        style={[
          styles.badge,
          { transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
        ]}
      >
        <Ionicons name="checkmark" size={92} color="#ffffff" />
      </Animated.View>

      <Text style={styles.title}>Payment received</Text>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {receipt.amount} {receipt.tokenSymbol}
      </Text>
      {receipt.detail ? <Text style={styles.detail}>{receipt.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1d8a4e",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    zIndex: 1000,
  },
  badge: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "600", opacity: 0.92 },
  amount: { color: "#ffffff", fontSize: 60, fontWeight: "800", marginTop: 8 },
  detail: { color: "#ffffff", fontSize: 16, opacity: 0.85, marginTop: 12, textAlign: "center" },
});
