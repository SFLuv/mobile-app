import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import Constants from "expo-constants";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { mobileConfig } from "../config";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { AmountUnit, SendResult } from "../services/smartWallet";
import type { AppBackendClient } from "../services/appBackend";
import { AppContact, AppLocation, AppWalletOwnerLookup } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { formatDistanceLabel, locationDistanceMeters, sortLocationsByProximity } from "../utils/location";
import { parseSendTarget, parseSfluvUniversalLink, SendTarget, SfluvUniversalLink } from "../utils/universalLinks";

type RecipientKind = "contact" | "merchant" | "payment-link";
type SendStep = "recipient" | "amount";
type SendPhase = "editing" | "sending" | "success" | "failure";
type TipChoice = "10" | "15" | "20" | "custom";

type RecipientSuggestion = {
  key: string;
  kind: RecipientKind;
  label: string;
  address: string;
  subtitle?: string;
};

type TipTarget = {
  merchantName: string;
  tipToAddress: string;
};

type SendAttempt = {
  recipient: string;
  recipientLabel: string;
  amountLabel: string;
  amountRaw: ethers.BigNumber;
  tipTarget: TipTarget | null;
  remainingBalanceRaw: ethers.BigNumber | null;
};

type Props = {
  contacts: AppContact[];
  merchants: AppLocation[];
  availableBalance: string;
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
  onCompleteFlow?: () => void;
  onExitFlow?: () => void;
};

function shortAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) {
    return "?";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function sanitizeTokenInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  const whole = (dotIndex >= 0 ? cleaned.slice(0, dotIndex) : cleaned).replace(/^0+(?=\d)/, "");
  const normalizedWhole = whole || (cleaned.startsWith(".") ? "0" : "");
  if (dotIndex < 0) {
    return normalizedWhole;
  }
  const fraction = cleaned
    .slice(dotIndex + 1)
    .replace(/\./g, "")
    .slice(0, mobileConfig.tokenDecimals);
  return `${normalizedWhole}.${fraction}`;
}

function appendAmountCharacter(current: string, character: string): string {
  if (character === ".") {
    if (current.includes(".")) {
      return current;
    }
    return current ? `${current}.` : "0.";
  }
  if (!/^\d$/.test(character)) {
    return current;
  }
  if (current === "0") {
    return character;
  }
  return sanitizeTokenInput(`${current}${character}`);
}

function removeAmountCharacter(current: string): string {
  if (!current) {
    return "";
  }
  const next = current.slice(0, -1);
  if (next === "0") {
    return "";
  }
  return next;
}

function parseTokenAmount(value: string): ethers.BigNumber | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return ethers.utils.parseUnits(trimmed, mobileConfig.tokenDecimals);
  } catch {
    return null;
  }
}

function formatTokenAmount(value: ethers.BigNumberish, maxDecimals = 4): string {
  const formatted = ethers.utils.formatUnits(value, mobileConfig.tokenDecimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (!trimmed) {
    return whole;
  }
  return `${whole}.${trimmed.slice(0, maxDecimals)}`;
}

function formatBalanceText(rawBalance: string): string {
  const normalized = rawBalance.trim();
  if (!normalized || normalized === "...") {
    return "Balance ...";
  }
  try {
    return `Balance ${sanitizeTokenInput(formatTokenAmount(ethers.utils.parseUnits(normalized, mobileConfig.tokenDecimals), 2)) || "0"}`;
  } catch {
    return `Balance ${normalized}`;
  }
}

function formatTargetAmount(target: SendTarget): string {
  if (!target.amount) {
    return "";
  }
  if (target.amountUnit === "wei") {
    try {
      return sanitizeTokenInput(ethers.utils.formatUnits(target.amount, mobileConfig.tokenDecimals));
    } catch {
      return "";
    }
  }
  return sanitizeTokenInput(target.amount);
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
  const thumbSize = 58;
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
    [disabled, loading, onComplete, resetSwipe, swipeDistance, translateX],
  );

  return (
    <View
      style={[styles.swipeTrack, disabled ? styles.swipeTrackDisabled : undefined]}
      onLayout={(event) => {
        setTrackWidth(event.nativeEvent.layout.width);
      }}
    >
      <Text style={[styles.swipeTrackText, disabled ? styles.swipeTrackTextDisabled : undefined]}>
        {loading ? "Sending" : label}
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

function NumberPad({
  onDigit,
  onDecimal,
  onBackspace,
}: {
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "backspace"],
  ];

  return (
    <View style={styles.keypad}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.keypadRow}>
          {row.map((key) => {
            const isAction = key === "backspace";
            return (
              <Pressable
                key={key}
                style={[styles.keypadKey, isAction ? styles.keypadKeyAction : undefined]}
                onPress={() => {
                  if (key === "backspace") {
                    onBackspace();
                    return;
                  }
                  if (key === ".") {
                    onDecimal();
                    return;
                  }
                  onDigit(key);
                }}
              >
                {key === "backspace" ? (
                  <Ionicons name="backspace-outline" size={22} color={palette.primaryStrong} />
                ) : (
                  <Text style={styles.keypadKeyText}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function SendScreen({
  contacts,
  merchants,
  availableBalance,
  backendClient,
  hapticsEnabled,
  onPrepareSend,
  draft,
  onDraftApplied,
  onOpenUniversalLink,
  onCompleteFlow,
  onExitFlow,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const topInset = Math.max(Constants.statusBarHeight, Platform.OS === "ios" ? spacing.sm : 0);
  const noteInputRef = useRef<TextInput | null>(null);
  const resultIconScale = useRef(new Animated.Value(0.84)).current;
  const resultIconOpacity = useRef(new Animated.Value(0)).current;
  const tipExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [step, setStep] = useState<SendStep>("recipient");
  const [phase, setPhase] = useState<SendPhase>("editing");
  const [recipientInput, setRecipientInput] = useState("");
  const [activeTarget, setActiveTarget] = useState<SendTarget | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [recipientLookup, setRecipientLookup] = useState<AppWalletOwnerLookup | null>(null);
  const [draftRecipient, setDraftRecipient] = useState<RecipientSuggestion | null>(null);
  const [resultAttempt, setResultAttempt] = useState<SendAttempt | null>(null);
  const [tipChoice, setTipChoice] = useState<TipChoice | null>(null);
  const [customTipInput, setCustomTipInput] = useState("");
  const [tipStatus, setTipStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [tipMessage, setTipMessage] = useState<string | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const { location: userLocation } = useCurrentLocation(step === "recipient" && phase === "editing");

  const parsedTarget = useMemo(() => parseSendTarget(recipientInput), [recipientInput]);
  const lookupAddress = activeTarget?.recipient ?? parsedTarget?.recipient ?? null;
  const parsedBalanceRaw = useMemo(() => {
    try {
      if (!availableBalance.trim() || availableBalance.trim() === "...") {
        return null;
      }
      return ethers.utils.parseUnits(availableBalance.trim(), mobileConfig.tokenDecimals);
    } catch {
      return null;
    }
  }, [availableBalance]);
  const amountRaw = useMemo(() => parseTokenAmount(amountInput), [amountInput]);

  const payableMerchants = useMemo(
    () => sortLocationsByProximity(merchants.filter((merchant) => Boolean(merchant.payToAddress)), userLocation),
    [merchants, userLocation],
  );

  const merchantSuggestions = useMemo<RecipientSuggestion[]>(
    () =>
      payableMerchants
        .filter((merchant) => merchant.payToAddress)
        .map((merchant) => {
          const distance = locationDistanceMeters(merchant, userLocation);
          return {
            key: `merchant:${merchant.id}`,
            kind: "merchant" as const,
            label: merchant.name,
            address: merchant.payToAddress!,
            subtitle: distance !== null
              ? formatDistanceLabel(distance)
              : [merchant.type, merchant.city].filter(Boolean).join(" • "),
          };
        }),
    [payableMerchants, userLocation],
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

  const allSuggestions = useMemo(() => {
    const next = new Map<string, RecipientSuggestion>();
    for (const suggestion of [...merchantSuggestions, ...contactSuggestions]) {
      const key = suggestion.address.toLowerCase();
      if (!next.has(key)) {
        next.set(key, suggestion);
      }
    }
    return [...next.values()];
  }, [contactSuggestions, merchantSuggestions]);

  const suggestionByAddress = useMemo(
    () => new Map(allSuggestions.map((suggestion) => [suggestion.address.toLowerCase(), suggestion] as const)),
    [allSuggestions],
  );

  const searchQuery = recipientInput.trim().toLowerCase();

  const filteredSuggestions = useMemo(() => {
    if (!searchQuery) {
      return merchantSuggestions.slice(0, 5);
    }
    return allSuggestions
      .filter((suggestion) => {
        const haystack = `${suggestion.label} ${suggestion.address} ${suggestion.subtitle ?? ""}`.toLowerCase();
        return haystack.includes(searchQuery);
      })
      .slice(0, 5);
  }, [allSuggestions, merchantSuggestions, searchQuery]);

  useEffect(() => {
    if (!lookupAddress || !backendClient) {
      setRecipientLookup(null);
      return;
    }

    let cancelled = false;
    void backendClient
      .lookupWalletOwner(lookupAddress)
      .then((lookup) => {
        if (!cancelled) {
          setRecipientLookup(lookup);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecipientLookup(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backendClient, lookupAddress]);

  const lookedUpRecipient = useMemo<RecipientSuggestion | null>(() => {
    const target = activeTarget ?? parsedTarget;
    if (!target || !recipientLookup?.found || !recipientLookup.isMerchant) {
      return null;
    }
    const label = (recipientLookup.merchantName || recipientLookup.walletName || "Merchant").trim() || "Merchant";
    const subtitle =
      recipientLookup.walletName?.trim() && recipientLookup.walletName.trim() !== label
        ? recipientLookup.walletName.trim()
        : undefined;
    return {
      key: `lookup:${target.recipient.toLowerCase()}`,
      kind: "merchant",
      label,
      address: target.recipient,
      subtitle,
    };
  }, [activeTarget, parsedTarget, recipientLookup]);

  const paymentLinkRecipient = useMemo<RecipientSuggestion | null>(() => {
    const target = activeTarget ?? parsedTarget;
    if (!target || (target.source !== "sfluv-link" && target.source !== "citizenwallet-plugin-link")) {
      return null;
    }
    return {
      key: `payment-link:${target.recipient.toLowerCase()}`,
      kind: "payment-link",
      label: "Payment link",
      address: target.recipient,
      subtitle: shortAddress(target.recipient),
    };
  }, [activeTarget, parsedTarget]);

  const resolvedRecipient = useMemo<RecipientSuggestion | null>(() => {
    const target = activeTarget ?? parsedTarget;
    if (!target) {
      return null;
    }
    const matched = suggestionByAddress.get(target.recipient.toLowerCase());
    if (matched) {
      return matched;
    }
    if (draftRecipient && draftRecipient.address.toLowerCase() === target.recipient.toLowerCase()) {
      return draftRecipient;
    }
    if (lookedUpRecipient) {
      return lookedUpRecipient;
    }
    return paymentLinkRecipient;
  }, [activeTarget, draftRecipient, lookedUpRecipient, parsedTarget, paymentLinkRecipient, suggestionByAddress]);

  const resolvedTipTarget = useMemo<TipTarget | null>(() => {
    const target = activeTarget ?? parsedTarget;
    if (!target) {
      return null;
    }

    if (
      recipientLookup?.found &&
      recipientLookup.isMerchant &&
      recipientLookup.tipToAddress &&
      recipientLookup.tipToAddress.toLowerCase() !== target.recipient.toLowerCase()
    ) {
      return {
        merchantName: (recipientLookup.merchantName || recipientLookup.walletName || resolvedRecipient?.label || "Merchant").trim() || "Merchant",
        tipToAddress: recipientLookup.tipToAddress,
      };
    }

    if (target.tipToAddress && target.tipToAddress.toLowerCase() !== target.recipient.toLowerCase()) {
      return {
        merchantName: resolvedRecipient?.label || "Merchant",
        tipToAddress: target.tipToAddress,
      };
    }

    const merchant = merchants.find(
      (entry) =>
        entry.payToAddress?.toLowerCase() === target.recipient.toLowerCase() &&
        entry.tipToAddress &&
        entry.tipToAddress.toLowerCase() !== target.recipient.toLowerCase(),
    );

    if (!merchant?.tipToAddress) {
      return null;
    }

    return {
      merchantName: merchant.name,
      tipToAddress: merchant.tipToAddress,
    };
  }, [activeTarget, merchants, parsedTarget, recipientLookup, resolvedRecipient?.label]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    const target: SendTarget = {
      recipient: draft.recipient,
      amount: draft.amount?.trim() || undefined,
      memo: draft.memo?.trim() || undefined,
      amountUnit: "token",
    };

    setRecipientInput(draft.recipient);
    setActiveTarget(target);
    setAmountInput(draft.amount ? sanitizeTokenInput(draft.amount) : "");
    setMemoInput(draft.memo ?? "");
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
    setStep("amount");
    setPhase("editing");
    setFeedback(null);
    setResultAttempt(null);
    setTipChoice(null);
    setCustomTipInput("");
    setTipStatus("idle");
    setTipMessage(null);
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timeout = setTimeout(() => {
      setFeedback((current) => (current === feedback ? null : current));
    }, 2600);
    return () => {
      clearTimeout(timeout);
    };
  }, [feedback]);

  useEffect(() => {
    if (phase !== "success" && phase !== "failure") {
      resultIconScale.setValue(0.84);
      resultIconOpacity.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(resultIconScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 14,
        bounciness: 9,
      }),
      Animated.timing(resultIconOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [phase, resultIconOpacity, resultIconScale]);

  useEffect(() => {
    return () => {
      if (tipExitTimeoutRef.current) {
        clearTimeout(tipExitTimeoutRef.current);
      }
    };
  }, []);

  const dismissNoteEditor = useCallback(() => {
    setNoteFocused(false);
    noteInputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const clearTipState = useCallback(() => {
    setTipChoice(null);
    setCustomTipInput("");
    setTipStatus("idle");
    setTipMessage(null);
  }, []);

  const exitFlow = useCallback(() => {
    if (tipExitTimeoutRef.current) {
      clearTimeout(tipExitTimeoutRef.current);
      tipExitTimeoutRef.current = null;
    }
    onCompleteFlow?.();
  }, [onCompleteFlow]);

  const handleBack = useCallback(() => {
    if (phase !== "editing") {
      return;
    }
    if (step === "amount") {
      dismissNoteEditor();
      setStep("recipient");
      return;
    }
    onExitFlow?.();
  }, [dismissNoteEditor, onExitFlow, phase, step]);

  const edgeBackResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          phase === "editing" &&
          gesture.x0 <= 28 &&
          gesture.dx > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.x0 <= 28 && gesture.dx > 78) {
            handleBack();
          }
        },
      }),
    [handleBack, phase],
  );

  const continueToAmount = useCallback(
    (target: SendTarget, suggestion?: RecipientSuggestion | null) => {
      setActiveTarget(target);
      setRecipientInput(target.recipient);
      if (suggestion) {
        setDraftRecipient(suggestion);
      }
      const targetAmount = formatTargetAmount(target);
      if (targetAmount) {
        setAmountInput((current) => (current.trim() ? current : targetAmount));
      }
      if (target.memo) {
        setMemoInput((current) => (current.trim() ? current : target.memo || ""));
      }
      setFeedback(null);
      setStep("amount");
      setPhase("editing");
      clearTipState();
      setResultAttempt(null);
    },
    [clearTipState],
  );

  const selectSuggestion = useCallback(
    (suggestion: RecipientSuggestion) => {
      const target: SendTarget = {
        recipient: suggestion.address,
        amountUnit: "token",
      };
      setDraftRecipient(suggestion);
      continueToAmount(target, suggestion);
    },
    [continueToAmount],
  );

  const openScanner = useCallback(async () => {
    const status = permission?.status;
    if (status !== "granted") {
      const nextPermission = await requestPermission();
      if (!nextPermission.granted) {
        setFeedback("Camera permission required.");
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  }, [permission?.status, requestPermission]);

  const primaryRecipient = activeTarget?.recipient ?? parsedTarget?.recipient ?? "";
  const primaryRecipientLabel = resolvedRecipient?.label || (primaryRecipient ? shortAddress(primaryRecipient) : "");

  const submitPayment = useCallback(async () => {
    const target = activeTarget ?? parsedTarget;
    const normalizedAmount = sanitizeTokenInput(amountInput).trim();
    if (!target || !amountRaw || amountRaw.lte(0) || !normalizedAmount) {
      return;
    }

    dismissNoteEditor();
    clearTipState();

    const amountLabel = normalizedAmount;
    const remainingBalanceRaw =
      parsedBalanceRaw && parsedBalanceRaw.gte(amountRaw) ? parsedBalanceRaw.sub(amountRaw) : parsedBalanceRaw;
    const nextAttempt: SendAttempt = {
      recipient: target.recipient,
      recipientLabel: resolvedRecipient?.label || shortAddress(target.recipient),
      amountLabel,
      amountRaw,
      tipTarget: resolvedTipTarget,
      remainingBalanceRaw,
    };

    setResultAttempt(nextAttempt);
    setPhase("sending");
    try {
      await onPrepareSend(target.recipient, normalizedAmount, "token", memoInput.trim());
      setPhase("success");
    } catch {
      setPhase("failure");
    }
  }, [
    activeTarget,
    amountInput,
    amountRaw,
    clearTipState,
    dismissNoteEditor,
    memoInput,
    onPrepareSend,
    parsedBalanceRaw,
    parsedTarget,
    resolvedRecipient?.label,
    resolvedTipTarget,
  ]);

  const retryPayment = useCallback(() => {
    void submitPayment();
  }, [submitPayment]);

  const tipPresetOptions = useMemo(() => {
    if (!resultAttempt?.tipTarget) {
      return [];
    }
    return [10, 15, 20]
      .map((percentage) => {
        const amount = resultAttempt.amountRaw.mul(percentage).div(100);
        if (amount.lte(0)) {
          return null;
        }
        if (resultAttempt.remainingBalanceRaw && amount.gt(resultAttempt.remainingBalanceRaw)) {
          return null;
        }
        return {
          key: `${percentage}` as TipChoice,
          label: `${percentage}%`,
          amountValue: ethers.utils.formatUnits(amount, mobileConfig.tokenDecimals),
        };
      })
      .filter(Boolean) as Array<{ key: TipChoice; label: string; amountValue: string }>;
  }, [resultAttempt]);

  const canUseCustomTip = useMemo(
    () => {
      if (!resultAttempt?.tipTarget) {
        return false;
      }
      return !resultAttempt.remainingBalanceRaw || resultAttempt.remainingBalanceRaw.gt(0);
    },
    [resultAttempt],
  );

  const selectedTipAmount = useMemo(() => {
    if (!resultAttempt?.tipTarget) {
      return "";
    }
    if (tipChoice === "custom") {
      return sanitizeTokenInput(customTipInput);
    }
    return tipPresetOptions.find((option) => option.key === tipChoice)?.amountValue || "";
  }, [customTipInput, resultAttempt, tipChoice, tipPresetOptions]);

  const selectedTipAmountRaw = useMemo(() => parseTokenAmount(selectedTipAmount), [selectedTipAmount]);

  const sendTip = useCallback(async () => {
    if (!resultAttempt?.tipTarget || !selectedTipAmountRaw || selectedTipAmountRaw.lte(0)) {
      return;
    }

    setTipStatus("sending");
    setTipMessage(null);
    try {
      await onPrepareSend(resultAttempt.tipTarget.tipToAddress, selectedTipAmount, "token", "");
      setTipStatus("sent");
      setTipMessage("Tip sent.");
      tipExitTimeoutRef.current = setTimeout(() => {
        exitFlow();
      }, 2000);
    } catch {
      setTipStatus("error");
      setTipMessage("Tip failed to send.");
      setTipChoice(null);
      setCustomTipInput("");
    }
  }, [exitFlow, onPrepareSend, resultAttempt, selectedTipAmount, selectedTipAmountRaw]);

  const handlePrimarySuccessAction = useCallback(() => {
    if (tipStatus === "sending" || tipStatus === "sent") {
      return;
    }
    if (selectedTipAmountRaw && selectedTipAmountRaw.gt(0)) {
      void sendTip();
      return;
    }
    exitFlow();
  }, [exitFlow, selectedTipAmountRaw, sendTip, tipStatus]);

  const scannerClose = useCallback(() => {
    setScannerOpen(false);
    setScanLocked(false);
  }, []);

  const renderSuggestionCard = (suggestion: RecipientSuggestion) => (
    <Pressable key={suggestion.key} style={styles.suggestionCard} onPress={() => selectSuggestion(suggestion)}>
      <View style={styles.suggestionAvatar}>
        <Text style={styles.suggestionAvatarText}>{initials(suggestion.label)}</Text>
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
                suggestion.kind === "merchant" ? styles.kindBadgeTextMerchant : styles.kindBadgeTextContact,
              ]}
            >
              {suggestion.kind === "merchant" ? "Merchant" : "Contact"}
            </Text>
          </View>
        </View>
        <Text style={styles.suggestionMeta}>{suggestion.subtitle || shortAddress(suggestion.address)}</Text>
      </View>
    </Pressable>
  );

  const renderRecipientStep = () => (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={[styles.recipientContainer, { paddingTop: topInset + spacing.sm, paddingBottom: 136 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepHeader}>
          <Pressable style={styles.iconButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={18} color={palette.primaryStrong} />
          </Pressable>
        </View>

        {feedback ? (
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        ) : null}

        <View style={styles.recipientSearchCard}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={recipientInput}
              onChangeText={(value) => {
                setRecipientInput(value);
                setActiveTarget(null);
                setDraftRecipient(null);
                setFeedback(null);
              }}
              placeholder="Search or paste an address"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit
            />
            <Pressable style={styles.scanButton} onPress={() => void openScanner()}>
              <Ionicons name="scan-outline" size={18} color={palette.primaryStrong} />
            </Pressable>
          </View>
        </View>

        {filteredSuggestions.length > 0 ? (
          <View style={styles.suggestionList}>{filteredSuggestions.map((suggestion) => renderSuggestionCard(suggestion))}</View>
        ) : null}
      </ScrollView>

      <View style={styles.footerDock}>
        <Pressable
          style={[styles.primaryButton, !parsedTarget ? styles.primaryButtonDisabled : undefined]}
          disabled={!parsedTarget}
          onPress={() => {
            if (parsedTarget) {
              continueToAmount(parsedTarget, resolvedRecipient);
            }
          }}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderAmountStep = () => (
    <View style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableWithoutFeedback
          accessible={false}
          onPress={() => {
            if (noteFocused) {
              dismissNoteEditor();
            }
          }}
        >
          <View style={[styles.amountScreen, { paddingTop: topInset + spacing.sm }]} {...edgeBackResponder.panHandlers}>
            <View style={styles.stepHeader}>
              <Pressable style={styles.iconButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={18} color={palette.primaryStrong} />
              </Pressable>
            </View>

            {feedback ? (
              <View style={styles.feedbackCard}>
                <Text style={styles.feedbackText}>{feedback}</Text>
              </View>
            ) : null}

            <View style={styles.amountHero}>
              <Text style={styles.recipientLine}>To {primaryRecipientLabel || "Recipient"}</Text>
              <Pressable
                style={styles.amountDisplay}
                onPress={() => {
                  dismissNoteEditor();
                }}
              >
                <Text style={styles.amountValue}>{amountInput || "0"}</Text>
                <Text style={styles.amountSuffix}>SFLUV</Text>
              </Pressable>
            </View>

            <View style={styles.amountMetaBlock}>
              <Text style={styles.balanceLabel}>{formatBalanceText(availableBalance)}</Text>
              <View style={styles.noteWrap}>
                <TextInput
                  ref={noteInputRef}
                  style={styles.noteInput}
                  value={memoInput}
                  onChangeText={setMemoInput}
                  onFocus={() => setNoteFocused(true)}
                  onBlur={() => setNoteFocused(false)}
                  placeholder="Add a note"
                  placeholderTextColor={palette.textMuted}
                  returnKeyType="done"
                />
              </View>
            </View>

            <View style={styles.flexGrow} />

            {!noteFocused ? (
              <NumberPad
                onDigit={(digit) => setAmountInput((current) => appendAmountCharacter(current, digit))}
                onDecimal={() => setAmountInput((current) => appendAmountCharacter(current, "."))}
                onBackspace={() => setAmountInput((current) => removeAmountCharacter(current))}
              />
            ) : (
              <View style={styles.keypadGap} />
            )}

            <View style={styles.sendDock}>
              <SwipeToSend
                disabled={!activeTarget || !amountRaw || amountRaw.lte(0) || phase !== "editing"}
                loading={phase === "sending"}
                label="Slide to send"
                onComplete={() => {
                  void submitPayment();
                }}
              />
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  );

  const renderStateScreen = (success: boolean) => {
    const title = success ? "Sent" : "Failed";
    const message = resultAttempt
      ? success
        ? `Sent ${resultAttempt.amountLabel} SFLUV to ${resultAttempt.recipientLabel}`
        : `Failed to send ${resultAttempt.amountLabel} SFLUV to ${resultAttempt.recipientLabel}`
      : success
        ? "Sent"
        : "Failed";
    const canTip = success && Boolean(resultAttempt?.tipTarget);

    return (
      <View style={[styles.stateScreen, { paddingTop: topInset + spacing.xl, paddingBottom: spacing.xl }]}>
        <View style={styles.stateInner}>
          <Animated.View
            style={[
              styles.resultIconWrap,
              success ? styles.resultIconSuccess : styles.resultIconFailure,
              {
                opacity: resultIconOpacity,
                transform: [{ scale: resultIconScale }],
              },
            ]}
          >
            <Ionicons name={success ? "checkmark" : "close"} size={68} color={palette.white} />
          </Animated.View>

          <Text style={styles.resultTitle}>{title}</Text>
          <Text style={styles.resultMessage}>{message}</Text>

          {canTip ? (
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>Add tip</Text>
              {resultAttempt?.tipTarget ? (
                <Text style={styles.tipBody}>For {resultAttempt.tipTarget.merchantName}</Text>
              ) : null}

              <View style={styles.tipChoices}>
                {tipPresetOptions.map((option) => {
                  const selected = tipChoice === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.tipChoice, selected ? styles.tipChoiceActive : undefined]}
                      onPress={() => {
                        Keyboard.dismiss();
                        setTipChoice(option.key);
                        setCustomTipInput("");
                        setTipStatus("idle");
                        setTipMessage(null);
                      }}
                    >
                      <Text style={[styles.tipChoiceText, selected ? styles.tipChoiceTextActive : undefined]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}

                {canUseCustomTip ? (
                  <Pressable
                    style={[styles.tipChoice, tipChoice === "custom" ? styles.tipChoiceActive : undefined]}
                    onPress={() => {
                      setTipChoice("custom");
                      setTipStatus("idle");
                      setTipMessage(null);
                    }}
                  >
                    <Text
                      style={[styles.tipChoiceText, tipChoice === "custom" ? styles.tipChoiceTextActive : undefined]}
                    >
                      Custom
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {tipChoice === "custom" ? (
                <TextInput
                  style={styles.customTipInput}
                  value={customTipInput}
                  onChangeText={(value) => {
                    setCustomTipInput(sanitizeTokenInput(value));
                    setTipStatus("idle");
                    setTipMessage(null);
                  }}
                  placeholder="0"
                  placeholderTextColor={palette.textMuted}
                  keyboardType={Platform.select({ ios: "decimal-pad", android: "numeric" })}
                  autoFocus
                />
              ) : null}

              {tipMessage ? (
                <View style={styles.tipMessageRow}>
                  {tipStatus === "sent" ? (
                    <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                  ) : tipStatus === "error" ? (
                    <Ionicons name="close-circle" size={16} color={palette.danger} />
                  ) : null}
                  <Text
                    style={[
                      styles.tipMessageText,
                      tipStatus === "sent"
                        ? styles.tipMessageTextSuccess
                        : tipStatus === "error"
                          ? styles.tipMessageTextError
                          : undefined,
                    ]}
                  >
                    {tipMessage}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.resultFooter}>
          {success ? (
            <Pressable
              style={[styles.primaryButton, tipStatus === "sending" ? styles.primaryButtonDisabled : undefined]}
              disabled={tipStatus === "sending" || tipStatus === "sent"}
              onPress={handlePrimarySuccessAction}
            >
              {tipStatus === "sending" ? (
                <ActivityIndicator size="small" color={palette.white} />
              ) : tipStatus === "sent" ? (
                <View style={styles.buttonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={palette.white} />
                  <Text style={styles.primaryButtonText}>Tip sent</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>
                  {selectedTipAmountRaw && selectedTipAmountRaw.gt(0) ? "Send tip" : "Done"}
                </Text>
              )}
            </Pressable>
          ) : (
            <>
              <Pressable style={styles.primaryButton} onPress={retryPayment}>
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={exitFlow}>
                <Text style={styles.secondaryButtonText}>Done</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  };

  if (phase === "sending") {
    return (
      <View style={[styles.stateScreen, { paddingTop: topInset + spacing.xl, paddingBottom: spacing.xl }]}>
        <View style={styles.stateInner}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.resultTitle}>Sending</Text>
        </View>
      </View>
    );
  }

  if (phase === "success") {
    return renderStateScreen(true);
  }

  if (phase === "failure") {
    return renderStateScreen(false);
  }

  return (
    <View style={styles.flex}>
      {step === "recipient" ? renderRecipientStep() : renderAmountStep()}

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={scannerClose}>
        <View style={styles.scannerScreen}>
          <View style={[styles.scannerHeader, { paddingTop: topInset + spacing.xl }]}>
            <Pressable style={styles.scannerClose} onPress={scannerClose}>
              <Ionicons name="arrow-back" size={20} color={palette.white} />
            </Pressable>
          </View>

          <View style={styles.scannerFrame}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => {
                if (scanLocked) {
                  return;
                }
                setScanLocked(true);
                if (hapticsEnabled) {
                  Vibration.vibrate(10);
                }

                const universalLink = parseSfluvUniversalLink(result.data);
                if (universalLink?.type === "redeem") {
                  scannerClose();
                  onOpenUniversalLink?.(universalLink);
                  return;
                }

                if (universalLink?.type === "addcontact") {
                  scannerClose();
                  onOpenUniversalLink?.(universalLink);
                  return;
                }

                const scannedTarget = parseSendTarget(result.data);
                if (scannedTarget) {
                  const suggestion = suggestionByAddress.get(scannedTarget.recipient.toLowerCase()) || undefined;
                  if (suggestion) {
                    setDraftRecipient(suggestion);
                  }
                  scannerClose();
                  continueToAmount(scannedTarget, suggestion);
                  return;
                }

                setRecipientInput(result.data);
                scannerClose();
                setFeedback("Scanned.");
              }}
            />
            <View pointerEvents="none" style={styles.scannerGuide} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    flexGrow: {
      flex: 1,
    },
    recipientContainer: {
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    stepHeader: {
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      minHeight: 44,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    feedbackCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    feedbackText: {
      color: palette.text,
      lineHeight: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    recipientSearchCard: {
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.sm,
      ...shadows.soft,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    searchInput: {
      flex: 1,
      minHeight: 56,
      borderRadius: radii.lg,
      backgroundColor: palette.surfaceStrong,
      paddingHorizontal: spacing.md,
      color: palette.text,
      fontSize: 15,
    },
    scanButton: {
      width: 56,
      height: 56,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    suggestionList: {
      gap: spacing.sm,
    },
    suggestionCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      ...shadows.soft,
    },
    suggestionAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    suggestionAvatarText: {
      color: palette.primaryStrong,
      fontWeight: "900",
      fontSize: 14,
    },
    suggestionBody: {
      flex: 1,
      gap: 4,
    },
    suggestionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    suggestionTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "900",
      flex: 1,
    },
    suggestionMeta: {
      color: palette.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    kindBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
    },
    kindBadgeMerchant: {
      backgroundColor: palette.primarySoft,
      borderColor: palette.primary,
    },
    kindBadgeContact: {
      backgroundColor: palette.surfaceStrong,
      borderColor: palette.border,
    },
    kindBadgeText: {
      fontSize: 10,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    kindBadgeTextMerchant: {
      color: palette.primaryStrong,
    },
    kindBadgeTextContact: {
      color: palette.textMuted,
    },
    footerDock: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      backgroundColor: palette.background,
    },
    primaryButton: {
      minHeight: 54,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 15,
      fontWeight: "900",
    },
    secondaryButton: {
      minHeight: 54,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    secondaryButtonText: {
      color: palette.primaryStrong,
      fontSize: 15,
      fontWeight: "900",
    },
    amountScreen: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    amountHero: {
      alignItems: "center",
      justifyContent: "center",
      paddingTop: spacing.xl,
      gap: spacing.sm,
    },
    recipientLine: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: "800",
    },
    amountDisplay: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 140,
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
    },
    amountValue: {
      color: palette.primaryStrong,
      fontSize: 58,
      lineHeight: 64,
      fontWeight: "900",
      textAlign: "center",
      letterSpacing: -1.4,
    },
    amountSuffix: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 0.7,
    },
    amountMetaBlock: {
      gap: spacing.sm,
    },
    balanceLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textAlign: "center",
    },
    noteWrap: {
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: spacing.md,
      ...shadows.soft,
    },
    noteInput: {
      minHeight: 50,
      color: palette.text,
      fontSize: 15,
    },
    keypad: {
      gap: spacing.sm,
    },
    keypadGap: {
      minHeight: 252,
    },
    keypadRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    keypadKey: {
      flex: 1,
      minHeight: 56,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      ...shadows.soft,
    },
    keypadKeyAction: {
      backgroundColor: palette.primarySoft,
    },
    keypadKeyText: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "900",
    },
    sendDock: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
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
      width: 58,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    swipeThumbDisabled: {
      backgroundColor: palette.surfaceStrong,
    },
    stateScreen: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      justifyContent: "space-between",
    },
    stateInner: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
    },
    resultIconWrap: {
      width: 140,
      height: 140,
      borderRadius: 70,
      alignItems: "center",
      justifyContent: "center",
      ...shadows.card,
    },
    resultIconSuccess: {
      backgroundColor: palette.success,
    },
    resultIconFailure: {
      backgroundColor: palette.danger,
    },
    resultTitle: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "900",
      textAlign: "center",
    },
    resultMessage: {
      color: palette.textMuted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      maxWidth: 320,
    },
    resultFooter: {
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    tipCard: {
      width: "100%",
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.soft,
    },
    tipTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "900",
      textAlign: "center",
    },
    tipBody: {
      color: palette.textMuted,
      fontSize: 13,
      textAlign: "center",
    },
    tipChoices: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      justifyContent: "center",
    },
    tipChoice: {
      minWidth: 72,
      minHeight: 42,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    tipChoiceActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    tipChoiceText: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 13,
    },
    tipChoiceTextActive: {
      color: palette.primaryStrong,
    },
    customTipInput: {
      minHeight: 50,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      paddingHorizontal: spacing.md,
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
      textAlign: "center",
    },
    tipMessageRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    tipMessageText: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },
    tipMessageTextSuccess: {
      color: palette.success,
    },
    tipMessageTextError: {
      color: palette.danger,
    },
    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    scannerScreen: {
      flex: 1,
      backgroundColor: "rgba(8, 12, 20, 0.95)",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    scannerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      paddingBottom: spacing.lg,
    },
    scannerClose: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: "rgba(255,255,255,0.14)",
      alignItems: "center",
      justifyContent: "center",
    },
    scannerFrame: {
      flex: 1,
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
  });
}
