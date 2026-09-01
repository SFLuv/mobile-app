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

  const hasEscrow = status.escrowedCount > 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="document-text-outline" size={18} color={palette.primaryStrong} />
        <Text style={styles.title}>Complete your W-9 to get paid</Text>
      </View>

      {hasEscrow ? (
        <>
          {/*
            The amount, and nothing qualifying it. No countdown, because escrow
            used to expire into an admin queue and cannot now — inventing
            urgency that no longer exists would be a lie told for conversion.
            No count of rewards either: how the total is divided up is our
            bookkeeping, not something the person waiting on it has to parse.
          */}
          <Text style={styles.amount}>{status.escrowedSfluv} SFLUV</Text>
        </>
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
