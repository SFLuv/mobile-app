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
  TextInput,
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
  useLoginWithEmail,
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
  clearCachedRouteDiscovery,
  createSmartWalletServiceFromSigner,
  createSmartWalletServiceForIndex,
  RouteCandidate,
  RouteDiscovery,
  SmartWalletService,
} from "./src/services/smartWallet";
import { AppBackendAuthError, AppBackendClient } from "./src/services/appBackend";
import {
  AppContact,
  AppLocation,
  AppTransaction,
  AppUser,
  AppWallet,
} from "./src/types/app";
import { AppPreferences, defaultAppPreferences } from "./src/types/preferences";
import { SfluvUniversalLink, parseSfluvUniversalLink } from "./src/utils/universalLinks";
import {
  AppThemeProvider,
  Palette,
  getShadows,
  radii,
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
  recipientLabel?: string;
  recipientKind?: "contact" | "merchant";
};

type SendDraftOptions = {
  returnTab?: Tab | null;
};

type RedeemFlowState = {
  code: string;
  stage: "awaiting_wallet" | "redeeming" | "success" | "error";
  message?: string;
};

type ToastState = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
};

type Tab = "wallet" | "activity" | "map" | "contacts" | "settings";
type WalletPane = "home" | "send" | "receive";

const PREFERENCES_STORAGE_KEY = "sfluv-wallet:preferences";
const PUSH_TOKEN_STORAGE_KEY = "sfluv-wallet:push-token";
const WALLET_PREFERENCES_STORAGE_KEY_PREFIX = "sfluv-wallet:wallet-preferences";
const TRANSFER_REFRESH_DEBOUNCE_MS = 350;
const TRANSACTION_POLL_INTERVAL_MS = 2_000;
const WALLET_TRANSACTION_LIMIT = 5;
const ACTIVITY_TRANSACTION_PAGE_SIZE = 10;

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

function walletDisplayName(
  wallets: AppWallet[],
  address: string | undefined,
  smartIndex: number | undefined,
): string {
  const normalizedAddress = normalizeWalletAddress(address);
  if (normalizedAddress) {
    const matchingWallet = wallets.find((wallet) => {
      const candidateAddress = wallet.smartAddress ?? wallet.eoaAddress;
      return candidateAddress.toLowerCase() === normalizedAddress.toLowerCase();
    });
    const namedWallet = matchingWallet?.name.trim();
    if (namedWallet) {
      return namedWallet;
    }
  }
  return walletLabel(smartIndex);
}

function sortWalletsForSettings(wallets: AppWallet[]): AppWallet[] {
  return [...wallets].sort((left, right) => {
    if (left.isEoa !== right.isEoa) {
      return left.isEoa ? 1 : -1;
    }
    const leftIndex = typeof left.smartIndex === "number" ? left.smartIndex : Number.POSITIVE_INFINITY;
    const rightIndex = typeof right.smartIndex === "number" ? right.smartIndex : Number.POSITIVE_INFINITY;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return (left.name || "").localeCompare(right.name || "", undefined, { sensitivity: "base" });
  });
}

type StoredWalletPreferences = {
  defaultWalletAddress?: string;
  hiddenWalletAddresses: string[];
};

function walletPreferencesStorageKey(userID: string): string {
  return `${WALLET_PREFERENCES_STORAGE_KEY_PREFIX}:${userID}`;
}

function normalizeWalletAddress(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || !ethers.utils.isAddress(trimmed)) {
    return undefined;
  }
  return ethers.utils.getAddress(trimmed);
}

function normalizeHiddenWalletAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const address of addresses) {
    const next = normalizeWalletAddress(address);
    if (!next) {
      continue;
    }
    const key = next.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

function deriveStoredWalletPreferences(user: AppUser, wallets: AppWallet[]): StoredWalletPreferences {
  return {
    defaultWalletAddress: normalizeWalletAddress(user.primaryWalletAddress),
    hiddenWalletAddresses: normalizeHiddenWalletAddresses(
      wallets
        .filter((wallet) => !wallet.isEoa && wallet.isHidden && wallet.smartAddress)
        .map((wallet) => wallet.smartAddress ?? ""),
    ),
  };
}

function resolveCandidateKeyForAddress(
  address: string | undefined,
  candidates: RouteCandidate[],
): string | undefined {
  const normalizedAddress = normalizeWalletAddress(address);
  if (!normalizedAddress) {
    return undefined;
  }
  return candidates.find((candidate) => candidate.accountAddress.toLowerCase() === normalizedAddress.toLowerCase())?.key;
}

function resolveCandidateKeyWithPreferences({
  candidates,
  requestedCandidateKey,
  discoverySelectedCandidateKey,
  defaultWalletAddress,
  hiddenWalletAddresses,
}: {
  candidates: RouteCandidate[];
  requestedCandidateKey?: string;
  discoverySelectedCandidateKey?: string;
  defaultWalletAddress?: string;
  hiddenWalletAddresses?: string[];
}): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const normalizedDefaultWallet = normalizeWalletAddress(defaultWalletAddress);
  const hiddenWalletSet = new Set(normalizeHiddenWalletAddresses(hiddenWalletAddresses ?? []).map((address) => address.toLowerCase()));
  const requestedCandidate = requestedCandidateKey
    ? candidates.find((candidate) => candidate.key === requestedCandidateKey)
    : undefined;
  if (requestedCandidate) {
    return requestedCandidate.key;
  }
  const defaultCandidate = normalizedDefaultWallet
    ? candidates.find((candidate) => candidate.accountAddress.toLowerCase() === normalizedDefaultWallet.toLowerCase())
    : undefined;
  if (defaultCandidate) {
    return defaultCandidate.key;
  }

  const visibleCandidates = candidates.filter((candidate) => !hiddenWalletSet.has(candidate.accountAddress.toLowerCase()));
  const visibleDiscoveryCandidate =
    discoverySelectedCandidateKey &&
    visibleCandidates.find((candidate) => candidate.key === discoverySelectedCandidateKey);
  if (visibleDiscoveryCandidate) {
    return visibleDiscoveryCandidate.key;
  }

  if (visibleCandidates.length > 0) {
    return visibleCandidates[0].key;
  }

  if (discoverySelectedCandidateKey) {
    const discoveryCandidate = candidates.find((candidate) => candidate.key === discoverySelectedCandidateKey);
    if (discoveryCandidate) {
      return discoveryCandidate.key;
    }
  }

  return candidates[0]?.key;
}

function eoaWalletName(walletOrder: number): string {
  return `EOA-${walletOrder + 1}`;
}

function smartWalletName(walletOrder: number, smartIndex: number, isNewAccount: boolean): string {
  if (smartIndex === 0 && isNewAccount) {
    return "Primary Wallet";
  }
  return `SW-${walletOrder + 1}-${smartIndex + 1}`;
}

async function ensureManagedEmbeddedWallets({
  backendClient,
  signer,
  ownerAddress,
  candidates,
  isNewAccount,
  getAccessToken,
}: {
  backendClient: AppBackendClient;
  signer: ethers.Signer;
  ownerAddress: string;
  candidates: RouteCandidate[];
  isNewAccount: boolean;
  getAccessToken: () => Promise<string | null>;
}): Promise<{ latestWallets: AppWallet[]; deployedPrimarySmartWallet: boolean }> {
  let latestWallets = await backendClient.getWallets();
  const normalizedOwner = ethers.utils.getAddress(ownerAddress);

  const hasEOAWallet = latestWallets.some(
    (wallet) => wallet.isEoa && wallet.eoaAddress.toLowerCase() === normalizedOwner.toLowerCase(),
  );
  if (!hasEOAWallet) {
    await backendClient.addWallet({
      owner: "",
      name: eoaWalletName(0),
      isEoa: true,
      isHidden: false,
      isRedeemer: false,
      isMinter: false,
      eoaAddress: normalizedOwner,
    });
    latestWallets = await backendClient.getWallets();
  }

  const sortedCandidates = [...candidates].sort((left, right) => left.smartIndex - right.smartIndex);
  const existingSmartWallets = new Set(
    latestWallets
      .filter((wallet) => !wallet.isEoa && wallet.smartAddress && typeof wallet.smartIndex === "number")
      .map((wallet) => `${wallet.smartIndex}:${wallet.smartAddress?.toLowerCase()}`),
  );

  for (const candidate of sortedCandidates) {
    const walletKey = `${candidate.smartIndex}:${candidate.accountAddress.toLowerCase()}`;
    if (existingSmartWallets.has(walletKey)) {
      continue;
    }

    await backendClient.addWallet({
      owner: "",
      name: smartWalletName(0, candidate.smartIndex, isNewAccount),
      isEoa: false,
      isHidden: false,
      isRedeemer: false,
      isMinter: false,
      eoaAddress: normalizedOwner,
      smartAddress: candidate.accountAddress,
      smartIndex: candidate.smartIndex,
    });
    existingSmartWallets.add(walletKey);
  }

  if (sortedCandidates.length > 0) {
    latestWallets = await backendClient.getWallets();
  }

  const primaryCandidate = sortedCandidates.find((candidate) => candidate.smartIndex === 0);
  if (!primaryCandidate || primaryCandidate.deployed) {
    return { latestWallets, deployedPrimarySmartWallet: false };
  }

  const primaryService = await createSmartWalletServiceForIndex(
    signer,
    0,
    getAccessToken,
    primaryCandidate.accountAddress,
  );
  const deployedPrimarySmartWallet = await primaryService.ensureSmartWalletDeployed();
  if (deployedPrimarySmartWallet) {
    latestWallets = await backendClient.getWallets();
  }

  return { latestWallets, deployedPrimarySmartWallet };
}

async function ensureDefaultPrimaryWalletAssignment(
  backendClient: AppBackendClient,
  currentUser: AppUser,
  walletList: AppWallet[],
  primaryEoaAddress: string,
): Promise<string> {
  const existingPrimaryWallet = currentUser.primaryWalletAddress?.trim();
  if (existingPrimaryWallet) {
    return existingPrimaryWallet;
  }

  const normalizedPrimaryEoa = ethers.utils.getAddress(primaryEoaAddress).toLowerCase();
  const preferredSmartWallet = walletList.find(
    (wallet) =>
      !wallet.isEoa &&
      wallet.smartIndex === 0 &&
      wallet.eoaAddress.toLowerCase() === normalizedPrimaryEoa &&
      typeof wallet.smartAddress === "string" &&
      wallet.smartAddress.trim().length > 0,
  );
  const fallbackSmartWallet = walletList.find(
    (wallet) =>
      !wallet.isEoa &&
      wallet.smartIndex === 0 &&
      typeof wallet.smartAddress === "string" &&
      wallet.smartAddress.trim().length > 0,
  );

  const nextPrimaryWallet = preferredSmartWallet?.smartAddress ?? fallbackSmartWallet?.smartAddress ?? "";
  if (!nextPrimaryWallet) {
    return "";
  }
  return backendClient.updatePrimaryWallet(nextPrimaryWallet);
}

function transactionIdentity(tx: Pick<AppTransaction, "hash" | "amount" | "from" | "to">): string {
  return `${tx.hash}:${tx.amount}:${tx.from}:${tx.to}`.toLowerCase();
}

function transactionLookupKey(tx: Pick<AppTransaction, "id" | "hash" | "amount" | "from" | "to">): string {
  const trimmedID = tx.id.trim();
  if (trimmedID) {
    return `id:${trimmedID.toLowerCase()}`;
  }
  return `identity:${transactionIdentity(tx)}`;
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

function hasNewTransactions(current: AppTransaction[], incoming: AppTransaction[]): boolean {
  const existingKeys = new Set(current.map((tx) => transactionLookupKey(tx)));
  return incoming.some((tx) => !existingKeys.has(transactionLookupKey(tx)));
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

function useStoredPreferences(): [AppPreferences, React.Dispatch<React.SetStateAction<AppPreferences>>] {
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

  return [preferences, setPreferences];
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
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
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
  backendBootstrapReady,
  walletPreferences,
  onWalletPreferencesSync,
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
  backendBootstrapReady: boolean;
  walletPreferences: StoredWalletPreferences;
  onWalletPreferencesSync: (user: AppUser, wallets: AppWallet[]) => void;
  pendingLinkIntent: PendingLinkIntent | null;
  onConsumePendingLink: () => void;
  preferences: AppPreferences;
  onUpdatePreferences: (next: AppPreferences) => void;
}) {
  return (
    <WalletAppShellContent
      runtime={runtime}
      selectedCandidateKey={selectedCandidateKey}
      onSelectCandidate={onSelectCandidate}
      ownerBadge={ownerBadge}
      onLogout={onLogout}
      backendClient={backendClient}
      backendBootstrapReady={backendBootstrapReady}
      walletPreferences={walletPreferences}
      onWalletPreferencesSync={onWalletPreferencesSync}
      pendingLinkIntent={pendingLinkIntent}
      onConsumePendingLink={onConsumePendingLink}
      preferences={preferences}
      onUpdatePreferences={onUpdatePreferences}
    />
  );
}

function WalletAppShellContent({
  runtime,
  selectedCandidateKey,
  onSelectCandidate,
  ownerBadge,
  onLogout,
  backendClient,
  backendBootstrapReady,
  walletPreferences,
  onWalletPreferencesSync,
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
  backendBootstrapReady: boolean;
  walletPreferences: StoredWalletPreferences;
  onWalletPreferencesSync: (user: AppUser, wallets: AppWallet[]) => void;
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
  const [walletTransactions, setWalletTransactions] = useState<AppTransaction[]>([]);
  const [activityTransactions, setActivityTransactions] = useState<AppTransaction[]>([]);
  const [walletTransactionsLoaded, setWalletTransactionsLoaded] = useState(false);
  const [activityTransactionsLoaded, setActivityTransactionsLoaded] = useState(false);
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [locations, setLocations] = useState<AppLocation[]>([]);
  const [backendWallets, setBackendWallets] = useState<AppWallet[]>([]);
  const [merchantLabelsByAddress, setMerchantLabelsByAddress] = useState<Record<string, string>>({});
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [storedPushToken, setStoredPushToken] = useState<string | null>(null);
  const [refreshingHome, setRefreshingHome] = useState(false);
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState(false);
  const [activityPageCount, setActivityPageCount] = useState(1);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [merchantMapViewMode, setMerchantMapViewMode] = useState<"map" | "list">("map");
  const [sendDraft, setSendDraft] = useState<SendDraft | null>(null);
  const [sendReturnTab, setSendReturnTab] = useState<Tab | null>(null);
  const [redeemFlow, setRedeemFlow] = useState<RedeemFlowState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const walletSurfaceRequestRef = useRef(0);
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const transferRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendAuthFailureHandledRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeServiceRef = useRef<SmartWalletService | null>(runtime.service);
  const smartAddressRef = useRef(smartAddress);
  const walletTransactionsRef = useRef<AppTransaction[]>(walletTransactions);
  const activityTransactionsRef = useRef<AppTransaction[]>(activityTransactions);
  const merchantLabelsRef = useRef<Record<string, string>>(merchantLabelsByAddress);
  const walletCandidates = runtime.discovery?.candidates ?? [];
  const hiddenWalletSet = useMemo(
    () => new Set(walletPreferences.hiddenWalletAddresses.map((address) => address.toLowerCase())),
    [walletPreferences.hiddenWalletAddresses],
  );
  const selectedCandidate = useMemo(
    () => walletCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? walletCandidates[0],
    [selectedCandidateKey, walletCandidates],
  );
  const walletChooserCandidates = useMemo(() => {
    const selectedKey = selectedCandidate?.key;
    const normalizedDefaultWallet = walletPreferences.defaultWalletAddress?.toLowerCase();
    return walletCandidates.filter((candidate) => {
      const normalizedAddress = candidate.accountAddress.toLowerCase();
      if (!hiddenWalletSet.has(normalizedAddress)) {
        return true;
      }
      return candidate.key === selectedKey || normalizedAddress === normalizedDefaultWallet;
    });
  }, [hiddenWalletSet, selectedCandidate?.key, walletCandidates, walletPreferences.defaultWalletAddress]);
  const settingsWallets = useMemo(() => sortWalletsForSettings(backendWallets), [backendWallets]);
  const selectedWalletLabel = useMemo(
    () =>
      selectedCandidate
        ? walletDisplayName(backendWallets, selectedCandidate.accountAddress, selectedCandidate.smartIndex)
        : undefined,
    [backendWallets, selectedCandidate],
  );
  const canChooseWallet = walletChooserCandidates.length > 1;
  const walletSyncReady = backendBootstrapReady && Boolean(appUser) && Boolean(runtime.discovery);
  const walletHistoryActive = tab === "wallet" && walletPane === "home";
  const activityHistoryActive = tab === "activity";
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
    runtimeServiceRef.current = runtime.service;
  }, [runtime.service]);

  useEffect(() => {
    smartAddressRef.current = smartAddress;
  }, [smartAddress]);

  useEffect(() => {
    walletTransactionsRef.current = walletTransactions;
  }, [walletTransactions]);

  useEffect(() => {
    activityTransactionsRef.current = activityTransactions;
  }, [activityTransactions]);

  useEffect(() => {
    merchantLabelsRef.current = merchantLabelsByAddress;
  }, [merchantLabelsByAddress]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
      toastTimeoutRef.current = null;
    }, 2600);

    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [toast]);

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    setToast({
      id: Date.now(),
      tone,
      message,
    });
  };

  useEffect(() => {
    setMerchantLabelsByAddress((current) => {
      let changed = false;
      const next = { ...current };
      for (const location of locations) {
        if (!location.payToAddress) {
          continue;
        }
        const normalizedAddress = location.payToAddress.toLowerCase();
        const normalizedName = location.name.trim();
        if (!normalizedName || next[normalizedAddress] === normalizedName) {
          continue;
        }
        next[normalizedAddress] = normalizedName;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [locations]);

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

    try {
      const profile = await backendClient.ensureUser();
      setAppUser(profile.user);
      setBackendWallets(profile.wallets);
      onWalletPreferencesSync(profile.user, profile.wallets);
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
    }
  };

  const ensureTransactionMerchantLabels = async (transactions: AppTransaction[]) => {
    if (!backendClient || transactions.length === 0) {
      return;
    }

    const contactAddresses = new Set(contacts.map((contact) => contact.address.toLowerCase()));
    const knownMerchantAddresses = new Set(
      locations
        .map((location) => location.payToAddress?.toLowerCase())
        .filter((address): address is string => Boolean(address)),
    );

    const uniqueAddresses = new Set<string>();
    for (const tx of transactions) {
      uniqueAddresses.add(tx.from.toLowerCase());
      uniqueAddresses.add(tx.to.toLowerCase());
    }

    const toLookup = Array.from(uniqueAddresses).filter((address) => {
      if (contactAddresses.has(address) || knownMerchantAddresses.has(address)) {
        return false;
      }
      return !Object.prototype.hasOwnProperty.call(merchantLabelsRef.current, address);
    });

    if (toLookup.length === 0) {
      return;
    }

    const resolvedLabels = await Promise.all(
      toLookup.map(async (address) => ({
        address,
        label: await backendClient.lookupMerchantWalletLabel(address),
      })),
    );

    setMerchantLabelsByAddress((current) => {
      const next = { ...current };
      for (const entry of resolvedLabels) {
        next[entry.address] = entry.label?.trim() || "";
      }
      return next;
    });
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

  const refreshSelectedWalletBalance = async (options?: {
    requestID?: number;
    service?: SmartWalletService | null;
    silent?: boolean;
  }) => {
    const service = options?.service ?? runtimeServiceRef.current;
    if (!service) {
      return;
    }

    const requestID = options?.requestID ?? walletSurfaceRequestRef.current;
    try {
      const balance = await service.smartAccountBalance();
      if (walletSurfaceRequestRef.current !== requestID || runtimeServiceRef.current !== service) {
        return;
      }
      setSmartBalance(formatDisplayBalance(balance));
    } catch (error) {
      if (!options?.silent) {
        console.warn("Unable to load wallet balance", error);
      }
    }
  };

  const refreshWalletTransactionsFromBackend = async (address: string, options?: { silent?: boolean }) => {
    if (!backendClient) {
      return false;
    }

    try {
      const nextTransactions = await backendClient.getTransactions(address, 0, WALLET_TRANSACTION_LIMIT);
      const normalizedAddress = address.toLowerCase();
      const activeAddress = smartAddressRef.current.toLowerCase();
      if (activeAddress && activeAddress !== normalizedAddress) {
        return false;
      }

      setWalletTransactionsLoaded(true);
      void ensureTransactionMerchantLabels(nextTransactions);
      const foundNewTransactions = hasNewTransactions(walletTransactionsRef.current, nextTransactions);
      setWalletTransactions((current) => mergeTransactions(current, nextTransactions, WALLET_TRANSACTION_LIMIT));
      if (foundNewTransactions) {
        await refreshSelectedWalletBalance({ silent: true });
      }
      return foundNewTransactions;
    } catch (error) {
      if (!options?.silent) {
        console.warn("Unable to load wallet transaction history from app backend", error);
      }
      return false;
    }
  };

  const refreshActivityTransactionsFromBackend = async (address: string, options?: { silent?: boolean }) => {
    if (!backendClient) {
      return false;
    }

    try {
      const nextTransactions = await backendClient.getTransactions(address, 0, ACTIVITY_TRANSACTION_PAGE_SIZE);
      const normalizedAddress = address.toLowerCase();
      const activeAddress = smartAddressRef.current.toLowerCase();
      if (activeAddress && activeAddress !== normalizedAddress) {
        return false;
      }

      setActivityTransactionsLoaded(true);
      void ensureTransactionMerchantLabels(nextTransactions);
      const foundNewTransactions = hasNewTransactions(activityTransactionsRef.current, nextTransactions);
      const currentVisibleCount = Math.max(ACTIVITY_TRANSACTION_PAGE_SIZE, activityPageCount * ACTIVITY_TRANSACTION_PAGE_SIZE);
      setActivityTransactions((current) => mergeTransactions(current, nextTransactions, currentVisibleCount));
      if (activityPageCount === 1) {
        setActivityHasMore(nextTransactions.length === ACTIVITY_TRANSACTION_PAGE_SIZE);
      }
      if (foundNewTransactions) {
        await refreshSelectedWalletBalance({ silent: true });
      }
      return foundNewTransactions;
    } catch (error) {
      if (!options?.silent) {
        console.warn("Unable to load activity transaction history from app backend", error);
      }
      return false;
    }
  };

  const loadMoreActivityTransactions = async () => {
    if (!backendClient || !smartAddress || loadingMoreActivity || !activityHasMore) {
      return;
    }

    const nextPage = activityPageCount;
    const normalizedAddress = smartAddress.toLowerCase();
    setLoadingMoreActivity(true);
    try {
      const nextTransactions = await backendClient.getTransactions(smartAddress, nextPage, ACTIVITY_TRANSACTION_PAGE_SIZE);
      if (smartAddressRef.current.toLowerCase() !== normalizedAddress) {
        return;
      }

      if (nextTransactions.length > 0) {
        const nextPageCount = activityPageCount + 1;
        setActivityTransactions((current) =>
          mergeTransactions(current, nextTransactions, nextPageCount * ACTIVITY_TRANSACTION_PAGE_SIZE),
        );
        setActivityPageCount(nextPageCount);
      }
      setActivityHasMore(nextTransactions.length === ACTIVITY_TRANSACTION_PAGE_SIZE);
    } catch (error) {
      console.warn("Unable to load more transaction history", error);
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const refreshWalletSurface = async () => {
    const requestID = walletSurfaceRequestRef.current + 1;
    walletSurfaceRequestRef.current = requestID;

    if (!runtime.service) {
      setSmartAddress("");
      setSmartBalance("...");
      setWalletTransactions([]);
      setActivityTransactions([]);
      setWalletTransactionsLoaded(false);
      setActivityTransactionsLoaded(false);
      setActivityPageCount(1);
      setActivityHasMore(true);
      return;
    }

    try {
      const service = runtime.service;
      const address = await service.smartAccountAddress();
      if (walletSurfaceRequestRef.current !== requestID) {
        return;
      }

      const nextAddress = ethers.utils.getAddress(address);
      const previousAddress = smartAddressRef.current;
      const addressChanged = previousAddress.toLowerCase() !== nextAddress.toLowerCase();
      setSmartAddress(nextAddress);
      if (addressChanged) {
        setWalletTransactions([]);
        setActivityTransactions([]);
        setWalletTransactionsLoaded(false);
        setActivityTransactionsLoaded(false);
        setActivityPageCount(1);
        setActivityHasMore(true);
        setLoadingMoreActivity(false);
        setRefreshingActivity(false);
      }

      const seededBalance =
        selectedCandidate && selectedCandidate.accountAddress.toLowerCase() === nextAddress.toLowerCase()
          ? formatDisplayBalance(selectedCandidate.tokenBalance)
          : null;
      setSmartBalance(seededBalance ?? "...");
      void refreshSelectedWalletBalance({ requestID, service, silent: true });
    } catch (error) {
      console.warn("Unable to refresh wallet surface", error);
      setSyncNotice(describeAppBackendIssue(error));
    }
  };

  useEffect(() => {
    void loadPublicLocations();
  }, []);

  useEffect(() => {
    if (!backendBootstrapReady) {
      return;
    }
    void loadAppProfile();
  }, [backendBootstrapReady, backendClient]);

  useEffect(() => {
    void refreshWalletSurface();
  }, [runtime.service, runtime.discovery, selectedCandidateKey, backendClient]);

  useEffect(() => {
    if (!backendClient || !smartAddress || !walletHistoryActive) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      await refreshWalletTransactionsFromBackend(smartAddress, { silent: true });
    };

    void poll();
    const interval = setInterval(() => {
      if (appIsActiveRef.current) {
        void poll();
      }
    }, TRANSACTION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [backendClient, smartAddress, walletHistoryActive]);

  useEffect(() => {
    if (!backendClient || !smartAddress || !activityHistoryActive) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      await refreshActivityTransactionsFromBackend(smartAddress, { silent: true });
    };

    void poll();
    const interval = setInterval(() => {
      if (appIsActiveRef.current) {
        void poll();
      }
    }, TRANSACTION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activityHistoryActive, activityPageCount, backendClient, smartAddress]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const isActive = nextState === "active";
      const wasActive = appIsActiveRef.current;
      appIsActiveRef.current = isActive;

      if (!wasActive && isActive) {
        void refreshWalletSurface();
        if (smartAddressRef.current) {
          if (walletHistoryActive) {
            void refreshWalletTransactionsFromBackend(smartAddressRef.current, { silent: true });
          }
          if (activityHistoryActive) {
            void refreshActivityTransactionsFromBackend(smartAddressRef.current, { silent: true });
          }
        }
        if (backendBootstrapReady) {
          void loadAppProfile();
        }
        void loadPublicLocations();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    activityHistoryActive,
    backendBootstrapReady,
    backendClient,
    publicBackendClient,
    runtime.service,
    runtime.discovery,
    selectedCandidateKey,
    walletHistoryActive,
  ]);

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
              if (smartAddressRef.current) {
                if (walletHistoryActive) {
                  void refreshWalletTransactionsFromBackend(smartAddressRef.current, { silent: true });
                }
                if (activityHistoryActive) {
                  void refreshActivityTransactionsFromBackend(smartAddressRef.current, { silent: true });
                }
              }
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
  }, [activityHistoryActive, runtime.service, runtime.discovery, selectedCandidateKey, walletHistoryActive]);

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

  const finishSendFlow = () => {
    const returnTab = sendReturnTab;
    setSendReturnTab(null);
    setWalletPane("home");
    setTab(returnTab ?? "wallet");
  };

  const handleRenameWallet = async (wallet: AppWallet, nextName: string) => {
    if (!backendClient) {
      throw new Error("Backend not configured.");
    }
    await backendClient.updateWallet({
      ...wallet,
      name: nextName.trim(),
    });
    await loadAppProfile();
  };

  const handleSetWalletVisibility = async (wallet: AppWallet, shouldShow: boolean) => {
    if (!backendClient) {
      throw new Error("Backend not configured.");
    }
    await backendClient.updateWallet({
      ...wallet,
      isHidden: !shouldShow,
    });
    await loadAppProfile();
  };

  const handleSetPrimaryWallet = async (address: string) => {
    if (!backendClient) {
      throw new Error("Backend not configured.");
    }
    await backendClient.updatePrimaryWallet(address);
    await loadAppProfile();
  };

  const handleSend = async (recipient: string, amount: string, unit: "wei" | "token", memo: string) => {
    if (!runtime.service) {
      throw new Error("Wallet signer is not ready.");
    }

    const result = await runtime.service.sendSFLUV(recipient, amount, unit);
    if (memo.trim() && result.txHash && backendClient) {
      void backendClient.saveTransactionMemo(result.txHash, memo).catch(() => {
        // Memo save failure should not block the transfer UX.
      });
    }
    emitTransferHaptic();
    const activeAddress = smartAddressRef.current || selectedCandidate?.accountAddress || "";
    void refreshSelectedWalletBalance({ silent: true });
    if (activeAddress) {
      void refreshWalletTransactionsFromBackend(activeAddress, { silent: true });
      void refreshActivityTransactionsFromBackend(activeAddress, { silent: true });
    }
    void loadAppProfile();
    showToast(result.txHash ? "Payment confirmed." : "Payment submitted.", "success");
    return result;
  };

  const refreshEverything = async () => {
    const activeAddress = smartAddressRef.current;
    await refreshSelectedWalletBalance({ silent: true });
    if (activeAddress) {
      await Promise.all([
        refreshWalletTransactionsFromBackend(activeAddress, { silent: true }),
        refreshActivityTransactionsFromBackend(activeAddress, { silent: true }),
      ]);
    }
    if (backendBootstrapReady) {
      await loadAppProfile();
    }
    await loadPublicLocations();
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
                : selectedWalletLabel
                  ? `${selectedWalletLabel} selected`
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
        </View>
      </View>

      <View style={styles.contentShell}>
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
                merchants={locations}
                backendClient={backendClient}
                hapticsEnabled={preferences.hapticsEnabled}
                onPrepareSend={handleSend}
                onCompleteFlow={finishSendFlow}
                draft={sendDraft}
                onDraftApplied={() => setSendDraft(null)}
                onOpenMerchantList={() => {
                  setMerchantMapViewMode("list");
                  setTab("map");
                }}
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
                selectedWalletLabel={selectedWalletLabel}
                recentTransactions={walletTransactions}
                transactionsLoaded={walletTransactionsLoaded}
                contacts={contacts}
                merchants={locations}
                merchantLabels={merchantLabelsByAddress}
                activeAddress={smartAddress}
                refreshing={refreshingHome}
                onRefresh={async () => {
                  setRefreshingHome(true);
                  try {
                    await refreshEverything();
                  } finally {
                    setRefreshingHome(false);
                  }
                }}
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
              transactions={activityTransactions}
              transactionsLoaded={activityTransactionsLoaded}
              contacts={contacts}
              merchants={locations}
              merchantLabels={merchantLabelsByAddress}
              activeAddress={smartAddress}
              selectedWalletLabel={selectedWalletLabel}
              refreshing={refreshingActivity}
              loadingMore={loadingMoreActivity}
              canLoadMore={activityHasMore}
              showWalletChooser={canChooseWallet}
              onOpenWalletChooser={() => {
                setShowWalletChooser(true);
              }}
              onRefresh={async () => {
                setRefreshingActivity(true);
                try {
                  if (smartAddressRef.current) {
                    await refreshActivityTransactionsFromBackend(smartAddressRef.current, { silent: true });
                  }
                  await refreshSelectedWalletBalance({ silent: true });
                } finally {
                  setRefreshingActivity(false);
                }
              }}
              onLoadMore={loadMoreActivityTransactions}
            />
          ) : tab === "map" ? (
            <MapScreen
              locations={locations}
              viewMode={merchantMapViewMode}
              onChangeViewMode={setMerchantMapViewMode}
              onPayLocation={(location) => {
                if (!location.payToAddress) {
                  showToast("Payment is not available for this merchant right now.", "error");
                  return;
                }
                openSendDraft({
                  recipient: location.payToAddress,
                  recipientLabel: location.name,
                  recipientKind: "merchant",
                }, { returnTab: "map" });
              }}
            />
          ) : tab === "contacts" ? (
            <ContactsScreen
              contacts={contacts}
              shareAddress={smartAddress}
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
              wallets={settingsWallets}
              primaryWalletAddress={appUser?.primaryWalletAddress}
              activeWalletAddress={smartAddress}
              activeWalletLabel={selectedWalletLabel}
              syncNotice={syncNotice}
              preferences={preferences}
              onLogout={onLogout}
              onRenameWallet={handleRenameWallet}
              onSetPrimaryWallet={handleSetPrimaryWallet}
              onSetWalletVisibility={handleSetWalletVisibility}
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
              setMerchantMapViewMode("map");
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

        {toast ? (
          <View
            style={[
              styles.toastCard,
              toast.tone === "error"
                ? styles.toastCardError
                : toast.tone === "success"
                  ? styles.toastCardSuccess
                  : styles.toastCardInfo,
            ]}
          >
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        ) : null}
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
              {walletChooserCandidates.map((candidate) => {
                const active = candidate.key === selectedCandidateKey;
                return (
	                  <Pressable
	                    key={candidate.key}
	                    style={[styles.walletChooserOption, active ? styles.walletChooserOptionActive : undefined]}
	                    onPress={() => {
	                      if (!active) {
	                        setWalletTransactions([]);
	                        setActivityTransactions([]);
	                        setWalletTransactionsLoaded(false);
	                        setActivityTransactionsLoaded(false);
	                        setActivityPageCount(1);
	                        setActivityHasMore(true);
	                      }
	                      onSelectCandidate(candidate.key);
	                      setShowWalletChooser(false);
                    }}
	                  >
                    <View style={styles.walletChooserOptionHeader}>
                      <Text style={styles.walletChooserOptionTitle}>
                        {walletDisplayName(backendWallets, candidate.accountAddress, candidate.smartIndex)}
                      </Text>
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

function PrivyWalletApp({
  preferences,
  onUpdatePreferences,
}: {
  preferences: AppPreferences;
  onUpdatePreferences: (next: AppPreferences) => void;
}) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const { user, isReady, logout, getAccessToken } = usePrivy();
  const { login, state: oauthState } = useLoginWithOAuth();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets, create } = useEmbeddedEthereumWallet();

  const [runtime, setRuntime] = useState<RuntimeState>(blankRuntime(true));
  const [preferredCandidateKey, setPreferredCandidateKey] = useState<string | undefined>(undefined);
  const [pendingLinkIntent, setPendingLinkIntent] = useState<PendingLinkIntent | null>(null);
  const [backendBootstrapReady, setBackendBootstrapReady] = useState(false);
  const [walletPreferencesReady, setWalletPreferencesReady] = useState(false);
  const [walletPreferences, setWalletPreferences] = useState<StoredWalletPreferences>({
    defaultWalletAddress: undefined,
    hiddenWalletAddresses: [],
  });
  const [loginMode, setLoginMode] = useState<"choice" | "email">("choice");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const creatingWalletRef = useRef(false);
  const bootstrappedIdentityRef = useRef<string | null>(null);
  const manualWalletSelectionRef = useRef(false);
  const nextPendingLinkIDRef = useRef(0);
  const embeddedWallet = wallets[0];

  const backendClient = useMemo(
    () => new AppBackendClient(async () => (await getAccessToken()) ?? null),
    [getAccessToken],
  );

  const presentLoginError = (error: unknown) => {
    const message = (error as Error)?.message?.trim() || "Unable to sign in right now.";
    setRuntime({
      loading: false,
      service: null,
      discovery: null,
      error: message,
    });
  };

  const syncWalletPreferences = (nextUser: AppUser, nextWallets: AppWallet[]) => {
    const storageUserID = nextUser.id || user?.id;
    if (!storageUserID) {
      return;
    }
    const nextPreferences = deriveStoredWalletPreferences(nextUser, nextWallets);
    setWalletPreferences(nextPreferences);
    AsyncStorage.setItem(walletPreferencesStorageKey(storageUserID), JSON.stringify(nextPreferences)).catch((error) => {
      console.warn("Unable to persist wallet preferences", error);
    });
  };

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
      setBackendBootstrapReady(false);
      setWalletPreferencesReady(false);
      setWalletPreferences({
        defaultWalletAddress: undefined,
        hiddenWalletAddresses: [],
      });
      setLoginMode("choice");
      setEmailAddress("");
      setEmailCode("");
      setEmailCodeSent(false);
      setEmailLoading(false);
      manualWalletSelectionRef.current = false;
      bootstrappedIdentityRef.current = null;
      return;
    }
    if (wallets.length > 0 || creatingWalletRef.current) {
      return;
    }

    creatingWalletRef.current = true;
    create({ createAdditional: false })
      .catch((error) => {
        presentLoginError(error);
      })
      .finally(() => {
        creatingWalletRef.current = false;
      });
  }, [create, isReady, user, wallets.length]);

  useEffect(() => {
    if (!isReady || !user?.id) {
      return;
    }

    let cancelled = false;
    setWalletPreferencesReady(false);
    AsyncStorage.getItem(walletPreferencesStorageKey(user.id))
      .then((raw) => {
        if (cancelled) {
          return;
        }
        if (!raw) {
          setWalletPreferences({
            defaultWalletAddress: undefined,
            hiddenWalletAddresses: [],
          });
          return;
        }
        try {
          const parsed = JSON.parse(raw) as Partial<StoredWalletPreferences>;
          setWalletPreferences({
            defaultWalletAddress: normalizeWalletAddress(parsed.defaultWalletAddress),
            hiddenWalletAddresses: normalizeHiddenWalletAddresses(Array.isArray(parsed.hiddenWalletAddresses) ? parsed.hiddenWalletAddresses : []),
          });
        } catch (error) {
          console.warn("Unable to parse cached wallet preferences", error);
          setWalletPreferences({
            defaultWalletAddress: undefined,
            hiddenWalletAddresses: [],
          });
        }
      })
      .catch((error) => {
        console.warn("Unable to load cached wallet preferences", error);
        if (!cancelled) {
          setWalletPreferences({
            defaultWalletAddress: undefined,
            hiddenWalletAddresses: [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWalletPreferencesReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isReady, user?.id]);

  useEffect(() => {
    if (!isReady || !user || !embeddedWallet || !walletPreferencesReady) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      setRuntime((state) => ({ ...state, loading: true, error: null }));
      try {
        const embeddedProvider = await embeddedWallet.getProvider();
        const web3Provider = new ethers.providers.Web3Provider(embeddedProvider as any);
        const signer = web3Provider.getSigner(embeddedWallet.address);
        const accessTokenProvider = async () => (await getAccessToken()) ?? null;
        let { service, discovery } = await createSmartWalletServiceFromSigner(
          signer,
          preferredCandidateKey,
          accessTokenProvider,
        );
        const initialPreferredCandidateKey = resolveCandidateKeyWithPreferences({
          candidates: discovery.candidates,
          requestedCandidateKey: preferredCandidateKey,
          discoverySelectedCandidateKey: discovery.selectedCandidateKey,
          defaultWalletAddress: walletPreferences.defaultWalletAddress,
          hiddenWalletAddresses: walletPreferences.hiddenWalletAddresses,
        });
        if (initialPreferredCandidateKey && initialPreferredCandidateKey !== discovery.selectedCandidateKey) {
          ({ service, discovery } = await createSmartWalletServiceFromSigner(
            signer,
            initialPreferredCandidateKey,
            accessTokenProvider,
          ));
        }
        const bootstrapKey = `${user.id}:${discovery.ownerAddress.toLowerCase()}`;

        if (bootstrappedIdentityRef.current !== bootstrapKey) {
          if (!cancelled) {
            setBackendBootstrapReady(false);
          }
          const profile = await backendClient.ensureUser();
          const { latestWallets, deployedPrimarySmartWallet } = await ensureManagedEmbeddedWallets({
            backendClient,
            signer,
            ownerAddress: discovery.ownerAddress,
            candidates: discovery.candidates,
            isNewAccount: profile.wallets.length === 0,
            getAccessToken: accessTokenProvider,
          });
          const updatedPrimaryWalletAddress =
            (await ensureDefaultPrimaryWalletAssignment(
              backendClient,
              profile.user,
              latestWallets,
              discovery.ownerAddress,
            )) || profile.user.primaryWalletAddress;
          const syncedUser = {
            ...profile.user,
            primaryWalletAddress: updatedPrimaryWalletAddress || profile.user.primaryWalletAddress,
          };
          const syncedWalletPreferences = deriveStoredWalletPreferences(syncedUser, latestWallets);
          syncWalletPreferences(syncedUser, latestWallets);
          const syncedPreferredCandidateKey = resolveCandidateKeyWithPreferences({
            candidates: discovery.candidates,
            requestedCandidateKey: preferredCandidateKey,
            discoverySelectedCandidateKey: discovery.selectedCandidateKey,
            defaultWalletAddress: syncedWalletPreferences.defaultWalletAddress,
            hiddenWalletAddresses: syncedWalletPreferences.hiddenWalletAddresses,
          });
          if (deployedPrimarySmartWallet) {
            clearCachedRouteDiscovery(discovery.ownerAddress);
          }
          if (deployedPrimarySmartWallet || (syncedPreferredCandidateKey && syncedPreferredCandidateKey !== discovery.selectedCandidateKey)) {
            ({ service, discovery } = await createSmartWalletServiceFromSigner(
              signer,
              syncedPreferredCandidateKey,
              accessTokenProvider,
              deployedPrimarySmartWallet ? { forceRefresh: true } : undefined,
            ));
          }
          bootstrappedIdentityRef.current = bootstrapKey;
        }
        if (cancelled) {
          return;
        }
        setRuntime({
          loading: false,
          service,
          discovery,
          error: null,
        });
        setBackendBootstrapReady(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBackendBootstrapReady(false);
        presentLoginError(error);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    backendClient,
    embeddedWallet,
    getAccessToken,
    isReady,
    preferredCandidateKey,
    user,
    walletPreferences.defaultWalletAddress,
    walletPreferences.hiddenWalletAddresses,
    walletPreferencesReady,
  ]);

  useEffect(() => {
    if (!runtime.discovery || manualWalletSelectionRef.current) {
      return;
    }
    const nextPreferredCandidateKey = resolveCandidateKeyWithPreferences({
      candidates: runtime.discovery.candidates,
      discoverySelectedCandidateKey: runtime.discovery.selectedCandidateKey,
      defaultWalletAddress: walletPreferences.defaultWalletAddress,
      hiddenWalletAddresses: walletPreferences.hiddenWalletAddresses,
    });
    if (
      nextPreferredCandidateKey &&
      nextPreferredCandidateKey !== runtime.discovery.selectedCandidateKey &&
      nextPreferredCandidateKey !== preferredCandidateKey
    ) {
      setPreferredCandidateKey(nextPreferredCandidateKey);
    }
  }, [
    preferredCandidateKey,
    runtime.discovery,
    walletPreferences.defaultWalletAddress,
    walletPreferences.hiddenWalletAddresses,
  ]);

  const oauthLoading = oauthState.status === "loading";
  const authLoading = oauthLoading || emailLoading;
  const selectedCandidateKey = runtime.discovery?.selectedCandidateKey;
  const walletInitializing =
    Boolean(user) &&
    !runtime.error &&
    (!embeddedWallet || runtime.loading || !runtime.service || !runtime.discovery || !backendBootstrapReady);

  const handleGoogleLogin = async () => {
    try {
      await login({ provider: "google" });
    } catch (error) {
      presentLoginError(error);
    }
  };

  const handleSendEmailCode = async () => {
    const normalizedEmail = emailAddress.trim();
    if (!normalizedEmail) {
      presentLoginError(new Error("Enter your email address to continue."));
      return;
    }

    setEmailLoading(true);
    try {
      await sendCode({ email: normalizedEmail });
      setEmailCodeSent(true);
      setRuntime((state) => ({ ...state, error: null }));
    } catch (error) {
      presentLoginError(error);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    const normalizedEmail = emailAddress.trim();
    const normalizedCode = emailCode.trim();
    if (!normalizedEmail) {
      presentLoginError(new Error("Enter your email address to continue."));
      return;
    }
    if (!normalizedCode) {
      presentLoginError(new Error("Enter the verification code from your email."));
      return;
    }

    setEmailLoading(true);
    try {
      await loginWithCode({ email: normalizedEmail, code: normalizedCode });
    } catch (error) {
      presentLoginError(error);
    } finally {
      setEmailLoading(false);
    }
  };

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
          {loginMode === "email" ? (
            <>
              <TextInput
                style={styles.loginInput}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!authLoading}
                inputMode="email"
                keyboardType="email-address"
                onChangeText={setEmailAddress}
                placeholder="Email address"
                placeholderTextColor={palette.textMuted}
                textContentType="emailAddress"
                value={emailAddress}
              />
              {emailCodeSent ? (
                <TextInput
                  style={styles.loginInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!authLoading}
                  keyboardType="number-pad"
                  onChangeText={setEmailCode}
                  placeholder="Verification code"
                  placeholderTextColor={palette.textMuted}
                  textContentType="oneTimeCode"
                  value={emailCode}
                />
              ) : null}
              <Pressable
                style={[styles.loginButton, authLoading ? styles.loginButtonDisabled : undefined]}
                disabled={authLoading}
                onPress={() => {
                  void (emailCodeSent ? handleEmailLogin() : handleSendEmailCode());
                }}
              >
                <Text style={styles.loginButtonText}>
                  {emailLoading
                    ? emailCodeSent
                      ? "Verifying..."
                      : "Sending code..."
                    : emailCodeSent
                      ? "Continue with Email"
                      : "Email me a code"}
                </Text>
              </Pressable>
              {emailCodeSent ? (
                <Pressable
                  style={[styles.loginSecondaryButton, authLoading ? styles.loginButtonDisabled : undefined]}
                  disabled={authLoading}
                  onPress={() => {
                    void handleSendEmailCode();
                  }}
                >
                  <Text style={styles.loginSecondaryButtonText}>Send a new code</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.loginTertiaryButton}
                disabled={authLoading}
                onPress={() => {
                  setLoginMode("choice");
                  setEmailCode("");
                  setEmailCodeSent(false);
                  setRuntime((state) => ({ ...state, error: null }));
                }}
              >
                <Text style={styles.loginTertiaryButtonText}>Other sign-in options</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.loginButton, authLoading ? styles.loginButtonDisabled : undefined]}
                disabled={authLoading}
                onPress={() => {
                  void handleGoogleLogin();
                }}
              >
                <Text style={styles.loginButtonText}>{oauthLoading ? "Connecting..." : "Continue with Google"}</Text>
              </Pressable>
              <Pressable
                style={[styles.loginSecondaryButton, authLoading ? styles.loginButtonDisabled : undefined]}
                disabled={authLoading}
                onPress={() => {
                  setLoginMode("email");
                  setRuntime((state) => ({ ...state, error: null }));
                }}
              >
                <Text style={styles.loginSecondaryButtonText}>Continue with Email</Text>
              </Pressable>
            </>
          )}
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
      onSelectCandidate={(key) => {
        manualWalletSelectionRef.current = true;
        setPreferredCandidateKey(key);
      }}
      ownerBadge={ownerBadge}
      onLogout={() => {
        void logout();
      }}
      backendClient={backendClient}
      backendBootstrapReady={backendBootstrapReady}
      walletPreferences={walletPreferences}
      onWalletPreferencesSync={syncWalletPreferences}
      pendingLinkIntent={pendingLinkIntent}
      onConsumePendingLink={() => setPendingLinkIntent(null)}
      preferences={preferences}
      onUpdatePreferences={onUpdatePreferences}
    />
  );
}

function MissingPrivyConfigScreen() {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
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
  const [preferences, setPreferences] = useStoredPreferences();

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
    <AppThemeProvider preference={preferences.themePreference}>
      {!mobileConfig.privyAppId.trim().length ? (
        <MissingPrivyConfigScreen />
      ) : (
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
          <PrivyWalletApp preferences={preferences} onUpdatePreferences={setPreferences} />
        </PrivyProvider>
      )}
    </AppThemeProvider>
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
  content: {
    flex: 1,
  },
  toastCard: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 92,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    ...shadows.card,
  },
  toastCardInfo: {
    backgroundColor: palette.surface,
    borderColor: palette.primary,
  },
  toastCardSuccess: {
    backgroundColor: palette.surface,
    borderColor: palette.success,
  },
  toastCardError: {
    backgroundColor: palette.surface,
    borderColor: palette.danger,
  },
  toastText: {
    color: palette.text,
    fontWeight: "800",
    textAlign: "center",
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
  loginInput: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    fontSize: 16,
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
  loginSecondaryButton: {
    borderRadius: radii.pill,
    paddingHorizontal: 22,
    paddingVertical: 16,
    minWidth: 240,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "transparent",
  },
  loginSecondaryButtonText: {
    color: palette.primaryStrong,
    fontWeight: "800",
    fontSize: 15,
  },
  loginTertiaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  loginTertiaryButtonText: {
    color: palette.textMuted,
    fontWeight: "700",
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
