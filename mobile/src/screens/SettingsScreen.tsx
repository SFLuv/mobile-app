import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  AppCredentialRequest,
  AppGlobalCredentialType,
  AppImprover,
  AppMerchantModeStatus,
  AppMerchantModeLocation,
  AppOwnedLocation,
  AppUser,
  AppVolunteerReminderPreferences,
  AppWallet,
} from "../types/app";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { getClientMetadata } from "../services/clientMetadata";
import {
  DEFAULT_VOLUNTEER_REMINDER_HOURS,
  VOLUNTEER_REMINDER_HOUR_OPTIONS,
} from "../services/appBackend";
import { AppPreferences, SendFlowEntryMode, ThemePreference } from "../types/preferences";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import * as MediaLibrary from "expo-media-library";
import { useTranslation } from "react-i18next";
import i18next, { LanguagePreference, SUPPORTED_LANGUAGES } from "../i18n";
import * as Notifications from "expo-notifications";
import {
  PhoneAccess,
  openPhoneSettings,
  phoneAccessOf,
  useCameraAccess,
  useOnForeground,
} from "../utils/phonePermissions";
import { t } from "../i18n";
import { dirIcon, dirSign } from "../i18n/direction";

type Props = {
  user: AppUser | null;
  tokenSymbol: string;
  improver?: AppImprover | null;
  wallets: AppWallet[];
  ownedLocations?: AppOwnedLocation[];
  /** Shops this device may be enrolled at — approved and with a payment wallet. */
  merchantModeLocations?: AppMerchantModeLocation[];
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
  /** Hides the volunteer preference entirely when the backend cannot serve it. */
  volunteerPanelAvailable?: boolean;
  /** Null until the backend answers; the row stays disabled until then. */
  volunteerReminderPreferences?: AppVolunteerReminderPreferences | null;
  onUpdateVolunteerReminderPreferences?: (next: AppVolunteerReminderPreferences) => void;
  onOpenImproverCredentials?: () => void;
  credentialRequests?: AppCredentialRequest[];
  credentialTypes?: AppGlobalCredentialType[];
  credentialRequestsLoading?: boolean;
  merchantModeStatus?: AppMerchantModeStatus | null;
  merchantModeBusy?: boolean;
  merchantModeMessage?: string | null;
  onSetMerchantModePin?: (pin: string, currentPin?: string) => Promise<void>;
  onEnableMerchantMode?: (locationID: number) => Promise<void>;
  onDeleteAccount?: () => void;
  onLogout?: () => void;
  /** Opens the contact form. Absent when the backend is unavailable. */
  onContactSupport?: () => void;
};

type SettingsSection = "general" | "wallets" | "account" | "merchant" | "improver";

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function walletFallbackName(wallet: AppWallet): string {
  if (wallet.isEoa) {
    return i18next.t("settings.wallets.embeddedOwner");
  }
  if (typeof wallet.smartIndex === "number") {
    return i18next.t("settings.wallets.numbered", { number: wallet.smartIndex + 1 });
  }
  return i18next.t("settings.wallets.wallet");
}

function walletDisplayName(wallet: AppWallet): string {
  const trimmedName = wallet.name.trim();
  return trimmedName || walletFallbackName(wallet);
}

function walletAddress(wallet: AppWallet): string {
  return wallet.smartAddress ?? wallet.eoaAddress;
}

function MerchantPinInput({
  value,
  placeholder,
  visible,
  onToggleVisible,
}: {
  value: string;
  placeholder: string;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const displayValue = value.length > 0 ? (visible ? value : "•".repeat(value.length)) : placeholder;
  const empty = value.length === 0;

  return (
    <View style={styles.pinDisplayRow}>
      <Text style={[styles.pinDisplayText, empty ? styles.pinDisplayPlaceholder : undefined]}>
        {displayValue}
      </Text>
      <Pressable style={styles.pinVisibilityButton} onPress={onToggleVisible}>
        <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={palette.primaryStrong} />
      </Pressable>
    </View>
  );
}

function MerchantPinPad({
  onDigit,
  onBackspace,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["blank", "0", "backspace"],
  ];

  return (
    <View style={styles.pinKeypad}>
      {rows.map((row, rowIndex) => (
        <View key={`pin-row-${rowIndex}`} style={styles.pinKeypadRow}>
          {row.map((key) =>
            key === "blank" ? (
              <View key={key} style={styles.pinKeypadKey} />
            ) : (
              <Pressable
                key={key}
                style={[styles.pinKeypadKey, key === "backspace" ? styles.pinKeypadAction : undefined]}
                onPress={() => {
                  if (key === "backspace") {
                    onBackspace();
                    return;
                  }
                  onDigit(key);
                }}
              >
                {key === "backspace" ? (
                  <Ionicons name="backspace-outline" size={22} color={palette.primaryStrong} />
                ) : (
                  <Text style={styles.pinKeypadText}>{key}</Text>
                )}
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function MerchantPinSwipe({
  disabled,
  loading,
  label,
  loadingLabel,
  onComplete,
}: {
  disabled: boolean;
  loading?: boolean;
  label: string;
  loadingLabel: string;
  onComplete: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbWidth = 54;
  const swipeDistance = Math.max(trackWidth - thumbWidth - 8, 0);

  useEffect(() => {
    if (!loading) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 0,
      }).start();
    }
  }, [loading, translateX]);

  const resetSwipe = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 0,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !loading && swipeDistance > 0,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !disabled && !loading && swipeDistance > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          translateX.setValue(Math.max(0, Math.min(gesture.dx * dirSign(), swipeDistance)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx * dirSign() >= swipeDistance * 0.72) {
            Animated.timing(translateX, {
              toValue: swipeDistance,
              duration: 120,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished) onComplete();
            });
            return;
          }
          resetSwipe();
        },
        onPanResponderTerminate: resetSwipe,
      }),
    [disabled, loading, onComplete, resetSwipe, swipeDistance, translateX],
  );

  return (
    <View
      style={[styles.pinSwipeTrack, disabled ? styles.pinSwipeTrackDisabled : undefined]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      <Text style={[styles.pinSwipeText, disabled ? styles.pinSwipeTextDisabled : undefined]}>
        {loading ? loadingLabel : label}
      </Text>
      <Animated.View
        style={[styles.pinSwipeThumb, disabled ? styles.pinSwipeThumbDisabled : undefined, { transform: [{ translateX: Animated.multiply(translateX, dirSign()) }] }]}
        {...panResponder.panHandlers}
      >
        <Ionicons name={loading ? "hourglass-outline" : dirIcon("arrow-forward")} size={18} color={palette.primaryStrong} />
      </Animated.View>
    </View>
  );
}

function formatPermissionStatus(status: Props["notificationPermissionStatus"]): string {
  switch (status) {
    case "granted":
      return i18next.t("settings.notifications.statusAllowed");
    case "denied":
      return i18next.t("settings.notifications.statusBlocked");
    case "undetermined":
      return i18next.t("settings.notifications.statusNotDecided");
    case "unavailable":
      return i18next.t("settings.notifications.statusDeviceRequired");
    default:
      return i18next.t("settings.notifications.statusChecking");
  }
}

function formatStatusLabel(value?: string | null): string {
  if (!value) {
    return "";
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "paid_out") {
    return i18next.t("settings.improver.finalized");
  }
  return value
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatCredentialLabel(value: string, credentialTypes: AppGlobalCredentialType[]): string {
  const match = credentialTypes.find((credentialType) => credentialType.value === value);
  return match?.label?.trim() || formatStatusLabel(value) || value;
}

function ThemeOption({
  label,
  active,
  onPress,
  fitContent = false,
}: {
  label: string;
  active: boolean;
  /** Size to the label rather than share the row equally, for longer translations. */
  fitContent?: boolean;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);

  return (
    <Pressable style={[styles.themeOption, fitContent ? styles.themeOptionFit : undefined, active ? styles.themeOptionActive : undefined]} onPress={onPress}>
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

function PermissionRow({
  title,
  body,
  access,
  onAllow,
}: {
  title: string;
  body: string;
  access: PhoneAccess;
  onAllow: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const { t } = useTranslation();

  const status =
    access === "granted"
      ? t("settings.permissions.statusAllowed")
      : access === "blocked"
        ? t("settings.permissions.statusBlocked")
        : access === "askable"
          ? t("settings.permissions.statusAskable")
          : t("settings.permissions.statusChecking");

  return (
    <View style={styles.preferenceRow}>
      <View style={styles.preferenceCopy}>
        <Text style={styles.preferenceTitle}>{title}</Text>
        <Text style={styles.preferenceBody}>{body}</Text>
        <Text style={[styles.preferenceBody, access === "blocked" ? styles.permissionStatusBlocked : styles.permissionStatus]}>
          {status}
        </Text>
      </View>
      {access === "askable" || access === "blocked" ? (
        <Pressable
          style={styles.syncButton}
          onPress={() => {
            if (access === "blocked") {
              openPhoneSettings();
              return;
            }
            onAllow();
          }}
        >
          <Text style={styles.syncButtonText}>{access === "blocked" ? t("common.openSettings") : t("common.allow")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The phone-level permissions SFLuv uses, each with the one action that fixes
 * it. These are not switches: only the phone can grant or revoke them, so a row
 * either shows the system popup (not asked yet) or opens SFLuv's page in the
 * phone's Settings (refused, and the popup will not come back).
 */
function PhonePermissionsCard({ onNotificationsAllowed }: { onNotificationsAllowed: () => void }) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const { t } = useTranslation();

  const camera = useCameraAccess();
  // Add-only, the same access saving a chat photo asks for (attachmentFiles.ts).
  const [photos, requestPhotos, getPhotos] = MediaLibrary.usePermissions({ writeOnly: true });

  const [notifications, setNotifications] = useState<Notifications.NotificationPermissionsStatus | null>(null);
  const notificationsGrantedRef = useRef<boolean | null>(null);
  const readNotifications = useCallback(async () => {
    try {
      const next = await Notifications.getPermissionsAsync();
      // Turned on in the phone's Settings while away: register this phone for
      // push now, rather than at the next launch.
      if (notificationsGrantedRef.current === false && next.granted) {
        onNotificationsAllowed();
      }
      notificationsGrantedRef.current = next.granted;
      setNotifications(next);
    } catch {
      // Leave the row as it was.
    }
  }, [onNotificationsAllowed]);

  useEffect(() => {
    void readNotifications();
  }, [readNotifications]);

  useOnForeground(() => {
    void getPhotos();
    void readNotifications();
  });

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t("settings.permissions.title")}</Text>
      <PermissionRow
        title={t("settings.permissions.cameraTitle")}
        body={t("settings.permissions.cameraBody")}
        access={camera.access}
        onAllow={() => void camera.ask()}
      />
      <PermissionRow
        title={t("settings.permissions.photosTitle")}
        body={t("settings.permissions.photosBody")}
        access={phoneAccessOf(photos)}
        onAllow={() => void requestPhotos()}
      />
      <PermissionRow
        title={t("settings.permissions.notificationsTitle")}
        body={t("settings.permissions.notificationsBody")}
        access={phoneAccessOf(notifications)}
        onAllow={() => {
          void (async () => {
            await Notifications.requestPermissionsAsync();
            await readNotifications();
          })();
        }}
      />
    </View>
  );
}

/**
 * Language choice: follow the phone, or pick one of the app's languages.
 * Hidden while English is the only language the app ships.
 */
function LanguageCard({
  value,
  onChange,
}: {
  value: LanguagePreference;
  onChange: (next: LanguagePreference) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const { t } = useTranslation();

  if (SUPPORTED_LANGUAGES.length < 2) {
    return null;
  }

  const options: Array<{ code: LanguagePreference; label: string }> = [
    { code: "system", label: t("settings.language.system") },
    ...SUPPORTED_LANGUAGES.map((language) => ({ code: language.code, label: language.nativeName })),
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t("settings.language.title")}</Text>
      <Text style={styles.preferenceBody}>{t("settings.language.body")}</Text>
      <View style={styles.languageOptions}>
        {options.map((option) => (
          <ThemeOption
            key={option.code}
            label={option.label}
            fitContent
            active={value === option.code}
            onPress={() => onChange(option.code)}
          />
        ))}
      </View>
    </View>
  );
}

function PreferenceRow({
  title,
  body,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  body: string;
  value: boolean;
  disabled?: boolean;
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
        trackColor={{ false: palette.borderStrong, true: palette.primarySoft }}
        thumbColor={value ? palette.primaryStrong : palette.white}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}

/**
 * The backend accepts any value in 1-168, so a stored setting that came from
 * elsewhere gets its own chip rather than leaving the row with nothing selected.
 */
function reminderHourOptions(current: number): number[] {
  if (VOLUNTEER_REMINDER_HOUR_OPTIONS.includes(current)) {
    return VOLUNTEER_REMINDER_HOUR_OPTIONS;
  }
  return [...VOLUNTEER_REMINDER_HOUR_OPTIONS, current].sort((left, right) => left - right);
}

function formatReminderHours(hours: number): string {
  if (hours % 24 === 0) {
    return i18next.t("settings.notifications.reminderDays", { count: hours / 24 });
  }
  return i18next.t("settings.notifications.reminderHours", { count: hours });
}

function SocialAccountRow({
  provider,
  iconName,
  iconColor,
  linked,
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
  buttonLabel: string;
  buttonBusyLabel: string;
  busy?: boolean;
  buttonDisabled?: boolean;
  actionVariant: "outline" | "primary";
  onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);

  return (
    <View style={styles.socialRow}>
      <View style={styles.socialRowHeader}>
        <View style={styles.socialIdentityWrap}>
          <View style={styles.socialIconBadge}>
            <Ionicons name={iconName} size={24} color={iconColor} />
          </View>
          <View style={styles.socialCopy}>
            <View style={styles.socialProviderTitleRow}>
              <Text style={styles.socialProviderTitle}>{provider}</Text>
              {linked ? (
                <View style={styles.socialLinkedPill}>
                  <Text style={styles.socialLinkedPillText}>{t("settings.social.linked")}</Text>
                </View>
              ) : null}
            </View>
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
  const { t } = useTranslation();
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
            <Text style={styles.walletTypePillText}>{wallet.isEoa ? t("settings.wallets.owner") : t("settings.wallets.smartWallet")}</Text>
          </View>
          {isPrimary ? (
            <View style={styles.primaryPill}>
              <Text style={styles.primaryPillText}>{t("settings.wallets.primary")}</Text>
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
                setSuccess(t("settings.wallets.nameUpdated"));
              })
              .catch((error) => {
                setSaveState((current) => ({ ...current, nameSaving: false }));
                setError((error as Error)?.message || t("settings.wallets.nameUpdateFailed"));
              });
          }}
        >
          <Text style={styles.secondaryButtonText}>{saveState.nameSaving ? t("common.saving") : t("settings.wallets.saveName")}</Text>
        </Pressable>

        <Pressable
          style={[styles.primaryActionButton, (isPrimary || saveState.primarySaving) ? styles.buttonDisabled : undefined]}
          disabled={isPrimary || saveState.primarySaving}
          onPress={() => {
            setSaveState((current) => ({ ...current, primarySaving: true, error: "", success: "" }));
            void onSetPrimaryWallet(address)
              .then(() => {
                setSaveState((current) => ({ ...current, primarySaving: false }));
                setSuccess(t("settings.wallets.primaryUpdated"));
              })
              .catch((error) => {
                setSaveState((current) => ({ ...current, primarySaving: false }));
                setError((error as Error)?.message || t("settings.wallets.primaryUpdateFailed"));
              });
          }}
        >
          <Text style={styles.primaryActionButtonText}>
            {saveState.primarySaving ? t("common.saving") : isPrimary ? t("settings.wallets.primaryWallet") : t("settings.wallets.setPrimary")}
          </Text>
        </Pressable>
      </View>

      {!wallet.isEoa ? (
        <View style={styles.visibilityRow}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>{t("settings.wallets.showInChooser")}</Text>
            <Text style={styles.preferenceBody}>{t("settings.wallets.showInChooserBody")}</Text>
          </View>
          <Switch
            trackColor={{ false: palette.borderStrong, true: palette.primarySoft }}
            thumbColor={isVisible ? palette.primaryStrong : palette.white}
            value={isVisible}
            disabled={saveState.visibilitySaving || !canPersistWallet}
            onValueChange={(next) => {
              setSaveState((current) => ({ ...current, visibilitySaving: true, error: "", success: "" }));
              void onSetWalletVisibility(wallet, next)
                .then(() => {
                  setSaveState((current) => ({ ...current, visibilitySaving: false }));
                  setSuccess(t("settings.wallets.displayUpdated"));
                })
                .catch((error) => {
                  setSaveState((current) => ({ ...current, visibilitySaving: false }));
                  setError((error as Error)?.message || t("settings.wallets.visibilityUpdateFailed"));
                });
            }}
          />
        </View>
      ) : (
        <Text style={styles.walletHelperText}>{t("settings.wallets.ownerHelper")}</Text>
      )}

      {saveState.error ? <Text style={styles.inlineError}>{saveState.error}</Text> : null}
      {saveState.success ? <Text style={styles.inlineSuccess}>{saveState.success}</Text> : null}
    </View>
  );
}

function MerchantModeSettingsCard({
  locations,
  status,
  busy,
  message,
  onSetPin,
  onEnable,
  enrollableLocations,
}: {
  locations: AppOwnedLocation[];
  status?: AppMerchantModeStatus | null;
  busy?: boolean;
  message?: string | null;
  onSetPin?: (pin: string, currentPin?: string) => Promise<void>;
  onEnable?: (locationID: number) => Promise<void>;
  enrollableLocations?: AppMerchantModeLocation[];
}) {
  const { palette } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  // The server's list is authoritative: it only contains shops that are
  // approved and have somewhere for money to land, so anything in it can
  // actually be enrolled. The local filter is the fallback for when that
  // request failed — offering a shop that errors on enable beats offering none.
  const approvedLocations = useMemo(
    () =>
      enrollableLocations && enrollableLocations.length > 0
        ? enrollableLocations.map((location) => ({
            id: location.id,
            name: location.name,
            street: location.street,
          }))
        : locations
            .filter((location) => location.approval !== false)
            .map((location) => ({
              id: location.id,
              name: location.name,
              street: location.street,
            })),
    [enrollableLocations, locations],
  );
  const [selectedLocationID, setSelectedLocationID] = useState<number | null>(approvedLocations[0]?.id ?? null);
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [currentPinVisible, setCurrentPinVisible] = useState(false);
  const [newPinVisible, setNewPinVisible] = useState(false);
  const [editingPinField, setEditingPinField] = useState<"current" | "new">(status?.passcodeSet ? "current" : "new");
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLocationID === null && approvedLocations[0]) {
      setSelectedLocationID(approvedLocations[0].id);
    }
  }, [approvedLocations, selectedLocationID]);

  const passcodeSet = status?.passcodeSet === true;
  const activeDevice = status?.device?.merchantModeEnabled ? status.device : null;
  const currentPinValid = !passcodeSet || /^\d{6}$/.test(currentPin);
  const pinValid = /^\d{6}$/.test(pin);
  const canSetPin = Boolean(onSetPin) && currentPinValid && pinValid && !busy;
  const canEnable = Boolean(onEnable) && passcodeSet && selectedLocationID !== null && !busy;

  useEffect(() => {
    setEditingPinField(passcodeSet ? "current" : "new");
  }, [passcodeSet]);

  const appendMerchantPinDigit = (digit: string) => {
    const update = editingPinField === "current" ? setCurrentPin : setPin;
    update((current) => `${current}${digit}`.replace(/\D/g, "").slice(0, 6));
    setLocalError(null);
    setLocalMessage(null);
  };

  const removeMerchantPinDigit = () => {
    const update = editingPinField === "current" ? setCurrentPin : setPin;
    update((current) => current.slice(0, -1));
    setLocalError(null);
    setLocalMessage(null);
  };

  const submitPIN = async () => {
    if (!onSetPin) {
      return;
    }
    if (!pinValid) {
      setLocalError(t("settings.merchant.enterPin"));
      setLocalMessage(null);
      return;
    }
    if (!currentPinValid) {
      setLocalError(t("settings.merchant.enterCurrentPin"));
      setLocalMessage(null);
      return;
    }
    setLocalError(null);
    setLocalMessage(null);
    try {
      await onSetPin(pin, passcodeSet ? currentPin : undefined);
      setCurrentPin("");
      setPin("");
      setEditingPinField(passcodeSet ? "current" : "new");
      setLocalMessage(passcodeSet ? t("settings.merchant.pinReset") : t("settings.merchant.pinSaved"));
    } catch (error) {
      setLocalError((error as Error)?.message || t("settings.merchant.pinSaveFailed"));
    }
  };

  const enableMerchantMode = async () => {
    if (!onEnable || selectedLocationID === null) {
      return;
    }
    setLocalError(null);
    setLocalMessage(null);
    try {
      await onEnable(selectedLocationID);
    } catch (error) {
      setLocalError((error as Error)?.message || t("settings.merchant.enableFailed"));
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t("settings.merchant.title")}</Text>

      {activeDevice ? (
        <View style={styles.merchantModeActiveCard}>
          <Ionicons name="lock-closed" size={18} color={palette.primaryStrong} />
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>{t("settings.merchant.active")}</Text>
            <Text style={styles.preferenceBody}>
              {activeDevice.locationName} uses {shortAddress(activeDevice.walletAddress)} on this device.
            </Text>
          </View>
        </View>
      ) : null}

      <Pressable
        style={[styles.primaryActionButton, styles.settingsWideButton, !canEnable ? styles.buttonDisabled : undefined]}
        disabled={!canEnable}
        onPress={() => {
          void enableMerchantMode();
        }}
      >
        <Text style={styles.primaryActionButtonText}>{busy ? t("settings.merchant.enabling") : t("settings.merchant.enable")}</Text>
      </Pressable>
      {!passcodeSet ? <Text style={styles.meta}>{t("settings.merchant.savePinFirst")}</Text> : null}

      <View style={styles.preferenceStack}>
        <Text style={styles.preferenceTitle}>{t("settings.merchant.location")}</Text>
        {approvedLocations.length === 0 ? (
          <Text style={styles.meta}>{t("settings.merchant.noLocations")}</Text>
        ) : (
          <View style={styles.optionList}>
            {approvedLocations.map((location) => {
              const selected = selectedLocationID === location.id;
              return (
                <Pressable
                  key={location.id}
                  style={[styles.selectOption, selected ? styles.selectOptionActive : undefined]}
                  onPress={() => setSelectedLocationID(location.id)}
                >
                  <Text style={[styles.selectOptionTitle, selected ? styles.selectOptionTitleActive : undefined]}>
                    {location.name || t("settings.merchant.locationFallback")}
                  </Text>
                  <Text style={styles.selectOptionMeta}>{location.street || t("settings.merchant.approvedLocation")}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.preferenceStack}>
        <Text style={styles.preferenceTitle}>{passcodeSet ? t("settings.merchant.resetPin") : t("settings.merchant.createPin")}</Text>
        <Text style={styles.preferenceBody}>
          {passcodeSet
            ? t("settings.merchant.resetPinBody")
            : t("settings.merchant.createPinBody")}
        </Text>
        {passcodeSet ? (
          <Pressable onPress={() => setEditingPinField("current")}>
            <Text style={styles.pinFieldLabel}>{t("settings.merchant.currentPin")}</Text>
            <View style={editingPinField === "current" ? styles.pinDisplayActive : undefined}>
              <MerchantPinInput
                value={currentPin}
                placeholder={t("settings.merchant.currentPinPlaceholder")}
                visible={currentPinVisible}
                onToggleVisible={() => setCurrentPinVisible((current) => !current)}
              />
            </View>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setEditingPinField("new")}>
          <Text style={styles.pinFieldLabel}>{t("settings.merchant.newPin")}</Text>
          <View style={editingPinField === "new" ? styles.pinDisplayActive : undefined}>
            <MerchantPinInput
              value={pin}
              placeholder={t("settings.merchant.newPinPlaceholder")}
              visible={newPinVisible}
              onToggleVisible={() => setNewPinVisible((current) => !current)}
            />
          </View>
        </Pressable>
        <MerchantPinPad
          onDigit={appendMerchantPinDigit}
          onBackspace={removeMerchantPinDigit}
        />
        <MerchantPinSwipe
          disabled={!canSetPin}
          loading={busy}
          label={passcodeSet ? t("settings.merchant.slideReset") : t("settings.merchant.slideSave")}
          loadingLabel={t("settings.merchant.savingShort")}
          onComplete={() => {
            void submitPIN();
          }}
        />
      </View>
      {message ? <Text style={styles.inlineSuccess}>{message}</Text> : null}
      {localMessage ? <Text style={styles.inlineSuccess}>{localMessage}</Text> : null}
      {localError ? <Text style={styles.inlineError}>{localError}</Text> : null}
    </View>
  );
}

export function SettingsScreen({
  user,
  tokenSymbol,
  improver,
  wallets,
  ownedLocations = [],
  merchantModeLocations = [],
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
  volunteerPanelAvailable,
  volunteerReminderPreferences,
  onUpdateVolunteerReminderPreferences,
  onOpenImproverCredentials,
  credentialRequests = [],
  credentialTypes = [],
  credentialRequestsLoading = false,
  merchantModeStatus,
  merchantModeBusy,
  merchantModeMessage,
  onSetMerchantModePin,
  onEnableMerchantMode,
  onDeleteAccount,
  onLogout,
  onContactSupport,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [section, setSection] = useState<SettingsSection>("general");
  const [showPushDetails, setShowPushDetails] = useState(false);
  const [rewardsWalletDraft, setRewardsWalletDraft] = useState(
    improver?.primaryRewardsAccount?.trim() || primaryWalletAddress || "",
  );
  const [improverBusy, setImproverBusy] = useState(false);
  const [improverMessage, setImproverMessage] = useState<string | null>(null);
  const [improverError, setImproverError] = useState<string | null>(null);
  const [socialHelpVisible, setSocialHelpVisible] = useState(false);
  const [dangerZoneOpen, setDangerZoneOpen] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const hasImproverSection = Boolean(onOpenImprover || improver || user?.isImprover);
  const hasMerchantSection = Boolean(user?.isMerchant);
  const isApprovedImprover = Boolean(user?.isImprover || improver?.status === "approved");
  const pendingCredentialRequests = useMemo(
    () => credentialRequests.filter((request) => request.status === "pending"),
    [credentialRequests],
  );

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
    if (!hasMerchantSection && section === "merchant") {
      setSection("general");
    }
  }, [hasImproverSection, hasMerchantSection, section]);

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
      setImproverError(t("settings.improver.enterRewardsWallet"));
      setImproverMessage(null);
      return;
    }
    if (!ethers.utils.isAddress(trimmedAddress)) {
      setImproverError(t("settings.improver.invalidRewardsWallet"));
      setImproverMessage(null);
      return;
    }

    setImproverBusy(true);
    setImproverError(null);
    setImproverMessage(null);
    try {
      await onUpdateImproverRewardsWallet(ethers.utils.getAddress(trimmedAddress));
      setImproverMessage(t("settings.improver.rewardsWalletUpdated"));
    } catch (error) {
      setImproverError((error as Error)?.message || t("settings.improver.rewardsWalletUpdateFailed"));
    } finally {
      setImproverBusy(false);
    }
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmVisible(false);
    setDeleteConfirmText("");
  };

  const openDeleteConfirm = () => {
    setDeleteConfirmText("");
    setDeleteConfirmVisible(true);
  };

  const confirmDeleteAccount = () => {
    if (deleteConfirmText !== "DELETE" || accountDeletionBusy || !onDeleteAccount) {
      return;
    }
    closeDeleteConfirm();
    onDeleteAccount();
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>{t("settings.appSync")}</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <SegmentedTabs
        segments={[
          { value: "general" as SettingsSection, label: t("settings.tabs.general") },
          { value: "wallets" as SettingsSection, label: t("settings.tabs.wallets") },
          { value: "account" as SettingsSection, label: t("settings.tabs.account") },
          ...(hasMerchantSection ? [{ value: "merchant" as SettingsSection, label: t("settings.tabs.merchant") }] : []),
          ...(hasImproverSection ? [{ value: "improver" as SettingsSection, label: t("settings.tabs.improver") }] : []),
        ]}
        value={section}
        onChange={setSection}
      />

      {section === "general" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.appearance.title")}</Text>
            <View style={styles.themeRow}>
              <ThemeOption label={t("settings.appearance.system")} active={preferences.themePreference === "system"} onPress={() => applyThemePreference("system")} />
              <ThemeOption label={t("settings.appearance.light")} active={preferences.themePreference === "light"} onPress={() => applyThemePreference("light")} />
              <ThemeOption label={t("settings.appearance.dark")} active={preferences.themePreference === "dark"} onPress={() => applyThemePreference("dark")} />
            </View>
          </View>

          <LanguageCard
            value={preferences.languagePreference}
            onChange={(languagePreference) => onUpdatePreferences({ ...preferences, languagePreference })}
          />

          <PhonePermissionsCard onNotificationsAllowed={onSyncNotifications} />

          {/* Everything notification-related lives together, with the technical
              diagnostics kept but folded away — they are for troubleshooting,
              not for every visit. */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.notifications.title")}</Text>
            {volunteerPanelAvailable ? (
              <>
                <PreferenceRow
                  title={t("settings.notifications.volunteerReminders")}
                  body={t("settings.notifications.volunteerRemindersBody")}
                  value={volunteerReminderPreferences?.enabled ?? true}
                  disabled={!volunteerReminderPreferences || !onUpdateVolunteerReminderPreferences}
                  onValueChange={(enabled) =>
                    onUpdateVolunteerReminderPreferences?.({
                      enabled,
                      hoursBefore: volunteerReminderPreferences?.hoursBefore ?? DEFAULT_VOLUNTEER_REMINDER_HOURS,
                    })
                  }
                />
                {volunteerReminderPreferences?.enabled ? (
                  <View style={styles.reminderHourRow}>
                    {reminderHourOptions(volunteerReminderPreferences.hoursBefore).map((hours) => {
                      const active = volunteerReminderPreferences.hoursBefore === hours;
                      return (
                        <Pressable
                          key={hours}
                          style={[styles.reminderHourChip, active ? styles.reminderHourChipActive : undefined]}
                          onPress={() =>
                            onUpdateVolunteerReminderPreferences?.({ enabled: true, hoursBefore: hours })
                          }
                        >
                          <Text
                            style={[
                              styles.reminderHourChipText,
                              active ? styles.reminderHourChipTextActive : undefined,
                            ]}
                          >
                            {formatReminderHours(hours)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : null}

            <Pressable style={styles.disclosureRow} onPress={() => setShowPushDetails((current) => !current)}>
              <Text style={styles.disclosureText}>{t("settings.notifications.deliveryStatus")}</Text>
              <Ionicons
                name={showPushDetails ? "chevron-up" : "chevron-down"}
                size={16}
                color={palette.textMuted}
              />
            </Pressable>
            {showPushDetails ? (
              <View style={styles.pushStatusCard}>
                <View style={styles.pushStatusHeader}>
                  <Text style={styles.pushStatusTitle}>{t("settings.notifications.pushStatus")}</Text>
                  <Pressable
                    style={[styles.syncButton, notificationSyncState === "syncing" ? styles.buttonDisabled : undefined]}
                    disabled={notificationSyncState === "syncing"}
                    onPress={onSyncNotifications}
                  >
                    <Text style={styles.syncButtonText}>{notificationSyncState === "syncing" ? t("settings.notifications.syncing") : t("settings.notifications.syncNow")}</Text>
                  </Pressable>
                </View>
                <Text style={styles.pushStatusMeta}>{t("settings.notifications.systemPermission", { status: formatPermissionStatus(notificationPermissionStatus) })}</Text>
                <Text style={styles.pushStatusMeta}>{t("settings.notifications.deviceToken", { status: notificationTokenRegistered ? t("settings.notifications.registered") : t("settings.notifications.missing") })}</Text>
                <Text style={styles.pushStatusMeta}>
                  {t("settings.notifications.walletSubscriptions", { subscribed: notificationSubscribedCount, total: notificationAddressCount })}
                </Text>
                {notificationStatusMessage ? <Text style={styles.pushStatusMessage}>{notificationStatusMessage}</Text> : null}
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.behavior.title")}</Text>
            <PreferenceRow
              title={t("settings.behavior.haptics")}
              body={t("settings.behavior.hapticsBody")}
              value={preferences.hapticsEnabled}
              onValueChange={(hapticsEnabled) => onUpdatePreferences({ ...preferences, hapticsEnabled })}
            />
            <View style={styles.preferenceStack}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>{t("settings.behavior.sendOpensOn")}</Text>
                <Text style={styles.preferenceBody}>{t("settings.behavior.sendOpensOnBody")}</Text>
              </View>
              <View style={styles.themeRow}>
                <SendFlowOption
                  label={t("settings.behavior.search")}
                  active={preferences.defaultSendEntryMode === "manual"}
                  onPress={() => applyDefaultSendEntryMode("manual")}
                />
                <SendFlowOption
                  label={t("settings.behavior.qrScan")}
                  active={preferences.defaultSendEntryMode === "scan"}
                  onPress={() => applyDefaultSendEntryMode("scan")}
                />
              </View>
            </View>
          </View>
        </>
      ) : null}
      {section === "wallets" ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("settings.wallets.title")}</Text>
          <Text style={styles.body}>{t("settings.wallets.body")}</Text>
          {wallets.length === 0 ? (
            <Text style={styles.meta}>{t("settings.wallets.none")}</Text>
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
            <Text style={styles.sectionTitle}>{user?.name || t("settings.account.defaultName")}</Text>
            <Text style={styles.meta}>{t("settings.account.userId", { id: user?.id || t("settings.account.notLoaded") })}</Text>
            {user?.contactEmail ? <Text style={styles.meta}>{t("settings.account.email", { email: user.contactEmail })}</Text> : null}
            {user?.contactPhone ? <Text style={styles.meta}>Phone: {user.contactPhone}</Text> : null}
          </View>

          <View style={styles.card}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>{t("settings.social.title")}</Text>
              <Pressable
                style={styles.titleInfoButton}
                accessibilityRole="button"
                accessibilityLabel={t("settings.social.about")}
                onPress={() => setSocialHelpVisible(true)}
              >
                <Ionicons name="information-circle-outline" size={19} color={palette.primaryStrong} />
              </Pressable>
            </View>
            <SocialAccountRow
              provider="Google"
              iconName="logo-google"
              iconColor={palette.primaryStrong}
              linked={googleLinkedNow}
              buttonLabel={
                googleLinkedNow
                  ? googleCanDisconnect
                    ? t("settings.social.disconnectGoogle")
                    : t("settings.social.googleLinked")
                  : t("settings.social.linkGoogle")
              }
              buttonBusyLabel={googleLinkedNow ? t("settings.social.disconnectingGoogle") : t("settings.social.linkingGoogle")}
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
              buttonLabel={
                appleLinkedNow
                  ? appleCanDisconnect
                    ? t("settings.social.disconnectApple")
                    : t("settings.social.appleLinked")
                  : t("settings.social.linkApple")
              }
              buttonBusyLabel={appleLinkedNow ? t("settings.social.disconnectingApple") : t("settings.social.linkingApple")}
              busy={appleLinkBusy}
              buttonDisabled={appleLinkedNow ? !appleCanDisconnect : !onLinkApple}
              actionVariant={appleLinkedNow ? "outline" : "primary"}
              onPress={appleLinkedNow ? onDisconnectApple : onLinkApple}
            />
          </View>

          {/* Writing to SFLuv, from inside the app.
              Above Log out and the danger zone, because needing help is the
              common reason somebody reaches the bottom of Settings — and
              because a support request written here carries the account, which
              is what lets us answer in a chat rather than only by email. */}
          {onContactSupport ? (
            <Pressable
              style={styles.supportButton}
              onPress={onContactSupport}
              accessibilityRole="button"
              accessibilityLabel={t("settings.account.contact")}
            >
              <Ionicons name="help-buoy-outline" size={18} color={palette.primaryStrong} />
              <View style={{ flex: 1 }}>
                <Text style={styles.supportButtonText}>{t("settings.account.contact")}</Text>
                <Text style={styles.supportButtonHint}>
                  {t("settings.questionsProblemsOrAnythingElse")}
                </Text>
              </View>
              <Ionicons name={dirIcon("chevron-forward")} size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}

          {onLogout ? (
            <Pressable style={styles.logoutButton} onPress={onLogout}>
              <Text style={styles.logoutButtonText}>{t("settings.account.logout")}</Text>
            </Pressable>
          ) : null}

          {onDeleteAccount ? (
            <View style={[styles.card, styles.deleteAccountCard]}>
              <Pressable
                style={styles.dangerZoneDisclosure}
                onPress={() => setDangerZoneOpen((current) => !current)}
              >
                <View style={styles.dangerZoneHeader}>
                  <Ionicons name="warning-outline" size={18} color="#b91c1c" />
                  <Text style={styles.dangerZoneTitle}>{t("settings.account.dangerZone")}</Text>
                </View>
                <Ionicons
                  name={dangerZoneOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#b91c1c"
                />
              </Pressable>
              {dangerZoneOpen ? (
                <View style={styles.dangerZoneContent}>
                  <Text style={styles.body}>
                    {t("settings.account.dangerBody", { symbol: tokenSymbol })}
                  </Text>
                  <Text style={styles.dangerZoneNote}>{t("settings.account.dangerNote")}</Text>
                  {accountDeletionMessage ? <Text style={styles.inlineError}>{accountDeletionMessage}</Text> : null}
                  <Pressable
                    style={[styles.deleteAccountButton, accountDeletionBusy ? styles.buttonDisabled : undefined]}
                    disabled={accountDeletionBusy}
                    onPress={openDeleteConfirm}
                  >
                    <Text style={styles.deleteAccountButtonText}>
                      {accountDeletionBusy ? t("settings.account.preparing") : t("settings.account.delete")}
                    </Text>
                  </Pressable>
                </View>
              ) : accountDeletionMessage ? (
                <Text style={styles.inlineError}>{accountDeletionMessage}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {section === "merchant" ? (
        <MerchantModeSettingsCard
          locations={ownedLocations}
          enrollableLocations={merchantModeLocations}
          status={merchantModeStatus}
          busy={merchantModeBusy}
          message={merchantModeMessage}
          onSetPin={onSetMerchantModePin}
          onEnable={onEnableMerchantMode}
        />
      ) : null}

      {section === "improver" ? (
        <>
          {onOpenImprover && !isApprovedImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("settings.improver.accessTitle")}</Text>
              <Text style={styles.body}>
                {improver
                  ? t("settings.improver.accessBodyExisting")
                  : t("settings.improver.accessBodyNew")}
              </Text>
              {improver ? <Text style={styles.meta}>{t("settings.improver.status", { status: formatStatusLabel(improver.status) })}</Text> : null}
              {improver?.email ? <Text style={styles.meta}>{t("settings.improver.email", { email: improver.email })}</Text> : null}
              <Pressable style={[styles.primaryActionButton, styles.settingsWideButton]} onPress={onOpenImprover}>
                <Text style={styles.primaryActionButtonText}>
                  {improver ? t("settings.improver.viewRequest") : t("settings.improver.become")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {improver || user?.isImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("settings.improver.profileTitle")}</Text>
              <Text style={styles.body}>{t("settings.improver.profileBody")}</Text>
              {isApprovedImprover ? (
                <PreferenceRow
                  title={t("settings.improver.showPanel")}
                  body={t("settings.improver.showPanelBody")}
                  value={preferences.showImproverPanel}
                  onValueChange={(showImproverPanel) => onUpdatePreferences({ ...preferences, showImproverPanel })}
                />
              ) : null}
              {improver ? <Text style={styles.meta}>{t("settings.improver.status", { status: formatStatusLabel(improver.status) })}</Text> : null}
              {improver?.email ? <Text style={styles.meta}>{t("settings.improver.email", { email: improver.email })}</Text> : null}
              <Text style={styles.meta}>{t("settings.improver.rewardsWallet", { address: shortAddress(improver?.primaryRewardsAccount || rewardsWalletDraft || t("settings.improver.notSet")) })}</Text>
              <Text style={styles.meta}>{t("settings.improver.primaryAppWallet", { address: shortAddress(primaryWalletAddress || t("settings.improver.notSet")) })}</Text>
              <TextInput
                style={styles.walletNameInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("settings.improver.rewardsWalletPlaceholder")}
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
                    {improverBusy ? t("common.saving") : t("settings.improver.saveRewardsWallet")}
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
                    <Text style={styles.secondaryButtonText}>{t("settings.improver.usePrimary")}</Text>
                  </Pressable>
                ) : null}
              </View>
              {improverError ? <Text style={styles.inlineError}>{improverError}</Text> : null}
              {improverMessage ? <Text style={styles.inlineSuccess}>{improverMessage}</Text> : null}
            </View>
          ) : null}

          {isApprovedImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("settings.improver.credentials")}</Text>
              {onOpenImproverCredentials ? (
                <Pressable
                  style={[styles.primaryActionButton, styles.settingsWideButton]}
                  onPress={onOpenImproverCredentials}
                >
                  <Text style={styles.primaryActionButtonText}>{t("settings.improver.viewCredentials")}</Text>
                </Pressable>
              ) : null}
              {credentialRequestsLoading ? (
                <Text style={styles.meta}>{t("settings.improver.loadingCredentials")}</Text>
              ) : pendingCredentialRequests.length > 0 ? (
                <View style={styles.optionList}>
                  {pendingCredentialRequests.map((request) => (
                    <View key={request.id} style={styles.selectOption}>
                      <Text style={styles.selectOptionTitle}>
                        {formatCredentialLabel(request.credentialType, credentialTypes)}
                      </Text>
                      <Text style={styles.selectOptionMeta}>
                        Pending since {new Date(request.requestedAt).toLocaleString()}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.meta}>{t("settings.improver.noCredentials")}</Text>
              )}
            </View>
          ) : null}
        </>
      ) : null}
        {/* Which build this is, for support. */}
        <Text style={styles.versionFooter}>
          {t("settings.version", { version: getClientMetadata().version, build: getClientMetadata().buildLabel })}
        </Text>
      </ScrollView>
      <Modal
        visible={deleteConfirmVisible}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={closeDeleteConfirm}
      >
        <Pressable style={styles.modalOverlay} onPress={closeDeleteConfirm}>
          <Pressable style={styles.deleteConfirmCard} onPress={() => {}}>
            <View style={styles.deleteConfirmHeader}>
              <Ionicons name="warning-outline" size={22} color="#b91c1c" />
              <Text style={styles.deleteConfirmTitle}>{t("settings.account.confirmDelete")}</Text>
            </View>
            <Text style={styles.body}>
              {t("settings.account.deleteFlowBody", { symbol: tokenSymbol })}
            </Text>
            <Text style={styles.dangerZoneNote}>{t("settings.account.typeDelete")}</Text>
            <TextInput
              style={styles.deleteConfirmInput}
              autoCapitalize="characters"
              autoCorrect={false}
              contextMenuHidden
              editable={!accountDeletionBusy}
              placeholder="DELETE"
              placeholderTextColor={palette.textMuted}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
            />
            <View style={styles.deleteConfirmActions}>
              <Pressable
                style={[styles.secondaryButton, styles.deleteConfirmActionButton]}
                disabled={accountDeletionBusy}
                onPress={closeDeleteConfirm}
              >
                <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.deleteAccountButton,
                  styles.deleteConfirmActionButton,
                  deleteConfirmText !== "DELETE" || accountDeletionBusy ? styles.buttonDisabled : undefined,
                ]}
                disabled={deleteConfirmText !== "DELETE" || accountDeletionBusy}
                onPress={confirmDeleteAccount}
              >
                <Text style={styles.deleteAccountButtonText}>
                  {accountDeletionBusy ? t("settings.account.preparing") : t("settings.account.delete")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={socialHelpVisible}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setSocialHelpVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSocialHelpVisible(false)}>
          <Pressable style={styles.socialHelpCard} onPress={() => {}}>
            <View style={styles.socialHelpHeader}>
              <Text style={styles.sectionTitle}>{t("settings.social.title")}</Text>
              <Pressable style={styles.titleInfoButton} onPress={() => setSocialHelpVisible(false)}>
                <Ionicons name="close" size={18} color={palette.primaryStrong} />
              </Pressable>
            </View>
            <Text style={styles.body}>{t("settings.social.body")}</Text>
            <View style={styles.socialHelpProviderCard}>
              <Text style={styles.socialProviderTitle}>{t("settings.social.google")}</Text>
              <Text style={styles.socialProviderMeta}>
                {googleLinkedNow
                  ? t("settings.social.googleLinkedBody")
                  : t("settings.social.googleLinkBody")}
              </Text>
              {googleLinkedEmail ? <Text style={styles.socialProviderMeta}>Google email: {googleLinkedEmail}</Text> : null}
              {googleLinkedNow && googleDisconnectDisabledReason ? (
                <Text style={styles.socialProviderMeta}>{googleDisconnectDisabledReason}</Text>
              ) : null}
              {googleMessage ? <Text style={styles.socialProviderMeta}>{googleMessage}</Text> : null}
            </View>
            <View style={styles.socialHelpProviderCard}>
              <Text style={styles.socialProviderTitle}>{t("settings.social.apple")}</Text>
              <Text style={styles.socialProviderMeta}>
                {appleLinkedNow
                  ? t("settings.social.appleLinkedBody")
                  : t("settings.social.appleLinkBody")}
              </Text>
              {appleLinkedEmail ? <Text style={styles.socialProviderMeta}>Apple email: {appleLinkedEmail}</Text> : null}
              {appleLinkedNow && appleDisconnectDisabledReason ? (
                <Text style={styles.socialProviderMeta}>{appleDisconnectDisabledReason}</Text>
              ) : null}
              {appleLinkMessage ? <Text style={styles.socialProviderMeta}>{appleLinkMessage}</Text> : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
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
      fontWeight: "800",
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
      fontWeight: "800",
    },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    titleInfoButton: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
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
    themeOptionFit: {
      flex: 0,
      flexGrow: 1,
      paddingHorizontal: 16,
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
    disclosureRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 6,
    },
    disclosureText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.textMuted,
    },
    reminderHourRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    reminderHourChip: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      paddingVertical: 9,
      paddingHorizontal: spacing.md,
      alignItems: "center",
    },
    reminderHourChipActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    reminderHourChipText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },
    reminderHourChipTextActive: {
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
    languageOptions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    permissionStatus: {
      color: palette.text,
      fontWeight: "700",
    },
    permissionStatusBlocked: {
      color: palette.danger,
      fontWeight: "700",
    },
    merchantModeActiveCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
      padding: spacing.md,
    },
    pinRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    pinInput: {
      flex: 1,
      textAlign: "center",
      letterSpacing: 3,
    },
    pinInputWide: {
      textAlign: "center",
      letterSpacing: 3,
    },
    pinFieldLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      marginBottom: 6,
      textTransform: "uppercase",
    },
    pinDisplayRow: {
      minHeight: 54,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: spacing.md,
      ...shadows.soft,
    },
    pinDisplayActive: {
      borderRadius: radii.lg,
      borderWidth: 2,
      borderColor: palette.primary,
    },
    pinDisplayText: {
      flex: 1,
      color: palette.text,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 4,
      textAlign: "center",
    },
    pinDisplayPlaceholder: {
      color: palette.textMuted,
      fontSize: 15,
      letterSpacing: 0,
      textAlign: "left",
    },
    pinVisibilityButton: {
      width: 48,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    pinKeypad: {
      gap: spacing.xs,
    },
    pinKeypadRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    pinKeypadKey: {
      flex: 1,
      minHeight: 48,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
      ...shadows.soft,
    },
    pinKeypadAction: {
      backgroundColor: palette.primarySoft,
    },
    pinKeypadText: {
      color: palette.text,
      fontSize: 22,
      fontWeight: "800",
    },
    pinSwipeTrack: {
      minHeight: 58,
      borderRadius: radii.pill,
      backgroundColor: palette.primaryStrong,
      justifyContent: "center",
      paddingHorizontal: 8,
      position: "relative",
      overflow: "hidden",
      ...shadows.card,
    },
    pinSwipeTrackDisabled: {
      backgroundColor: palette.borderStrong,
    },
    pinSwipeText: {
      color: palette.white,
      textAlign: "center",
      fontSize: 15,
      fontWeight: "800",
      paddingHorizontal: 72,
    },
    pinSwipeTextDisabled: {
      color: palette.surface,
    },
    pinSwipeThumb: {
      position: "absolute",
      left: 4,
      top: 4,
      bottom: 4,
      width: 54,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pinSwipeThumbDisabled: {
      backgroundColor: palette.surfaceStrong,
    },
    optionList: {
      gap: spacing.sm,
    },
    selectOption: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
      gap: 4,
    },
    selectOptionActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    selectOptionTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "800",
    },
    selectOptionTitleActive: {
      color: palette.primaryStrong,
    },
    selectOptionMeta: {
      color: palette.textMuted,
      lineHeight: 19,
    },
    socialRow: {
      gap: spacing.sm,
    },
    socialRowHeader: {
      gap: spacing.md,
    },
    socialIdentityWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      width: "100%",
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
      minWidth: 0,
      gap: 4,
    },
    socialProviderTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    socialProviderTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    socialProviderMeta: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    socialActionButton: {
      minHeight: 52,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      alignSelf: "stretch",
    },
    socialActionButtonPrimary: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    socialActionContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      width: "100%",
    },
    socialActionButtonText: {
      color: palette.text,
      fontWeight: "800",
      flexShrink: 1,
      textAlign: "center",
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
    modalOverlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      padding: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    socialHelpCard: {
      width: "100%",
      maxWidth: 380,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    socialHelpHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    socialHelpProviderCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      padding: spacing.md,
      gap: spacing.xs,
    },
    walletAddress: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
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
      fontWeight: "800",
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
    supportButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      marginTop: spacing.md,
    },
    supportButtonText: { fontSize: 15, fontWeight: "600", color: palette.text },
    supportButtonHint: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
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
      fontWeight: "800",
      fontSize: 15,
    },
    versionFooter: {
      color: palette.textMuted,
      fontSize: 12,
      textAlign: "center",
      paddingVertical: spacing.md,
    },
    dangerZoneHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    dangerZoneDisclosure: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    dangerZoneContent: {
      gap: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: "rgba(185, 28, 28, 0.18)",
    },
    dangerZoneTitle: {
      color: "#b91c1c",
      fontSize: 18,
      fontWeight: "800",
    },
    dangerZoneNote: {
      color: "#b91c1c",
      lineHeight: 20,
      fontWeight: "700",
    },
    deleteAccountCard: {
      borderColor: "rgba(185, 28, 28, 0.26)",
      backgroundColor: "rgba(185, 28, 28, 0.05)",
    },
    deleteAccountButton: {
      minHeight: 48,
      borderRadius: radii.md,
      backgroundColor: "#b91c1c",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    deleteAccountButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 15,
    },
    deleteConfirmCard: {
      width: "100%",
      maxWidth: 390,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: "rgba(185, 28, 28, 0.28)",
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    deleteConfirmHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    deleteConfirmTitle: {
      flex: 1,
      color: "#b91c1c",
      fontSize: 18,
      fontWeight: "800",
    },
    deleteConfirmInput: {
      borderWidth: 1,
      borderColor: "rgba(185, 28, 28, 0.38)",
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      backgroundColor: "rgba(185, 28, 28, 0.06)",
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: 1,
    },
    deleteConfirmActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    deleteConfirmActionButton: {
      flex: 1,
    },
  });
}
