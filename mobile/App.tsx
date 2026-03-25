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
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
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
import { palette, radii, shadows, spacing } from "./src/theme";

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

function routeLabelTone(routeID: "legacy" | "new") {
  if (routeID === "new") {
    return {
      backgroundColor: palette.primarySoft,
      color: palette.primaryStrong,
      icon: "sparkles" as const,
    };
  }

  return {
    backgroundColor: palette.accent,
    color: palette.text,
    icon: "time" as const,
  };
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
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.bottomTab, active ? styles.bottomTabActive : undefined]} onPress={onPress}>
      <Ionicons
        name={icon}
        size={18}
        color={active ? palette.primaryStrong : palette.textMuted}
      />
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
  const [showWalletChooser, setShowWalletChooser] = useState(false);

  const currentSubscription = useMemo(() => {
    if (!smartAddress) return undefined;
    return subscriptions.find((entry) => entry.address.toLowerCase() === smartAddress.toLowerCase());
  }, [smartAddress, subscriptions]);
  const walletCandidates = runtime.discovery?.candidates ?? [];
  const selectedCandidate = useMemo(
    () => walletCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? walletCandidates[0],
    [selectedCandidateKey, walletCandidates],
  );

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
      <StatusBar style="dark" />
      <View style={styles.topBackdrop}>
        <View style={styles.topOrbLarge} />
        <View style={styles.topOrbSmall} />
      </View>

      <View style={styles.topBar}>
        <View style={styles.topTitleWrap}>
          <Text style={styles.brandKicker}>SFLUV Wallet</Text>
          <Text style={styles.brand}>{activeTitle}</Text>
          <Text style={styles.topMeta}>
            {selectedCandidateKey && runtime.discovery
              ? runtime.discovery.candidates.find((item) => item.key === selectedCandidateKey)?.route.label ?? "Wallet"
              : "Fast SFLUV payments"}
          </Text>
        </View>
        <View style={styles.topActions}>
          {showWalletPaneBack ? (
            <Pressable style={styles.iconButton} onPress={() => setWalletPane("home")}>
              <Ionicons name="arrow-back" size={18} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
          {onLogout ? (
            <Pressable style={styles.iconButton} onPress={onLogout}>
              <Ionicons name="log-out-outline" size={18} color={palette.primaryStrong} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.contentShell}>
        {loadingData ? (
          <View style={styles.banner}>
            <ActivityIndicator size="small" color={palette.primaryStrong} />
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
                selectedRouteLabel={selectedCandidate?.route.label}
                recentTransactions={transactions}
                onOpenSend={() => setWalletPane("send")}
                onOpenReceive={() => setWalletPane("receive")}
                onOpenActivity={() => setTab("activity")}
                onOpenWalletChooser={() => setShowWalletChooser(true)}
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
            onPress={() => setTab("activity")}
          />
          <BottomTab
            label="Map"
            icon={tab === "map" ? "map" : "map-outline"}
            active={tab === "map"}
            onPress={() => setTab("map")}
          />
          <BottomTab
            label="Settings"
            icon={tab === "settings" ? "settings" : "settings-outline"}
            active={tab === "settings"}
            onPress={() => setTab("settings")}
          />
        </View>
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

      <Modal
        visible={showWalletChooser}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWalletChooser(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowWalletChooser(false)}>
          <Pressable style={styles.walletChooserCard} onPress={() => {}}>
            <View style={styles.walletChooserHeader}>
              <View>
                <Text style={styles.walletChooserTitle}>Choose Wallet</Text>
                <Text style={styles.walletChooserSubtitle}>Switch between your available wallet routes.</Text>
              </View>
              <Pressable style={styles.walletChooserClose} onPress={() => setShowWalletChooser(false)}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.walletChooserList} showsVerticalScrollIndicator={false}>
              {walletCandidates.map((candidate) => {
                const active = candidate.key === selectedCandidateKey;
                const tone = routeLabelTone(candidate.route.id);
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
                      <View style={[styles.walletChooserRouteChip, { backgroundColor: tone.backgroundColor }]}>
                        <Ionicons name={tone.icon} size={12} color={tone.color} />
                        <Text style={[styles.walletChooserRouteChipText, { color: tone.color }]}>
                          {candidate.route.label}
                        </Text>
                      </View>
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
  topBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.background,
  },
  topOrbLarge: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(239,109,102,0.07)",
    top: -90,
    right: -20,
  },
  topOrbSmall: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(239,109,102,0.05)",
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
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: palette.white,
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
    backgroundColor: palette.white,
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
  walletChooserRouteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  walletChooserRouteChipText: {
    fontSize: 12,
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
