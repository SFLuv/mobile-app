import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  Vibration,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { AmountUnit, SendResult } from "../services/smartWallet";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import type { AppBackendClient } from "../services/appBackend";
import { AppContact, AppLocation, AppWalletOwnerLookup } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import {
  findNearestMerchantWithinThreshold,
  formatDistanceLabel,
  locationDistanceMeters,
  sortLocationsByProximity,
} from "../utils/location";
import { parseSendTarget, parseSfluvUniversalLink, SfluvUniversalLink } from "../utils/universalLinks";

type RecipientKind = "contact" | "merchant" | "payment-link";

type RecipientSuggestion = {
  key: string;
  kind: RecipientKind;
  label: string;
  address: string;
  subtitle?: string;
};

type TipPromptState = {
  merchantName: string;
  tipToAddress: string;
  amount: string;
};

type Props = {
  contacts: AppContact[];
  merchants: AppLocation[];
  backendClient?: AppBackendClient | null;
  hapticsEnabled: boolean;
  onPrepareSend: (
    recipient: string,
    amount: string,
    amountUnit: AmountUnit,
    memo: string,
  ) => Promise<SendResult>;
  draft?: {
    recipient: string;
    amount?: string;
    memo?: string;
    recipientLabel?: string;
    recipientKind?: RecipientKind;
  } | null;
  onDraftApplied?: () => void;
  onOpenUniversalLink?: (link: SfluvUniversalLink) => void;
  onOpenMerchantList?: () => void;
  onCompleteFlow?: () => void;
};

type FeedbackTone = "info" | "success" | "danger";

function shortAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function SwipeToSend({
  disabled,
  loading,
  label,
  onComplete,
}: {
  disabled: boolean;
  loading: boolean;
  label: string;
  onComplete: () => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const translateX = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbSize = 56;
  const swipeDistance = Math.max(trackWidth - thumbSize - 8, 0);

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

  const resetSwipe = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 0,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !loading && swipeDistance > 0,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !disabled && !loading && swipeDistance > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          const nextValue = Math.max(0, Math.min(gesture.dx, swipeDistance));
          translateX.setValue(nextValue);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx >= swipeDistance * 0.72) {
            Animated.timing(translateX, {
              toValue: swipeDistance,
              duration: 120,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished) {
                onComplete();
              }
            });
            return;
          }
          resetSwipe();
        },
        onPanResponderTerminate: resetSwipe,
      }),
    [disabled, loading, onComplete, swipeDistance, translateX],
  );

  return (
    <View
      style={[styles.swipeTrack, disabled ? styles.swipeTrackDisabled : undefined]}
      onLayout={(event) => {
        setTrackWidth(event.nativeEvent.layout.width);
      }}
    >
      <Text style={[styles.swipeTrackText, disabled ? styles.swipeTrackTextDisabled : undefined]}>
        {loading ? "Sending…" : label}
      </Text>
      <Animated.View
        style={[
          styles.swipeThumb,
          {
            transform: [{ translateX }],
          },
          disabled ? styles.swipeThumbDisabled : undefined,
        ]}
        {...panResponder.panHandlers}
      >
        {loading ? (
          <ActivityIndicator size="small" color={palette.primaryStrong} />
        ) : (
          <Ionicons name="arrow-forward" size={18} color={palette.primaryStrong} />
        )}
      </Animated.View>
    </View>
  );
}

export function SendScreen({
  contacts,
  merchants,
  backendClient,
  hapticsEnabled,
  onPrepareSend,
  draft,
  onDraftApplied,
  onOpenUniversalLink,
  onOpenMerchantList,
  onCompleteFlow,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const topInset = Math.max((Dimensions.get("window").height - Dimensions.get("screen").height) * -1, 0);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [entryMode, setEntryMode] = useState<"scan" | "manual">("manual");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
  const [tipPrompt, setTipPrompt] = useState<TipPromptState | null>(null);
  const [tipSending, setTipSending] = useState(false);
  const [recipientLookup, setRecipientLookup] = useState<AppWalletOwnerLookup | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [draftRecipient, setDraftRecipient] = useState<RecipientSuggestion | null>(null);
  const { location: userLocation, loading: loadingLocation, permissionGranted: locationPermissionGranted } = useCurrentLocation(
    entryMode === "manual",
  );

  const parsed = useMemo(() => parseSendTarget(recipientInput), [recipientInput]);
  const payableMerchants = useMemo(
    () => sortLocationsByProximity(merchants.filter((merchant) => Boolean(merchant.payToAddress)), userLocation),
    [merchants, userLocation],
  );

  const merchantSuggestions = useMemo<RecipientSuggestion[]>(
    () =>
      payableMerchants
        .filter((merchant) => merchant.payToAddress)
        .map((merchant) => ({
          key: `merchant:${merchant.id}`,
          kind: "merchant",
          label: merchant.name,
          address: merchant.payToAddress!,
          subtitle: [merchant.type, merchant.city].filter(Boolean).join(" • "),
        })),
    [payableMerchants],
  );

  const contactSuggestions = useMemo<RecipientSuggestion[]>(
    () =>
      contacts.map((contact) => ({
        key: `contact:${contact.id}`,
        kind: "contact",
        label: contact.name,
        address: contact.address,
      })),
    [contacts],
  );

  const suggestions = useMemo(() => {
    const byAddress = new Map<string, RecipientSuggestion>();
    for (const suggestion of [...merchantSuggestions, ...contactSuggestions]) {
      const key = suggestion.address.toLowerCase();
      if (!byAddress.has(key)) {
        byAddress.set(key, suggestion);
      }
    }
    return [...byAddress.values()];
  }, [contactSuggestions, merchantSuggestions]);

  const suggestionByAddress = useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestion.address.toLowerCase(), suggestion] as const)),
    [suggestions],
  );

  const query = recipientInput.trim().toLowerCase();

  const favoriteContacts = useMemo<RecipientSuggestion[]>(
    () =>
      contacts
        .filter((contact) => contact.isFavorite)
        .map((contact) => ({
          key: `favorite:${contact.id}`,
          kind: "contact" as const,
          label: contact.name,
          address: contact.address,
        })),
    [contacts],
  );

  const filteredSuggestions = useMemo(() => {
    const selectedAddress = parsed?.recipient?.toLowerCase();
    if (!query) {
      return [];
    }

    return suggestions
      .filter((suggestion) => {
        if (selectedAddress && suggestion.address.toLowerCase() === selectedAddress) {
          return false;
        }
        const haystack = `${suggestion.label} ${suggestion.address} ${suggestion.subtitle ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 6);
  }, [favoriteContacts, merchantSuggestions, parsed?.recipient, query, suggestions]);

  const displayedMerchants = useMemo(() => {
    const excludedAddress = parsed?.recipient?.toLowerCase();
    return payableMerchants
      .filter((merchant) => {
        if (!merchant.payToAddress) {
          return false;
        }
        if (!excludedAddress) {
          return true;
        }
        return merchant.payToAddress.toLowerCase() !== excludedAddress;
      })
      .slice(0, 5);
  }, [parsed?.recipient, payableMerchants]);

  const suggestedNearbyMerchant = useMemo(() => {
    const nearest = findNearestMerchantWithinThreshold(payableMerchants, userLocation);
    if (!nearest?.payToAddress) {
      return null;
    }

    if (parsed?.recipient && nearest.payToAddress.toLowerCase() === parsed.recipient.toLowerCase()) {
      return null;
    }

    return nearest;
  }, [parsed?.recipient, payableMerchants, userLocation]);

  useEffect(() => {
    if (!backendClient || !parsed?.recipient) {
      setRecipientLookup(null);
      return;
    }

    let cancelled = false;
    void backendClient
      .lookupWalletOwner(parsed.recipient)
      .then((lookup) => {
        if (cancelled) {
          return;
        }
        setRecipientLookup(lookup);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRecipientLookup(null);
      });

    return () => {
      cancelled = true;
    };
  }, [backendClient, parsed?.recipient]);

  const lookedUpRecipient = useMemo<RecipientSuggestion | null>(() => {
    if (!parsed || !recipientLookup?.found || !recipientLookup.isMerchant) {
      return null;
    }

    const label = (recipientLookup.merchantName || recipientLookup.walletName || "Merchant").trim() || "Merchant";
    const subtitle =
      recipientLookup.walletName && recipientLookup.walletName.trim() && recipientLookup.walletName.trim() !== label
        ? recipientLookup.walletName.trim()
        : undefined;

    return {
      key: `lookup:${parsed.recipient.toLowerCase()}`,
      kind: "merchant",
      label,
      address: parsed.recipient,
      subtitle,
    };
  }, [parsed, recipientLookup]);

  const paymentLinkRecipient = useMemo<RecipientSuggestion | null>(() => {
    if (!parsed || (parsed.source !== "citizenwallet-plugin-link" && parsed.source !== "sfluv-link")) {
      return null;
    }

    return {
      key: `payment-link:${parsed.recipient.toLowerCase()}`,
      kind: "payment-link",
      label: "Payment Link Scanned",
      address: parsed.recipient,
      subtitle: shortAddress(parsed.recipient),
    };
  }, [parsed]);

  const resolvedRecipient = useMemo(() => {
    if (!parsed) {
      return null;
    }

    if (lookedUpRecipient) {
      return lookedUpRecipient;
    }

    const matched = suggestionByAddress.get(parsed.recipient.toLowerCase());
    if (matched) {
      return matched;
    }

    if (draftRecipient && draftRecipient.address.toLowerCase() === parsed.recipient.toLowerCase()) {
      return draftRecipient;
    }

    if (paymentLinkRecipient) {
      return paymentLinkRecipient;
    }

    return null;
  }, [draftRecipient, lookedUpRecipient, parsed, paymentLinkRecipient, suggestionByAddress]);

  const resolvedMerchantTipTarget = useMemo(() => {
    if (!parsed) {
      return null;
    }

    if (
      recipientLookup?.found &&
      recipientLookup.isMerchant &&
      (recipientLookup.matchedPaymentWallet || recipientLookup.matchedPrimaryWallet) &&
      recipientLookup.tipToAddress &&
      recipientLookup.tipToAddress.toLowerCase() !== parsed.recipient.toLowerCase()
    ) {
      return {
        name: (recipientLookup.merchantName || recipientLookup.walletName || resolvedRecipient?.label || "Merchant").trim() || "Merchant",
        tipToAddress: recipientLookup.tipToAddress,
      };
    }

    if (parsed.tipToAddress && parsed.tipToAddress.toLowerCase() !== parsed.recipient.toLowerCase()) {
      return {
        name: resolvedRecipient?.kind === "merchant" ? resolvedRecipient.label : "this merchant",
        tipToAddress: parsed.tipToAddress,
      };
    }

    return (
      merchants.find(
        (merchant) =>
          merchant.payToAddress?.toLowerCase() === parsed.recipient.toLowerCase() &&
          merchant.tipToAddress &&
          merchant.tipToAddress.toLowerCase() !== parsed.recipient.toLowerCase(),
      ) ?? null
    );
  }, [merchants, parsed, recipientLookup, resolvedRecipient?.kind, resolvedRecipient?.label]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    setRecipientInput(draft.recipient);
    setAmountInput(draft.amount ?? "");
    setMemoInput(draft.memo ?? "");
    setEntryMode("manual");
    setDraftRecipient(
      draft.recipientLabel
        ? {
            key: `draft:${draft.recipient.toLowerCase()}`,
            kind: draft.recipientKind ?? "merchant",
            label: draft.recipientLabel,
            address: draft.recipient,
          }
        : null,
    );
    setFeedback(null);
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = setTimeout(() => {
      setFeedback((current) => (current === feedback ? null : current));
    }, 3200);

    return () => {
      clearTimeout(timeout);
    };
  }, [feedback]);

  const resolvedAmount = (parsed?.amount ?? amountInput).trim();

  const openScanner = async () => {
    const status = permission?.status;
    if (status !== "granted") {
      const req = await requestPermission();
      if (!req.granted) {
        setEntryMode("manual");
        setFeedback({
          tone: "danger",
          message: "Camera permission is required to scan payment QRs.",
        });
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const activateScanner = () => {
    setEntryMode("scan");
    void openScanner();
  };

  const pasteClipboard = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (!value) {
      setFeedback({
        tone: "info",
        message: "Clipboard is empty. Copy an address or payment QR first.",
      });
      return;
    }

    const universalLink = parseSfluvUniversalLink(value);
    if (universalLink?.type === "redeem") {
      onOpenUniversalLink?.(universalLink);
      return;
    }

    const parsedTarget = parseSendTarget(value);
    if (parsedTarget) {
      setRecipientInput(parsedTarget.recipient);
      setAmountInput(parsedTarget.amount ?? "");
      setMemoInput(parsedTarget.memo ?? "");
      setEntryMode("manual");
      setFeedback({
        tone: "success",
        message: "Loaded payment details from your clipboard.",
      });
      return;
    }

    setRecipientInput(value);
    setEntryMode("manual");
  };

  const resetComposer = () => {
    setRecipientInput("");
    setAmountInput("");
    setMemoInput("");
    setEntryMode("manual");
    setDraftRecipient(null);
    setFeedback(null);
    setTipPrompt(null);
    setTipSending(false);
  };

  const finishFlow = () => {
    resetComposer();
    onCompleteFlow?.();
  };

  const send = async () => {
    if (isSending) {
      return;
    }

    if (!parsed) {
      setFeedback({
        tone: "danger",
        message: "Enter a valid wallet address or scan a supported payment QR.",
      });
      return;
    }

    if (!resolvedAmount) {
      setFeedback({
        tone: "danger",
        message: "Enter an amount in SFLUV or scan a QR with a preset amount.",
      });
      return;
    }

    try {
      setIsSending(true);
      await onPrepareSend(parsed.recipient, resolvedAmount, parsed.amountUnit, memoInput.trim() || parsed.memo || "");
      if (resolvedMerchantTipTarget?.tipToAddress) {
        setTipPrompt({
          merchantName: resolvedMerchantTipTarget.name,
          tipToAddress: resolvedMerchantTipTarget.tipToAddress,
          amount: "",
        });
        return;
      }
      finishFlow();
    } catch (error) {
      const message = (error as Error).message.trim();
      if (message && message !== "Transfer cancelled.") {
        setFeedback({
          tone: "danger",
          message,
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const sendTip = async () => {
    if (!tipPrompt || tipSending) {
      return;
    }

    const normalizedTipAmount = tipPrompt.amount.trim();
    if (!normalizedTipAmount) {
      setFeedback({
        tone: "danger",
        message: "Enter a tip amount to continue.",
      });
      return;
    }

    const tipAmount = Number.parseFloat(normalizedTipAmount);
    if (!Number.isFinite(tipAmount) || tipAmount <= 0) {
      setFeedback({
        tone: "danger",
        message: "Tip amount must be greater than zero.",
      });
      return;
    }

    try {
      setTipSending(true);
      await onPrepareSend(tipPrompt.tipToAddress, normalizedTipAmount, "token", "");
      setFeedback({
        tone: "success",
        message: `Tip sent to ${tipPrompt.merchantName}.`,
      });
      finishFlow();
    } catch (error) {
      const message = (error as Error).message.trim();
      if (message && message !== "Transfer cancelled.") {
        setFeedback({
          tone: "danger",
          message,
        });
      }
    } finally {
      setTipSending(false);
    }
  };

  const selectSuggestion = (suggestion: RecipientSuggestion) => {
    setRecipientInput(suggestion.address);
    setDraftRecipient(suggestion);
    setEntryMode("manual");
    Keyboard.dismiss();
  };

  const clearRecipientSelection = () => {
    setRecipientInput("");
    setDraftRecipient(null);
    setFeedback(null);
  };

  const sendLabel = resolvedRecipient ? `Slide to pay ${resolvedRecipient.label}` : "Slide to send SFLUV";
  const showAutocomplete = entryMode === "manual" && query.length > 0 && !resolvedRecipient;

  return (
    <View style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.flex}>
            <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modeRow}>
                <Pressable
                  style={[styles.modeButton, entryMode === "manual" ? styles.modeButtonActive : undefined]}
                  onPress={() => setEntryMode("manual")}
                >
                  <Ionicons
                    name="create-outline"
                    size={16}
                    color={entryMode === "manual" ? palette.primaryStrong : palette.textMuted}
                  />
                  <Text style={[styles.modeButtonText, entryMode === "manual" ? styles.modeButtonTextActive : undefined]}>
                    Manual
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, entryMode === "scan" ? styles.modeButtonActive : undefined]}
                  onPress={activateScanner}
                >
                  <Ionicons name="scan-outline" size={16} color={entryMode === "scan" ? palette.primaryStrong : palette.textMuted} />
                  <Text style={[styles.modeButtonText, entryMode === "scan" ? styles.modeButtonTextActive : undefined]}>
                    Scan
                  </Text>
                </Pressable>
              </View>

              {feedback ? (
                <View
                  style={[
                    styles.feedbackCard,
                    feedback.tone === "danger"
                      ? styles.feedbackDanger
                      : feedback.tone === "success"
                        ? styles.feedbackSuccess
                        : styles.feedbackInfo,
                  ]}
                >
                  <Ionicons
                    name={
                      feedback.tone === "danger"
                        ? "alert-circle"
                        : feedback.tone === "success"
                          ? "checkmark-circle"
                          : "information-circle"
                    }
                    size={18}
                    color={
                      feedback.tone === "danger"
                        ? palette.danger
                        : feedback.tone === "success"
                          ? palette.success
                          : palette.primaryStrong
                    }
                  />
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>Recipient</Text>
                  <Pressable style={styles.inlineToolButton} onPress={() => void pasteClipboard()}>
                    <Ionicons name="clipboard-outline" size={16} color={palette.primaryStrong} />
                    <Text style={styles.inlineToolButtonText}>Paste</Text>
                  </Pressable>
                </View>

                {resolvedRecipient ? (
                  <View style={styles.recipientCard}>
                    <View style={styles.recipientCardAvatar}>
                      <Text style={styles.contactAvatarText}>{initials(resolvedRecipient.label)}</Text>
                    </View>
                    <View style={styles.recipientCardBody}>
                      <Text style={styles.recipientCardTitle}>{resolvedRecipient.label}</Text>
                      {resolvedRecipient.subtitle ? (
                        <Text style={styles.recipientCardSubtitle}>{resolvedRecipient.subtitle}</Text>
                      ) : null}
                      <Text style={styles.recipientCardDetail}>
                        {resolvedRecipient.kind === "merchant"
                          ? "Merchant"
                          : resolvedRecipient.kind === "payment-link"
                            ? "Payment link"
                            : "Contact"}
                      </Text>
                      <Text style={styles.recipientCardAddress}>{shortAddress(parsed?.recipient ?? resolvedRecipient.address)}</Text>
                    </View>
                    <Pressable style={styles.clearRecipientButton} onPress={clearRecipientSelection}>
                      <Ionicons name="close" size={16} color={palette.primaryStrong} />
                    </Pressable>
                  </View>
                ) : (
                  <TextInput
                    style={styles.recipientInput}
                    value={recipientInput}
                    onChangeText={setRecipientInput}
                    placeholder="Search merchants, contacts, or paste an address"
                    placeholderTextColor={palette.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    returnKeyType="done"
                    blurOnSubmit
                  />
                )}

                {!resolvedRecipient && parsed ? (
                  <View style={styles.validRecipientRow}>
                    <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                    <Text style={styles.validRecipientText}>Ready to pay {shortAddress(parsed.recipient)}</Text>
                  </View>
                ) : null}

                {showAutocomplete && filteredSuggestions.length > 0 ? (
                  <View style={styles.suggestionList}>
                    {filteredSuggestions.map((suggestion) => (
                      <Pressable key={suggestion.key} style={styles.suggestionCard} onPress={() => selectSuggestion(suggestion)}>
                        <View style={styles.contactAvatar}>
                          <Text style={styles.contactAvatarText}>{initials(suggestion.label)}</Text>
                        </View>
                        <View style={styles.suggestionBody}>
                          <View style={styles.suggestionHeader}>
                            <Text style={styles.suggestionTitle}>{suggestion.label}</Text>
                            <View
                              style={[
                                styles.kindBadge,
                                suggestion.kind === "merchant" ? styles.kindBadgeMerchant : styles.kindBadgeContact,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.kindBadgeText,
                                  suggestion.kind === "merchant"
                                    ? styles.kindBadgeTextMerchant
                                    : styles.kindBadgeTextContact,
                                ]}
                              >
                                {suggestion.kind === "merchant" ? "Merchant" : "Contact"}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.suggestionMeta}>{suggestion.subtitle || shortAddress(suggestion.address)}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              <View style={styles.amountCard}>
                <View style={styles.amountRow}>
                  <Text style={styles.currencyPrefix}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={amountInput}
                    onChangeText={setAmountInput}
                    placeholder="0.00"
                    placeholderTextColor={palette.textMuted}
                    keyboardType={Platform.select({ ios: "decimal-pad", android: "numeric" })}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                  <Text style={styles.amountToken}>SFLUV</Text>
                </View>
              </View>

              {entryMode === "manual" && !parsed && displayedMerchants.length > 0 ? (
                <View style={styles.card}>
                  <View style={styles.merchantHeader}>
                    <View style={styles.merchantHeaderTextWrap}>
                      <Text style={styles.sectionLabel}>Nearby merchants</Text>
                      <Text style={styles.sectionHint}>
                        {userLocation
                          ? "Closest merchants appear first."
                          : loadingLocation
                            ? "Checking your location for nearby merchants."
                            : locationPermissionGranted
                              ? "Loading nearby merchants."
                              : "Enable location to sort merchants by distance."}
                      </Text>
                    </View>
                    {onOpenMerchantList ? (
                      <Pressable style={styles.moreButton} onPress={onOpenMerchantList}>
                        <Text style={styles.moreButtonText}>More</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.merchantList}>
                    {displayedMerchants.map((merchant) => {
                      const distance = locationDistanceMeters(merchant, userLocation);
                      return (
                        <Pressable
                          key={merchant.id}
                          style={styles.merchantOption}
                          onPress={() => {
                            if (!merchant.payToAddress) {
                              return;
                            }
                            setRecipientInput(merchant.payToAddress);
                            setDraftRecipient({
                              key: `merchant:${merchant.id}`,
                              kind: "merchant",
                              label: merchant.name,
                              address: merchant.payToAddress,
                              subtitle: [merchant.type, merchant.city].filter(Boolean).join(" • "),
                            });
                          }}
                        >
                          <View style={styles.merchantOptionBody}>
                            <Text style={styles.merchantOptionTitle}>{merchant.name}</Text>
                            <Text style={styles.merchantOptionSubtitle}>
                              {[merchant.type, merchant.city].filter(Boolean).join(" • ")}
                            </Text>
                            <Text style={styles.merchantOptionAddress}>{shortAddress(merchant.payToAddress || "")}</Text>
                          </View>
                          <View style={styles.merchantOptionMeta}>
                            {suggestedNearbyMerchant?.id === merchant.id ? (
                              <View style={styles.merchantOptionBadge}>
                                <Text style={styles.merchantOptionBadgeText}>Closest</Text>
                              </View>
                            ) : null}
                            {distance !== null ? (
                              <Text style={styles.merchantOptionDistance}>{formatDistanceLabel(distance)}</Text>
                            ) : null}
                            <Ionicons name="chevron-forward" size={16} color={palette.primaryStrong} />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Add a note</Text>
                <TextInput
                  style={styles.noteInput}
                  value={memoInput}
                  onChangeText={setMemoInput}
                  placeholder="What's this for?"
                  placeholderTextColor={palette.textMuted}
                  returnKeyType="done"
                  blurOnSubmit
                />
              </View>
            </ScrollView>

            <View style={styles.actionDock}>
              <SwipeToSend
                disabled={!parsed || !resolvedAmount || isSending}
                loading={isSending}
                label={sendLabel}
                onComplete={() => {
                  void send();
                }}
              />
              <Text style={styles.actionHint}>Swipe all the way across to confirm the payment.</Text>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => {
          setScannerOpen(false);
          setScanLocked(false);
          setEntryMode("manual");
        }}
      >
        <View style={styles.scannerScreen}>
          <View style={[styles.scannerHeader, { paddingTop: topInset + spacing.xxl }]}>
            <Text style={styles.scannerTitle}>Scan payment QR</Text>
            <Pressable
              style={styles.scannerClose}
              onPress={() => {
                setScannerOpen(false);
                setScanLocked(false);
                setEntryMode("manual");
              }}
            >
              <Ionicons name="close" size={20} color={palette.white} />
            </Pressable>
          </View>

          <View style={styles.scannerFrame}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => {
                if (!scannerOpen || scanLocked) {
                  return;
                }

                setScanLocked(true);
                if (hapticsEnabled) {
                  Vibration.vibrate(10);
                }

                const universalLink = parseSfluvUniversalLink(result.data);
                if (universalLink?.type === "redeem") {
                  onOpenUniversalLink?.(universalLink);
                  setScannerOpen(false);
                  setEntryMode("manual");
                  setFeedback({
                    tone: "success",
                    message: "Redeem code scanned.",
                  });
                  return;
                }

                const scanned = parseSendTarget(result.data);
                if (scanned) {
                  setRecipientInput(scanned.recipient);
                  setAmountInput(scanned.amount ?? "");
                  setMemoInput(scanned.memo ?? "");
                  setEntryMode("manual");
                  setFeedback(null);
                } else {
                  setRecipientInput(result.data);
                  setEntryMode("manual");
                  setFeedback({
                    tone: "info",
                    message: "Scanned value pasted into the recipient field.",
                  });
                }

                setScannerOpen(false);
                setEntryMode("manual");
              }}
            />
            <View pointerEvents="none" style={styles.scannerGuide} />
          </View>
          <View style={styles.scannerFooter}>
            {scanLocked ? <ActivityIndicator size="small" color={palette.white} /> : null}
            <Text style={styles.scannerHint}>Point your camera at any supported SFLUV payment QR.</Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={tipPrompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          finishFlow();
        }}
      >
        <View style={styles.sendingOverlay}>
          <View style={styles.tipPromptCard}>
            <Text style={styles.tipPromptTitle}>Thank you! Would you like to leave a tip?</Text>
            <Text style={styles.tipPromptBody}>
              {tipPrompt?.merchantName
                ? `Send an optional second payment to ${tipPrompt.merchantName}'s separate tipping wallet.`
                : "Send an optional second payment to this merchant's separate tipping wallet."}
            </Text>

            <View style={styles.tipAmountWrap}>
              <Text style={styles.tipAmountPrefix}>$</Text>
              <TextInput
                style={styles.tipAmountInput}
                value={tipPrompt?.amount || ""}
                onChangeText={(value) =>
                  setTipPrompt((current) => (current ? { ...current, amount: value } : current))
                }
                placeholder="0.00"
                placeholderTextColor={palette.textMuted}
                keyboardType={Platform.select({ ios: "decimal-pad", android: "numeric" })}
                returnKeyType="done"
                blurOnSubmit
              />
              <Text style={styles.tipAmountToken}>SFLUV</Text>
            </View>

            <View style={styles.tipPromptActions}>
              <Pressable
                style={[styles.tipPromptButton, styles.tipPromptButtonSecondary]}
                onPress={finishFlow}
                disabled={tipSending}
              >
                <Text style={styles.tipPromptButtonSecondaryText}>No thanks</Text>
              </Pressable>
              <Pressable
                style={[styles.tipPromptButton, styles.tipPromptButtonPrimary, tipSending ? styles.tipPromptButtonDisabled : undefined]}
                onPress={() => {
                  void sendTip();
                }}
                disabled={tipSending}
              >
                {tipSending ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <Text style={styles.tipPromptButtonPrimaryText}>Send tip</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isSending} transparent animationType="fade">
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingCard}>
            <ActivityIndicator size="large" color={palette.primary} />
            <Text style={styles.sendingTitle}>Confirming transaction...</Text>
            <Text style={styles.sendingText}>
              Sponsoring gas, submitting the user operation, and waiting for confirmation.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    modeRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    modeButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    modeButtonActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    modeButtonText: {
      color: palette.textMuted,
      fontWeight: "800",
    },
    modeButtonTextActive: {
      color: palette.primaryStrong,
    },
    feedbackCard: {
      borderRadius: radii.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    feedbackInfo: {
      backgroundColor: palette.primarySoft,
      borderColor: palette.primary,
    },
    feedbackSuccess: {
      backgroundColor: palette.surface,
      borderColor: palette.success,
    },
    feedbackDanger: {
      backgroundColor: palette.surface,
      borderColor: palette.danger,
    },
    feedbackText: {
      color: palette.text,
      flex: 1,
      lineHeight: 20,
      fontWeight: "700",
    },
    scanHeroCard: {
      backgroundColor: palette.primaryStrong,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    scanHeroIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    scanHeroTitle: {
      color: palette.white,
      fontSize: 28,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    scanHeroBody: {
      color: "rgba(255,255,255,0.82)",
      lineHeight: 21,
    },
    scanHeroActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    scanPrimaryButton: {
      flex: 1,
      minHeight: 50,
      borderRadius: radii.pill,
      backgroundColor: palette.navyStrong,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    scanPrimaryButtonText: {
      color: palette.white,
      fontWeight: "900",
    },
    scanSecondaryButton: {
      flex: 1,
      minHeight: 50,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    scanSecondaryButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    scanHintCard: {
      backgroundColor: "rgba(255,255,255,0.12)",
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 6,
    },
    scanHintTitle: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 13,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    scanHintBody: {
      color: "rgba(255,255,255,0.78)",
      lineHeight: 20,
    },
    browseMerchantsButton: {
      marginTop: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.surface,
      paddingVertical: 12,
    },
    browseMerchantsButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    highlightCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: palette.primary,
      padding: spacing.lg,
      gap: spacing.xs,
      ...shadows.card,
    },
    highlightHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    highlightEyebrow: {
      color: palette.primaryStrong,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    highlightTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
    },
    highlightMeta: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    highlightBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 14,
      gap: 8,
      ...shadows.soft,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    sectionLabel: {
      color: palette.primaryStrong,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    sectionHint: {
      color: palette.textMuted,
      lineHeight: 18,
      marginTop: 4,
    },
    inlineToolButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    inlineToolButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    recipientInput: {
      minHeight: 54,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.primary,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: palette.text,
      textAlignVertical: "top",
      fontSize: 15,
      lineHeight: 20,
    },
    recipientCard: {
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.primary,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    recipientCardAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: palette.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: palette.primary,
    },
    recipientCardBody: {
      flex: 1,
      gap: 4,
    },
    recipientCardTitle: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 16,
    },
    recipientCardSubtitle: {
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    recipientCardDetail: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    recipientCardAddress: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 13,
    },
    clearRecipientButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    recipientSummary: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingTop: 4,
    },
    recipientSummaryBody: {
      flex: 1,
      gap: 4,
    },
    recipientSummaryHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    recipientSummaryTitle: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 16,
    },
    recipientSummaryKind: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    recipientSummaryMeta: {
      color: palette.textMuted,
      fontSize: 13,
    },
    contactAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    contactAvatarText: {
      color: palette.primaryStrong,
      fontWeight: "900",
      fontSize: 15,
    },
    validRecipientRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingTop: 4,
    },
    validRecipientText: {
      color: palette.success,
      fontWeight: "700",
    },
    suggestionList: {
      gap: 10,
      paddingTop: 4,
    },
    suggestionCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: 12,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    suggestionBody: {
      flex: 1,
      gap: 4,
    },
    suggestionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    suggestionTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 15,
    },
    suggestionMeta: {
      color: palette.textMuted,
      fontSize: 12,
    },
    kindBadge: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: radii.pill,
      borderWidth: 1,
    },
    kindBadgeMerchant: {
      backgroundColor: palette.primarySoft,
      borderColor: palette.primary,
    },
    kindBadgeContact: {
      backgroundColor: palette.surface,
      borderColor: palette.borderStrong,
    },
    kindBadgeText: {
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    kindBadgeTextMerchant: {
      color: palette.primaryStrong,
    },
    kindBadgeTextContact: {
      color: palette.textMuted,
    },
    merchantHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    merchantHeaderTextWrap: {
      flex: 1,
    },
    moreButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    moreButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
    merchantList: {
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    merchantOption: {
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    merchantOptionBody: {
      flex: 1,
      gap: 4,
    },
    merchantOptionTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 15,
    },
    merchantOptionSubtitle: {
      color: palette.textMuted,
      fontSize: 13,
    },
    merchantOptionAddress: {
      color: palette.primaryStrong,
      fontWeight: "700",
      fontSize: 12,
    },
    merchantOptionMeta: {
      alignItems: "flex-end",
      gap: 8,
    },
    merchantOptionBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    merchantOptionBadgeText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    merchantOptionDistance: {
      color: palette.primaryStrong,
      fontWeight: "700",
      fontSize: 12,
    },
    amountCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      paddingVertical: 12,
      paddingHorizontal: spacing.lg,
      borderWidth: 1.5,
      borderColor: palette.primary,
      alignItems: "center",
      ...shadows.card,
    },
    amountRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    currencyPrefix: {
      color: palette.primaryStrong,
      fontSize: 20,
      fontWeight: "900",
    },
    amountInput: {
      minWidth: 120,
      color: palette.primaryStrong,
      fontSize: 32,
      fontWeight: "900",
      textAlign: "center",
      paddingVertical: 0,
    },
    amountToken: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 0.5,
    },
    noteInput: {
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: palette.text,
      fontSize: 15,
    },
    actionDock: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: 10,
      backgroundColor: palette.background,
    },
    actionHint: {
      color: palette.textMuted,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "700",
    },
    swipeTrack: {
      minHeight: 64,
      borderRadius: radii.pill,
      backgroundColor: palette.primaryStrong,
      justifyContent: "center",
      paddingHorizontal: 8,
      position: "relative",
      overflow: "hidden",
      ...shadows.card,
    },
    swipeTrackDisabled: {
      backgroundColor: palette.borderStrong,
    },
    swipeTrackText: {
      color: palette.white,
      textAlign: "center",
      fontSize: 15,
      fontWeight: "900",
      paddingHorizontal: 72,
    },
    swipeTrackTextDisabled: {
      color: palette.surface,
    },
    swipeThumb: {
      position: "absolute",
      left: 4,
      top: 4,
      bottom: 4,
      width: 56,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    swipeThumbDisabled: {
      backgroundColor: palette.surfaceStrong,
    },
    scannerScreen: {
      flex: 1,
      backgroundColor: "rgba(8, 12, 20, 0.92)",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    scannerHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingBottom: spacing.lg,
    },
    scannerTitle: {
      color: palette.white,
      fontSize: 22,
      fontWeight: "900",
    },
    scannerClose: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.12)",
    },
    scannerFrame: {
      flex: 1,
      minHeight: 360,
      borderRadius: radii.xl,
      overflow: "hidden",
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.16)",
      backgroundColor: "#05070b",
      justifyContent: "center",
      alignItems: "center",
    },
    scannerGuide: {
      width: 236,
      height: 236,
      borderRadius: 32,
      borderWidth: 3,
      borderColor: palette.primaryStrong,
      backgroundColor: "transparent",
    },
    scannerFooter: {
      minHeight: 74,
      paddingTop: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    scannerHint: {
      color: "rgba(255,255,255,0.82)",
      textAlign: "center",
      lineHeight: 21,
    },
    sendingOverlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    sendingCard: {
      width: "100%",
      maxWidth: 320,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.xl,
      alignItems: "center",
      gap: spacing.sm,
      ...shadows.card,
    },
    sendingTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
    },
    sendingText: {
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
    tipPromptCard: {
      width: "100%",
      maxWidth: 360,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.xl,
      gap: spacing.md,
      ...shadows.card,
    },
    tipPromptTitle: {
      color: palette.text,
      fontSize: 22,
      fontWeight: "900",
      textAlign: "center",
    },
    tipPromptBody: {
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
    tipAmountWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.md,
      paddingHorizontal: 14,
      minHeight: 58,
    },
    tipAmountPrefix: {
      color: palette.primaryStrong,
      fontSize: 22,
      fontWeight: "900",
    },
    tipAmountInput: {
      flex: 1,
      color: palette.text,
      fontSize: 24,
      fontWeight: "900",
      paddingVertical: 10,
    },
    tipAmountToken: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    tipPromptActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    tipPromptButton: {
      flex: 1,
      minHeight: 50,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    tipPromptButtonPrimary: {
      backgroundColor: palette.primaryStrong,
    },
    tipPromptButtonSecondary: {
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.borderStrong,
    },
    tipPromptButtonDisabled: {
      opacity: 0.7,
    },
    tipPromptButtonPrimaryText: {
      color: palette.white,
      fontWeight: "900",
    },
    tipPromptButtonSecondaryText: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
  });
}
