import "./src/polyfills";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { ethers } from "ethers";
import {
  PrivyProvider,
  useEmbeddedEthereumWallet,
  useLinkWithOAuth,
  useLoginWithEmail,
  useLoginWithOAuth,
  useOAuthTokens,
  usePrivy,
  useUnlinkOAuth,
} from "@privy-io/expo";
import { SendScreen } from "./src/screens/SendScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { WalletHomeScreen } from "./src/screens/WalletHomeScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ContactsScreen } from "./src/screens/ContactsScreen";
import { ImproverScreen } from "./src/screens/ImproverScreen";
import { ThemedActivityIndicator } from "./src/components/ThemedActivityIndicator";
import { mobileConfig } from "./src/config";
import {
  clearCachedRouteDiscovery,
  createSmartWalletServiceFromSigner,
  RouteCandidate,
  RouteDiscovery,
  SmartWalletService,
} from "./src/services/smartWallet";
import { sweepAccessibleSFLUVToAdmin } from "./src/services/accountDeletion";
import {
  AppBackendAuthError,
  AppBackendClient,
  AppBackendPolicyRequiredError,
} from "./src/services/appBackend";
import {
  AppAccountDeletionPreview,
  AppAccountDeletionStatusResponse,
  AppContact,
  AppImprover,
  AppLocation,
  AppTransaction,
  AppUser,
  AppUserPolicyStatus,
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
  loadingMessage?: string | null;
};

type PendingLinkIntent = {
  id: number;
  link: SfluvUniversalLink;
};

type AppleOAuthUserInfoHint = {
  email?: string | null;
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
  walletAddress?: string;
};

type ToastState = {
  id: number;
  tone: "info" | "success" | "error";
  message: string;
};

type PushPermissionStatus = "unknown" | "undetermined" | "granted" | "denied" | "unavailable";

type PushRegistrationResult = {
  token: string | null;
  permissionStatus: PushPermissionStatus;
  error?: string;
};

type PushSyncState = {
  permissionStatus: PushPermissionStatus;
  syncState: "idle" | "syncing" | "success" | "error";
  addressCount: number;
  subscribedCount: number;
  token: string | null;
  message: string | null;
  lastSyncedAt?: number;
};

type Tab = "wallet" | "activity" | "improver" | "map" | "contacts" | "settings";
type WalletPane = "home" | "send" | "receive";
type OverlayWalletPane = Exclude<WalletPane, "home">;

const PREFERENCES_STORAGE_KEY = "sfluv-wallet:preferences";
const PUSH_TOKEN_STORAGE_KEY = "sfluv-wallet:push-token";
const WALLET_PREFERENCES_STORAGE_KEY_PREFIX = "sfluv-wallet:wallet-preferences";
const BALANCE_CACHE_STORAGE_KEY_PREFIX = "sfluv-wallet:balance-cache";
const REACTIVATED_ACCOUNT_RECOVERY_NOTICE_STORAGE_KEY =
  "sfluv-wallet:reactivated-account-recovery-notice";
const ACCOUNT_RECOVERY_SUPPORT_EMAIL = "techsupport@sfluv.org";
const PRIVACY_POLICY_PATH = "/privacy-policy";
const EMAIL_OPT_IN_POLICY_PATH = "/email-opt-in-policy";
const TRANSFER_REFRESH_DEBOUNCE_MS = 350;
const TRANSACTION_POLL_INTERVAL_MS = 2_000;
const WALLET_TRANSACTION_LIMIT = 5;
const ACTIVITY_TRANSACTION_PAGE_SIZE = 10;
const LINK_DEDUPE_WINDOW_MS = 4_000;
const BACKEND_BOOTSTRAP_TIMEOUT_MS = 20_000;
const WALLET_CREATE_TIMEOUT_MS = 30_000;
const WALLET_DISCOVERY_TIMEOUT_MS = 45_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`Timed out while trying to ${label}. Please try again.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutID) {
      clearTimeout(timeoutID);
    }
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function blankRuntime(loading = false): RuntimeState {
  return { loading, service: null, discovery: null, error: null, loadingMessage: null };
}

function buildPublicPolicyURL(path: string): string {
  return `${mobileConfig.appOrigin.replace(/\/+$/, "")}${path}`;
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

function normalizePushPermissionStatus(status: string | null | undefined): PushPermissionStatus {
  if (status === "granted") {
    return "granted";
  }
  if (status === "denied") {
    return "denied";
  }
  if (status === "undetermined") {
    return "undetermined";
  }
  return "unknown";
}

async function readPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("wallet-activity", {
        name: "Wallet activity",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 200, 250],
        lightColor: "#ef6d66",
      });
    } catch {
      // Ignore Android channel errors while checking permission state.
    }
  }

  if (!Device.isDevice) {
    return "unavailable";
  }

  try {
    const permissions = await Notifications.getPermissionsAsync();
    return normalizePushPermissionStatus(permissions.status);
  } catch {
    return "unknown";
  }
}

async function ensurePushRegistration(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      token: null,
      permissionStatus: "unavailable",
      error: "Push notifications require a physical device.",
    };
  }

  const projectId = resolveExpoProjectId();
  if (!projectId) {
    return {
      token: null,
      permissionStatus: "unknown",
      error: "Expo project ID is required to register this device for push notifications.",
    };
  }

  try {
    const token = await registerForPushNotificationsAsync();
    const permissionStatus = await readPushPermissionStatus();
    if (!token) {
      return {
        token: null,
        permissionStatus,
        error:
          permissionStatus === "denied"
            ? "Push notifications are blocked for this app in system settings."
            : "Unable to register this device for push notifications right now.",
      };
    }

    return {
      token,
      permissionStatus,
    };
  } catch (error) {
    return {
      token: null,
      permissionStatus: await readPushPermissionStatus(),
      error: (error as Error)?.message || "Unable to register this device for push notifications.",
    };
  }
}

function formatDisplayBalance(raw: string): string {
  try {
    const normalized = raw.trim();
    if (!normalized) {
      return "0.00";
    }

    const parsed = ethers.utils.parseUnits(normalized, mobileConfig.tokenDecimals);
    let roundedCents: ethers.BigNumber;
    if (mobileConfig.tokenDecimals > 2) {
      const centsDivisor = ethers.BigNumber.from(10).pow(mobileConfig.tokenDecimals - 2);
      roundedCents = parsed.add(centsDivisor.div(2)).div(centsDivisor);
    } else if (mobileConfig.tokenDecimals === 2) {
      roundedCents = parsed;
    } else {
      const centsMultiplier = ethers.BigNumber.from(10).pow(2 - mobileConfig.tokenDecimals);
      roundedCents = parsed.mul(centsMultiplier);
    }
    const whole = roundedCents.div(100).toString();
    const fraction = roundedCents.mod(100).toString().padStart(2, "0");
    return `${whole}.${fraction}`;
  } catch {
    return "0.00";
  }
}

function shortAddress(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function walletBalanceCacheKey(address: string): string {
  return `${BALANCE_CACHE_STORAGE_KEY_PREFIX}:${address.trim().toLowerCase()}`;
}

function linkSignature(link: SfluvUniversalLink): string {
  switch (link.type) {
    case "pay":
      return `pay:${link.address.toLowerCase()}`;
    case "addcontact":
      return `addcontact:${link.address.toLowerCase()}`;
    case "redeem":
      return `redeem:${link.code.trim().toLowerCase()}`;
    case "request":
      return `request:${link.address.toLowerCase()}:${link.amount ?? ""}:${link.memo ?? ""}`;
  }
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
  ownerAddress,
  candidates,
  isNewAccount,
}: {
  backendClient: AppBackendClient;
  ownerAddress: string;
  candidates: RouteCandidate[];
  isNewAccount: boolean;
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

  // Do not block login on first-time smart-account deployment. The smart wallet
  // address is deterministic and can receive funds before deployment; sends can
  // deploy lazily via initCode when needed.
  return { latestWallets, deployedPrimarySmartWallet: false };
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
  if ((error as Error)?.name === "AbortError") {
    return "That request timed out. Check your connection and try again.";
  }
  const message = (error as Error)?.message?.trim();
  if (!message) {
    return "Some shared app features could not sync right now. Wallet transfers still work.";
  }
  return message;
}

function describeLoginIssue(error: unknown, fallback = "Unable to sign in right now."): string {
  if (error instanceof AppBackendPolicyRequiredError && error.policyStatus) {
    return "Privacy policy acceptance is required before this account can finish loading.";
  }
  if (error instanceof AppBackendAuthError) {
    return error.message;
  }
  if ((error as Error)?.name === "AbortError") {
    return "A login request timed out. Check your connection and try again.";
  }
  const message = (error as Error)?.message?.trim();
  return message || fallback;
}

function formatDeletionDateLabel(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function getDeletionFallbackDateLabel(): string {
  return (
    formatDeletionDateLabel(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ) || "30 days from now"
  );
}

function buildDeleteAccountPreviewMessage(preview: AppAccountDeletionPreview): string {
  const scheduledDate =
    formatDeletionDateLabel(preview.deleteDate) || getDeletionFallbackDateLabel();
  const summaryParts = [
    preview.counts.wallets > 0 ? `${preview.counts.wallets} wallets` : null,
    preview.counts.contacts > 0 ? `${preview.counts.contacts} contacts` : null,
    preview.counts.locations > 0 ? `${preview.counts.locations} locations` : null,
    preview.counts.verifiedEmails > 0 ? `${preview.counts.verifiedEmails} verified emails` : null,
    preview.counts.ponderSubscriptions > 0 ? `${preview.counts.ponderSubscriptions} notification subscriptions` : null,
    preview.counts.memos > 0 ? `${preview.counts.memos} memos` : null,
  ].filter((value): value is string => Boolean(value));

  const summary = summaryParts.length > 0 ? ` This includes ${summaryParts.join(", ")}.` : "";

  return `Your account will be marked inactive immediately and scheduled for permanent deletion on ${scheduledDate}.${summary} You can reactivate it any time during the 30-day window by signing in again.`;
}

function getLinkedOAuthAccount(
  currentUser: unknown,
  accountType: "apple_oauth" | "google_oauth",
): {
  email?: string | null;
  subject?: string;
} | null {
  if (!currentUser || typeof currentUser !== "object") {
    return null;
  }

  const rawLinkedAccounts = Array.isArray((currentUser as { linked_accounts?: unknown[] }).linked_accounts)
    ? (currentUser as { linked_accounts: unknown[] }).linked_accounts
    : Array.isArray((currentUser as { linkedAccounts?: unknown[] }).linkedAccounts)
      ? (currentUser as { linkedAccounts: unknown[] }).linkedAccounts
      : [];

  for (const account of rawLinkedAccounts) {
    if (!account || typeof account !== "object") {
      continue;
    }
    const typedAccount = account as { type?: string; email?: string | null; subject?: string };
    if (typedAccount.type !== accountType) {
      continue;
    }
    return {
      email: typedAccount.email ?? undefined,
      subject: typedAccount.subject,
    };
  }

  return null;
}

function getLinkedAppleAccount(currentUser: unknown) {
  return getLinkedOAuthAccount(currentUser, "apple_oauth");
}

function getLinkedGoogleAccount(currentUser: unknown) {
  return getLinkedOAuthAccount(currentUser, "google_oauth");
}

function getLinkedEmailAccount(currentUser: unknown): {
  address?: string;
} | null {
  if (!currentUser || typeof currentUser !== "object") {
    return null;
  }

  const rawLinkedAccounts = Array.isArray((currentUser as { linked_accounts?: unknown[] }).linked_accounts)
    ? (currentUser as { linked_accounts: unknown[] }).linked_accounts
    : Array.isArray((currentUser as { linkedAccounts?: unknown[] }).linkedAccounts)
      ? (currentUser as { linkedAccounts: unknown[] }).linkedAccounts
      : [];

  for (const account of rawLinkedAccounts) {
    if (!account || typeof account !== "object") {
      continue;
    }
    const typedAccount = account as { type?: string; address?: string };
    if (typedAccount.type !== "email") {
      continue;
    }
    return {
      address: typedAccount.address?.trim() || undefined,
    };
  }

  return null;
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
    defaultSendEntryMode:
      candidate.defaultSendEntryMode === "manual" || candidate.defaultSendEntryMode === "scan"
        ? candidate.defaultSendEntryMode
        : defaultAppPreferences.defaultSendEntryMode,
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
  appleLinked,
  appleLinkedEmail,
  appleLinkBusy,
  appleLinkMessage,
  appleCanDisconnect,
  appleDisconnectDisabledReason,
  onLinkApple,
  onDisconnectApple,
  googleLinked,
  googleLinkedEmail,
  googleActionBusy,
  googleMessage,
  googleCanDisconnect,
  googleDisconnectDisabledReason,
  onLinkGoogle,
  onDisconnectGoogle,
  showRecoveryFundsNotice,
  onDismissRecoveryFundsNotice,
  onPolicyRequired,
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
  appleLinked: boolean;
  appleLinkedEmail?: string;
  appleLinkBusy: boolean;
  appleLinkMessage?: string | null;
  appleCanDisconnect: boolean;
  appleDisconnectDisabledReason?: string | null;
  onLinkApple?: () => void;
  onDisconnectApple?: () => void;
  googleLinked: boolean;
  googleLinkedEmail?: string;
  googleActionBusy: boolean;
  googleMessage?: string | null;
  googleCanDisconnect: boolean;
  googleDisconnectDisabledReason?: string | null;
  onLinkGoogle?: () => void;
  onDisconnectGoogle?: () => void;
  showRecoveryFundsNotice: boolean;
  onDismissRecoveryFundsNotice: () => void;
  onPolicyRequired?: (status: AppUserPolicyStatus) => void;
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
      appleLinked={appleLinked}
      appleLinkedEmail={appleLinkedEmail}
      appleLinkBusy={appleLinkBusy}
      appleLinkMessage={appleLinkMessage}
      appleCanDisconnect={appleCanDisconnect}
      appleDisconnectDisabledReason={appleDisconnectDisabledReason}
      onLinkApple={onLinkApple}
      onDisconnectApple={onDisconnectApple}
      googleLinked={googleLinked}
      googleLinkedEmail={googleLinkedEmail}
      googleActionBusy={googleActionBusy}
      googleMessage={googleMessage}
      googleCanDisconnect={googleCanDisconnect}
      googleDisconnectDisabledReason={googleDisconnectDisabledReason}
      onLinkGoogle={onLinkGoogle}
      onDisconnectGoogle={onDisconnectGoogle}
      showRecoveryFundsNotice={showRecoveryFundsNotice}
      onDismissRecoveryFundsNotice={onDismissRecoveryFundsNotice}
      onPolicyRequired={onPolicyRequired}
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
  appleLinked,
  appleLinkedEmail,
  appleLinkBusy,
  appleLinkMessage,
  appleCanDisconnect,
  appleDisconnectDisabledReason,
  onLinkApple,
  onDisconnectApple,
  googleLinked,
  googleLinkedEmail,
  googleActionBusy,
  googleMessage,
  googleCanDisconnect,
  googleDisconnectDisabledReason,
  onLinkGoogle,
  onDisconnectGoogle,
  showRecoveryFundsNotice,
  onDismissRecoveryFundsNotice,
  onPolicyRequired,
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
  appleLinked: boolean;
  appleLinkedEmail?: string;
  appleLinkBusy: boolean;
  appleLinkMessage?: string | null;
  appleCanDisconnect: boolean;
  appleDisconnectDisabledReason?: string | null;
  onLinkApple?: () => void;
  onDisconnectApple?: () => void;
  googleLinked: boolean;
  googleLinkedEmail?: string;
  googleActionBusy: boolean;
  googleMessage?: string | null;
  googleCanDisconnect: boolean;
  googleDisconnectDisabledReason?: string | null;
  onLinkGoogle?: () => void;
  onDisconnectGoogle?: () => void;
  showRecoveryFundsNotice: boolean;
  onDismissRecoveryFundsNotice: () => void;
  onPolicyRequired?: (status: AppUserPolicyStatus) => void;
}) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const [tab, setTab] = useState<Tab>("wallet");
  const [walletPane, setWalletPane] = useState<WalletPane>("home");
  const walletPaneSlideDistance = Dimensions.get("window").width;
  const walletPaneTranslateX = useRef(new Animated.Value(0)).current;
  const walletPaneTranslateXValueRef = useRef(0);
  const previousWalletPaneRef = useRef<WalletPane>("home");
  const walletPaneAnimatingRef = useRef(false);
  const walletPaneAnimationIDRef = useRef(0);
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
  const [appImprover, setAppImprover] = useState<AppImprover | null>(null);
  const [storedPushToken, setStoredPushToken] = useState<string | null>(null);
  const [pushSyncState, setPushSyncState] = useState<PushSyncState>({
    permissionStatus: "unknown",
    syncState: "idle",
    addressCount: 0,
    subscribedCount: 0,
    token: null,
    message: null,
  });
  const [accountDeletionBusy, setAccountDeletionBusy] = useState(false);
  const [accountDeletionMessage, setAccountDeletionMessage] = useState<string | null>(null);
  const [pushSyncRequestVersion, setPushSyncRequestVersion] = useState(0);
  const [refreshingHome, setRefreshingHome] = useState(false);
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState(false);
  const [activityPageCount, setActivityPageCount] = useState(1);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [merchantMapViewMode, setMerchantMapViewMode] = useState<"map" | "list">("map");
  const [pendingContactAddress, setPendingContactAddress] = useState<string | null>(null);
  const [sendDraft, setSendDraft] = useState<SendDraft | null>(null);
  const [sendReturnTab, setSendReturnTab] = useState<Tab | null>(null);
  const [walletPaneBackSwipeEnabled, setWalletPaneBackSwipeEnabled] = useState(true);
  const [redeemFlow, setRedeemFlow] = useState<RedeemFlowState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const walletSurfaceRequestRef = useRef(0);
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const transferRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendAuthFailureHandledRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeServiceRef = useRef<SmartWalletService | null>(runtime.service);
  const smartAddressRef = useRef(smartAddress);
  const handledPendingLinkIdRef = useRef<number | null>(null);
  const walletTransactionsRef = useRef<AppTransaction[]>(walletTransactions);
  const activityTransactionsRef = useRef<AppTransaction[]>(activityTransactions);
  const walletPaneGestureMaxXRef = useRef(0);
  const walletPaneGestureActiveRef = useRef(false);
  const walletOverlayPane: OverlayWalletPane | null = walletPane === "home" ? null : walletPane;

  const setWalletPaneTranslateX = React.useCallback(
    (value: number) => {
      const nextValue = Math.max(0, Math.min(value, walletPaneSlideDistance));
      walletPaneTranslateXValueRef.current = nextValue;
      walletPaneTranslateX.setValue(nextValue);
      return nextValue;
    },
    [walletPaneSlideDistance, walletPaneTranslateX],
  );

  const resetWalletPanePosition = React.useCallback(() => {
    walletPaneAnimationIDRef.current += 1;
    walletPaneTranslateX.stopAnimation();
    setWalletPaneTranslateX(0);
    walletPaneAnimatingRef.current = false;
    walletPaneGestureActiveRef.current = false;
    walletPaneGestureMaxXRef.current = 0;
  }, [setWalletPaneTranslateX, walletPaneTranslateX]);

  const closeWalletPaneToWallet = React.useCallback((fromValue?: number) => {
    if (walletPane === "home") {
      return;
    }

    const returnTab = walletPane === "send" ? sendReturnTab : null;
    const animationID = walletPaneAnimationIDRef.current + 1;
    walletPaneAnimationIDRef.current = animationID;
    walletPaneGestureActiveRef.current = false;
    walletPaneGestureMaxXRef.current = 0;
    walletPaneAnimatingRef.current = true;
    setWalletPaneTranslateX(typeof fromValue === "number" ? fromValue : walletPaneTranslateXValueRef.current);
    Animated.timing(walletPaneTranslateX, {
      toValue: walletPaneSlideDistance,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      if (walletPaneAnimationIDRef.current !== animationID) {
        return;
      }
      setSendReturnTab(null);
      setWalletPane("home");
      setTab(returnTab ?? "wallet");
      setWalletPaneTranslateX(0);
      walletPaneAnimatingRef.current = false;
    });
  }, [sendReturnTab, setWalletPaneTranslateX, walletPane, walletPaneSlideDistance, walletPaneTranslateX]);

  const resetWalletPaneSwipe = React.useCallback(
    (fromValue?: number) => {
      if (walletPane === "home") {
        resetWalletPanePosition();
        return;
      }

      const animationID = walletPaneAnimationIDRef.current + 1;
      walletPaneAnimationIDRef.current = animationID;
      walletPaneGestureActiveRef.current = false;
      walletPaneGestureMaxXRef.current = 0;
      walletPaneAnimatingRef.current = true;
      setWalletPaneTranslateX(typeof fromValue === "number" ? fromValue : walletPaneTranslateXValueRef.current);
      Animated.spring(walletPaneTranslateX, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      }).start(() => {
        if (walletPaneAnimationIDRef.current !== animationID) {
          return;
        }
        setWalletPaneTranslateX(0);
        walletPaneAnimatingRef.current = false;
      });
    },
    [resetWalletPanePosition, setWalletPaneTranslateX, walletPane, walletPaneTranslateX],
  );

  const finishWalletPaneSwipe = React.useCallback(
    (currentValue: number, velocityX = 0) => {
      const clampedValue = setWalletPaneTranslateX(currentValue);
      const maxValue = Math.max(walletPaneGestureMaxXRef.current, clampedValue);
      walletPaneGestureActiveRef.current = false;
      walletPaneGestureMaxXRef.current = 0;
      if (maxValue >= walletPaneSlideDistance * 0.25 || velocityX > 1.05) {
        closeWalletPaneToWallet(clampedValue);
        return;
      }
      resetWalletPaneSwipe(clampedValue);
    },
    [closeWalletPaneToWallet, resetWalletPaneSwipe, setWalletPaneTranslateX, walletPaneSlideDistance],
  );

  const walletPanePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          walletOverlayPane !== null &&
          walletPaneBackSwipeEnabled &&
          !walletPaneAnimatingRef.current &&
          gesture.x0 <= 28 &&
          gesture.dx > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          walletPaneAnimationIDRef.current += 1;
          walletPaneTranslateX.stopAnimation();
          walletPaneGestureActiveRef.current = true;
          walletPaneGestureMaxXRef.current = 0;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          const currentValue = Math.max(0, Math.min(gesture.dx, walletPaneSlideDistance));
          walletPaneGestureMaxXRef.current = Math.max(walletPaneGestureMaxXRef.current, currentValue);
          setWalletPaneTranslateX(currentValue);
        },
        onPanResponderRelease: (_, gesture) => {
          const currentValue = Math.max(0, Math.min(gesture.dx, walletPaneSlideDistance));
          finishWalletPaneSwipe(currentValue, gesture.vx);
        },
        onPanResponderTerminate: () => {
          finishWalletPaneSwipe(walletPaneTranslateXValueRef.current);
        },
        onPanResponderReject: () => {
          if (walletPaneGestureActiveRef.current) {
            finishWalletPaneSwipe(walletPaneTranslateXValueRef.current);
          }
        },
        onShouldBlockNativeResponder: () => true,
      }),
    [
      finishWalletPaneSwipe,
      setWalletPaneTranslateX,
      walletOverlayPane,
      walletPaneBackSwipeEnabled,
      walletPaneSlideDistance,
      walletPaneTranslateX,
    ],
  );

  useEffect(() => {
    const previousWalletPane = previousWalletPaneRef.current;
    if (walletPane !== "home" && previousWalletPane !== walletPane) {
      const animationID = walletPaneAnimationIDRef.current + 1;
      walletPaneAnimationIDRef.current = animationID;
      walletPaneAnimatingRef.current = true;
      walletPaneGestureActiveRef.current = false;
      walletPaneGestureMaxXRef.current = 0;
      walletPaneTranslateX.stopAnimation();
      setWalletPaneTranslateX(walletPaneSlideDistance);
      Animated.spring(walletPaneTranslateX, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      }).start(() => {
        if (walletPaneAnimationIDRef.current !== animationID) {
          return;
        }
        setWalletPaneTranslateX(0);
        walletPaneAnimatingRef.current = false;
      });
    }
    if (walletPane === "home") {
      resetWalletPanePosition();
    }
    previousWalletPaneRef.current = walletPane;
  }, [resetWalletPanePosition, setWalletPaneTranslateX, walletPane, walletPaneSlideDistance, walletPaneTranslateX]);

  useEffect(() => {
    if (walletPane !== "send" && !walletPaneBackSwipeEnabled) {
      setWalletPaneBackSwipeEnabled(true);
    }
  }, [walletPane, walletPaneBackSwipeEnabled]);

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
  const hasImproverTab = Boolean(appUser?.isImprover || appImprover?.status === "approved");
  const moreTabActive = hasImproverTab && (tab === "activity" || tab === "contacts");
  const canChooseWallet = walletChooserCandidates.length > 1;
  const walletSyncReady = backendBootstrapReady && Boolean(appUser) && Boolean(runtime.discovery);
  const walletHistoryActive = tab === "wallet" && walletPane === "home";
  const activityHistoryActive = tab === "activity";
  const notificationAddresses = useMemo(() => {
    const seen = new Set<string>();
    const addresses: string[] = [];
    if (smartAddress) {
      const normalized = smartAddress.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        addresses.push(smartAddress);
      }
    }
    for (const wallet of backendWallets) {
      const address = wallet.smartAddress ?? wallet.eoaAddress;
      if (!address || wallet.isEoa) {
        continue;
      }
      const normalized = address.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      addresses.push(address);
    }
    return addresses;
  }, [backendWallets, smartAddress]);

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
    if (!hasImproverTab && tab === "improver") {
      setTab("wallet");
    }
  }, [hasImproverTab, tab]);

  useEffect(() => {
    if (!hasImproverTab && showMoreMenu) {
      setShowMoreMenu(false);
    }
  }, [hasImproverTab, showMoreMenu]);

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
          setPushSyncState((current) => ({
            ...current,
            token: value,
          }));
        }
      })
      .catch((error) => {
        console.warn("Unable to load saved push token", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void readPushPermissionStatus().then((permissionStatus) => {
      if (cancelled) {
        return;
      }
      setPushSyncState((current) => ({
        ...current,
        permissionStatus,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPushSyncState((current) => ({
      ...current,
      addressCount: notificationAddresses.length,
    }));
  }, [notificationAddresses.length]);

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
      setAppImprover(profile.improver);
      setBackendWallets(profile.wallets);
      onWalletPreferencesSync(profile.user, profile.wallets);
      setContacts(profile.contacts);
      setSyncNotice(null);
      backendAuthFailureHandledRef.current = false;
    } catch (error) {
      console.warn("Unable to load app profile", error);
      if (error instanceof AppBackendPolicyRequiredError && error.policyStatus) {
        setSyncNotice(null);
        onPolicyRequired?.(error.policyStatus);
        return;
      }
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

  const openRedeemFlowForCode = React.useCallback((code: string) => {
    setTab("wallet");
    setWalletPane("home");
    const normalizedCode = code.trim().toLowerCase();
    setRedeemFlow((current) => {
      if (
        current &&
        current.code.trim().toLowerCase() === normalizedCode &&
        (current.stage === "awaiting_wallet" || current.stage === "redeeming" || current.stage === "success")
      ) {
        return current;
      }

      return {
        code,
        stage: "awaiting_wallet",
      };
    });
  }, []);

  useEffect(() => {
    if (!pendingLinkIntent) {
      return;
    }
    if (handledPendingLinkIdRef.current === pendingLinkIntent.id) {
      return;
    }
    handledPendingLinkIdRef.current = pendingLinkIntent.id;

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

    if (link.type === "addcontact") {
      setPendingContactAddress(link.address);
      setTab("contacts");
      onConsumePendingLink();
      return;
    }

    openRedeemFlowForCode(link.code);
    onConsumePendingLink();
  }, [onConsumePendingLink, openRedeemFlowForCode, pendingLinkIntent]);

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

    let cancelled = false;
    const prepareRedeem = async () => {
      try {
        const walletAddress = await runtime.service?.smartAccountAddress();
        if (!walletAddress || cancelled) {
          return;
        }
        setRedeemFlow((current) =>
          current && current.code === redeemFlow.code && current.stage === "awaiting_wallet"
            ? {
                code: current.code,
                stage: "redeeming",
                walletAddress,
              }
            : current,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        setRedeemFlow((current) =>
          current && current.code === redeemFlow.code
            ? {
                code: current.code,
                stage: "error",
                message: (error as Error)?.message || "Unable to prepare this reward right now.",
              }
            : current,
        );
      }
    };

    void prepareRedeem();
    return () => {
      cancelled = true;
    };
  }, [redeemFlow, runtime.error, runtime.service]);

  useEffect(() => {
    if (!redeemFlow || redeemFlow.stage !== "redeeming") {
      return;
    }
    if (!redeemFlow.walletAddress) {
      return;
    }

    let cancelled = false;
    const code = redeemFlow.code;
    const payoutAddress = redeemFlow.walletAddress;
    const redeem = async () => {
      try {
        await publicBackendClient.redeemCode(code, payoutAddress);
        if (cancelled) {
          return;
        }
        setRedeemFlow((current) =>
          current && current.code === code && current.stage === "redeeming"
            ? {
                code,
                stage: "success",
                walletAddress: payoutAddress,
                message: "Your SFLUV perk was sent to this wallet.",
              }
            : current,
        );
        await refreshWalletSurface();
        await loadAppProfile();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setRedeemFlow((current) =>
          current && current.code === code
            ? {
                code,
                stage: "error",
                walletAddress: payoutAddress,
                message: (error as Error)?.message || "Unable to redeem this QR code right now.",
              }
            : current,
        );
      }
    };

    void redeem();
    return () => {
      cancelled = true;
    };
  }, [publicBackendClient, redeemFlow]);

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
      const rawBalance = balance.trim();
      setSmartBalance(rawBalance);
      const activeAddress = smartAddressRef.current || (await service.smartAccountAddress());
      void AsyncStorage.setItem(walletBalanceCacheKey(activeAddress), rawBalance).catch((storageError) => {
        console.warn("Unable to cache wallet balance", storageError);
      });
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

      if (addressChanged || smartBalance === "...") {
        try {
          const cachedBalance = await AsyncStorage.getItem(walletBalanceCacheKey(nextAddress));
          if (walletSurfaceRequestRef.current !== requestID) {
            return;
          }
          setSmartBalance(cachedBalance?.trim() || "...");
        } catch (error) {
          console.warn("Unable to load cached wallet balance", error);
          setSmartBalance("...");
        }
      }
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
        if (preferences.notificationsEnabled) {
          setPushSyncRequestVersion((current) => current + 1);
        }
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
    preferences.notificationsEnabled,
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
    if (!backendClient || !appUser) {
      return;
    }

    if (preferences.notificationsEnabled && !walletSyncReady) {
      return;
    }

    let cancelled = false;

    const runPushNotificationSync = async () => {
      const addressCount = notificationAddresses.length;
      const baseState = {
        addressCount,
        syncState: "syncing" as const,
        message: preferences.notificationsEnabled ? "Syncing push notifications..." : "Removing push notifications...",
      };

      setPushSyncState((current) => ({
        ...current,
        ...baseState,
      }));

      if (!preferences.notificationsEnabled) {
        try {
          const subscriptions = await backendClient.getNotificationSubscriptions();
          const pushSubscriptions = subscriptions.filter((subscription) => subscription.type === "push");
          await Promise.all(pushSubscriptions.map((subscription) => backendClient.disableNotification(subscription.id)));
          await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
          if (cancelled) {
            return;
          }
          setStoredPushToken(null);
          const permissionStatus = await readPushPermissionStatus();
          if (cancelled) {
            return;
          }
          setPushSyncState((current) => ({
            ...current,
            permissionStatus,
            syncState: "success",
            token: null,
            addressCount,
            subscribedCount: 0,
            message: "Push notifications are off for this device.",
            lastSyncedAt: Date.now(),
          }));
        } catch (error) {
          if (cancelled) {
            return;
          }
          console.warn("Unable to disable push notifications", error);
          setPushSyncState((current) => ({
            ...current,
            syncState: "error",
            addressCount,
            message: (error as Error)?.message || "Unable to disable push notifications right now.",
          }));
        }
        return;
      }

      const registration = storedPushToken
        ? { token: storedPushToken, permissionStatus: await readPushPermissionStatus() }
        : await ensurePushRegistration();

      if (cancelled) {
        return;
      }

      setPushSyncState((current) => ({
        ...current,
        permissionStatus: registration.permissionStatus,
        token: registration.token,
      }));

      if (!registration.token) {
        setPushSyncState((current) => ({
          ...current,
          syncState: "error",
          addressCount,
          subscribedCount: 0,
          token: null,
          message: registration.error || "Unable to register this device for push notifications.",
        }));
        return;
      }

      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, registration.token);
      if (cancelled) {
        return;
      }
      setStoredPushToken(registration.token);

      if (addressCount === 0) {
        setPushSyncState((current) => ({
          ...current,
          syncState: "idle",
          addressCount,
          subscribedCount: 0,
          token: registration.token,
          message: "Push permission is ready. Waiting for your wallets to finish loading before subscribing.",
        }));
        return;
      }

      try {
        await backendClient.syncPushNotifications(registration.token, notificationAddresses);
        const subscriptions = await backendClient.getNotificationSubscriptions();
        if (cancelled) {
          return;
        }
        const subscribedAddresses = new Set(
          subscriptions
            .filter((subscription) => subscription.type === "push")
            .map((subscription) => subscription.address.toLowerCase())
            .filter((address) => notificationAddresses.some((candidate) => candidate.toLowerCase() === address)),
        );
        const subscribedCount = subscribedAddresses.size;
        setPushSyncState((current) => ({
          ...current,
          permissionStatus: registration.permissionStatus,
          syncState: "success",
          addressCount,
          subscribedCount,
          token: registration.token,
          message:
            subscribedCount > 0
              ? `Push notifications are active for ${subscribedCount} wallet${subscribedCount === 1 ? "" : "s"} on this device.`
              : "This device has permission to receive notifications, but no wallet subscriptions were created yet.",
          lastSyncedAt: Date.now(),
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn("Unable to sync push notifications", error);
        setPushSyncState((current) => ({
          ...current,
          permissionStatus: registration.permissionStatus,
          syncState: "error",
          addressCount,
          message: (error as Error)?.message || "Unable to sync push notifications right now.",
        }));
      }
    };

    void runPushNotificationSync();

    return () => {
      cancelled = true;
    };
  }, [
    appUser,
    backendClient,
    notificationAddresses,
    preferences.notificationsEnabled,
    pushSyncRequestVersion,
    walletSyncReady,
  ]);

  const handleSyncPushNotifications = () => {
    if (!backendClient || !appUser) {
      setPushSyncState((current) => ({
        ...current,
        syncState: "idle",
        message: "Sign in fully before syncing push notifications.",
      }));
      return;
    }

    if (preferences.notificationsEnabled && !walletSyncReady) {
      setPushSyncState((current) => ({
        ...current,
        syncState: "idle",
        addressCount: notificationAddresses.length,
        message: "Waiting for your wallets to finish loading before syncing push notifications.",
      }));
      return;
    }

    setPushSyncRequestVersion((current) => current + 1);
  };

  const finishSendFlow = () => {
    const returnTab = sendReturnTab;
    setSendReturnTab(null);
    setWalletPane("home");
    setTab(returnTab ?? "wallet");
  };

  const completeSendFlow = () => {
    setSendReturnTab(null);
    setWalletPane("home");
    setTab("wallet");
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

  const handleDeleteAccount = async () => {
    if (!backendClient) {
      setAccountDeletionMessage("Backend not configured.");
      return;
    }
    const service = runtime.service;
    if (!service) {
      setAccountDeletionMessage("Wallet service is still loading.");
      return;
    }

    setAccountDeletionBusy(true);
    setAccountDeletionMessage(null);
    try {
      const preview = await backendClient.getDeleteAccountPreview();
      Alert.alert(
        "Delete account",
        `${buildDeleteAccountPreviewMessage(preview)} Before the delete request is sent, any SFLUV in your accessible wallets will be transferred out of your account. If you later reactivate during the grace period, contact ${ACCOUNT_RECOVERY_SUPPORT_EMAIL} to recover those funds.`,
        [
          {
            text: "Keep account",
            style: "cancel",
            onPress: () => {
              setAccountDeletionBusy(false);
            },
          },
          {
            text: "Delete account",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  setAccountDeletionMessage(
                    "Transferring SFLUV out of your accessible wallets before submitting the deletion request...",
                  );
                  await sweepAccessibleSFLUVToAdmin({
                    service,
                    backendWallets,
                    discovery: runtime.discovery,
                  });
                  setAccountDeletionMessage(
                    `Submitting your deletion request. If you later stop the scheduled deletion, contact ${ACCOUNT_RECOVERY_SUPPORT_EMAIL} to recover your transferred funds.`,
                  );
                  const status = await backendClient.deleteAccount();
                  const deleteDateLabel =
                    formatDeletionDateLabel(status.deleteDate) ||
                    getDeletionFallbackDateLabel();
                  Alert.alert(
                    "Account scheduled for deletion",
                    `This account is inactive and scheduled for deletion on ${deleteDateLabel}. Sign in again during that window if you want to reactivate it. If you reactivate later, contact ${ACCOUNT_RECOVERY_SUPPORT_EMAIL} to recover any SFLUV transferred out during the deletion request.`,
                    [
                      {
                        text: "OK",
                        onPress: () => {
                          onLogout?.();
                        },
                      },
                    ],
                  );
                } catch (error) {
                  setAccountDeletionMessage(describeAppBackendIssue(error));
                } finally {
                  setAccountDeletionBusy(false);
                }
              })();
            },
          },
        ],
      );
    } catch (error) {
      setAccountDeletionBusy(false);
      setAccountDeletionMessage(describeAppBackendIssue(error));
    }
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
    const activeAddress = smartAddressRef.current || selectedCandidate?.accountAddress || "";
    void refreshSelectedWalletBalance({ silent: true });
    if (activeAddress) {
      void refreshWalletTransactionsFromBackend(activeAddress, { silent: true });
      void refreshActivityTransactionsFromBackend(activeAddress, { silent: true });
    }
    void loadAppProfile();
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
      : tab === "improver"
        ? "Improver"
      : tab === "map"
        ? "Merchant Map"
        : tab === "contacts"
          ? "Contacts"
          : "Settings";
  const showWalletPaneBack = tab === "wallet" && walletPane !== "home";
  const showBlockingWalletState = runtime.loading && !runtime.service;
  const showStandardChrome = !(tab === "wallet" && walletPane === "send");
  const RootContainer = showStandardChrome ? SafeAreaView : View;
  const walletHomeContent = (
    <WalletHomeScreen
      balance={smartBalance === "..." ? smartBalance : formatDisplayBalance(smartBalance)}
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
  );
  const walletOverlayContent =
    walletOverlayPane === "send" ? (
      <SendScreen
        contacts={contacts}
        merchants={locations}
        availableBalance={smartBalance}
        backendClient={backendClient}
        hapticsEnabled={preferences.hapticsEnabled}
        defaultEntryMode={preferences.defaultSendEntryMode}
        onPrepareSend={handleSend}
        onCompleteFlow={completeSendFlow}
        onExitFlow={finishSendFlow}
        onNavigationSwipeEnabledChange={setWalletPaneBackSwipeEnabled}
        draft={sendDraft}
        onDraftApplied={() => setSendDraft(null)}
        onOpenUniversalLink={(link) => {
          if (link.type === "redeem") {
            openRedeemFlowForCode(link.code);
            return;
          }
          if (link.type === "addcontact") {
            setPendingContactAddress(link.address);
            setTab("contacts");
            return;
          }
          openSendDraft({
            recipient: link.address,
            amount: link.type === "request" ? link.amount : undefined,
            memo: link.type === "request" ? link.memo : undefined,
          });
        }}
      />
    ) : walletOverlayPane === "receive" ? (
      <ReceiveScreen
        accountAddress={smartAddress || runtime.discovery?.ownerAddress || ethers.constants.AddressZero}
        onRedeemCodeScanned={openRedeemFlowForCode}
      />
    ) : null;
  const walletTabContent =
    walletOverlayPane !== null ? (
      <View style={styles.walletPaneStack}>
        <View style={styles.walletPaneBase}>{walletHomeContent}</View>
        <Animated.View
          style={[styles.walletPaneOverlay, { transform: [{ translateX: walletPaneTranslateX }] }]}
          {...walletPanePanResponder.panHandlers}
        >
          {walletOverlayContent}
        </Animated.View>
      </View>
    ) : (
      walletHomeContent
    );

  return (
    <RootContainer style={[styles.safe, !showStandardChrome ? styles.safeFullscreen : undefined]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={styles.topBackdrop}>
        <View style={styles.topOrbLarge} />
        <View style={styles.topOrbSmall} />
      </View>

      {showStandardChrome ? (
        <View style={styles.topBar}>
          <View style={styles.topTitleWrap}>
            <Text style={styles.brandKicker}>SFLuv</Text>
            <Text style={styles.brand}>{activeTitle}</Text>
            <Text style={styles.topMeta}>
              {tab === "settings"
                ? "Preferences and account details"
                : tab === "contacts"
                  ? "People and wallets you trust"
                  : tab === "activity"
                    ? "Recent wallet transfers and rewards"
                    : tab === "improver"
                      ? "Claims, payouts, badges, and credentials"
                      : selectedWalletLabel
                        ? `${selectedWalletLabel} selected`
                        : "Fast SFLuv payments"}
            </Text>
          </View>
          <View style={styles.topActions}>
            {showWalletPaneBack ? (
              <Pressable
                style={styles.iconButton}
                onPress={() => {
                  if (walletPane === "receive") {
                    closeWalletPaneToWallet();
                    return;
                  }
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
      ) : null}

      <View style={[styles.contentShell, !showStandardChrome ? styles.contentShellFullscreen : undefined]}>
        <View style={styles.content}>
          {showBlockingWalletState ? (
            <View style={styles.centerState}>
              <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
              <Text style={styles.stateText}>
                {runtime.loadingMessage || "Preparing your wallet..."}
              </Text>
            </View>
          ) : runtime.error ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>{runtime.error}</Text>
            </View>
          ) : tab === "wallet" ? (
            walletTabContent
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
          ) : tab === "improver" ? (
            <ImproverScreen
              user={appUser}
              improver={appImprover}
              backendClient={backendClient}
              hapticsEnabled={preferences.hapticsEnabled}
              onRefreshProfile={loadAppProfile}
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
              incomingContactAddress={pendingContactAddress}
              onIncomingContactAddressHandled={() => {
                setPendingContactAddress(null);
              }}
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
              improver={appImprover}
              wallets={settingsWallets}
              primaryWalletAddress={appUser?.primaryWalletAddress}
              syncNotice={syncNotice}
              preferences={preferences}
              notificationPermissionStatus={pushSyncState.permissionStatus}
              notificationSyncState={pushSyncState.syncState}
              notificationTokenRegistered={Boolean(pushSyncState.token)}
              notificationAddressCount={pushSyncState.addressCount}
              notificationSubscribedCount={pushSyncState.subscribedCount}
              notificationStatusMessage={pushSyncState.message}
              onSyncNotifications={handleSyncPushNotifications}
              onLogout={onLogout}
              googleLinked={googleLinked}
              googleLinkedEmail={googleLinkedEmail}
              googleActionBusy={googleActionBusy}
              googleMessage={googleMessage}
              googleCanDisconnect={googleCanDisconnect}
              googleDisconnectDisabledReason={googleDisconnectDisabledReason}
              onLinkGoogle={onLinkGoogle}
              onDisconnectGoogle={onDisconnectGoogle}
              appleLinked={appleLinked}
              appleLinkedEmail={appleLinkedEmail}
              appleLinkBusy={appleLinkBusy}
              appleLinkMessage={appleLinkMessage}
              appleCanDisconnect={appleCanDisconnect}
              appleDisconnectDisabledReason={appleDisconnectDisabledReason}
              onLinkApple={onLinkApple}
              onDisconnectApple={onDisconnectApple}
              onRenameWallet={handleRenameWallet}
              onSetPrimaryWallet={handleSetPrimaryWallet}
              onSetWalletVisibility={handleSetWalletVisibility}
              accountDeletionBusy={accountDeletionBusy}
              accountDeletionMessage={accountDeletionMessage}
              onUpdateImproverRewardsWallet={async (address) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.updateImproverPrimaryRewardsAccount(address.trim());
                await loadAppProfile();
              }}
              onOpenImprover={() => {
                setTab("improver");
              }}
              onDeleteAccount={handleDeleteAccount}
              onUpdatePreferences={(next) => {
                onUpdatePreferences(next);
              }}
            />
          )}
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

      {showStandardChrome ? (
        <View pointerEvents="box-none" style={styles.bottomDockShell}>
          <BlurView
            pointerEvents="none"
            intensity={Platform.OS === "android" ? 24 : 42}
            tint={isDark ? "dark" : "light"}
            style={styles.bottomDockShellBackdrop}
          />
          <View pointerEvents="none" style={styles.bottomDockLiquidLayer} />
          <View style={styles.bottomDock}>
            <View pointerEvents="none" style={styles.bottomDockGlassLayer} />
            <View pointerEvents="none" style={styles.bottomDockGlassSheen} />
            <BottomTab
              label="Wallet"
              icon={tab === "wallet" ? "wallet" : "wallet-outline"}
              active={tab === "wallet"}
              onPress={() => {
                setTab("wallet");
                setWalletPane("home");
              }}
            />
            {hasImproverTab ? (
              <>
                <BottomTab
                  label="Improver"
                  icon={tab === "improver" ? "construct" : "construct-outline"}
                  active={tab === "improver"}
                  onPress={() => {
                    setTab("improver");
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
                  label="More"
                  icon={moreTabActive ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline"}
                  active={moreTabActive}
                  onPress={() => {
                    setShowMoreMenu(true);
                  }}
                />
              </>
            ) : (
              <>
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
              </>
            )}
          </View>
        </View>
      ) : null}

      <Modal
        visible={showWalletChooser && canChooseWallet}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setShowWalletChooser(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowWalletChooser(false)}>
          <Pressable style={styles.walletChooserCard} onPress={() => {}}>
            <View style={styles.walletChooserHeader}>
              <View style={styles.walletChooserHeaderCopy}>
                <Text style={styles.walletChooserTitle}>Choose Wallet</Text>
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

      <Modal
        visible={showMoreMenu && hasImproverTab}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={() => setShowMoreMenu(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowMoreMenu(false)}>
          <Pressable style={styles.moreMenuCard} onPress={() => {}}>
            <View style={styles.moreMenuHeader}>
              <View style={styles.moreMenuHeaderCopy}>
                <Text style={styles.moreMenuTitle}>More</Text>
                <Text style={styles.moreMenuSubtitle}>Open additional wallet tools.</Text>
              </View>
              <Pressable style={styles.walletChooserClose} onPress={() => setShowMoreMenu(false)}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>

            <View style={styles.moreMenuList}>
              <Pressable
                style={[styles.moreMenuItem, tab === "activity" ? styles.moreMenuItemActive : undefined]}
                onPress={() => {
                  setShowMoreMenu(false);
                  setTab("activity");
                }}
              >
                <View style={styles.moreMenuCopy}>
                  <Text style={styles.moreMenuLabel}>Activity</Text>
                  <Text style={styles.moreMenuBody}>Recent wallet transfers and rewards.</Text>
                </View>
                <Ionicons
                  name={tab === "activity" ? "pulse" : "pulse-outline"}
                  size={18}
                  color={tab === "activity" ? palette.primaryStrong : palette.textMuted}
                />
              </Pressable>

              <Pressable
                style={[styles.moreMenuItem, tab === "contacts" ? styles.moreMenuItemActive : undefined]}
                onPress={() => {
                  setShowMoreMenu(false);
                  setTab("contacts");
                }}
              >
                <View style={styles.moreMenuCopy}>
                  <Text style={styles.moreMenuLabel}>Contacts</Text>
                  <Text style={styles.moreMenuBody}>People and wallet addresses you trust.</Text>
                </View>
                <Ionicons
                  name={tab === "contacts" ? "people" : "people-outline"}
                  size={18}
                  color={tab === "contacts" ? palette.primaryStrong : palette.textMuted}
                />
              </Pressable>
            </View>
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
              <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
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

      <Modal
        visible={showRecoveryFundsNotice}
        transparent
        animationType="fade"
        onRequestClose={onDismissRecoveryFundsNotice}
      >
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingCard}>
            <Ionicons name="information-circle" size={42} color={palette.primaryStrong} />
            <Text style={styles.sendingTitle}>Funds recovery</Text>
            <Text style={styles.sendingText}>
              This account is active again, but any SFLUV transferred out during the deletion
              request will not return automatically.
            </Text>
            <Text style={styles.sendingText}>
              Contact {ACCOUNT_RECOVERY_SUPPORT_EMAIL} to recover your funds.
            </Text>
            <Pressable style={styles.dismissButton} onPress={onDismissRecoveryFundsNotice}>
              <Text style={styles.dismissButtonText}>Understood</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </RootContainer>
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
  const { link, state: linkOauthState } = useLinkWithOAuth();
  const { unlinkOAuth } = useUnlinkOAuth();
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
  const [deletedAccountStatus, setDeletedAccountStatus] =
    useState<AppAccountDeletionStatusResponse | null>(null);
  const [deletedAccountAction, setDeletedAccountAction] = useState<
    "idle" | "reactivating" | "returning"
  >("idle");
  const [deletedAccountError, setDeletedAccountError] = useState<string | null>(
    null,
  );
  const [showRecoveryFundsNotice, setShowRecoveryFundsNotice] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [policyStatus, setPolicyStatus] = useState<AppUserPolicyStatus | null>(null);
  const [policyAction, setPolicyAction] = useState<
    "idle" | "submitting" | "returning"
  >("idle");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [appleUserInfoHint, setAppleUserInfoHint] = useState<AppleOAuthUserInfoHint | null>(
    null,
  );
  const [pendingAppleTokens, setPendingAppleTokens] = useState<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresInSeconds?: number;
    refreshTokenExpiresInSeconds?: number;
    scopes?: string[];
    providerSubject?: string;
    providerEmail?: string;
    isPrivateRelay?: boolean;
  } | null>(null);
  const [appleLinkMessage, setAppleLinkMessage] = useState<string | null>(null);
  const [appleUnlinkBusy, setAppleUnlinkBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const [googleUnlinkBusy, setGoogleUnlinkBusy] = useState(false);
  const creatingWalletRef = useRef(false);
  const bootstrappedIdentityRef = useRef<string | null>(null);
  const manualWalletSelectionRef = useRef(false);
  const nextPendingLinkIDRef = useRef(0);
  const recentIncomingLinkRef = useRef<{ signature: string; timestamp: number } | null>(null);
  const embeddedWallet = wallets[0];

  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);
  const backendClient = useMemo(
    () => new AppBackendClient(async () => (await getAccessTokenRef.current()) ?? null),
    [],
  );
  const linkedAppleAccount = useMemo(() => getLinkedAppleAccount(user), [user]);
  const linkedGoogleAccount = useMemo(() => getLinkedGoogleAccount(user), [user]);
  const linkedEmailAccount = useMemo(() => getLinkedEmailAccount(user), [user]);
  const appleLinked = Boolean(linkedAppleAccount?.subject || linkedAppleAccount?.email);
  const googleLinked = Boolean(linkedGoogleAccount?.subject || linkedGoogleAccount?.email);
  const emailLinked = Boolean(linkedEmailAccount?.address);
  const signInMethodCount = Number(appleLinked) + Number(googleLinked) + Number(emailLinked);
  const canDisconnectApple = appleLinked && signInMethodCount > 1;
  const canDisconnectGoogle = googleLinked && signInMethodCount > 1;
  const appleDisconnectDisabledReason =
    appleLinked && !canDisconnectApple ? "Add email or Google before disconnecting Apple." : null;
  const googleDisconnectDisabledReason =
    googleLinked && !canDisconnectGoogle ? "Add email or Apple before disconnecting Google." : null;
  const appleActionBusy = linkOauthState.status === "loading" || appleUnlinkBusy;
  const googleActionBusy = linkOauthState.status === "loading" || googleUnlinkBusy;
  const googleLinkedEmail = linkedGoogleAccount?.email?.trim() || undefined;
  const consumePendingLink = React.useCallback(() => {
    setPendingLinkIntent(null);
  }, []);

  useOAuthTokens({
    onOAuthTokenGrant: (tokens) => {
      if (tokens.provider !== "apple") {
        return;
      }
      setPendingAppleTokens((current) => ({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresInSeconds: tokens.access_token_expires_in_seconds,
        refreshTokenExpiresInSeconds: tokens.refresh_token_expires_in_seconds,
        scopes: tokens.scopes,
        providerSubject: linkedAppleAccount?.subject,
        providerEmail: linkedAppleAccount?.email ?? appleUserInfoHint?.email ?? undefined,
        isPrivateRelay:
          Boolean(linkedAppleAccount?.email?.toLowerCase().endsWith("@privaterelay.appleid.com")) ||
          Boolean(appleUserInfoHint?.email?.toLowerCase().endsWith("@privaterelay.appleid.com")) ||
          current?.isPrivateRelay === true,
      }));
    },
  });

  const presentLoginError = (error: unknown) => {
    const message = describeLoginIssue(error);
    setRuntime({
      loading: false,
      service: null,
      discovery: null,
      error: message,
      loadingMessage: null,
    });
  };

  const showDeletedAccountGate = (
    nextDeletedAccountStatus: AppAccountDeletionStatusResponse,
  ) => {
    setDeletedAccountStatus(nextDeletedAccountStatus);
    setDeletedAccountAction("idle");
    setDeletedAccountError(null);
    setBackendBootstrapReady(false);
    setRuntime(blankRuntime(false));
  };

  const showPolicyGate = (nextPolicyStatus: AppUserPolicyStatus) => {
    setPolicyStatus(nextPolicyStatus);
    setPolicyAction("idle");
    setPolicyError(null);
    setBackendBootstrapReady(false);
    setRuntime(blankRuntime(false));
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
    const signature = linkSignature(parsedLink);
    const lastHandledLink = recentIncomingLinkRef.current;
    const now = Date.now();
    if (lastHandledLink && lastHandledLink.signature === signature && now - lastHandledLink.timestamp < LINK_DEDUPE_WINDOW_MS) {
      return;
    }
    recentIncomingLinkRef.current = {
      signature,
      timestamp: now,
    };
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
      setDeletedAccountStatus(null);
      setDeletedAccountAction("idle");
      setDeletedAccountError(null);
      setPolicyStatus(null);
      setPolicyAction("idle");
      setPolicyError(null);
      setAppleUserInfoHint(null);
      setPendingAppleTokens(null);
      setAppleLinkMessage(null);
      manualWalletSelectionRef.current = false;
      bootstrappedIdentityRef.current = null;
      return;
    }
    if (deletedAccountStatus) {
      return;
    }
    if (policyStatus) {
      return;
    }
    if (wallets.length > 0 || creatingWalletRef.current) {
      return;
    }

    let cancelled = false;
    creatingWalletRef.current = true;
    const createEmbeddedWallet = async () => {
      try {
        try {
          const status = await withTimeout(
            backendClient.getDeleteAccountStatus(),
            BACKEND_BOOTSTRAP_TIMEOUT_MS,
            "check your account status",
          );
          if (cancelled) {
            return;
          }
          if (status && status.status !== "active") {
            showDeletedAccountGate(status);
            return;
          }
        } catch (statusError) {
          if (cancelled) {
            return;
          }
          console.warn("Unable to load deleted-account status", statusError);
        }
        await withTimeout(
          backendClient.ensureUser(),
          BACKEND_BOOTSTRAP_TIMEOUT_MS,
          "prepare your SFLUV profile",
        );
        if (cancelled || wallets.length > 0) {
          return;
        }
        await withTimeout(
          create({ createAdditional: false }),
          WALLET_CREATE_TIMEOUT_MS,
          "create your Privy wallet",
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof AppBackendPolicyRequiredError && error.policyStatus) {
          showPolicyGate(error.policyStatus);
          return;
        }
        presentLoginError(error);
      } finally {
        creatingWalletRef.current = false;
      }
    };

    void createEmbeddedWallet();
    return () => {
      cancelled = true;
    };
  }, [backendClient, create, deletedAccountStatus, isReady, policyStatus, user, wallets.length]);

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
    let cancelled = false;

    if (!user || deletedAccountStatus || policyStatus) {
      setShowRecoveryFundsNotice(false);
      return () => {
        cancelled = true;
      };
    }

    AsyncStorage.getItem(REACTIVATED_ACCOUNT_RECOVERY_NOTICE_STORAGE_KEY)
      .then((value) => {
        if (!cancelled) {
          setShowRecoveryFundsNotice(value === "pending");
        }
      })
      .catch((error) => {
        console.warn("Unable to load the account recovery notice state", error);
      });

    return () => {
      cancelled = true;
    };
  }, [deletedAccountStatus, policyStatus, user]);

  const dismissRecoveryFundsNotice = () => {
    setShowRecoveryFundsNotice(false);
    AsyncStorage.removeItem(REACTIVATED_ACCOUNT_RECOVERY_NOTICE_STORAGE_KEY).catch((error) => {
      console.warn("Unable to clear the account recovery notice state", error);
    });
  };

  useEffect(() => {
    if (!user?.id || !pendingAppleTokens) {
      return;
    }

    let cancelled = false;
    const persistAppleTokens = async () => {
      try {
        await backendClient.storeAppleOAuthCredential({
          accessToken: pendingAppleTokens.accessToken,
          refreshToken: pendingAppleTokens.refreshToken,
          accessTokenExpiresInSeconds: pendingAppleTokens.accessTokenExpiresInSeconds,
          refreshTokenExpiresInSeconds: pendingAppleTokens.refreshTokenExpiresInSeconds,
          scopes: pendingAppleTokens.scopes,
          providerSubject: pendingAppleTokens.providerSubject || linkedAppleAccount?.subject,
          providerEmail:
            pendingAppleTokens.providerEmail || linkedAppleAccount?.email || appleUserInfoHint?.email || undefined,
          isPrivateRelay:
            pendingAppleTokens.isPrivateRelay ||
            Boolean(
              (pendingAppleTokens.providerEmail || linkedAppleAccount?.email || appleUserInfoHint?.email || "")
                .toLowerCase()
                .endsWith("@privaterelay.appleid.com"),
            ),
        });
        if (!cancelled) {
          setPendingAppleTokens(null);
        }
      } catch (error) {
        console.warn("Unable to persist Apple OAuth credentials", error);
      }
    };

    void persistAppleTokens();
    return () => {
      cancelled = true;
    };
  }, [appleUserInfoHint?.email, backendClient, linkedAppleAccount?.email, linkedAppleAccount?.subject, pendingAppleTokens, user?.id]);

  useEffect(() => {
    if (
      !isReady ||
      !user ||
      !embeddedWallet ||
      !walletPreferencesReady ||
      deletedAccountStatus ||
      policyStatus
    ) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      setRuntime((state) => ({
        ...state,
        loading: true,
        error: null,
        loadingMessage: "Loading your SFLUV profile...",
      }));
      try {
        const profile = await withTimeout(
          backendClient.ensureUser(),
          BACKEND_BOOTSTRAP_TIMEOUT_MS,
          "load your SFLUV profile",
        );
        if (cancelled) {
          return;
        }
        setRuntime((state) => ({
          ...state,
          loading: true,
          error: null,
          loadingMessage: "Opening your Privy wallet...",
        }));
        const embeddedProvider = await embeddedWallet.getProvider();
        const web3Provider = new ethers.providers.Web3Provider(embeddedProvider as any);
        const signer = web3Provider.getSigner(embeddedWallet.address);
        const accessTokenProvider = async () => (await getAccessToken()) ?? null;
        setRuntime((state) => ({
          ...state,
          loading: true,
          error: null,
          loadingMessage: "Finding your smart wallet...",
        }));
        let { service, discovery } = await withTimeout(
          createSmartWalletServiceFromSigner(
            signer,
            preferredCandidateKey,
            accessTokenProvider,
          ),
          WALLET_DISCOVERY_TIMEOUT_MS,
          "discover your smart wallet",
        );
        const initialPreferredCandidateKey = resolveCandidateKeyWithPreferences({
          candidates: discovery.candidates,
          requestedCandidateKey: preferredCandidateKey,
          discoverySelectedCandidateKey: discovery.selectedCandidateKey,
          defaultWalletAddress: walletPreferences.defaultWalletAddress,
          hiddenWalletAddresses: walletPreferences.hiddenWalletAddresses,
        });
        if (initialPreferredCandidateKey && initialPreferredCandidateKey !== discovery.selectedCandidateKey) {
          ({ service, discovery } = await withTimeout(
            createSmartWalletServiceFromSigner(
              signer,
              initialPreferredCandidateKey,
              accessTokenProvider,
            ),
            WALLET_DISCOVERY_TIMEOUT_MS,
            "load your selected smart wallet",
          ));
        }
        const bootstrapKey = `${user.id}:${discovery.ownerAddress.toLowerCase()}`;

        if (bootstrappedIdentityRef.current !== bootstrapKey) {
          if (!cancelled) {
            setBackendBootstrapReady(false);
            setRuntime((state) => ({
              ...state,
              loading: true,
              error: null,
              loadingMessage: "Syncing your wallet profile...",
            }));
          }
          const { latestWallets, deployedPrimarySmartWallet } = await withTimeout(
            ensureManagedEmbeddedWallets({
              backendClient,
              ownerAddress: discovery.ownerAddress,
              candidates: discovery.candidates,
              isNewAccount: profile.wallets.length === 0,
            }),
            BACKEND_BOOTSTRAP_TIMEOUT_MS,
            "sync your wallet profile",
          );
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
            ({ service, discovery } = await withTimeout(
              createSmartWalletServiceFromSigner(
                signer,
                syncedPreferredCandidateKey,
                accessTokenProvider,
                deployedPrimarySmartWallet ? { forceRefresh: true } : undefined,
              ),
              WALLET_DISCOVERY_TIMEOUT_MS,
              "refresh your smart wallet",
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
          loadingMessage: null,
        });
        setBackendBootstrapReady(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBackendBootstrapReady(false);
        if (error instanceof AppBackendPolicyRequiredError && error.policyStatus) {
          showPolicyGate(error.policyStatus);
          return;
        }
        if (error instanceof AppBackendAuthError) {
          try {
            const status = await backendClient.getDeleteAccountStatus();
            if (status && status.status !== "active") {
              showDeletedAccountGate(status);
              return;
            }
          } catch (statusError) {
            console.warn("Unable to load deleted-account status", statusError);
          }
        }
        presentLoginError(error);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    backendClient,
    deletedAccountStatus,
    embeddedWallet,
    getAccessToken,
    isReady,
    policyStatus,
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

  const oauthLoading =
    oauthState.status === "loading" || linkOauthState.status === "loading";
  const authLoading = oauthLoading || emailLoading;
  const selectedCandidateKey = runtime.discovery?.selectedCandidateKey;
  const walletInitializingMessage =
    !walletPreferencesReady
      ? "Loading wallet preferences..."
      : !embeddedWallet
        ? "Creating your Privy wallet..."
        : runtime.loadingMessage || (runtime.loading ? "Preparing your wallet..." : null);
  const walletInitializing =
    Boolean(user) &&
    !runtime.error &&
    (!embeddedWallet || runtime.loading || !runtime.service || !runtime.discovery || !backendBootstrapReady);

  const handleGoogleLogin = async () => {
    try {
      setLoginNotice(null);
      setPolicyStatus(null);
      setPolicyAction("idle");
      setPolicyError(null);
      await login({ provider: "google" });
    } catch (error) {
      presentLoginError(error);
    }
  };

  const startAppleLogin = async () => {
    try {
      setLoginNotice(null);
      setAppleUserInfoHint(null);
      setPolicyStatus(null);
      setPolicyAction("idle");
      setPolicyError(null);
      await login({
        provider: "apple",
        onAppleOAuthUserInfo: (userInfo) => {
          setAppleUserInfoHint({
            email: userInfo.email ?? undefined,
          });
        },
      });
    } catch (error) {
      presentLoginError(error);
    }
  };

  const handleAppleLogin = () => {
    if (authLoading) {
      return;
    }
    void startAppleLogin();
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
      setPolicyStatus(null);
      setPolicyAction("idle");
      setPolicyError(null);
      await loginWithCode({ email: normalizedEmail, code: normalizedCode });
    } catch (error) {
      presentLoginError(error);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleAcceptPolicies = async (mailingListOptIn: boolean) => {
    setPolicyAction("submitting");
    setPolicyError(null);
    try {
      await backendClient.acceptUserPolicies(mailingListOptIn);
      setPolicyStatus(null);
      setBackendBootstrapReady(false);
      setRuntime(blankRuntime(true));
      bootstrappedIdentityRef.current = null;
    } catch (error) {
      setPolicyError(describeAppBackendIssue(error));
    } finally {
      setPolicyAction("idle");
    }
  };

  const handlePolicyReturnToLogin = async () => {
    setPolicyAction("returning");
    setPolicyError(null);
    try {
      await logout();
    } finally {
      setPolicyAction("idle");
    }
  };

  const handleDeletedAccountReactivate = async () => {
    setDeletedAccountAction("reactivating");
    setDeletedAccountError(null);
    try {
      await backendClient.cancelDeleteAccount();
      try {
        await AsyncStorage.setItem(REACTIVATED_ACCOUNT_RECOVERY_NOTICE_STORAGE_KEY, "pending");
      } catch (storageError) {
        console.warn("Unable to persist the account recovery notice state", storageError);
      }
      bootstrappedIdentityRef.current = null;
      setBackendBootstrapReady(false);
      setDeletedAccountStatus(null);
      setRuntime(blankRuntime(true));
    } catch (error) {
      setDeletedAccountError(describeAppBackendIssue(error));
      setDeletedAccountAction("idle");
      return;
    }
    setDeletedAccountAction("idle");
  };

  const handleDeletedAccountReturnToLogin = async () => {
    setDeletedAccountAction("returning");
    setDeletedAccountError(null);
    try {
      await logout();
    } finally {
      setDeletedAccountAction("idle");
    }
  };

  const handleLinkApple = async () => {
    try {
      setAppleLinkMessage(null);
      await link({
        provider: "apple",
        onAppleOAuthUserInfo: (userInfo) => {
          setAppleUserInfoHint({
            email: userInfo.email ?? undefined,
          });
        },
      });
      setAppleLinkMessage("Apple is now linked to this account.");
    } catch (error) {
      setAppleLinkMessage((error as Error)?.message || "Unable to link Apple right now.");
    }
  };

  const handleLinkGoogle = async () => {
    try {
      setGoogleMessage(null);
      await link({
        provider: "google",
      });
      setGoogleMessage("Google is now linked to this account.");
    } catch (error) {
      setGoogleMessage((error as Error)?.message || "Unable to link Google right now.");
    }
  };

  const handleDisconnectApple = () => {
    if (!linkedAppleAccount?.subject) {
      setAppleLinkMessage("Apple is not linked to this account.");
      return;
    }
    if (!canDisconnectApple) {
      setAppleLinkMessage(appleDisconnectDisabledReason);
      return;
    }
    const appleSubject = linkedAppleAccount.subject;

    Alert.alert(
      "Disconnect Apple",
      "Apple will no longer be able to sign in to this SFLUV account until you link it again.",
      [
        { text: "Keep Apple", style: "cancel" },
        {
          text: "Disconnect Apple",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setAppleUnlinkBusy(true);
              setAppleLinkMessage(null);
              try {
                await unlinkOAuth({
                  provider: "apple",
                  subject: appleSubject,
                });
                setAppleLinkMessage("Apple has been disconnected from this account.");
              } catch (error) {
                setAppleLinkMessage(
                  (error as Error)?.message || "Unable to disconnect Apple right now.",
                );
              } finally {
                setAppleUnlinkBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const handleDisconnectGoogle = () => {
    if (!linkedGoogleAccount?.subject) {
      setGoogleMessage("Google is not linked to this account.");
      return;
    }
    if (!canDisconnectGoogle) {
      setGoogleMessage(googleDisconnectDisabledReason);
      return;
    }
    const googleSubject = linkedGoogleAccount.subject;

    Alert.alert(
      "Disconnect Google",
      "Google will no longer be able to sign in to this SFLUV account until you link it again.",
      [
        { text: "Keep Google", style: "cancel" },
        {
          text: "Disconnect Google",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setGoogleUnlinkBusy(true);
              setGoogleMessage(null);
              try {
                await unlinkOAuth({
                  provider: "google",
                  subject: googleSubject,
                });
                setGoogleMessage("Google has been disconnected from this account.");
              } catch (error) {
                setGoogleMessage(
                  (error as Error)?.message || "Unable to disconnect Google right now.",
                );
              } finally {
                setGoogleUnlinkBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (!isReady) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerState}>
          <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
          <Text style={styles.stateText}>Initializing Privy…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (user && deletedAccountStatus) {
    return (
      <DeletedAccountScreen
        status={deletedAccountStatus}
        action={deletedAccountAction}
        error={deletedAccountError}
        onReactivate={() => {
          void handleDeletedAccountReactivate();
        }}
        onReturnToLogin={() => {
          void handleDeletedAccountReturnToLogin();
        }}
      />
    );
  }

  if (user && policyStatus) {
    return (
      <PolicyAcceptanceScreen
        action={policyAction}
        error={policyError}
        onAccept={(mailingListOptIn) => {
          void handleAcceptPolicies(mailingListOptIn);
        }}
        onReturnToLogin={() => {
          void handlePolicyReturnToLogin();
        }}
      />
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loginWrap}>
          <Text style={styles.loginBrand}>SFLUV</Text>
          <Text style={styles.loginTitle}>A community currency for San Francisco</Text>
          <Text style={styles.loginBody}>Sign in to send, receive, and redeem SFLUV.</Text>
          {loginNotice ? <Text style={styles.loginNotice}>{loginNotice}</Text> : null}
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
                  setLoginNotice(null);
                  setRuntime((state) => ({ ...state, error: null }));
                }}
              >
                <Text style={styles.loginTertiaryButtonText}>Other sign-in options</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[
                  styles.loginOptionButton,
                  styles.loginOptionButtonLight,
                  authLoading ? styles.loginButtonDisabled : undefined,
                ]}
                disabled={authLoading}
                onPress={() => {
                  void handleGoogleLogin();
                }}
              >
                <View style={styles.loginOptionContent}>
                  <View style={styles.loginOptionIconSlot}>
                    <Ionicons name="logo-google" size={20} color={palette.text} />
                  </View>
                  <Text style={styles.loginOptionButtonText}>
                    {oauthLoading ? "Connecting..." : "Continue with Google"}
                  </Text>
                  <View style={styles.loginOptionIconSlot} />
                </View>
              </Pressable>
              <Pressable
                style={[
                  styles.loginOptionButton,
                  styles.loginOptionButtonOutline,
                  authLoading ? styles.loginButtonDisabled : undefined,
                ]}
                disabled={authLoading}
                onPress={() => {
                  setLoginMode("email");
                  setLoginNotice(null);
                  setRuntime((state) => ({ ...state, error: null }));
                }}
              >
                <View style={styles.loginOptionContent}>
                  <View style={styles.loginOptionIconSlot}>
                    <Ionicons name="mail-outline" size={20} color={palette.primaryStrong} />
                  </View>
                  <Text style={styles.loginOptionOutlineText}>Continue with Email</Text>
                  <View style={styles.loginOptionIconSlot} />
                </View>
              </Pressable>
              <Pressable
                style={[
                  styles.loginOptionButton,
                  styles.loginOptionButtonDark,
                  authLoading ? styles.loginButtonDisabled : undefined,
                ]}
                disabled={authLoading}
                onPress={() => {
                  handleAppleLogin();
                }}
              >
                <View style={styles.loginOptionContent}>
                  <View style={styles.loginOptionIconSlot}>
                    <Ionicons name="logo-apple" size={20} color={palette.white} />
                  </View>
                  <Text style={styles.loginOptionButtonTextDark}>
                    {oauthLoading ? "Connecting..." : "Continue with Apple"}
                  </Text>
                  <View style={styles.loginOptionIconSlot} />
                </View>
              </Pressable>
            </>
          )}
          <View style={styles.loginPolicyLinks}>
            <Pressable
              disabled={authLoading}
              onPress={() => {
                void Linking.openURL(buildPublicPolicyURL(PRIVACY_POLICY_PATH));
              }}
            >
              <Text style={styles.loginPolicyLinkText}>Privacy Policy</Text>
            </Pressable>
            <Text style={styles.loginPolicyLinkDivider}>•</Text>
            <Pressable
              disabled={authLoading}
              onPress={() => {
                void Linking.openURL(buildPublicPolicyURL(EMAIL_OPT_IN_POLICY_PATH));
              }}
            >
              <Text style={styles.loginPolicyLinkText}>Email Opt-In Policy</Text>
            </Pressable>
          </View>
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
      runtime={{
        ...runtime,
        loading: walletInitializing,
        loadingMessage: walletInitializingMessage,
      }}
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
      onConsumePendingLink={consumePendingLink}
      preferences={preferences}
      onUpdatePreferences={onUpdatePreferences}
      appleLinked={appleLinked}
      appleLinkedEmail={linkedAppleAccount?.email || undefined}
      appleLinkBusy={appleActionBusy}
      appleLinkMessage={appleLinkMessage}
      appleCanDisconnect={canDisconnectApple}
      appleDisconnectDisabledReason={appleDisconnectDisabledReason}
      onLinkApple={handleLinkApple}
      onDisconnectApple={handleDisconnectApple}
      googleLinked={googleLinked}
      googleLinkedEmail={googleLinkedEmail}
      googleActionBusy={googleActionBusy}
      googleMessage={googleMessage}
      googleCanDisconnect={canDisconnectGoogle}
      googleDisconnectDisabledReason={googleDisconnectDisabledReason}
      onLinkGoogle={handleLinkGoogle}
      onDisconnectGoogle={handleDisconnectGoogle}
      showRecoveryFundsNotice={showRecoveryFundsNotice}
      onDismissRecoveryFundsNotice={dismissRecoveryFundsNotice}
      onPolicyRequired={showPolicyGate}
    />
  );
}

function DeletedAccountScreen({
  status,
  action,
  error,
  onReactivate,
  onReturnToLogin,
}: {
  status: AppAccountDeletionStatusResponse;
  action: "idle" | "reactivating" | "returning";
  error: string | null;
  onReactivate: () => void;
  onReturnToLogin: () => void;
}) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(
    () => createStyles(palette, shadows, isDark),
    [palette, shadows, isDark],
  );
  const deleteDateLabel =
    formatDeletionDateLabel(status.deleteDate) || "the current 30-day window";
  const busy = action !== "idle";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.loginWrap}>
        <Text style={styles.loginBrand}>SFLUV</Text>
        <Text style={styles.loginTitle}>
          This account has been recently deleted. Do you want to re-activate it?
        </Text>
        <Text style={styles.loginBody}>
          The account is scheduled for permanent deletion on {deleteDateLabel}.
          If you reactivate it now, your profile and wallets will become active
          again.
        </Text>
        {status.status === "ready_for_manual_purge" ? (
          <View style={styles.deletedAccountNotice}>
            <Text style={styles.deletedAccountNoticeText}>
              This account is already at the end of its deletion window. If
              reactivation fails, it may need manual recovery.
            </Text>
          </View>
        ) : null}
        <Pressable
          style={[styles.loginButton, busy ? styles.loginButtonDisabled : undefined]}
          disabled={busy}
          onPress={onReactivate}
        >
          <Text style={styles.loginButtonText}>
            {action === "reactivating" ? "Re-activating..." : "Yes, re-activate it"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.loginSecondaryButton, busy ? styles.loginButtonDisabled : undefined]}
          disabled={busy}
          onPress={onReturnToLogin}
        >
          <Text style={styles.loginSecondaryButtonText}>
            {action === "returning" ? "Returning..." : "No, take me back"}
          </Text>
        </Pressable>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function PolicyAcceptanceScreen({
  action,
  error,
  onAccept,
  onReturnToLogin,
}: {
  action: "idle" | "submitting" | "returning";
  error: string | null;
  onAccept: (mailingListOptIn: boolean) => void;
  onReturnToLogin: () => void;
}) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(
    () => createStyles(palette, shadows, isDark),
    [palette, shadows, isDark],
  );
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = useState(false);
  const [mailingListOptIn, setMailingListOptIn] = useState(true);
  const busy = action !== "idle";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.safe}
        contentContainerStyle={styles.policyScreenScrollContent}
      >
        <View style={styles.loginWrap}>
          <Text style={styles.loginBrand}>SFLUV</Text>
          <Text style={styles.loginTitle}>Accept the Privacy Policy to keep using SFLUV.</Text>
          <Text style={styles.loginBody}>
            Review the Privacy Policy and choose whether to receive SFLUV email updates. The
            privacy-policy checkbox is required to continue.
          </Text>

          <View style={styles.policyCard}>
            <Pressable
              style={styles.policyCheckboxRow}
              disabled={busy}
              onPress={() => {
                setAcceptedPrivacyPolicy((current) => !current);
              }}
            >
              <View
                style={[
                  styles.policyCheckbox,
                  acceptedPrivacyPolicy ? styles.policyCheckboxChecked : undefined,
                ]}
              >
                {acceptedPrivacyPolicy ? (
                  <Ionicons name="checkmark" size={16} color={palette.white} />
                ) : null}
              </View>
              <Text style={styles.policyCheckboxText}>
                I have read and accept the Privacy Policy.
              </Text>
            </Pressable>

            <View style={styles.policyLinkRow}>
              <Pressable
                disabled={busy}
                onPress={() => {
                  void Linking.openURL(buildPublicPolicyURL(PRIVACY_POLICY_PATH));
                }}
              >
                <Text style={styles.policyInlineLink}>Open Privacy Policy</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.policyCheckboxRow}
              disabled={busy}
              onPress={() => {
                setMailingListOptIn((current) => !current);
              }}
            >
              <View
                style={[
                  styles.policyCheckbox,
                  mailingListOptIn ? styles.policyCheckboxChecked : undefined,
                ]}
              >
                {mailingListOptIn ? (
                  <Ionicons name="checkmark" size={16} color={palette.white} />
                ) : null}
              </View>
              <Text style={styles.policyCheckboxText}>
                I want to receive SFLUV emails in line with the Email Opt-In Policy.
              </Text>
            </Pressable>

            <View style={styles.policyLinkRow}>
              <Pressable
                disabled={busy}
                onPress={() => {
                  void Linking.openURL(buildPublicPolicyURL(EMAIL_OPT_IN_POLICY_PATH));
                }}
              >
                <Text style={styles.policyInlineLink}>Open Email Opt-In Policy</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.loginBody}>
            Email opt-in is optional, and you can unsubscribe later at any time.
          </Text>

          <Pressable
            style={[
              styles.loginButton,
              (!acceptedPrivacyPolicy || busy) ? styles.loginButtonDisabled : undefined,
            ]}
            disabled={!acceptedPrivacyPolicy || busy}
            onPress={() => onAccept(mailingListOptIn)}
          >
            <Text style={styles.loginButtonText}>
              {action === "submitting" ? "Saving..." : "Continue"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.loginSecondaryButton, busy ? styles.loginButtonDisabled : undefined]}
            disabled={busy}
            onPress={onReturnToLogin}
          >
            <Text style={styles.loginSecondaryButtonText}>
              {action === "returning" ? "Logging out..." : "Log out"}
            </Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
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
                createOnLogin: "off",
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
    paddingBottom: Platform.OS === "android" ? spacing.sm : 0,
  },
  safeFullscreen: {
    paddingBottom: 0,
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
    letterSpacing: 0,
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
  contentShellFullscreen: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  content: {
    flex: 1,
  },
  walletPaneStack: {
    flex: 1,
  },
  walletPaneBase: {
    flex: 1,
  },
  walletPaneOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.background,
  },
  toastCard: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: Platform.OS === "android" ? 112 : 100,
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
  bottomDockShell: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? -spacing.xl : 0,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "android" ? spacing.md : spacing.sm,
    paddingBottom: Platform.OS === "android" ? spacing.md : spacing.xl + 12,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  bottomDockShellBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomDockLiquidLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: isDark ? "rgba(16,22,27,0.22)" : "rgba(255,255,255,0.26)",
    borderTopWidth: 1,
    borderTopColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.64)",
  },
  bottomDock: {
    position: "relative",
    flexDirection: "row",
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
    ...shadows.card,
  },
  bottomDockGlassLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  bottomDockGlassSheen: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 0,
    height: 24,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: "transparent",
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
  loginNotice: {
    color: palette.primaryStrong,
    lineHeight: 20,
    fontWeight: "700",
    maxWidth: 360,
  },
  loginPolicyLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loginPolicyLinkText: {
    color: palette.primaryStrong,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  loginPolicyLinkDivider: {
    color: palette.textMuted,
    fontSize: 12,
  },
  deletedAccountNotice: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.primary,
    backgroundColor: palette.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deletedAccountNoticeText: {
    color: palette.primaryStrong,
    lineHeight: 20,
    fontWeight: "700",
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
  loginOptionButton: {
    marginTop: spacing.sm,
    width: "100%",
    maxWidth: 360,
    minHeight: 58,
    alignSelf: "stretch",
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  loginOptionButtonLight: {
    backgroundColor: palette.surface,
    borderColor: palette.surface,
  },
  loginOptionButtonOutline: {
    backgroundColor: "transparent",
    borderColor: palette.border,
  },
  loginOptionButtonDark: {
    backgroundColor: "#111111",
    borderColor: "#111111",
  },
  loginOptionContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  loginOptionIconSlot: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  loginOptionButtonText: {
    flex: 1,
    color: palette.text,
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },
  loginOptionOutlineText: {
    flex: 1,
    color: palette.primaryStrong,
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },
  loginOptionButtonTextDark: {
    flex: 1,
    color: palette.white,
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
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
  policyScreenScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  policyCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  policyCheckboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  policyCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  policyCheckboxChecked: {
    borderColor: palette.primaryStrong,
    backgroundColor: palette.primaryStrong,
  },
  policyCheckboxText: {
    flex: 1,
    color: palette.text,
    lineHeight: 22,
  },
  policyLinkRow: {
    paddingLeft: 36,
  },
  policyInlineLink: {
    color: palette.primaryStrong,
    fontWeight: "700",
    textDecorationLine: "underline",
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
  moreMenuCard: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.primary,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.card,
  },
  moreMenuHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  moreMenuHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  moreMenuTitle: {
    color: palette.primaryStrong,
    fontSize: 24,
    fontWeight: "900",
  },
  moreMenuSubtitle: {
    color: palette.textMuted,
    marginTop: 4,
  },
  moreMenuList: {
    gap: spacing.sm,
  },
  moreMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    padding: spacing.md,
  },
  moreMenuItemActive: {
    borderColor: palette.primary,
    backgroundColor: palette.primarySoft,
  },
  moreMenuCopy: {
    flex: 1,
    gap: 4,
  },
  moreMenuLabel: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "800",
  },
  moreMenuBody: {
    color: palette.textMuted,
    lineHeight: 18,
  },
  walletChooserHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  walletChooserHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  walletChooserTitle: {
    color: palette.primaryStrong,
    fontSize: 24,
    fontWeight: "900",
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
