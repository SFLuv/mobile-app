import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

/**
 * What a merchant account sees on a phone before it has a till to run.
 *
 * A merchant account never gets the ordinary app here. That is the difference
 * between the two surfaces and it is deliberate: the web app is where a
 * merchant does setup and can look around, a phone is a till. So this screen
 * covers the two states before the till exists, and the only way out of either
 * is forwards or logging out.
 *
 *  - `start`   — nothing applied for. Offers the Location Approval Form.
 *                Reached only by an account that said "merchant" on the web and
 *                has no listing, which in practice means they cancelled their
 *                application or never filed one.
 *  - `pending` — filed and waiting on review. Nothing to do but wait, so the
 *                screen says so rather than handing back an app whose every
 *                write the server would refuse.
 *
 * A rejected-only account gets `start` too: there is nothing on the map, and
 * the way forward is another application.
 */
export function MerchantOnboardingScreen({
  state,
  locationName,
  busy = false,
  onStartApplication,
  onRefresh,
  onLogout,
}: {
  state: "start" | "pending";
  /** Named on the pending screen so it is obvious which listing is waiting. */
  locationName?: string;
  busy?: boolean;
  onStartApplication: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const pending = state === "pending";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {pending ? "Merchant status pending" : "Set up your merchant account"}
        </Text>
        <Text style={styles.body}>
          {pending
            ? `${locationName || "Your location"} is with the SFLuv team. We will email you when it has been reviewed.`
            : "List your business to put it on the SFLuv map and turn this device into a till."}
        </Text>

        {pending ? (
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={onRefresh}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? "Checking..." : "Check again"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={onStartApplication}
          >
            <Text style={styles.primaryButtonText}>Start application</Text>
          </Pressable>
        )}
      </View>

      {/* Both states carry it. This screen is the whole app for these accounts,
          so without it there is no way off it at all. */}
      <Pressable onPress={onLogout} hitSlop={12}>
        <Text style={styles.logout}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: spacing.lg,
      gap: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.background,
    },
    card: {
      width: "100%",
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.md,
      alignItems: "center",
      ...shadows.soft,
    },
    title: {
      color: palette.text,
      fontSize: 22,
      fontWeight: "800",
      textAlign: "center",
    },
    body: {
      color: palette.textMuted,
      lineHeight: 20,
      textAlign: "center",
    },
    primaryButton: {
      alignSelf: "stretch",
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: palette.primary,
    },
    primaryButtonText: { color: palette.surface, fontWeight: "800" },
    buttonDisabled: { opacity: 0.5 },
    logout: { color: palette.danger, fontWeight: "700" },
  });
}
