import "./src/polyfills";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { MerchantApplicationScreen } from "./src/screens/MerchantApplicationScreen";
import { mobileConfig } from "./src/config";
import {
  createSmartWalletServiceFromSigner,
  createSmartWalletServiceFromTestKey,
  RouteDiscovery,
  SmartWalletService,
} from "./src/services/smartWallet";
import { AppBackendClient } from "./src/services/appBackend";
import {
  AppContact,
  AppLocation,
  AppOwnedLocation,
  AppTransaction,
  AppUser,
  PonderSubscription,
  VerifiedEmail,
} from "./src/types/app";
import { palette, radii, spacing } from "./src/theme";

type RuntimeState = {
  loading: boolean;
  service: SmartWalletService | null;
  discovery: RouteDiscovery | null;
  error: string | null;
};

type Tab = "wallet" | "activity" | "map" | "settings";
type WalletPane = "home" | "send" | "receive";

function blankRuntime(loading = false): RuntimeState {
  return { loading, service: null, discovery: null, error: null };
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

function findPrimaryCandidate(discovery: RouteDiscovery | null, routeID: "legacy" | "new") {
  if (!discovery) {
    return undefined;
  }
  return (
    discovery.candidates.find((candidate) => candidate.route.id === routeID && candidate.smartIndex === 0) ??
    discovery.candidates.find((candidate) => candidate.route.id === routeID)
  );
}

function shortAddress(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function describeAppBackendIssue(error: unknown): string {
  const message = (error as Error)?.message?.trim();
  if (!message) {
    return "Some shared app features could not sync right now. Wallet transfers still work.";
  }
  if (message === "Unable to load user profile." || message === "No Privy access token available.") {
    return "Some shared app features could not sync right now. Wallet transfers still work.";
  }
  return message;
}

function BottomTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.bottomTab, active ? styles.bottomTabActive : undefined]} onPress={onPress}>
      <Text style={[styles.bottomTabText, active ? styles.bottomTabTextActive : undefined]}>{label}</Text>
    </Pressable>
  );
}

function WalletAppShell({
  runtime,
  selectedCandidateKey,
  onSelectCandidate,
  onMigrateLegacyToNew,
  showMigrateLegacyToNew,
  canMigrateLegacyToNew,
  migratingLegacyToNew,
  legacyBalance,
  ownerBadge,
  onLogout,
  backendClient,
}: {
  runtime: RuntimeState;
  selectedCandidateKey?: string;
  onSelectCandidate: (key: string) => void;
  onMigrateLegacyToNew?: () => Promise<void>;
  showMigrateLegacyToNew?: boolean;
  canMigrateLegacyToNew?: boolean;
  migratingLegacyToNew?: boolean;
  legacyBalance?: string;
  ownerBadge?: string;
  onLogout?: () => void;
  backendClient?: AppBackendClient | null;
}) {
  const [tab, setTab] = useState<Tab>("wallet");
  const [walletPane, setWalletPane] = useState<WalletPane>("home");
  const [smartAddress, setSmartAddress] = useState("");
  const [smartBalance, setSmartBalance] = useState("...");
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [locations, setLocations] = useState<AppLocation[]>([]);
  const [ownedLocations, setOwnedLocations] = useState<AppOwnedLocation[]>([]);
  const [verifiedEmails, setVerifiedEmails] = useState<VerifiedEmail[]>([]);
  const [subscriptions, setSubscriptions] = useState<PonderSubscription[]>([]);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showMerchantApplication, setShowMerchantApplication] = useState(false);

  const currentSubscription = useMemo(() => {
    if (!smartAddress) return undefined;
    return subscriptions.find((entry) => entry.address.toLowerCase() === smartAddress.toLowerCase());
  }, [smartAddress, subscriptions]);

  const publicBackendClient = useMemo(
    () => backendClient ?? new AppBackendClient(async () => null),
    [backendClient],
  );

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
      setOwnedLocations(profile.locations);

      const [emails, notifications] = await Promise.allSettled([
        backendClient.getVerifiedEmails(),
        backendClient.getNotificationSubscriptions(),
      ]);

      if (emails.status === "fulfilled") {
        setVerifiedEmails(emails.value);
      }
      if (notifications.status === "fulfilled") {
        setSubscriptions(notifications.value);
      }
      setSyncNotice(null);
    } catch (error) {
      console.warn("Unable to load app profile", error);
      setSyncNotice(describeAppBackendIssue(error));
    } finally {
      setLoadingData(false);
    }
  };

  const refreshWalletSurface = async () => {
    if (!runtime.service) {
      setSmartAddress("");
      setSmartBalance("...");
      setTransactions([]);
      return;
    }

    try {
      const address = await runtime.service.smartAccountAddress();
      const balance = await runtime.service.smartAccountBalance();
      setSmartAddress(address);
      setSmartBalance(formatDisplayBalance(balance));

      if (backendClient) {
        try {
          const txs = await backendClient.getTransactions(address, 0, 25);
          setTransactions(txs);
        } catch (error) {
          console.warn("Unable to load transaction history", error);
          setSyncNotice(describeAppBackendIssue(error));
          setTransactions([]);
        }
      }
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
  }, [runtime.service, selectedCandidateKey, backendClient]);

  const handleSend = async (recipient: string, amount: string, unit: "wei" | "token", memo: string) => {
    if (!runtime.service) {
      throw new Error("Wallet signer is not ready.");
    }
    const result = await runtime.service.sendSFLUV(recipient, amount, unit);
    if (memo.trim() && result.txHash && backendClient) {
      try {
        await backendClient.saveTransactionMemo(result.txHash, memo);
      } catch {
        // Memo save failure should not block the transfer UX.
      }
    }
    await refreshWalletSurface();
    await loadAppProfile();
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
          : "Settings";
  const showWalletPaneBack = tab === "wallet" && walletPane !== "home";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brand}>SFLUV Wallet</Text>
          <Text style={styles.topMeta}>
            {activeTitle}
            {selectedCandidateKey && runtime.discovery
              ? ` • ${runtime.discovery.candidates.find((item) => item.key === selectedCandidateKey)?.route.label ?? "Wallet"}`
              : ""}
          </Text>
        </View>
        <View style={styles.topActions}>
          {showWalletPaneBack ? (
            <Pressable style={styles.navButton} onPress={() => setWalletPane("home")}>
              <Text style={styles.navButtonText}>Back</Text>
            </Pressable>
          ) : null}
          {onLogout ? (
            <Pressable style={styles.logoutButton} onPress={onLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {loadingData ? (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={palette.primary} />
          <Text style={styles.bannerText}>Syncing with the SFLUV app backend…</Text>
        </View>
      ) : null}

      <View style={styles.content}>
        {runtime.loading ? (
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
            <SendScreen contacts={contacts} onPrepareSend={handleSend} />
          ) : walletPane === "receive" ? (
            <ReceiveScreen
              accountAddress={smartAddress || runtime.discovery?.ownerAddress || ethers.constants.AddressZero}
              chainId={mobileConfig.chainId}
              tokenAddress={mobileConfig.tokenAddress}
            />
          ) : (
            <WalletHomeScreen
              balance={smartBalance}
              smartAddress={smartAddress}
              ownerBadge={ownerBadge}
              candidates={runtime.discovery?.candidates ?? []}
              selectedCandidateKey={selectedCandidateKey}
              recentTransactions={transactions}
              onSelectCandidate={onSelectCandidate}
              onOpenSend={() => setWalletPane("send")}
              onOpenReceive={() => setWalletPane("receive")}
              onOpenActivity={() => setTab("activity")}
              onMigrateLegacyToNew={onMigrateLegacyToNew}
              showMigrateLegacyToNew={showMigrateLegacyToNew}
              canMigrateLegacyToNew={canMigrateLegacyToNew}
              migratingLegacyToNew={migratingLegacyToNew}
              legacyBalance={legacyBalance}
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
          <MapScreen locations={locations} />
        ) : (
          <SettingsScreen
            user={appUser}
            contacts={contacts}
            locations={ownedLocations}
            verifiedEmails={verifiedEmails}
            notificationSubscription={currentSubscription}
            activeWalletAddress={smartAddress}
            syncNotice={syncNotice}
            onOpenMerchantApplication={() => setShowMerchantApplication(true)}
            onAddContact={async (name, address) => {
              if (!backendClient) {
                throw new Error("Backend not configured.");
              }
              await backendClient.addContact(name, address);
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
            onEnableNotification={async (email, address) => {
              if (!backendClient) {
                throw new Error("Backend not configured.");
              }
              await backendClient.enableNotification(email, address);
              const updatedSubscriptions = await backendClient.getNotificationSubscriptions();
              setSubscriptions(updatedSubscriptions);
            }}
            onDisableNotification={async (id) => {
              if (!backendClient) {
                throw new Error("Backend not configured.");
              }
              await backendClient.disableNotification(id);
              const updatedSubscriptions = await backendClient.getNotificationSubscriptions();
              setSubscriptions(updatedSubscriptions);
            }}
            onLogout={() => {
              onLogout?.();
            }}
          />
        )}
      </View>

      {showMerchantApplication ? (
        <Modal visible animationType="slide" onRequestClose={() => setShowMerchantApplication(false)}>
          <SafeAreaView style={styles.safe}>
            <MerchantApplicationScreen
              onClose={() => setShowMerchantApplication(false)}
              onSubmit={async (draft) => {
                if (!backendClient) {
                  throw new Error("Backend not configured.");
                }
                await backendClient.submitMerchantApplication(draft);
                await loadAppProfile();
              }}
            />
          </SafeAreaView>
        </Modal>
      ) : null}

      <View style={styles.bottomBar}>
        <BottomTab
          label="Wallet"
          active={tab === "wallet"}
          onPress={() => {
            setTab("wallet");
            setWalletPane("home");
          }}
        />
        <BottomTab label="Activity" active={tab === "activity"} onPress={() => setTab("activity")} />
        <BottomTab label="Map" active={tab === "map"} onPress={() => setTab("map")} />
        <BottomTab label="Settings" active={tab === "settings"} onPress={() => setTab("settings")} />
      </View>
    </SafeAreaView>
  );
}

function PrivyWalletApp() {
  const { user, isReady, logout, getAccessToken } = usePrivy();
  const { login, state: oauthState } = useLoginWithOAuth();
  const { wallets, create } = useEmbeddedEthereumWallet();

  const [runtime, setRuntime] = useState<RuntimeState>(blankRuntime(true));
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | undefined>(undefined);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [migratingLegacyToNew, setMigratingLegacyToNew] = useState(false);
  const creatingWalletRef = useRef(false);

  const backendClient = useMemo(
    () => new AppBackendClient(async () => (await getAccessToken()) ?? null),
    [getAccessToken],
  );

  useEffect(() => {
    if (!isReady) {
      return;
    }
    if (!user) {
      setRuntime(blankRuntime(false));
      setSelectedCandidateKey(undefined);
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
    if (!isReady || !user || wallets.length === 0) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      setRuntime((state) => ({ ...state, loading: true, error: null }));
      try {
        const embeddedWallet = wallets[0];
        const embeddedProvider = await embeddedWallet.getProvider();
        const web3Provider = new ethers.providers.Web3Provider(embeddedProvider as any);
        const signer = web3Provider.getSigner(embeddedWallet.address);
        const { service, discovery } = await createSmartWalletServiceFromSigner(signer, selectedCandidateKey);
        if (cancelled) {
          return;
        }
        if (!selectedCandidateKey) {
          setSelectedCandidateKey(discovery.selectedCandidateKey);
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
  }, [isReady, refreshNonce, selectedCandidateKey, user, wallets]);

  const oauthLoading = oauthState.status === "loading";
  const legacyCandidate = findPrimaryCandidate(runtime.discovery, "legacy");
  const newCandidate = findPrimaryCandidate(runtime.discovery, "new");
  const showMigrateLegacyToNew =
    Boolean(legacyCandidate && newCandidate) &&
    legacyCandidate?.accountAddress.toLowerCase() !== newCandidate?.accountAddress.toLowerCase();
  const canMigrateLegacyToNew = Boolean(showMigrateLegacyToNew && legacyCandidate?.tokenBalanceRaw.gt(0));

  const runLegacyToNewMigration = async () => {
    if (migratingLegacyToNew) {
      return;
    }
    if (!legacyCandidate || !newCandidate) {
      Alert.alert("Migration unavailable", "Could not resolve both legacy and new wallets.");
      return;
    }
    if (wallets.length === 0) {
      Alert.alert("Wallet not ready", "Embedded wallet is still loading.");
      return;
    }

    setMigratingLegacyToNew(true);
    try {
      const embeddedWallet = wallets[0];
      const embeddedProvider = await embeddedWallet.getProvider();
      const web3Provider = new ethers.providers.Web3Provider(embeddedProvider as any);
      const signer = web3Provider.getSigner(embeddedWallet.address);
      const { service } = await createSmartWalletServiceFromSigner(signer, legacyCandidate.key);
      const rawBalance = ethers.BigNumber.from(await service.smartAccountBalanceRaw());
      if (rawBalance.isZero()) {
        Alert.alert("No funds", "Legacy account has no SFLUV to migrate.");
        return;
      }
      const result = await service.sendSFLUV(newCandidate.accountAddress, rawBalance.toString(), "wei");
      if (result.txHash) {
        Alert.alert("Migration confirmed", `Transaction ID:\n${result.txHash}`);
      } else {
        Alert.alert("Migration submitted", `UserOp submitted:\n${result.userOpHash}`);
      }
      setSelectedCandidateKey(newCandidate.key);
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      Alert.alert("Migration failed", (error as Error).message);
    } finally {
      setMigratingLegacyToNew(false);
    }
  };

  const requestLegacyToNewMigration = async () => {
    if (!canMigrateLegacyToNew || !legacyCandidate) {
      return;
    }

    Alert.alert(
      "Move legacy balance?",
      `Send ${formatDisplayBalance(legacyCandidate.tokenBalance)} SFLUV from your legacy wallet into your new wallet?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move Funds",
          style: "default",
          onPress: () => {
            void runLegacyToNewMigration();
          },
        },
      ],
    );
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
          <Text style={styles.loginBrand}>SFLUV Wallet</Text>
          <Text style={styles.loginTitle}>Wallet-first access to SFLUV on mobile</Text>
          <Text style={styles.loginBody}>
            Sign in with Privy to open the same account system you already use on the web, with mobile-first send and receive flows.
          </Text>
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
      runtime={runtime}
      selectedCandidateKey={selectedCandidateKey}
      onSelectCandidate={(key) => setSelectedCandidateKey(key)}
      onMigrateLegacyToNew={requestLegacyToNewMigration}
      showMigrateLegacyToNew={showMigrateLegacyToNew}
      canMigrateLegacyToNew={canMigrateLegacyToNew}
      migratingLegacyToNew={migratingLegacyToNew}
      legacyBalance={legacyCandidate ? formatDisplayBalance(legacyCandidate.tokenBalance) : "0"}
      ownerBadge={ownerBadge}
      onLogout={() => {
        void logout();
      }}
      backendClient={backendClient}
    />
  );
}

function TestKeyWalletApp() {
  const [runtime, setRuntime] = useState<RuntimeState>(blankRuntime(true));
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const loaded = await createSmartWalletServiceFromTestKey(selectedCandidateKey);
        if (!cancelled) {
          if (!selectedCandidateKey) {
            setSelectedCandidateKey(loaded.discovery.selectedCandidateKey);
          }
          setRuntime({
            loading: false,
            service: loaded.service,
            discovery: loaded.discovery,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRuntime({
            loading: false,
            service: null,
            discovery: null,
            error: (error as Error).message,
          });
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [selectedCandidateKey]);

  const ownerBadge = runtime.discovery?.ownerAddress
    ? `${runtime.discovery.ownerAddress.slice(0, 6)}...${runtime.discovery.ownerAddress.slice(-4)}`
    : "test key";

  return (
    <WalletAppShell
      runtime={runtime}
      selectedCandidateKey={selectedCandidateKey ?? runtime.discovery?.selectedCandidateKey}
      onSelectCandidate={(key) => setSelectedCandidateKey(key)}
      ownerBadge={ownerBadge}
      backendClient={null}
    />
  );
}

export default function App() {
  const withPrivy = mobileConfig.privyAppId.trim().length > 0;
  if (!withPrivy) {
    return <TestKeyWalletApp />;
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.background,
  },
  brand: {
    color: palette.text,
    fontSize: 26,
    fontWeight: "900",
  },
  topMeta: {
    color: palette.textMuted,
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  navButton: {
    backgroundColor: palette.accent,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navButtonText: {
    color: palette.text,
    fontWeight: "800",
  },
  logoutText: {
    color: palette.text,
    fontWeight: "800",
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bannerText: {
    color: palette.textMuted,
    flex: 1,
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
  bottomBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  bottomTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    paddingVertical: 12,
  },
  bottomTabActive: {
    backgroundColor: palette.primary,
  },
  bottomTabText: {
    color: palette.textMuted,
    fontWeight: "700",
    fontSize: 12,
  },
  bottomTabTextActive: {
    color: palette.white,
  },
  loginWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 16,
  },
  loginBrand: {
    color: palette.primary,
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  loginTitle: {
    color: palette.text,
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
  },
  loginBody: {
    color: palette.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
  loginButton: {
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    paddingHorizontal: 22,
    paddingVertical: 14,
    minWidth: 240,
    alignItems: "center",
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: palette.white,
    fontWeight: "800",
    fontSize: 15,
  },
});
