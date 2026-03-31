import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { AppUser } from "../types/app";
import { AppPreferences, ThemePreference } from "../types/preferences";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  activeWalletAddress?: string;
  syncNotice?: string | null;
  preferences: AppPreferences;
  onUpdatePreferences: (next: AppPreferences) => void;
};

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function ThemeOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);

  return (
    <Pressable style={[styles.themeOption, active ? styles.themeOptionActive : undefined]} onPress={onPress}>
      <Text style={[styles.themeOptionText, active ? styles.themeOptionTextActive : undefined]}>{label}</Text>
    </Pressable>
  );
}

function PreferenceRow({
  title,
  body,
  value,
  onValueChange,
}: {
  title: string;
  body: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);

  return (
    <View style={styles.preferenceRow}>
      <View style={styles.preferenceCopy}>
        <Text style={styles.preferenceTitle}>{title}</Text>
        <Text style={styles.preferenceBody}>{body}</Text>
      </View>
      <Switch
        trackColor={{ false: palette.borderStrong, true: "#f5a59f" }}
        thumbColor={value ? palette.primaryStrong : palette.white}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}

export function SettingsScreen({ user, activeWalletAddress, syncNotice, preferences, onUpdatePreferences }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const applyThemePreference = (themePreference: ThemePreference) => {
    onUpdatePreferences({ ...preferences, themePreference });
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>App preferences, local device behavior, and the account you currently have open.</Text>
      </View>

      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <Text style={styles.body}>Theme preference is saved on this device and now updates the active app shell live.</Text>
        <View style={styles.themeRow}>
          <ThemeOption label="System" active={preferences.themePreference === "system"} onPress={() => applyThemePreference("system")} />
          <ThemeOption label="Light" active={preferences.themePreference === "light"} onPress={() => applyThemePreference("light")} />
          <ThemeOption label="Dark" active={preferences.themePreference === "dark"} onPress={() => applyThemePreference("dark")} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>App behavior</Text>
        <PreferenceRow
          title="Notifications"
          body="Get phone alerts on this device when money lands in one of your wallets."
          value={preferences.notificationsEnabled}
          onValueChange={(notificationsEnabled) => onUpdatePreferences({ ...preferences, notificationsEnabled })}
        />
        <PreferenceRow
          title="Haptic feedback"
          body="Toggle whether your phone will buzz when you send or receive."
          value={preferences.hapticsEnabled}
          onValueChange={(hapticsEnabled) => onUpdatePreferences({ ...preferences, hapticsEnabled })}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{user?.name || "SFLUV User"}</Text>
        <Text style={styles.meta}>User ID: {user?.id || "Not loaded"}</Text>
        {user?.contactEmail ? <Text style={styles.meta}>Email: {user.contactEmail}</Text> : null}
        {user?.contactPhone ? <Text style={styles.meta}>Phone: {user.contactPhone}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Current wallet</Text>
        <Text style={styles.body}>This is the smart account currently active in the app.</Text>
        <Text style={styles.walletAddress}>{activeWalletAddress ? shortAddress(activeWalletAddress) : "Wallet not loaded yet"}</Text>
      </View>
    </ScrollView>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
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
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    noticeCard: {
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    noticeTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 16,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
    },
    body: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    meta: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    themeRow: {
      flexDirection: "row",
      gap: 8,
    },
    themeOption: {
      flex: 1,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      paddingVertical: 12,
      alignItems: "center",
    },
    themeOptionActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    themeOptionText: {
      color: palette.textMuted,
      fontWeight: "800",
    },
    themeOptionTextActive: {
      color: palette.primaryStrong,
    },
    preferenceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    preferenceCopy: {
      flex: 1,
      gap: 4,
    },
    preferenceTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    preferenceBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    walletAddress: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "900",
      fontFamily: "Courier",
    },
  });
}
