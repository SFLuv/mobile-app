import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../theme";
import type { AppW9Status } from "../types/app";

type Props = {
  status: AppW9Status | null;
  busy?: boolean;
  onStart: () => void;
};

/**
 * How long is left before the automatic window closes.
 *
 * Stated plainly because crossing that line changes what happens: before it,
 * filing releases the money by itself; after it, somebody has to send it by
 * hand. A deadline nobody was told about reads as a bait and switch.
 */
function remainingLabel(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `about ${Math.max(hours, 1)}h left`;
  return `${Math.round(hours / 24)} days left`;
}

/**
 * The tax card: what is being held, why, and the one action that releases it.
 *
 * Shown on the volunteer and improver panels. Owing a W-9 is not tied to either
 * role — anyone who earns past the threshold owes one — but those are the two
 * places people go after doing the work that earned it.
 */
export function W9EscrowCard({ status, busy, onStart }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  if (!status || !status.required || status.cleared) {
    return null;
  }

  const remaining = remainingLabel(status.escrowExpiresAt);
  const hasBackPay = status.backPayCount > 0;
  const hasEscrow = status.escrowedCount > 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="document-text-outline" size={18} color={palette.primaryStrong} />
        <Text style={styles.title}>Complete your W-9 to get paid</Text>
      </View>

      {hasEscrow ? (
        <>
          <Text style={styles.amount}>{status.escrowedSfluv} SFLUV</Text>
          <Text style={styles.body}>
            waiting across {status.escrowedCount} reward{status.escrowedCount === 1 ? "" : "s"}
            {remaining ? ` · ${remaining}` : ""}
          </Text>
        </>
      ) : null}

      {hasBackPay ? (
        <View style={styles.backPayRow}>
          <Text style={styles.backPayAmount}>{status.backPaySfluv} SFLUV</Text>
          <Text style={styles.backPayNote}>
            {/* Honest about the slower path rather than implying it is automatic. */}
            held too long to send automatically — we'll arrange this once your form is in
          </Text>
        </View>
      ) : null}

      <Text style={styles.body}>
        You've earned over {status.thresholdSfluv} SFLUV this year, so we need a W-9 on file before we
        can send it. It takes a couple of minutes.
      </Text>

      <Pressable style={styles.button} onPress={onStart} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <Text style={styles.buttonText}>Complete tax form</Text>
        )}
      </Pressable>
    </View>
  );
}

function createStyles(palette: ReturnType<typeof useAppTheme>["palette"]) {
  return StyleSheet.create({
    card: {
      backgroundColor: palette.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: palette.primaryStrong,
      gap: 6,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 15, fontWeight: "700", color: palette.text, flexShrink: 1 },
    amount: { fontSize: 28, fontWeight: "800", color: palette.text, marginTop: 4 },
    body: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
    backPayRow: {
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      gap: 2,
    },
    backPayAmount: { fontSize: 16, fontWeight: "700", color: palette.text },
    backPayNote: { fontSize: 12, color: palette.textMuted, lineHeight: 16 },
    button: {
      marginTop: 10,
      backgroundColor: palette.primaryStrong,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
    },
    buttonText: { color: palette.white, fontSize: 15, fontWeight: "700" },
  });
}
