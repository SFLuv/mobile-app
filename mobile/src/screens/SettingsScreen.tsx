import React, { useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { AppImprover, AppUser, AppWallet } from "../types/app";
import { AppPreferences, SendFlowEntryMode, ThemePreference } from "../types/preferences";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  improver?: AppImprover | null;
  wallets: AppWallet[];
  primaryWalletAddress?: string;
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
  onLinkGoogle?: () => void;
  onDisconnectGoogle?: () => void;
  appleLinked?: boolean;
  appleLinkedEmail?: string;
  appleLinkBusy?: boolean;
  appleLinkMessage?: string | null;
  appleCanDisconnect?: boolean;
  appleDisconnectDisabledReason?: string | null;
  onLinkApple?: () => void;
  onDisconnectApple?: () => void;
  onUpdateImproverRewardsWallet?: (address: string) => Promise<void>;
  onOpenImprover?: () => void;
  onDeleteAccount?: () => void;
  onLogout?: () => void;
};

type SettingsSection = "general" | "wallets" | "account" | "improver";

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

function formatStatusLabel(value?: string | null): string {
  if (!value) {
    return "";
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "paid_out") {
    return "Finalized";
  }
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
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

function SendFlowOption({
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

function SocialAccountRow({
  provider,
  iconName,
  iconColor,
  linked,
  description,
  email,
  message,
  disabledReason,
  buttonLabel,
  buttonBusyLabel,
  busy,
  buttonDisabled,
  actionVariant,
  onPress,
}: {
  provider: string;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  linked: boolean;
  description: string;
  email?: string;
  message?: string | null;
  disabledReason?: string | null;
  buttonLabel: string;
  buttonBusyLabel: string;
  busy?: boolean;
  buttonDisabled?: boolean;
  actionVariant: "outline" | "primary";
  onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);

  return (
    <View style={styles.socialRow}>
      <View style={styles.socialRowHeader}>
        <View style={styles.socialIdentityWrap}>
          <View style={styles.socialIconBadge}>
            <Ionicons name={iconName} size={24} color={iconColor} />
          </View>
          <View style={styles.socialCopy}>
            <Text style={styles.socialProviderTitle}>{provider}</Text>
            <Text style={styles.socialProviderBody}>{description}</Text>
            {email ? <Text style={styles.socialProviderMeta}>{provider} email: {email}</Text> : null}
            {disabledReason ? <Text style={styles.socialProviderMeta}>{disabledReason}</Text> : null}
            {message ? <Text style={styles.socialProviderMeta}>{message}</Text> : null}
          </View>
        </View>
        <Pressable
          style={[
            styles.socialActionButton,
            actionVariant === "primary" ? styles.socialActionButtonPrimary : undefined,
            busy || buttonDisabled ? styles.buttonDisabled : undefined,
          ]}
          disabled={busy || buttonDisabled || !onPress}
          onPress={onPress}
        >
          <View style={styles.socialActionContent}>
            <Ionicons
              name={iconName}
              size={18}
              color={actionVariant === "primary" ? palette.white : palette.text}
            />
            <Text
              style={[
                styles.socialActionButtonText,
                actionVariant === "primary" ? styles.socialActionButtonTextPrimary : undefined,
              ]}
            >
              {busy ? buttonBusyLabel : buttonLabel}
            </Text>
          </View>
        </Pressable>
      </View>
      {linked ? <View style={styles.socialLinkedPill}><Text style={styles.socialLinkedPillText}>Linked</Text></View> : null}
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
  improver,
  wallets,
  primaryWalletAddress,
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
  onLinkGoogle,
  onDisconnectGoogle,
  appleLinked,
  appleLinkedEmail,
  appleLinkBusy,
  appleLinkMessage,
  appleCanDisconnect,
  appleDisconnectDisabledReason,
  onLinkApple,
  onDisconnectApple,
  onUpdateImproverRewardsWallet,
  onOpenImprover,
  onDeleteAccount,
  onLogout,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [section, setSection] = useState<SettingsSection>("general");
  const [rewardsWalletDraft, setRewardsWalletDraft] = useState(
    improver?.primaryRewardsAccount?.trim() || primaryWalletAddress || "",
  );
  const [improverBusy, setImproverBusy] = useState(false);
  const [improverMessage, setImproverMessage] = useState<string | null>(null);
  const [improverError, setImproverError] = useState<string | null>(null);

  const hasImproverSection = Boolean(onOpenImprover || improver || user?.isImprover);
  const isApprovedImprover = Boolean(user?.isImprover || improver?.status === "approved");

  const applyThemePreference = (themePreference: ThemePreference) => {
    onUpdatePreferences({ ...preferences, themePreference });
  };

  const applyDefaultSendEntryMode = (defaultSendEntryMode: SendFlowEntryMode) => {
    onUpdatePreferences({ ...preferences, defaultSendEntryMode });
  };

  useEffect(() => {
    if (!hasImproverSection && section === "improver") {
      setSection("account");
    }
  }, [hasImproverSection, section]);

  useEffect(() => {
    setRewardsWalletDraft(improver?.primaryRewardsAccount?.trim() || primaryWalletAddress || "");
  }, [improver?.primaryRewardsAccount, primaryWalletAddress]);

  const normalizedPrimaryWallet = primaryWalletAddress?.toLowerCase();
  const saveRewardsWalletDisabled =
    improverBusy || !rewardsWalletDraft.trim() || !onUpdateImproverRewardsWallet;
  const googleLinkedNow = Boolean(googleLinked);
  const appleLinkedNow = Boolean(appleLinked);

  const handleSaveImproverRewardsWallet = async () => {
    if (!onUpdateImproverRewardsWallet) {
      return;
    }

    const trimmedAddress = rewardsWalletDraft.trim();
    if (!trimmedAddress) {
      setImproverError("Enter a rewards wallet address.");
      setImproverMessage(null);
      return;
    }
    if (!ethers.utils.isAddress(trimmedAddress)) {
      setImproverError("Enter a valid rewards wallet address.");
      setImproverMessage(null);
      return;
    }

    setImproverBusy(true);
    setImproverError(null);
    setImproverMessage(null);
    try {
      await onUpdateImproverRewardsWallet(ethers.utils.getAddress(trimmedAddress));
      setImproverMessage("Improver rewards wallet updated.");
    } catch (error) {
      setImproverError((error as Error)?.message || "Unable to update the rewards wallet.");
    } finally {
      setImproverBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.segmentWrap}>
        <Pressable
          style={[styles.segmentButton, section === "general" ? styles.segmentButtonActive : undefined]}
          onPress={() => setSection("general")}
        >
          <Text style={[styles.segmentText, section === "general" ? styles.segmentTextActive : undefined]}>General</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, section === "wallets" ? styles.segmentButtonActive : undefined]}
          onPress={() => setSection("wallets")}
        >
          <Text style={[styles.segmentText, section === "wallets" ? styles.segmentTextActive : undefined]}>Wallets</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, section === "account" ? styles.segmentButtonActive : undefined]}
          onPress={() => setSection("account")}
        >
          <Text style={[styles.segmentText, section === "account" ? styles.segmentTextActive : undefined]}>Account</Text>
        </Pressable>
        {hasImproverSection ? (
          <Pressable
            style={[styles.segmentButton, section === "improver" ? styles.segmentButtonActive : undefined]}
            onPress={() => setSection("improver")}
          >
            <Text style={[styles.segmentText, section === "improver" ? styles.segmentTextActive : undefined]}>Improver</Text>
          </Pressable>
        ) : null}
      </View>

      {section === "general" ? (
        <>
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
            <View style={styles.preferenceStack}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>Send flow</Text>
                <Text style={styles.preferenceBody}>Choose whether Send opens on manual entry or QR scan first.</Text>
              </View>
              <View style={styles.themeRow}>
                <SendFlowOption
                  label="Manual"
                  active={preferences.defaultSendEntryMode === "manual"}
                  onPress={() => applyDefaultSendEntryMode("manual")}
                />
                <SendFlowOption
                  label="QR scan"
                  active={preferences.defaultSendEntryMode === "scan"}
                  onPress={() => applyDefaultSendEntryMode("scan")}
                />
              </View>
            </View>
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
        </>
      ) : null}

      {section === "wallets" ? (
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
      ) : null}

      {section === "account" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{user?.name || "SFLUV User"}</Text>
            <Text style={styles.meta}>User ID: {user?.id || "Not loaded"}</Text>
            {user?.contactEmail ? <Text style={styles.meta}>Email: {user.contactEmail}</Text> : null}
            {user?.contactPhone ? <Text style={styles.meta}>Phone: {user.contactPhone}</Text> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Link Socials</Text>
            <Text style={styles.body}>Manage the Google and Apple sign-in methods attached to this account.</Text>
            <SocialAccountRow
              provider="Google"
              iconName="logo-google"
              iconColor={palette.primaryStrong}
              linked={googleLinkedNow}
              description={
                googleLinkedNow
                  ? "Google is linked to this account for future sign-ins."
                  : "Link Google so future Google sign-ins land on this account."
              }
              email={googleLinkedEmail}
              message={googleMessage}
              disabledReason={googleLinkedNow ? googleDisconnectDisabledReason : null}
              buttonLabel={
                googleLinkedNow
                  ? googleCanDisconnect
                    ? "Disconnect Google"
                    : "Google linked"
                  : "Link Google"
              }
              buttonBusyLabel={googleLinkedNow ? "Disconnecting Google..." : "Linking Google..."}
              busy={googleActionBusy}
              buttonDisabled={googleLinkedNow ? !googleCanDisconnect : !onLinkGoogle}
              actionVariant={googleLinkedNow ? "outline" : "primary"}
              onPress={googleLinkedNow ? onDisconnectGoogle : onLinkGoogle}
            />
            <View style={styles.socialDivider} />
            <SocialAccountRow
              provider="Apple"
              iconName="logo-apple"
              iconColor={palette.text}
              linked={appleLinkedNow}
              description={
                appleLinkedNow
                  ? "Apple is linked to this account for future sign-ins."
                  : "Link Apple so future Apple sign-ins land on this account."
              }
              email={appleLinkedEmail}
              message={appleLinkMessage}
              disabledReason={appleLinkedNow ? appleDisconnectDisabledReason : null}
              buttonLabel={
                appleLinkedNow
                  ? appleCanDisconnect
                    ? "Disconnect Apple"
                    : "Apple linked"
                  : "Link Apple"
              }
              buttonBusyLabel={appleLinkedNow ? "Disconnecting Apple..." : "Linking Apple..."}
              busy={appleLinkBusy}
              buttonDisabled={appleLinkedNow ? !appleCanDisconnect : !onLinkApple}
              actionVariant={appleLinkedNow ? "outline" : "primary"}
              onPress={appleLinkedNow ? onDisconnectApple : onLinkApple}
            />
          </View>

          {onLogout ? (
            <Pressable style={styles.logoutButton} onPress={onLogout}>
              <Text style={styles.logoutButtonText}>Log out</Text>
            </Pressable>
          ) : null}

          {onDeleteAccount ? (
            <View style={[styles.card, styles.deleteAccountCard]}>
              <View style={styles.dangerZoneHeader}>
                <Ionicons name="warning-outline" size={18} color={palette.danger} />
                <Text style={styles.dangerZoneTitle}>Danger Zone</Text>
              </View>
              <Text style={styles.body}>
                Delete your account and log out. Your account stays recoverable for 30 days, but any SFLUV in your accessible wallets will be transferred out before the deletion request is submitted.
              </Text>
              <Text style={styles.dangerZoneNote}>Only use this if you really want to remove this account.</Text>
              {accountDeletionMessage ? <Text style={styles.inlineError}>{accountDeletionMessage}</Text> : null}
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
        </>
      ) : null}

      {section === "improver" ? (
        <>
          {onOpenImprover && !isApprovedImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Improver Access</Text>
              <Text style={styles.body}>
                {improver
                  ? "View your improver request and finish any remaining setup steps."
                  : "Request improver status and manage the verified email used for approval."}
              </Text>
              {improver ? <Text style={styles.meta}>Status: {formatStatusLabel(improver.status)}</Text> : null}
              {improver?.email ? <Text style={styles.meta}>Improver email: {improver.email}</Text> : null}
              <Pressable style={[styles.primaryActionButton, styles.settingsWideButton]} onPress={onOpenImprover}>
                <Text style={styles.primaryActionButtonText}>
                  {improver ? "View improver request" : "Request improver status"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {improver || user?.isImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Improver Profile</Text>
              <Text style={styles.body}>Manage the wallet used for improver payouts and review the improver profile tied to this account.</Text>
              {improver ? <Text style={styles.meta}>Status: {formatStatusLabel(improver.status)}</Text> : null}
              {improver?.email ? <Text style={styles.meta}>Improver email: {improver.email}</Text> : null}
              <Text style={styles.meta}>Rewards wallet: {shortAddress(improver?.primaryRewardsAccount || rewardsWalletDraft || "Not set")}</Text>
              <Text style={styles.meta}>Primary app wallet: {shortAddress(primaryWalletAddress || "Not set")}</Text>
              <TextInput
                style={styles.walletNameInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Improver rewards wallet"
                placeholderTextColor={palette.textMuted}
                value={rewardsWalletDraft}
                onChangeText={(value) => {
                  setRewardsWalletDraft(value);
                  if (improverError || improverMessage) {
                    setImproverError(null);
                    setImproverMessage(null);
                  }
                }}
              />
              <View style={styles.improverWalletActionRow}>
                <Pressable
                  style={[
                    styles.primaryActionButton,
                    styles.settingsWideButton,
                    saveRewardsWalletDisabled ? styles.buttonDisabled : undefined,
                  ]}
                  disabled={saveRewardsWalletDisabled}
                  onPress={() => {
                    void handleSaveImproverRewardsWallet();
                  }}
                >
                  <Text style={styles.primaryActionButtonText}>
                    {improverBusy ? "Saving..." : "Save rewards wallet"}
                  </Text>
                </Pressable>
                {primaryWalletAddress ? (
                  <Pressable
                    style={[styles.secondaryButton, styles.settingsWideButton]}
                    onPress={() => {
                      setRewardsWalletDraft(primaryWalletAddress);
                      setImproverError(null);
                      setImproverMessage(null);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Use primary wallet</Text>
                  </Pressable>
                ) : null}
              </View>
              {improverError ? <Text style={styles.inlineError}>{improverError}</Text> : null}
              {improverMessage ? <Text style={styles.inlineSuccess}>{improverMessage}</Text> : null}
            </View>
          ) : null}
        </>
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
      letterSpacing: 0,
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
    segmentWrap: {
      flexDirection: "row",
      gap: spacing.xs,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    segmentButton: {
      flex: 1,
      borderRadius: radii.md,
      paddingVertical: 12,
      alignItems: "center",
    },
    segmentButtonActive: {
      backgroundColor: palette.primary,
    },
    segmentText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 12,
    },
    segmentTextActive: {
      color: palette.white,
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
    preferenceStack: {
      gap: spacing.sm,
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
    socialRow: {
      gap: spacing.sm,
    },
    socialRowHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    socialIdentityWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    socialIconBadge: {
      width: 56,
      height: 56,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    socialCopy: {
      flex: 1,
      gap: 4,
    },
    socialProviderTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "900",
    },
    socialProviderBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    socialProviderMeta: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    socialActionButton: {
      minHeight: 48,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      alignSelf: "flex-start",
    },
    socialActionButtonPrimary: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    socialActionContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    socialActionButtonText: {
      color: palette.text,
      fontWeight: "800",
    },
    socialActionButtonTextPrimary: {
      color: palette.white,
    },
    socialLinkedPill: {
      alignSelf: "flex-start",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    socialLinkedPillText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    socialDivider: {
      height: 1,
      backgroundColor: palette.border,
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
    improverWalletActionRow: {
      gap: spacing.sm,
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
    settingsWideButton: {
      flex: 0,
      width: "100%",
      minHeight: 48,
      borderRadius: radii.lg,
      paddingVertical: 12,
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
    dangerZoneHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    dangerZoneTitle: {
      color: palette.danger,
      fontSize: 18,
      fontWeight: "900",
    },
    dangerZoneNote: {
      color: palette.danger,
      lineHeight: 20,
      fontWeight: "700",
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
