import "./src/polyfills";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { ethers } from "ethers";
import {
  PrivyProvider,
  useEmbeddedEthereumWallet,
  useLoginWithOAuth,
  usePrivy,
} from "@privy-io/expo";
import { SendScreen } from "./src/screens/SendScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { WalletHomeScreen } from "./src/screens/WalletHomeScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { mobileConfig } from "./src/config";
import {
  createSmartWalletServiceFromSigner,
  RouteDiscovery,
  SmartWalletService,
} from "./src/services/smartWallet";
import { AppBackendAuthError, AppBackendClient } from "./src/services/appBackend";
import {
  AppContact,
  AppLocation,
  AppTransaction,
  AppUser,
} from "./src/types/app";
import { AppPreferences, defaultAppPreferences } from "./src/types/preferences";
import { SfluvUniversalLink, parseSfluvUniversalLink } from "./src/utils/universalLinks";
import {
  AppThemeProvider,
  Palette,
  getShadows,
  lightPalette,
  palette,
  radii,
  shadows,
  spacing,
  useAppTheme,
} from "./src/theme";

type RuntimeState = {
  loading: boolean;
  service: SmartWalletService | null;
  discovery: RouteDiscovery | null;
  error: string | null;
};

type PendingLinkIntent = {
  id: number;
  link: SfluvUniversalLink;
};

type SendDraft = {
  recipient: string;
  amount?: string;
  memo?: string;
};

type SendDraftOptions = {
  returnTab?: Tab | null;
};

type RedeemFlowState = {
  code: string;
  stage: "awaiting_wallet" | "redeeming" | "success" | "error";
  message?: string;
};

type Tab = "wallet" | "activity" | "map" | "contacts" | "settings";
type WalletPane = "home" | "send" | "receive";

const PREFERENCES_STORAGE_KEY = "sfluv-wallet:preferences";
const PUSH_TOKEN_STORAGE_KEY = "sfluv-wallet:push-token";
const TRANSFER_REFRESH_DEBOUNCE_MS = 900;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function blankRuntime(loading = false): RuntimeState {
  return { loading, service: null, discovery: null, error: null };
}

function resolveExpoProjectId(): string | undefined {
  const configuredProjectId = mobileConfig.expoProjectId.trim();
  if (configuredProjectId) {
    return configuredProjectId;
  }

  const fromConstants =
    Constants.easConfig?.projectId ??
    ((Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? "");
  return typeof fromConstants === "string" && fromConstants.trim().length > 0 ? fromConstants.trim() : undefined;
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("wallet-activity", {
      name: "Wallet activity",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: "#ef6d66",
    });
  }

  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device.");
    return null;
  }

  const projectId = resolveExpoProjectId();
  if (!projectId) {
    console.warn("Expo project ID is required to register for push notifications.");
    return null;
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    console.warn("Notification permissions were not granted.");
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

function formatDisplayBalance(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  const [intPart, decimalPart] = raw.split(".");
  const trimmed = decimalPart.replace(/0+$/, "");
  if (!trimmed) {
    return intPart;
  }
  return `${intPart}.${trimmed.slice(0, 4)}`;
}

function shortAddress(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function walletLabel(smartIndex: number | undefined): string {
  if (typeof smartIndex !== "number" || smartIndex < 0) {
    return "Wallet";
  }
  return `Wallet ${smartIndex + 1}`;
}

function transactionIdentity(tx: Pick<AppTransaction, "hash" | "amount" | "from" | "to">): string {
  return `${tx.hash}:${tx.amount}:${tx.from}:${tx.to}`.toLowerCase();
}

function mergeTransactions(primary: AppTransaction[], secondary: AppTransaction[], limit = 25): AppTransaction[] {
  const secondaryByIdentity = new Map(secondary.map((tx) => [transactionIdentity(tx), tx]));
  const merged = primary.map((tx) => {
    const secondaryTx = secondaryByIdentity.get(transactionIdentity(tx));
    if (!secondaryTx) {
      return tx;
    }
    return {
      ...tx,
      id: secondaryTx.id || tx.id,
      memo: secondaryTx.memo || tx.memo,
    };
  });

  const seen = new Set(merged.map((tx) => transactionIdentity(tx)));
  for (const tx of secondary) {
    const identity = transactionIdentity(tx);
    if (!seen.has(identity)) {
      merged.push(tx);
      seen.add(identity);
    }
  }

  return merged
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      if (left.hash === right.hash) {
        return 0;
      }
      return left.hash < right.hash ? 1 : -1;
    })
    .slice(0, limit);
}

function describeAppBackendIssue(error: unknown): string {
  if (error instanceof AppBackendAuthError) {
    return error.message;
  }
  const message = (error as Error)?.message?.trim();
  if (!message) {
    return "Some shared app features could not sync right now. Wallet transfers still work.";
  }
  return message;
}

function mergePreferences(input: unknown): AppPreferences {
  if (!input || typeof input !== "object") {
    return defaultAppPreferences;
  }

  const candidate = input as Partial<AppPreferences>;
  return {
    themePreference:
      candidate.themePreference === "light" || candidate.themePreference === "dark" || candidate.themePreference === "system"
        ? candidate.themePreference
        : defaultAppPreferences.themePreference,
    notificationsEnabled:
      typeof candidate.notificationsEnabled === "boolean"
        ? candidate.notificationsEnabled
        : defaultAppPreferences.notificationsEnabled,
    hapticsEnabled:
      typeof candidate.hapticsEnabled === "boolean" ? candidate.hapticsEnabled : defaultAppPreferences.hapticsEnabled,
  };
}

function BottomTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable style={[styles.bottomTab, active ? { backgroundColor: palette.primarySoft } : undefined]} onPress={onPress}>
      <Ionicons
        name={icon}
        size={18}
        color={active ? palette.primaryStrong : palette.textMuted}
      />
      <Text style={[styles.bottomTabText, { color: active ? palette.primaryStrong : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

function WalletAppShell({
  runtime,
  selectedCandidateKey,
  onSelectCandidate,
  ownerBadge,
  onLogout,
  backendClient,
  pendingLinkIntent,
  onConsumePendingLink,
}: {
  runtime: RuntimeState;
  selectedCandidateKey?: string;
  onSelectCandidate: (key: string) => void;
  ownerBadge?: string;
  onLogout?: () => void;
  backendClient?: AppBackendClient | null;
  pendingLinkIntent: PendingLinkIntent | null;
  onConsumePendingLink: () => void;
}) {
  const [preferences, setPreferences] = useState<AppPreferences>(defaultAppPreferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const raw = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (!cancelled && raw) {
          setPreferences(mergePreferences(JSON.parse(raw)));
        }
      } catch (error) {
        console.warn("Unable to load saved app preferences", error);
      } finally {
        if (!cancelled) {
          setPreferencesLoaded(true);
        }
      }
    };

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences)).catch((error) => {
      console.warn("Unable to persist app preferences", error);
    });
  }, [preferences, preferencesLoaded]);

  return (
    <AppThemeProvider preference={preferences.themePreference}>
      <WalletAppShellContent
        runtime={runtime}
        selectedCandidateKey={selectedCandidateKey}
        onSelectCandidate={onSelectCandidate}
        ownerBadge={ownerBadge}
        onLogout={onLogout}
        backendClient={backendClient}
        pendingLinkIntent={pendingLinkIntent}
        onConsumePendingLink={onConsumePendingLink}
        preferences={preferences}
        onUpdatePreferences={setPreferences}
      />
    </AppThemeProvider>
  );
}

function WalletAppShellContent({
  runtime,
  selectedCandidateKey,
  onSelectCandidate,
  ownerBadge,
  onLogout,
  backendClient,
  pendingLinkIntent,
  onConsumePendingLink,
  preferences,
  onUpdatePreferences,
}: {
  runtime: RuntimeState;
  selectedCandidateKey?: string;
  onSelectCandidate: (key: string) => void;
  ownerBadge?: string;
  onLogout?: () => void;
  backendClient?: AppBackendClient | null;
  pendingLinkIntent: PendingLinkIntent | null;
  onConsumePendingLink: () => void;
  preferences: AppPreferences;
  onUpdatePreferences: (next: AppPreferences) => void;
}) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const [tab, setTab] = useState<Tab>("wallet");
  const [walletPane, setWalletPane] = useState<WalletPane>("home");
  const [smartAddress, setSmartAddress] = useState("");
  const [smartBalance, setSmartBalance] = useState("...");
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [locations, setLocations] = useState<AppLocation[]>([]);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [storedPushToken, setStoredPushToken] = useState<string | null>(null);
  const [walletSyncReady, setWalletSyncReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [sendDraft, setSendDraft] = useState<SendDraft | null>(null);
  const [sendReturnTab, setSendReturnTab] = useState<Tab | null>(null);
  const [redeemFlow, setRedeemFlow] = useState<RedeemFlowState | null>(null);
  const walletSurfaceRequestRef = useRef(0);
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const transferRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendAuthFailureHandledRef = useRef(false);
  const walletCandidates = runtime.discovery?.candidates ?? [];
  const canChooseWallet = walletCandidates.length > 1;
  const selectedCandidate = useMemo(
    () => walletCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? walletCandidates[0],
    [selectedCandidateKey, walletCandidates],
  );
  const notificationAddresses = useMemo(() => {
    const seen = new Set<string>();
    const addresses: string[] = [];
    for (const candidate of walletCandidates) {
      const normalized = candidate.accountAddress.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      addresses.push(candidate.accountAddress);
    }
    return addresses;
  }, [walletCandidates]);

  const publicBackendClient = useMemo(
    () => backendClient ?? new AppBackendClient(async () => null),
    [backendClient],
  );

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY)
      .then((value) => {
        if (!cancelled) {
          setStoredPushToken(value);
        }
      })
      .catch((error) => {
        console.warn("Unable to load saved push token", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const emitTransferHaptic = () => {
    if (!preferences.hapticsEnabled) {
      return;
    }
    Vibration.vibrate(10);
  };

  const loadPublicLocations = async () => {
    try {
      const nextLocations = await publicBackendClient.getPublicLocations();
      setLocations(nextLocations);
    } catch (error) {
      console.warn("Unable to load public locations", error);
    }
  };

  const loadAppProfile = async () => {
    if (!backendClient) {
      return;
    }

    setLoadingData(true);
    try {
      const profile = await backendClient.ensureUser();
      setAppUser(profile.user);
      setContacts(profile.contacts);
      setSyncNotice(null);
      backendAuthFailureHandledRef.current = false;
    } catch (error) {
      console.warn("Unable to load app profile", error);
      const message = describeAppBackendIssue(error);
      setSyncNotice(message);
      if (error instanceof AppBackendAuthError && onLogout && !backendAuthFailureHandledRef.current) {
        backendAuthFailureHandledRef.current = true;
        Alert.alert("Sign in again", message, [
          {
            text: "OK",
            onPress: () => {
              onLogout();
            },
          },
        ]);
      }
    } finally {
      setLoadingData(false);
    }
  };

  const openSendDraft = (draft: SendDraft, options?: SendDraftOptions) => {
    setSendDraft(draft);
    setSendReturnTab(options?.returnTab ?? null);
    setTab("wallet");
    setWalletPane("send");
  };

  useEffect(() => {
    if (!pendingLinkIntent) {
      return;
    }

    const { link } = pendingLinkIntent;
    if (link.type === "pay") {
      openSendDraft({
        recipient: link.address,
      });
      onConsumePendingLink();
      return;
    }

    if (link.type === "request") {
      openSendDraft({
        recipient: link.address,
        amount: link.amount,
        memo: link.memo,
      });
      onConsumePendingLink();
      return;
    }

    setTab("wallet");
    setWalletPane("home");
    setRedeemFlow({
      code: link.code,
      stage: "awaiting_wallet",
    });
    onConsumePendingLink();
  }, [onConsumePendingLink, pendingLinkIntent]);

  useEffect(() => {
    if (!redeemFlow || redeemFlow.stage !== "awaiting_wallet") {
      return;
    }
    if (runtime.error) {
      setRedeemFlow({
        code: redeemFlow.code,
        stage: "error",
        message: runtime.error,
      });
      return;
    }
    if (!runtime.service) {
      return;
    }
    setRedeemFlow((current) =>
      current && current.code === redeemFlow.code
        ? {
            code: current.code,
            stage: "redeeming",
          }
        : current,
    );
  }, [redeemFlow, runtime.error, runtime.service]);

  useEffect(() => {
    if (!redeemFlow || redeemFlow.stage !== "redeeming") {
      return;
    }
    if (!runtime.service) {
      return;
    }

    let cancelled = false;
    const redeem = async () => {
      try {
        const payoutAddress = await runtime.service?.smartAccountAddress();
        if (!payoutAddress || cancelled) {
          return;
        }
        await publicBackendClient.redeemCode(redeemFlow.code, payoutAddress);
        if (cancelled) {
          return;
        }
        setRedeemFlow({
          code: redeemFlow.code,
          stage: "success",
          message: "Your SFLUV perk was sent to this wallet.",
        });
        await refreshWalletSurface();
        await loadAppProfile();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setRedeemFlow({
          code: redeemFlow.code,
          stage: "error",
          message: (error as Error)?.message || "Unable to redeem this QR code right now.",
        });
      }
    };

    void redeem();
    return () => {
      cancelled = true;
    };
  }, [publicBackendClient, redeemFlow, runtime.service]);

  const refreshWalletSurface = async () => {
    const requestID = walletSurfaceRequestRef.current + 1;
    walletSurfaceRequestRef.current = requestID;

    if (!runtime.service) {
      setSmartAddress("");
      setSmartBalance("...");
      setTransactions([]);
      return;
    }

    try {
      const address = await runtime.service.smartAccountAddress();
      if (walletSurfaceRequestRef.current !== requestID) {
        return;
      }

      const nextAddress = ethers.utils.getAddress(address);
      setSmartAddress(nextAddress);
      setTransactions((current) => (smartAddress && smartAddress.toLowerCase() !== nextAddress.toLowerCase() ? [] : current));

      const seededBalance =
        selectedCandidate && selectedCandidate.accountAddress.toLowerCase() === nextAddress.toLowerCase()
          ? formatDisplayBalance(selectedCandidate.tokenBalance)
          : null;
      setSmartBalance(seededBalance ?? "...");

      void runtime.service
        .smartAccountBalance()
        .then((balance) => {
          if (walletSurfaceRequestRef.current !== requestID) {
            return;
          }
          setSmartBalance(formatDisplayBalance(balance));
        })
        .catch((error) => {
          console.warn("Unable to load wallet balance", error);
        });

      void Promise.all([
        runtime.service.recentTransfers(25).catch((error) => {
          console.warn("Unable to load recent onchain transfers", error);
          return [] as AppTransaction[];
        }),
        backendClient
          ? backendClient.getTransactions(nextAddress, 0, 25).catch((error) => {
              console.warn("Unable to load transaction history from app backend", error);
              return [] as AppTransaction[];
            })
          : Promise.resolve([] as AppTransaction[]),
      ]).then(([chainTransactions, backendTransactions]) => {
        if (walletSurfaceRequestRef.current !== requestID) {
          return;
        }
        setTransactions(mergeTransactions(chainTransactions, backendTransactions, 25));
      });
    } catch (error) {
      console.warn("Unable to refresh wallet surface", error);
      setSyncNotice(describeAppBackendIssue(error));
    }
  };

  useEffect(() => {
    void loadPublicLocations();
  }, []);

  useEffect(() => {
    void loadAppProfile();
  }, [backendClient]);

  useEffect(() => {
    void refreshWalletSurface();
  }, [runtime.service, runtime.discovery, selectedCandidateKey, backendClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const isActive = nextState === "active";
      const wasActive = appIsActiveRef.current;
      appIsActiveRef.current = isActive;

      if (!wasActive && isActive) {
        void refreshWalletSurface();
        void loadAppProfile();
        void loadPublicLocations();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [backendClient, publicBackendClient, runtime.service, runtime.discovery, selectedCandidateKey]);

  useEffect(() => {
    if (!runtime.service) {
      return;
    }

    const service = runtime.service;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const watchTransfers = async () => {
      try {
        unsubscribe = await service.watchSmartAccountTransfers(() => {
          if (!appIsActiveRef.current) {
            return;
          }
          if (transferRefreshTimeoutRef.current) {
            clearTimeout(transferRefreshTimeoutRef.current);
          }
          transferRefreshTimeoutRef.current = setTimeout(() => {
            transferRefreshTimeoutRef.current = null;
            if (!cancelled) {
              void refreshWalletSurface();
            }
          }, TRANSFER_REFRESH_DEBOUNCE_MS);
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Unable to watch wallet transfers", error);
        }
      }
    };

    void watchTransfers();

    return () => {
      cancelled = true;
      if (transferRefreshTimeoutRef.current) {
        clearTimeout(transferRefreshTimeoutRef.current);
        transferRefreshTimeoutRef.current = null;
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [runtime.service, runtime.discovery, selectedCandidateKey]);

  useEffect(() => {
    return () => {
      if (transferRefreshTimeoutRef.current) {
        clearTimeout(transferRefreshTimeoutRef.current);
        transferRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!runtime.service || !appIsActiveRef.current) {
      return;
    }
    void refreshWalletSurface();
  }, [runtime.service, selectedCandidateKey]);

  useEffect(() => {
    if (!backendClient || !appUser || !runtime.discovery || walletCandidates.length === 0) {
      setWalletSyncReady(false);
      return;
    }

    let cancelled = false;
    const syncWallets = async () => {
      setWalletSyncReady(false);
      try {
        await backendClient.ensureLegacyWallets(
          runtime.discovery?.ownerAddress ?? "",
          walletCandidates.map((candidate) => ({
            smartIndex: candidate.smartIndex,
            accountAddress: candidate.accountAddress,
          })),
        );

        const existingPrimaryWallet = appUser.primaryWalletAddress?.trim();
        if (!existingPrimaryWallet) {
          const primaryCandidate =
            walletCandidates.find((candidate) => candidate.smartIndex === 0) ?? walletCandidates[0];
          if (primaryCandidate) {
            await backendClient.updatePrimaryWallet(primaryCandidate.accountAddress);
            await loadAppProfile();
          }
        }

        if (!cancelled) {
          setWalletSyncReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Unable to sync wallets with app backend", error);
        }
      }
    };

    void syncWallets();
    return () => {
      cancelled = true;
    };
  }, [appUser, backendClient, runtime.discovery, walletCandidates]);

  useEffect(() => {
    if (!backendClient || !appUser || !runtime.discovery || !walletSyncReady) {
      return;
    }

    let cancelled = false;
    const syncPushNotifications = async () => {
      if (!preferences.notificationsEnabled) {
        if (!storedPushToken) {
          return;
        }
        try {
          await backendClient.syncPushNotifications(storedPushToken, []);
          await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
          if (!cancelled) {
            setStoredPushToken(null);
          }
        } catch (error) {
          if (!cancelled) {
            console.warn("Unable to disable push notifications", error);
          }
        }
        return;
      }

      try {
        const token = storedPushToken ?? (await registerForPushNotificationsAsync());
        if (!token || cancelled) {
          return;
        }
        await backendClient.syncPushNotifications(token, notificationAddresses);
        await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        if (!cancelled) {
          setStoredPushToken(token);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Unable to sync push notifications", error);
        }
      }
    };

    void syncPushNotifications();
    return () => {
      cancelled = true;
    };
  }, [appUser, backendClient, notificationAddresses, preferences.notificationsEnabled, runtime.discovery, storedPushToken, walletSyncReady]);

  const handleSend = async (recipient: string, amount: string, unit: "wei" | "token", memo: string) => {
    if (!runtime.service) {
      throw new Error("Wallet signer is not ready.");
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Send SFLUV?",
        `Send ${amount.trim()} ${unit === "token" ? "SFLUV" : "wei"} to ${shortAddress(recipient.trim())}?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Send", onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirmed) {
      throw new Error("Transfer cancelled.");
    }

    const result = await runtime.service.sendSFLUV(recipient, amount, unit);
    if (memo.trim() && result.txHash && backendClient) {
      try {
        await backendClient.saveTransactionMemo(result.txHash, memo);
      } catch {
        // Memo save failure should not block the transfer UX.
      }
    }
    emitTransferHaptic();
    await refreshWalletSurface();
    await loadAppProfile();
    setSendReturnTab(null);
    setWalletPane("home");
    setTab("wallet");
    return result;
  };

  const activeTitle =
    tab === "wallet"
      ? walletPane === "send"
        ? "Send"
        : walletPane === "receive"
          ? "Receive"
          : "Wallet"
      : tab === "activity"
        ? "Activity"
      : tab === "map"
        ? "Merchant Map"
        : tab === "contacts"
          ? "Contacts"
          : "Settings";
  const showWalletPaneBack = tab === "wallet" && walletPane !== "home";
  const showBlockingWalletState = runtime.loading && !runtime.service;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={styles.topBackdrop}>
        <View style={styles.topOrbLarge} />
        <View style={styles.topOrbSmall} />
      </View>

      <View style={styles.topBar}>
        <View style={styles.topTitleWrap}>
          <Text style={styles.brandKicker}>SFLUV Wallet</Text>
          <Text style={styles.brand}>{activeTitle}</Text>
          <Text style={styles.topMeta}>
            {tab === "settings"
              ? "Preferences and account details"
              : tab === "contacts"
                ? "People and wallets you trust"
                : selectedCandidate
                  ? `${walletLabel(selectedCandidate.smartIndex)} selected`
                  : "Fast SFLUV payments"}
          </Text>
        </View>
        <View style={styles.topActions}>
          {showWalletPaneBack ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => {
                if (walletPane === "send" && sendReturnTab) {
                  setSendReturnTab(null);
                  setWalletPane("home");
                  setTab(sendReturnTab);
                  return;
                }
                setSendReturnTab(null);
                setWalletPane("home");
              }}
            >
              <Ionicons name="arrow-back" size={18} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.iconButton, tab === "settings" ? styles.iconButtonActive : undefined]}
            onPress={() => {
              setTab("settings");
            }}
          >
            <Ionicons name={tab === "settings" ? "settings" : "settings-outline"} size={18} color={palette.primaryStrong} />
          </Pressable>
          {onLogout ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => {
                onLogout();
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.contentShell}>
        {loadingData ? (
          <View style={styles.banner}>
            <ActivityIndicator size="small" color={palette.primaryStrong} />
            <Text style={styles.bannerText}>Loading contacts…</Text>
          </View>
        ) : null}

        <View style={styles.content}>
          {showBlockingWalletState ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={palette.primary} />
              <Text style={styles.stateText}>Preparing your wallet…</Text>
            </View>
          ) : runtime.error ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>{runtime.error}</Text>
            </View>
          ) : tab === "wallet" ? (
            walletPane === "send" ? (
              <SendScreen
                contacts={contacts}
                onPrepareSend={handleSend}
                draft={sendDraft}
                onDraftApplied={() => setSendDraft(null)}
                onOpenUniversalLink={(link) => {
                  if (link.type === "redeem") {
                    setRedeemFlow({
                      code: link.code,
                      stage: "awaiting_wallet",
                    });
                    setTab("wallet");
                    setWalletPane("home");
                    return;
                  }
                  openSendDraft({
                    recipient: link.address,
                    amount: link.type === "request" ? link.amount : undefined,
                    memo: link.type === "request" ? link.memo : undefined,
                  });
                }}
              />
            ) : walletPane === "receive" ? (
              <ReceiveScreen accountAddress={smartAddress || runtime.discovery?.ownerAddress || ethers.constants.AddressZero} />
            ) : (
              <WalletHomeScreen
                balance={smartBalance}
                smartAddress={smartAddress}
                ownerBadge={ownerBadge}
                selectedWalletLabel={walletLabel(selectedCandidate?.smartIndex)}
                recentTransactions={transactions}
                onOpenSend={() => {
                  setWalletPane("send");
                }}
                onOpenReceive={() => {
                  setWalletPane("receive");
                }}
                onOpenActivity={() => {
                  setTab("activity");
                }}
                onOpenWalletChooser={() => {
                  setShowWalletChooser(true);
                }}
                showWalletChooser={canChooseWallet}
              />
            )
          ) : tab === "activity" ? (
            <ActivityScreen
              transactions={transactions}
              contacts={contacts}
              activeAddress={smartAddress}
              refreshing={refreshingActivity}
              onRefresh={async () => {
                setRefreshingActivity(true);
                try {
                  await refreshWalletSurface();
                } finally {
                  setRefreshingActivity(false);
                }
              }}
            />
          ) : tab === "map" ? (
            <MapScreen
              locations={locations}
              onPayLocation={(location) => {
                if (!location.payToAddress) {
                  Alert.alert("Payment unavailable", "This merchant does not have a payout wallet configured yet.");
                  return;
                }
                openSendDraft({
                  recipient: location.payToAddress,
                }, { returnTab: "map" });
              }}
            />
          ) : tab === "contacts" ? (
            <ContactsScreen
              contacts={contacts}
              syncNotice={syncNotice}
              onAddContact={async (name, address) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.addContact(name, address);
                const updatedContacts = await backendClient.getContacts();
                setContacts(updatedContacts);
              }}
              onUpdateContact={async (contact) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.updateContact(contact);
                const updatedContacts = await backendClient.getContacts();
                setContacts(updatedContacts);
              }}
              onToggleFavorite={async (contact) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.toggleFavorite(contact);
                const updatedContacts = await backendClient.getContacts();
                setContacts(updatedContacts);
              }}
              onDeleteContact={async (contactID) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.deleteContact(contactID);
                const updatedContacts = await backendClient.getContacts();
                setContacts(updatedContacts);
              }}
            />
          ) : (
            <SettingsScreen
              user={appUser}
              activeWalletAddress={smartAddress}
              syncNotice={syncNotice}
              preferences={preferences}
              onUpdatePreferences={(next) => {
                onUpdatePreferences(next);
              }}
            />
          )}
        </View>

        <View style={styles.bottomDock}>
          <BottomTab
            label="Wallet"
            icon={tab === "wallet" ? "wallet" : "wallet-outline"}
            active={tab === "wallet"}
            onPress={() => {
              setTab("wallet");
              setWalletPane("home");
            }}
          />
          <BottomTab
            label="Activity"
            icon={tab === "activity" ? "pulse" : "pulse-outline"}
            active={tab === "activity"}
            onPress={() => {
              setTab("activity");
            }}
          />
          <BottomTab
            label="Map"
            icon={tab === "map" ? "map" : "map-outline"}
            active={tab === "map"}
            onPress={() => {
              setTab("map");
            }}
          />
          <BottomTab
            label="Contacts"
            icon={tab === "contacts" ? "people" : "people-outline"}
            active={tab === "contacts"}
            onPress={() => {
              setTab("contacts");
            }}
          />
        </View>
      </View>

      <Modal
        visible={showWalletChooser && canChooseWallet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWalletChooser(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowWalletChooser(false)}>
          <Pressable style={styles.walletChooserCard} onPress={() => {}}>
            <View style={styles.walletChooserHeader}>
              <View>
                <Text style={styles.walletChooserTitle}>Choose Wallet</Text>
                <Text style={styles.walletChooserSubtitle}>Switch between your available Citizen Wallet accounts.</Text>
              </View>
              <Pressable style={styles.walletChooserClose} onPress={() => setShowWalletChooser(false)}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.walletChooserList} showsVerticalScrollIndicator={false}>
              {walletCandidates.map((candidate) => {
                const active = candidate.key === selectedCandidateKey;
                return (
                  <Pressable
                    key={candidate.key}
                    style={[styles.walletChooserOption, active ? styles.walletChooserOptionActive : undefined]}
                    onPress={() => {
                      onSelectCandidate(candidate.key);
                      setShowWalletChooser(false);
                    }}
                  >
                    <View style={styles.walletChooserOptionHeader}>
                      <Text style={styles.walletChooserOptionTitle}>{walletLabel(candidate.smartIndex)}</Text>
                      {active ? (
                        <View style={styles.walletChooserActiveBadge}>
                          <Ionicons name="checkmark" size={12} color={palette.white} />
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.walletChooserBalance}>{candidate.tokenBalance} SFLUV</Text>
                    <Text style={styles.walletChooserAddress}>{shortAddress(candidate.accountAddress)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(redeemFlow)} transparent animationType="fade" onRequestClose={() => setRedeemFlow(null)}>
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingCard}>
            {redeemFlow?.stage === "success" ? (
              <Ionicons name="checkmark-circle" size={42} color={palette.success} />
            ) : redeemFlow?.stage === "error" ? (
              <Ionicons name="alert-circle" size={42} color={palette.danger} />
            ) : (
              <ActivityIndicator size="large" color={palette.primary} />
            )}
            <Text style={styles.sendingTitle}>
              {redeemFlow?.stage === "awaiting_wallet"
                ? "Preparing your wallet…"
                : redeemFlow?.stage === "redeeming"
                  ? "Redeeming your perk…"
                  : redeemFlow?.stage === "success"
                    ? "Perk redeemed"
                    : "Redeem failed"}
            </Text>
            <Text style={styles.sendingText}>
              {redeemFlow?.message ||
                (redeemFlow?.stage === "awaiting_wallet"
                  ? "Finishing wallet setup before the reward is claimed."
                  : redeemFlow?.stage === "redeeming"
                    ? "Requesting your SFLUV reward from the event faucet."
                    : "Close this modal and try again.")}
            </Text>
            {redeemFlow?.stage === "success" || redeemFlow?.stage === "error" ? (
              <Pressable style={styles.dismissButton} onPress={() => setRedeemFlow(null)}>
                <Text style={styles.dismissButtonText}>Close</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function PrivyWalletApp() {
  const { user, isReady, logout, getAccessToken } = usePrivy();
  const { login, state: oauthState } = useLoginWithOAuth();
  const { wallets, create } = useEmbeddedEthereumWallet();

  const [runtime, setRuntime] = useState<RuntimeState>(blankRuntime(true));
  const [preferredCandidateKey, setPreferredCandidateKey] = useState<string | undefined>(undefined);
  const [pendingLinkIntent, setPendingLinkIntent] = useState<PendingLinkIntent | null>(null);
  const creatingWalletRef = useRef(false);
  const nextPendingLinkIDRef = useRef(0);
  const embeddedWallet = wallets[0];

  const backendClient = useMemo(
    () => new AppBackendClient(async () => (await getAccessToken()) ?? null),
    [getAccessToken],
  );

  const handleIncomingLink = (rawURL: string | null) => {
    if (!rawURL) {
      return;
    }
    const parsedLink = parseSfluvUniversalLink(rawURL);
    if (!parsedLink) {
      return;
    }
    nextPendingLinkIDRef.current += 1;
    setPendingLinkIntent({
      id: nextPendingLinkIDRef.current,
      link: parsedLink,
    });
  };

  useEffect(() => {
    let cancelled = false;

    Linking.getInitialURL()
      .then((url) => {
        if (!cancelled) {
          handleIncomingLink(url);
        }
      })
      .catch((error) => {
        console.warn("Unable to read initial URL", error);
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleIncomingLink(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    if (!user) {
      setRuntime(blankRuntime(false));
      setPreferredCandidateKey(undefined);
      return;
    }
    if (wallets.length > 0 || creatingWalletRef.current) {
      return;
    }

    creatingWalletRef.current = true;
    create({ createAdditional: false })
      .catch((error) => {
        setRuntime({
          loading: false,
          service: null,
          discovery: null,
          error: (error as Error).message,
        });
      })
      .finally(() => {
        creatingWalletRef.current = false;
      });
  }, [create, isReady, user, wallets.length]);

  useEffect(() => {
    if (!isReady || !user || !embeddedWallet) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      setRuntime((state) => ({ ...state, loading: true, error: null }));
      try {
        const embeddedProvider = await embeddedWallet.getProvider();
        const web3Provider = new ethers.providers.Web3Provider(embeddedProvider as any);
        const signer = web3Provider.getSigner(embeddedWallet.address);
        const { service, discovery } = await createSmartWalletServiceFromSigner(
          signer,
          preferredCandidateKey,
          async () => (await getAccessToken()) ?? null,
        );
        if (cancelled) {
          return;
        }
        setRuntime({
          loading: false,
          service,
          discovery,
          error: null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setRuntime({
          loading: false,
          service: null,
          discovery: null,
          error: (error as Error).message,
        });
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [embeddedWallet, getAccessToken, isReady, preferredCandidateKey, user]);

  const oauthLoading = oauthState.status === "loading";
  const selectedCandidateKey =
    preferredCandidateKey && runtime.discovery?.candidates.some((candidate) => candidate.key === preferredCandidateKey)
      ? preferredCandidateKey
      : runtime.discovery?.selectedCandidateKey;
  const walletInitializing =
    Boolean(user) &&
    !runtime.error &&
    (!embeddedWallet || runtime.loading || !runtime.service || !runtime.discovery);

  if (!isReady) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.stateText}>Initializing Privy…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loginWrap}>
          <Text style={styles.loginBrand}>SFLUV</Text>
          <Text style={styles.loginTitle}>A community currency for San Francisco</Text>
          <Text style={styles.loginBody}>Sign in to send, receive, and redeem SFLUV.</Text>
          <Pressable
            style={[styles.loginButton, oauthLoading ? styles.loginButtonDisabled : undefined]}
            disabled={oauthLoading}
            onPress={async () => {
              try {
                await login({ provider: "google" });
              } catch (error) {
                setRuntime({
                  loading: false,
                  service: null,
                  discovery: null,
                  error: (error as Error).message,
                });
              }
            }}
          >
            <Text style={styles.loginButtonText}>{oauthLoading ? "Connecting..." : "Continue with Google"}</Text>
          </Pressable>
          {runtime.error ? <Text style={styles.errorText}>{runtime.error}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  const ownerBadge = runtime.discovery?.ownerAddress
    ? `${runtime.discovery.ownerAddress.slice(0, 6)}...${runtime.discovery.ownerAddress.slice(-4)}`
    : undefined;

  return (
    <WalletAppShell
      runtime={{ ...runtime, loading: walletInitializing }}
      selectedCandidateKey={selectedCandidateKey}
      onSelectCandidate={(key) => setPreferredCandidateKey(key)}
      ownerBadge={ownerBadge}
      onLogout={() => {
        void logout();
      }}
      backendClient={backendClient}
      pendingLinkIntent={pendingLinkIntent}
      onConsumePendingLink={() => setPendingLinkIntent(null)}
    />
  );
}

function MissingPrivyConfigScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centerState}>
        <Text style={styles.errorText}>Privy configuration is required for this build.</Text>
        <Text style={styles.stateText}>Set `EXPO_PUBLIC_PRIVY_APP_ID` and `EXPO_PUBLIC_PRIVY_CLIENT_ID` to run the app.</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  if (!mobileConfig.privyAppId.trim().length) {
    return <MissingPrivyConfigScreen />;
  }

  const supportedChain = {
    id: mobileConfig.chainId,
    name: `Berachain ${mobileConfig.chainId}`,
    nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
    rpcUrls: {
      default: { http: [mobileConfig.rpcURL] },
      public: { http: [mobileConfig.rpcURL] },
    },
  } as any;

  return (
    <PrivyProvider
      appId={mobileConfig.privyAppId}
      clientId={mobileConfig.privyClientId || undefined}
      supportedChains={[supportedChain]}
      config={{
        embedded: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <PrivyWalletApp />
    </PrivyProvider>
  );
}

const createStyles = (palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.background,
  },
  topOrbLarge: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: isDark ? "rgba(239,109,102,0.12)" : "rgba(239,109,102,0.07)",
    top: -90,
    right: -20,
  },
  topOrbSmall: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: isDark ? "rgba(239,109,102,0.08)" : "rgba(239,109,102,0.05)",
    top: 60,
    left: -40,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  topTitleWrap: {
    flex: 1,
    gap: 4,
  },
  brandKicker: {
    color: palette.primaryStrong,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  brand: {
    color: palette.primaryStrong,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  topMeta: {
    color: palette.textMuted,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: {
    backgroundColor: palette.primarySoft,
  },
  contentShell: {
    flex: 1,
    backgroundColor: palette.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: "hidden",
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: palette.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#f3c8c2",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bannerText: {
    color: palette.primaryStrong,
    flex: 1,
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  stateText: {
    color: palette.textMuted,
    textAlign: "center",
  },
  errorText: {
    color: palette.danger,
    textAlign: "center",
    lineHeight: 20,
  },
  bottomDock: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: 8,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadows.card,
  },
  bottomTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    paddingVertical: 10,
    gap: 4,
  },
  bottomTabActive: {
    backgroundColor: palette.primarySoft,
  },
  bottomTabText: {
    color: palette.textMuted,
    fontWeight: "800",
    fontSize: 11,
  },
  bottomTabTextActive: {
    color: palette.primaryStrong,
  },
  loginWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: spacing.md,
  },
  loginBrand: {
    color: palette.primaryStrong,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  loginTitle: {
    color: palette.primaryStrong,
    fontSize: 38,
    fontWeight: "900",
    lineHeight: 42,
  },
  loginBody: {
    color: palette.textMuted,
    lineHeight: 22,
    maxWidth: 340,
  },
  loginButton: {
    marginTop: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 22,
    paddingVertical: 16,
    minWidth: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: palette.text,
    fontWeight: "900",
    fontSize: 16,
  },
  sendingOverlay: {
    flex: 1,
    backgroundColor: palette.overlay,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  sendingCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.primary,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  sendingTitle: {
    color: palette.primaryStrong,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  sendingText: {
    color: palette.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  dismissButton: {
    marginTop: spacing.xs,
    minWidth: 140,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: palette.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissButtonText: {
    color: palette.white,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  walletChooserCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.primary,
    padding: spacing.lg,
    maxHeight: "72%",
    ...shadows.card,
  },
  walletChooserHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  walletChooserTitle: {
    color: palette.primaryStrong,
    fontSize: 24,
    fontWeight: "900",
  },
  walletChooserSubtitle: {
    color: palette.textMuted,
    marginTop: 4,
  },
  walletChooserClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  walletChooserList: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  walletChooserOption: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    padding: spacing.md,
    gap: 8,
  },
  walletChooserOptionActive: {
    borderColor: palette.primary,
    backgroundColor: palette.primarySoft,
  },
  walletChooserOptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  walletChooserOptionTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "800",
  },
  walletChooserActiveBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primaryStrong,
  },
  walletChooserBalance: {
    color: palette.text,
    fontWeight: "900",
    fontSize: 18,
  },
  walletChooserAddress: {
    color: palette.textMuted,
    fontSize: 13,
    fontFamily: "Courier",
  },
});

const styles = createStyles(lightPalette, shadows, false);
