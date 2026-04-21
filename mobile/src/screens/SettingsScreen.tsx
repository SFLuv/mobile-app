import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { AppUser, AppWallet } from "../types/app";
import { AppPreferences, ThemePreference } from "../types/preferences";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  wallets: AppWallet[];
  primaryWalletAddress?: string;
  activeWalletAddress?: string;
  activeWalletLabel?: string;
  syncNotice?: string | null;
  preferences: AppPreferences;
  notificationPermissionStatus: "unknown" | "undetermined" | "granted" | "denied" | "unavailable";
  notificationSyncState: "idle" | "syncing" | "success" | "error";
  notificationTokenRegistered: boolean;
  notificationAddressCount: number;
  notificationSubscribedCount: number;
  notificationStatusMessage?: string | null;
  onSyncNotifications: () => void;
  onUpdatePreferences: (next: AppPreferences) => void;
  onRenameWallet: (wallet: AppWallet, nextName: string) => Promise<void>;
  onSetPrimaryWallet: (address: string) => Promise<void>;
  onSetWalletVisibility: (wallet: AppWallet, shouldShow: boolean) => Promise<void>;
  accountDeletionBusy?: boolean;
  accountDeletionMessage?: string | null;
  googleLinked?: boolean;
  googleLinkedEmail?: string;
  googleActionBusy?: boolean;
  googleMessage?: string | null;
  googleCanDisconnect?: boolean;
  googleDisconnectDisabledReason?: string | null;
  onDisconnectGoogle?: () => void;
  appleLinked?: boolean;
  appleLinkedEmail?: string;
  appleLinkBusy?: boolean;
  appleLinkMessage?: string | null;
  appleCanDisconnect?: boolean;
  appleDisconnectDisabledReason?: string | null;
  onLinkApple?: () => void;
  onDisconnectApple?: () => void;
  onDeleteAccount?: () => void;
  onLogout?: () => void;
};

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function walletFallbackName(wallet: AppWallet): string {
  if (wallet.isEoa) {
    return "Embedded owner wallet";
  }
  if (typeof wallet.smartIndex === "number") {
    return `Wallet ${wallet.smartIndex + 1}`;
  }
  return "Wallet";
}

function walletDisplayName(wallet: AppWallet): string {
  const trimmedName = wallet.name.trim();
  return trimmedName || walletFallbackName(wallet);
}

function walletAddress(wallet: AppWallet): string {
  return wallet.smartAddress ?? wallet.eoaAddress;
}

function formatPermissionStatus(status: Props["notificationPermissionStatus"]): string {
  switch (status) {
    case "granted":
      return "Allowed";
    case "denied":
      return "Blocked";
    case "undetermined":
      return "Not decided";
    case "unavailable":
      return "Device required";
    default:
      return "Checking";
  }
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

function WalletSettingsRow({
  wallet,
  isPrimary,
  onRenameWallet,
  onSetPrimaryWallet,
  onSetWalletVisibility,
}: {
  wallet: AppWallet;
  isPrimary: boolean;
  onRenameWallet: (wallet: AppWallet, nextName: string) => Promise<void>;
  onSetPrimaryWallet: (address: string) => Promise<void>;
  onSetWalletVisibility: (wallet: AppWallet, shouldShow: boolean) => Promise<void>;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const [draftName, setDraftName] = useState(walletDisplayName(wallet));
  const [saveState, setSaveState] = useState<{
    nameSaving: boolean;
    visibilitySaving: boolean;
    primarySaving: boolean;
    error: string;
    success: string;
  }>({
    nameSaving: false,
    visibilitySaving: false,
    primarySaving: false,
    error: "",
    success: "",
  });

  useEffect(() => {
    setDraftName(walletDisplayName(wallet));
  }, [wallet.name, wallet.isEoa, wallet.smartIndex]);

  const isVisible = !wallet.isHidden;
  const editableName = draftName.trim();
  const canPersistWallet = typeof wallet.id === "number";
  const canSaveName = canPersistWallet && editableName.length > 0 && editableName !== walletDisplayName(wallet);
  const address = walletAddress(wallet);

  const setError = (message: string) => {
    setSaveState((current) => ({ ...current, error: message, success: "" }));
  };

  const setSuccess = (message: string) => {
    setSaveState((current) => ({ ...current, success: message, error: "" }));
  };

  return (
    <View style={styles.walletRow}>
      <View style={styles.walletRowHeader}>
        <View style={styles.walletRowBadges}>
          <View style={styles.walletTypePill}>
            <Text style={styles.walletTypePillText}>{wallet.isEoa ? "Owner" : "Smart wallet"}</Text>
          </View>
          {isPrimary ? (
            <View style={styles.primaryPill}>
              <Text style={styles.primaryPillText}>Primary</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.walletRowAddress}>{shortAddress(address)}</Text>
      </View>

      <TextInput
        style={styles.walletNameInput}
        value={draftName}
        onChangeText={(value) => {
          setDraftName(value);
          if (saveState.error || saveState.success) {
            setSaveState((current) => ({ ...current, error: "", success: "" }));
          }
        }}
        placeholder={walletFallbackName(wallet)}
        placeholderTextColor={palette.textMuted}
      />

      <View style={styles.walletActionRow}>
        <Pressable
          style={[styles.secondaryButton, !canSaveName || saveState.nameSaving ? styles.buttonDisabled : undefined]}
          disabled={!canSaveName || saveState.nameSaving}
          onPress={() => {
            setSaveState((current) => ({ ...current, nameSaving: true, error: "", success: "" }));
            void onRenameWallet(wallet, editableName)
              .then(() => {
                setSaveState((current) => ({ ...current, nameSaving: false }));
                setSuccess("Wallet name updated.");
              })
              .catch((error) => {
                setSaveState((current) => ({ ...current, nameSaving: false }));
                setError((error as Error)?.message || "Unable to update wallet name.");
              });
          }}
        >
          <Text style={styles.secondaryButtonText}>{saveState.nameSaving ? "Saving..." : "Save name"}</Text>
        </Pressable>

        <Pressable
          style={[styles.primaryActionButton, (isPrimary || saveState.primarySaving) ? styles.buttonDisabled : undefined]}
          disabled={isPrimary || saveState.primarySaving}
          onPress={() => {
            setSaveState((current) => ({ ...current, primarySaving: true, error: "", success: "" }));
            void onSetPrimaryWallet(address)
              .then(() => {
                setSaveState((current) => ({ ...current, primarySaving: false }));
                setSuccess("Primary wallet updated.");
              })
              .catch((error) => {
                setSaveState((current) => ({ ...current, primarySaving: false }));
                setError((error as Error)?.message || "Unable to update primary wallet.");
              });
          }}
        >
          <Text style={styles.primaryActionButtonText}>
            {saveState.primarySaving ? "Saving..." : isPrimary ? "Primary wallet" : "Set primary"}
          </Text>
        </Pressable>
      </View>

      {!wallet.isEoa ? (
        <View style={styles.visibilityRow}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>Show in wallet chooser</Text>
            <Text style={styles.preferenceBody}>Controls whether this smart wallet appears in the mobile wallet picker.</Text>
          </View>
          <Switch
            trackColor={{ false: palette.borderStrong, true: "#f5a59f" }}
            thumbColor={isVisible ? palette.primaryStrong : palette.white}
            value={isVisible}
            disabled={saveState.visibilitySaving || !canPersistWallet}
            onValueChange={(next) => {
              setSaveState((current) => ({ ...current, visibilitySaving: true, error: "", success: "" }));
              void onSetWalletVisibility(wallet, next)
                .then(() => {
                  setSaveState((current) => ({ ...current, visibilitySaving: false }));
                  setSuccess("Wallet display updated.");
                })
                .catch((error) => {
                  setSaveState((current) => ({ ...current, visibilitySaving: false }));
                  setError((error as Error)?.message || "Unable to update wallet visibility.");
                });
            }}
          />
        </View>
      ) : (
        <Text style={styles.walletHelperText}>The owner wallet is used for account bootstrap and is not shown in the smart-wallet chooser.</Text>
      )}

      {saveState.error ? <Text style={styles.inlineError}>{saveState.error}</Text> : null}
      {saveState.success ? <Text style={styles.inlineSuccess}>{saveState.success}</Text> : null}
    </View>
  );
}

export function SettingsScreen({
  user,
  wallets,
  primaryWalletAddress,
  activeWalletAddress,
  activeWalletLabel,
  syncNotice,
  preferences,
  notificationPermissionStatus,
  notificationSyncState,
  notificationTokenRegistered,
  notificationAddressCount,
  notificationSubscribedCount,
  notificationStatusMessage,
  onSyncNotifications,
  onUpdatePreferences,
  onRenameWallet,
  onSetPrimaryWallet,
  onSetWalletVisibility,
  accountDeletionBusy,
  accountDeletionMessage,
  googleLinked,
  googleLinkedEmail,
  googleActionBusy,
  googleMessage,
  googleCanDisconnect,
  googleDisconnectDisabledReason,
  onDisconnectGoogle,
  appleLinked,
  appleLinkedEmail,
  appleLinkBusy,
  appleLinkMessage,
  appleCanDisconnect,
  appleDisconnectDisabledReason,
  onLinkApple,
  onDisconnectApple,
  onDeleteAccount,
  onLogout,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const applyThemePreference = (themePreference: ThemePreference) => {
    onUpdatePreferences({ ...preferences, themePreference });
  };

  const normalizedPrimaryWallet = primaryWalletAddress?.toLowerCase();

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>App preferences, wallet defaults, and display settings for the account you currently have open.</Text>
      </View>

      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <Text style={styles.body}>System now follows your phone preference, while light and dark remain manual overrides on this device.</Text>
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
        <View style={styles.pushStatusCard}>
          <View style={styles.pushStatusHeader}>
            <Text style={styles.pushStatusTitle}>Push status</Text>
            <Pressable
              style={[styles.syncButton, notificationSyncState === "syncing" ? styles.buttonDisabled : undefined]}
              disabled={notificationSyncState === "syncing"}
              onPress={onSyncNotifications}
            >
              <Text style={styles.syncButtonText}>{notificationSyncState === "syncing" ? "Syncing..." : "Sync now"}</Text>
            </Pressable>
          </View>
          <Text style={styles.pushStatusMeta}>System permission: {formatPermissionStatus(notificationPermissionStatus)}</Text>
          <Text style={styles.pushStatusMeta}>Device token: {notificationTokenRegistered ? "Registered" : "Missing"}</Text>
          <Text style={styles.pushStatusMeta}>
            Wallet subscriptions: {notificationSubscribedCount} / {notificationAddressCount}
          </Text>
          {notificationStatusMessage ? <Text style={styles.pushStatusMessage}>{notificationStatusMessage}</Text> : null}
        </View>
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
        {activeWalletLabel ? <Text style={styles.currentWalletLabel}>{activeWalletLabel}</Text> : null}
        <Text style={styles.walletAddress}>{activeWalletAddress ? shortAddress(activeWalletAddress) : "Wallet not loaded yet"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Wallet settings</Text>
        <Text style={styles.body}>Wallet names come from the shared backend. You can rename them here, choose your primary wallet, and decide which smart wallets appear in the chooser.</Text>
        {wallets.length === 0 ? (
          <Text style={styles.meta}>No wallets are loaded yet.</Text>
        ) : (
          wallets.map((wallet) => (
            <WalletSettingsRow
              key={`${wallet.id ?? walletAddress(wallet)}:${walletAddress(wallet)}`}
              wallet={wallet}
              isPrimary={walletAddress(wallet).toLowerCase() === normalizedPrimaryWallet}
              onRenameWallet={onRenameWallet}
              onSetPrimaryWallet={onSetPrimaryWallet}
              onSetWalletVisibility={onSetWalletVisibility}
            />
          ))
        )}
      </View>

      {onLogout ? (
        <Pressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutButtonText}>Log out</Text>
        </Pressable>
      ) : null}

      {googleLinked ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Google sign-in</Text>
          <Text style={styles.body}>
            Google is linked to this account for future sign-ins.
          </Text>
          {googleLinkedEmail ? <Text style={styles.meta}>Google email: {googleLinkedEmail}</Text> : null}
          {googleDisconnectDisabledReason ? (
            <Text style={styles.meta}>{googleDisconnectDisabledReason}</Text>
          ) : null}
          {googleMessage ? <Text style={styles.inlineError}>{googleMessage}</Text> : null}
          <Pressable
            style={[
              styles.primaryActionButton,
              googleActionBusy || !googleCanDisconnect ? styles.buttonDisabled : undefined,
            ]}
            disabled={googleActionBusy || !googleCanDisconnect}
            onPress={onDisconnectGoogle}
          >
            <Text style={styles.primaryActionButtonText}>
              {googleCanDisconnect
                ? googleActionBusy
                  ? "Disconnecting..."
                  : "Disconnect Google"
                : "Google linked"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {onLinkApple ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Apple sign-in</Text>
          <Text style={styles.body}>
            {appleLinked
              ? "Apple is linked to this account for future Apple sign-ins."
              : "Link Apple so future Apple sign-ins land on this account."}
          </Text>
          {appleLinkedEmail ? <Text style={styles.meta}>Apple email: {appleLinkedEmail}</Text> : null}
          {appleDisconnectDisabledReason ? (
            <Text style={styles.meta}>{appleDisconnectDisabledReason}</Text>
          ) : null}
          {appleLinkMessage ? <Text style={styles.inlineError}>{appleLinkMessage}</Text> : null}
          <Pressable
            style={[
              styles.primaryActionButton,
              appleLinkBusy || (appleLinked ? !appleCanDisconnect : false) ? styles.buttonDisabled : undefined,
            ]}
            disabled={appleLinkBusy || (appleLinked ? !appleCanDisconnect : false)}
            onPress={appleLinked ? onDisconnectApple : onLinkApple}
          >
            <Text style={styles.primaryActionButtonText}>
              {appleLinked
                ? appleCanDisconnect
                  ? appleLinkBusy
                    ? "Disconnecting..."
                    : "Disconnect Apple"
                  : "Apple linked"
                : appleLinkBusy
                  ? "Linking..."
                  : "Link Apple"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {onDeleteAccount ? (
        <View style={[styles.card, styles.deleteAccountCard]}>
          <Text style={styles.sectionTitle}>Delete account</Text>
          <Text style={styles.body}>
            Delete your account and log out. Your account will be recoverable for the next 30 days,
            but any SFLUV in your accessible wallets will be transferred out of your account before
            the deletion request is submitted.
          </Text>
          {accountDeletionMessage ? (
            <Text style={styles.inlineError}>{accountDeletionMessage}</Text>
          ) : null}
          <Pressable
            style={[styles.deleteAccountButton, accountDeletionBusy ? styles.buttonDisabled : undefined]}
            disabled={accountDeletionBusy}
            onPress={onDeleteAccount}
          >
            <Text style={styles.deleteAccountButtonText}>
              {accountDeletionBusy ? "Preparing..." : "Delete account"}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
    currentWalletLabel: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
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
    pushStatusCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
      gap: spacing.xs,
    },
    pushStatusHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    pushStatusTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    pushStatusMeta: {
      color: palette.textMuted,
      lineHeight: 19,
    },
    pushStatusMessage: {
      color: palette.text,
      lineHeight: 20,
      fontWeight: "600",
    },
    syncButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    syncButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 13,
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
    walletRow: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    walletRowHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    walletRowBadges: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    walletTypePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    walletTypePillText: {
      color: palette.textMuted,
      fontWeight: "700",
      fontSize: 12,
    },
    primaryPill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    primaryPillText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    walletRowAddress: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },
    walletNameInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      backgroundColor: palette.surfaceStrong,
      color: palette.text,
      fontSize: 16,
      fontWeight: "700",
    },
    walletActionRow: {
      flexDirection: "row",
      gap: 10,
    },
    secondaryButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    secondaryButtonText: {
      color: palette.text,
      fontWeight: "800",
    },
    primaryActionButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: radii.md,
      backgroundColor: palette.primary,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    primaryActionButtonText: {
      color: palette.white,
      fontWeight: "900",
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    visibilityRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    walletHelperText: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    inlineError: {
      color: palette.danger,
      lineHeight: 20,
    },
    inlineSuccess: {
      color: palette.success,
      lineHeight: 20,
    },
    logoutButton: {
      minHeight: 52,
      marginTop: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: palette.primaryMuted,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    logoutButtonText: {
      color: palette.danger,
      fontWeight: "900",
      fontSize: 15,
    },
    deleteAccountCard: {
      borderColor: palette.danger,
      backgroundColor: palette.surface,
    },
    deleteAccountButton: {
      minHeight: 48,
      borderRadius: radii.md,
      backgroundColor: palette.danger,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    deleteAccountButtonText: {
      color: palette.white,
      fontWeight: "900",
      fontSize: 15,
    },
  });
}
