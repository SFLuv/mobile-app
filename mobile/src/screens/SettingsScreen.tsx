import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  AppCredentialRequest,
  AppGlobalCredentialType,
  AppImprover,
  AppMerchantModeStatus,
  AppOwnedLocation,
  AppUser,
  AppWallet,
} from "../types/app";
import { AppPreferences, SendFlowEntryMode, ThemePreference } from "../types/preferences";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  user: AppUser | null;
  tokenSymbol: string;
  improver?: AppImprover | null;
  wallets: AppWallet[];
  ownedLocations?: AppOwnedLocation[];
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
};

type SettingsSection = "general" | "wallets" | "account" | "merchant" | "improver";

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
          translateX.setValue(Math.max(0, Math.min(gesture.dx, swipeDistance)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx >= swipeDistance * 0.72) {
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
        style={[styles.pinSwipeThumb, disabled ? styles.pinSwipeThumbDisabled : undefined, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Ionicons name={loading ? "hourglass-outline" : "arrow-forward"} size={18} color={palette.primaryStrong} />
      </Animated.View>
    </View>
  );
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

function formatCredentialLabel(value: string, credentialTypes: AppGlobalCredentialType[]): string {
  const match = credentialTypes.find((credentialType) => credentialType.value === value);
  return match?.label?.trim() || formatStatusLabel(value) || value;
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
                  <Text style={styles.socialLinkedPillText}>Linked</Text>
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

function MerchantModeSettingsCard({
  locations,
  status,
  busy,
  message,
  onSetPin,
  onEnable,
}: {
  locations: AppOwnedLocation[];
  status?: AppMerchantModeStatus | null;
  busy?: boolean;
  message?: string | null;
  onSetPin?: (pin: string, currentPin?: string) => Promise<void>;
  onEnable?: (locationID: number) => Promise<void>;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, getShadows(palette)), [palette]);
  const approvedLocations = useMemo(
    () => locations.filter((location) => location.approval !== false),
    [locations],
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
      setLocalError("Enter a 6 digit PIN.");
      setLocalMessage(null);
      return;
    }
    if (!currentPinValid) {
      setLocalError("Enter the current 6 digit PIN before resetting it.");
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
      setLocalMessage(passcodeSet ? "Merchant mode PIN reset." : "Merchant mode PIN saved.");
    } catch (error) {
      setLocalError((error as Error)?.message || "Unable to save merchant mode PIN.");
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
      setLocalError((error as Error)?.message || "Unable to enable merchant mode.");
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Merchant Mode</Text>

      {activeDevice ? (
        <View style={styles.merchantModeActiveCard}>
          <Ionicons name="lock-closed" size={18} color={palette.primaryStrong} />
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>Merchant mode is active</Text>
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
        <Text style={styles.primaryActionButtonText}>{busy ? "Enabling..." : "Enable Merchant Mode on this device"}</Text>
      </Pressable>
      {!passcodeSet ? <Text style={styles.meta}>Save a 6 digit exit PIN before enabling Merchant Mode.</Text> : null}

      <View style={styles.preferenceStack}>
        <Text style={styles.preferenceTitle}>Location</Text>
        {approvedLocations.length === 0 ? (
          <Text style={styles.meta}>No approved merchant locations are available yet.</Text>
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
                    {location.name || "Merchant location"}
                  </Text>
                  <Text style={styles.selectOptionMeta}>{location.street || "Approved SFLuv location"}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.preferenceStack}>
        <Text style={styles.preferenceTitle}>{passcodeSet ? "Reset 6 digit exit PIN" : "Create 6 digit exit PIN"}</Text>
        <Text style={styles.preferenceBody}>
          {passcodeSet
            ? "Enter the current PIN before choosing a new exit PIN."
            : "This PIN is required to exit Merchant Mode on the device."}
        </Text>
        {passcodeSet ? (
          <Pressable onPress={() => setEditingPinField("current")}>
            <Text style={styles.pinFieldLabel}>Current PIN</Text>
            <View style={editingPinField === "current" ? styles.pinDisplayActive : undefined}>
              <MerchantPinInput
                value={currentPin}
                placeholder="Enter current PIN"
                visible={currentPinVisible}
                onToggleVisible={() => setCurrentPinVisible((current) => !current)}
              />
            </View>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setEditingPinField("new")}>
          <Text style={styles.pinFieldLabel}>New PIN</Text>
          <View style={editingPinField === "new" ? styles.pinDisplayActive : undefined}>
            <MerchantPinInput
              value={pin}
              placeholder="Enter new PIN"
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
          label={passcodeSet ? "Slide to reset PIN" : "Slide to save PIN"}
          loadingLabel="Saving"
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
        {hasMerchantSection ? (
          <Pressable
            style={[styles.segmentButton, section === "merchant" ? styles.segmentButtonActive : undefined]}
            onPress={() => setSection("merchant")}
          >
            <Text style={[styles.segmentText, section === "merchant" ? styles.segmentTextActive : undefined]}>Merchant</Text>
          </Pressable>
        ) : null}
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
                <Text style={styles.preferenceBody}>Choose whether Send opens on search or QR scan first.</Text>
              </View>
              <View style={styles.themeRow}>
                <SendFlowOption
                  label="Search"
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
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Link Socials</Text>
              <Pressable
                style={styles.titleInfoButton}
                accessibilityRole="button"
                accessibilityLabel="About linked socials"
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
              <Pressable
                style={styles.dangerZoneDisclosure}
                onPress={() => setDangerZoneOpen((current) => !current)}
              >
                <View style={styles.dangerZoneHeader}>
                  <Ionicons name="warning-outline" size={18} color="#b91c1c" />
                  <Text style={styles.dangerZoneTitle}>Danger Zone</Text>
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
                    Delete your account and log out. Your account stays recoverable for 30 days, but any {tokenSymbol} in your accessible wallets will be transferred out before the deletion request is submitted.
                  </Text>
                  <Text style={styles.dangerZoneNote}>Only use this if you really want to remove this account.</Text>
                  {accountDeletionMessage ? <Text style={styles.inlineError}>{accountDeletionMessage}</Text> : null}
                  <Pressable
                    style={[styles.deleteAccountButton, accountDeletionBusy ? styles.buttonDisabled : undefined]}
                    disabled={accountDeletionBusy}
                    onPress={openDeleteConfirm}
                  >
                    <Text style={styles.deleteAccountButtonText}>
                      {accountDeletionBusy ? "Preparing..." : "Delete account"}
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
              <Text style={styles.sectionTitle}>Improver Access</Text>
              <Text style={styles.body}>
                {improver
                  ? "View your improver request and finish any remaining setup steps."
                  : "Become an improver using the email attached to your account."}
              </Text>
              {improver ? <Text style={styles.meta}>Status: {formatStatusLabel(improver.status)}</Text> : null}
              {improver?.email ? <Text style={styles.meta}>Improver email: {improver.email}</Text> : null}
              <Pressable style={[styles.primaryActionButton, styles.settingsWideButton]} onPress={onOpenImprover}>
                <Text style={styles.primaryActionButtonText}>
                  {improver ? "View improver request" : "Become an improver"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {improver || user?.isImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Improver Profile</Text>
              <Text style={styles.body}>Manage the wallet used for improver payouts and review the improver profile tied to this account.</Text>
              {isApprovedImprover ? (
                <PreferenceRow
                  title="Show improver panel"
                  body="Keep the improver panel in the bottom navigation."
                  value={preferences.showImproverPanel}
                  onValueChange={(showImproverPanel) => onUpdatePreferences({ ...preferences, showImproverPanel })}
                />
              ) : null}
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

          {isApprovedImprover ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Credentials</Text>
              {onOpenImproverCredentials ? (
                <Pressable
                  style={[styles.primaryActionButton, styles.settingsWideButton]}
                  onPress={onOpenImproverCredentials}
                >
                  <Text style={styles.primaryActionButtonText}>View credentials</Text>
                </Pressable>
              ) : null}
              {credentialRequestsLoading ? (
                <Text style={styles.meta}>Loading pending credential requests...</Text>
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
                <Text style={styles.meta}>No pending credential requests.</Text>
              )}
            </View>
          ) : null}
        </>
      ) : null}
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
              <Text style={styles.deleteConfirmTitle}>Confirm account deletion</Text>
            </View>
            <Text style={styles.body}>
              This starts the account deletion flow and may transfer {tokenSymbol} out of accessible wallets before the deletion request is submitted.
            </Text>
            <Text style={styles.dangerZoneNote}>Type DELETE to continue.</Text>
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
                <Text style={styles.secondaryButtonText}>Cancel</Text>
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
                  {accountDeletionBusy ? "Preparing..." : "Delete account"}
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
              <Text style={styles.sectionTitle}>Link Socials</Text>
              <Pressable style={styles.titleInfoButton} onPress={() => setSocialHelpVisible(false)}>
                <Ionicons name="close" size={18} color={palette.primaryStrong} />
              </Pressable>
            </View>
            <Text style={styles.body}>Attach Google or Apple sign-in methods to this SFLUV account so future social sign-ins land here.</Text>
            <View style={styles.socialHelpProviderCard}>
              <Text style={styles.socialProviderTitle}>Google</Text>
              <Text style={styles.socialProviderMeta}>
                {googleLinkedNow
                  ? "Google is linked to this account for future sign-ins."
                  : "Link Google so future Google sign-ins land on this account."}
              </Text>
              {googleLinkedEmail ? <Text style={styles.socialProviderMeta}>Google email: {googleLinkedEmail}</Text> : null}
              {googleLinkedNow && googleDisconnectDisabledReason ? (
                <Text style={styles.socialProviderMeta}>{googleDisconnectDisabledReason}</Text>
              ) : null}
              {googleMessage ? <Text style={styles.socialProviderMeta}>{googleMessage}</Text> : null}
            </View>
            <View style={styles.socialHelpProviderCard}>
              <Text style={styles.socialProviderTitle}>Apple</Text>
              <Text style={styles.socialProviderMeta}>
                {appleLinkedNow
                  ? "Apple is linked to this account for future sign-ins."
                  : "Link Apple so future Apple sign-ins land on this account."}
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
      fontWeight: "900",
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
