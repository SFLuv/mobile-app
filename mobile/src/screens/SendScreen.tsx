import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { AmountUnit, SendResult } from "../services/smartWallet";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { AppContact, AppLocation } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import {
  findNearestMerchantWithinThreshold,
  formatDistanceLabel,
  locationDistanceMeters,
  sortLocationsByProximity,
} from "../utils/location";
import { parseSendTarget, parseSfluvUniversalLink, SfluvUniversalLink } from "../utils/universalLinks";

type Props = {
  contacts: AppContact[];
  merchants: AppLocation[];
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
  } | null;
  onDraftApplied?: () => void;
  onOpenUniversalLink?: (link: SfluvUniversalLink) => void;
  onOpenMerchantList?: () => void;
};

type SendMode = "manual" | "scan";

type RecipientMatch =
  | {
      kind: "contact";
      name: string;
      subtitle: string;
      address: string;
    }
  | {
      kind: "merchant";
      name: string;
      subtitle: string;
      address: string;
      detail?: string;
    };

function shortAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function SendScreen({
  contacts,
  merchants,
  onPrepareSend,
  draft,
  onDraftApplied,
  onOpenUniversalLink,
  onOpenMerchantList,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("manual");
  const [isSending, setIsSending] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const { location: userLocation, loading: loadingLocation } = useCurrentLocation(true);
  const scanCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLockedRef = useRef(false);

  const parsed = useMemo(() => parseSendTarget(recipientInput), [recipientInput]);
  const payableMerchants = useMemo(
    () => sortLocationsByProximity(merchants.filter((merchant) => Boolean(merchant.payToAddress)), userLocation),
    [merchants, userLocation],
  );
  const displayedMerchants = useMemo(() => payableMerchants.slice(0, 5), [payableMerchants]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    setRecipientInput(draft.recipient);
    setAmountInput(draft.amount ?? "");
    setMemoInput(draft.memo ?? "");
    setSendMode("manual");
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  useEffect(() => {
    if (sendMode !== "scan") {
      return;
    }
    if (permission?.status === "granted") {
      return;
    }
    void requestPermission();
  }, [permission?.status, requestPermission, sendMode]);

  useEffect(() => {
    return () => {
      if (scanCooldownRef.current) {
        clearTimeout(scanCooldownRef.current);
        scanCooldownRef.current = null;
      }
    };
  }, []);

  const resolvedRecipient = useMemo<RecipientMatch | null>(() => {
    const recipient = parsed?.recipient?.toLowerCase();
    if (!recipient) {
      return null;
    }

    const contact = contacts.find((entry) => entry.address.toLowerCase() === recipient);
    if (contact) {
      return {
        kind: "contact",
        name: contact.name,
        subtitle: contact.isFavorite ? "Favorite contact" : "Saved contact",
        address: contact.address,
      };
    }

    const merchant = payableMerchants.find((entry) => entry.payToAddress?.toLowerCase() === recipient);
    if (merchant?.payToAddress) {
      const distance = locationDistanceMeters(merchant, userLocation);
      return {
        kind: "merchant",
        name: merchant.name,
        subtitle: [merchant.type, merchant.city].filter(Boolean).join(" • "),
        address: merchant.payToAddress,
        detail: distance !== null ? formatDistanceLabel(distance) : undefined,
      };
    }

    return null;
  }, [contacts, parsed?.recipient, payableMerchants, userLocation]);

  const filteredContacts = useMemo(() => {
    const query = recipientInput.trim().toLowerCase();
    if (!query) {
      return contacts.filter((contact) => contact.isFavorite).slice(0, 5);
    }
    return contacts
      .filter((contact) => contact.name.toLowerCase().includes(query) || contact.address.toLowerCase().includes(query))
      .slice(0, 5);
  }, [contacts, recipientInput]);

  const suggestedNearbyMerchant = useMemo(() => {
    const nearest = findNearestMerchantWithinThreshold(payableMerchants, userLocation);
    if (!nearest?.payToAddress) {
      return null;
    }

    if (resolvedRecipient?.kind === "merchant" && resolvedRecipient.address.toLowerCase() === nearest.payToAddress.toLowerCase()) {
      return null;
    }

    return nearest;
  }, [payableMerchants, resolvedRecipient, userLocation]);

  const resolvedAmount = (parsed?.amount ?? amountInput).trim();

  const applyRecipient = (address: string) => {
    setRecipientInput(address);
    setSendMode("manual");
  };

  const clearRecipient = () => {
    setRecipientInput("");
  };

  const pasteClipboard = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (!value) {
      Alert.alert("Clipboard empty", "Copy an address or payment QR value first.");
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
      setSendMode("manual");
      return;
    }

    setRecipientInput(value);
    setSendMode("manual");
  };

  const send = async () => {
    if (isSending) {
      return;
    }

    if (!parsed) {
      Alert.alert("Invalid address", "Enter a wallet address or scan a valid payment QR.");
      return;
    }

    if (!resolvedAmount) {
      Alert.alert("Missing amount", "Enter an amount in SFLUV or scan a QR with a preset amount.");
      return;
    }

    try {
      setIsSending(true);
      const result = await onPrepareSend(
        parsed.recipient,
        resolvedAmount,
        parsed.amountUnit,
        memoInput.trim() || parsed.memo || "",
      );

      if (result.txHash) {
        Alert.alert("Transaction sent", `Transaction ID:\n${result.txHash}`);
      } else {
        Alert.alert("Transaction sent", `UserOp submitted:\n${result.userOpHash}`);
      }
    } catch (error) {
      Alert.alert("Send failed", (error as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const handleScannedValue = (value: string) => {
    if (scanLockedRef.current) {
      return;
    }

    scanLockedRef.current = true;
    if (scanCooldownRef.current) {
      clearTimeout(scanCooldownRef.current);
    }
    scanCooldownRef.current = setTimeout(() => {
      scanLockedRef.current = false;
      scanCooldownRef.current = null;
    }, 1200);

    const universalLink = parseSfluvUniversalLink(value);
    if (universalLink?.type === "redeem") {
      onOpenUniversalLink?.(universalLink);
      return;
    }

    const scanned = parseSendTarget(value);
    if (scanned) {
      setRecipientInput(scanned.recipient);
      setAmountInput(scanned.amount ?? "");
      setMemoInput(scanned.memo ?? "");
      setSendMode("manual");
      return;
    }

    setRecipientInput(value);
    setSendMode("manual");
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.segmentWrap}>
          <Pressable
            style={[styles.segmentButton, sendMode === "manual" ? styles.segmentButtonActive : undefined]}
            onPress={() => setSendMode("manual")}
          >
            <Text style={[styles.segmentText, sendMode === "manual" ? styles.segmentTextActive : undefined]}>Manual</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, sendMode === "scan" ? styles.segmentButtonActive : undefined]}
            onPress={() => setSendMode("scan")}
          >
            <Text style={[styles.segmentText, sendMode === "scan" ? styles.segmentTextActive : undefined]}>Scan</Text>
          </Pressable>
        </View>

        {sendMode === "manual" ? (
          <>
            <View style={styles.topActionRow}>
              <Pressable style={styles.toolButton} onPress={() => void pasteClipboard()}>
                <Ionicons name="clipboard-outline" size={18} color={palette.primaryStrong} />
                <Text style={styles.toolButtonText}>Paste</Text>
              </Pressable>
            </View>

            {suggestedNearbyMerchant?.payToAddress ? (
              <Pressable style={styles.highlightCard} onPress={() => applyRecipient(suggestedNearbyMerchant.payToAddress!)}>
                <View style={styles.highlightHeader}>
                  <Text style={styles.highlightEyebrow}>Suggested nearby payment</Text>
                  <Ionicons name="location" size={16} color={palette.primaryStrong} />
                </View>
                <Text style={styles.highlightTitle}>{suggestedNearbyMerchant.name}</Text>
                <Text style={styles.highlightMeta}>
                  {formatDistanceLabel(locationDistanceMeters(suggestedNearbyMerchant, userLocation) ?? 0)}
                </Text>
                <Text style={styles.highlightBody}>
                  {suggestedNearbyMerchant.street}, {suggestedNearbyMerchant.city}
                </Text>
              </Pressable>
            ) : null}

            {resolvedRecipient ? (
              <View style={styles.recipientCard}>
                <View style={styles.recipientCardAvatar}>
                  <Ionicons
                    name={resolvedRecipient.kind === "merchant" ? "storefront-outline" : "person-outline"}
                    size={18}
                    color={palette.primaryStrong}
                  />
                </View>
                <View style={styles.recipientCardBody}>
                  <Text style={styles.recipientCardTitle}>{resolvedRecipient.name}</Text>
                  <Text style={styles.recipientCardSubtitle}>{resolvedRecipient.subtitle}</Text>
                  {resolvedRecipient.kind === "merchant" && resolvedRecipient.detail ? (
                    <Text style={styles.recipientCardDetail}>{resolvedRecipient.detail}</Text>
                  ) : null}
                  <Text style={styles.recipientCardAddress}>{shortAddress(resolvedRecipient.address)}</Text>
                </View>
                <Pressable style={styles.clearRecipientButton} onPress={clearRecipient}>
                  <Ionicons name="close" size={16} color={palette.primaryStrong} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Recipient</Text>
                <TextInput
                  style={styles.recipientInput}
                  value={recipientInput}
                  onChangeText={setRecipientInput}
                  placeholder="Contact or wallet address"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  returnKeyType="done"
                  blurOnSubmit
                />

                {filteredContacts.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contactRow}>
                    {filteredContacts.map((contact) => (
                      <Pressable key={contact.id} style={styles.contactChip} onPress={() => applyRecipient(contact.address)}>
                        <View style={styles.contactAvatar}>
                          <Text style={styles.contactAvatarText}>{initials(contact.name)}</Text>
                        </View>
                        <Text style={styles.contactName} numberOfLines={1}>
                          {contact.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {parsed ? (
                  <View style={styles.validRecipientRow}>
                    <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                    <Text style={styles.validRecipientText}>Ready to pay {shortAddress(parsed.recipient)}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {displayedMerchants.length > 0 ? (
              <View style={styles.card}>
                <View style={styles.merchantHeader}>
                  <View style={styles.merchantHeaderTextWrap}>
                    <Text style={styles.sectionLabel}>Merchants</Text>
                    <Text style={styles.sectionHint}>
                      {userLocation
                        ? "Closest merchants appear first."
                        : loadingLocation
                          ? "Checking your location for nearby merchants."
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
                        onPress={() => merchant.payToAddress && applyRecipient(merchant.payToAddress)}
                      >
                        <View style={styles.merchantOptionBody}>
                          <Text style={styles.merchantOptionTitle}>{merchant.name}</Text>
                          <Text style={styles.merchantOptionSubtitle}>{[merchant.type, merchant.city].filter(Boolean).join(" • ")}</Text>
                          <Text style={styles.merchantOptionAddress}>{shortAddress(merchant.payToAddress || "")}</Text>
                        </View>
                        <View style={styles.merchantOptionMeta}>
                          {distance !== null ? <Text style={styles.merchantOptionDistance}>{formatDistanceLabel(distance)}</Text> : null}
                          <Ionicons name="chevron-forward" size={16} color={palette.primaryStrong} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

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
          </>
        ) : (
          <View style={styles.scanCard}>
            <Text style={styles.sectionLabel}>Scan payment QR</Text>
            <Text style={styles.scanText}>Point your camera at any supported SFLUV payment or redemption QR.</Text>

            {permission?.status === "granted" ? (
              <View style={styles.scannerFrame}>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={(result) => {
                    handleScannedValue(result.data);
                  }}
                />
              </View>
            ) : (
              <View style={styles.permissionCard}>
                <Ionicons name="camera-outline" size={24} color={palette.primaryStrong} />
                <Text style={styles.permissionText}>
                  {permission?.status === "undetermined"
                    ? "Allow camera access to scan payment QR codes here."
                    : "Camera access is required to scan payment QR codes here."}
                </Text>
                <Pressable style={styles.permissionButton} onPress={() => void requestPermission()}>
                  <Text style={styles.permissionButtonText}>Enable Camera</Text>
                </Pressable>
              </View>
            )}

            <Pressable style={styles.toolButtonInline} onPress={() => void pasteClipboard()}>
              <Ionicons name="clipboard-outline" size={18} color={palette.primaryStrong} />
              <Text style={styles.toolButtonInlineText}>Paste from clipboard instead</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[styles.sendButton, isSending ? styles.sendButtonDisabled : undefined]}
          onPress={send}
          disabled={isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? "Sending..." : "Send money"}</Text>
          <Ionicons name="arrow-forward" size={18} color={palette.white} />
        </Pressable>
      </ScrollView>

      {isSending ? (
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingCard}>
            <ActivityIndicator size="large" color={palette.primary} />
            <Text style={styles.sendingTitle}>Sending transaction...</Text>
            <Text style={styles.sendingText}>Sponsoring gas and submitting your user operation.</Text>
          </View>
        </View>
      ) : null}
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
      paddingBottom: 96,
    },
    segmentWrap: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
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
      fontSize: 13,
    },
    segmentTextActive: {
      color: palette.white,
    },
    topActionRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
    },
    toolButton: {
      minWidth: 92,
      height: 42,
      borderRadius: 21,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 14,
    },
    toolButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 13,
    },
    toolButtonInline: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    toolButtonInlineText: {
      color: palette.primaryStrong,
      fontWeight: "700",
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
    recipientCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.primary,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      ...shadows.soft,
    },
    recipientCardAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: palette.primarySoft,
      alignItems: "center",
      justifyContent: "center",
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
    },
    recipientCardDetail: {
      color: palette.primaryStrong,
      fontWeight: "700",
      fontSize: 12,
    },
    recipientCardAddress: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 13,
      marginTop: 2,
    },
    clearRecipientButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
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
    contactRow: {
      gap: spacing.sm,
      paddingTop: 2,
    },
    contactChip: {
      width: 72,
      alignItems: "center",
      gap: 6,
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
    contactName: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "700",
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
      fontSize: 34,
      fontWeight: "900",
      textAlign: "center",
      paddingVertical: 4,
    },
    amountToken: {
      color: palette.primaryStrong,
      fontSize: 16,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    noteInput: {
      minHeight: 52,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: palette.text,
      fontSize: 15,
    },
    scanCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.soft,
    },
    scanText: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    scannerFrame: {
      alignSelf: "center",
      width: 280,
      height: 280,
      borderRadius: radii.lg,
      overflow: "hidden",
      borderWidth: 1.5,
      borderColor: palette.primary,
      backgroundColor: palette.surfaceStrong,
    },
    permissionCard: {
      minHeight: 220,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.lg,
    },
    permissionText: {
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
    permissionButton: {
      marginTop: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    permissionButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    sendButton: {
      marginTop: spacing.sm,
      backgroundColor: palette.primary,
      borderRadius: radii.pill,
      paddingVertical: 16,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      ...shadows.card,
    },
    sendButtonDisabled: {
      opacity: 0.6,
    },
    sendButtonText: {
      color: palette.white,
      fontSize: 16,
      fontWeight: "800",
    },
    sendingOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(9, 15, 20, 0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    sendingCard: {
      width: "100%",
      maxWidth: 320,
      borderRadius: radii.xl,
      backgroundColor: palette.surface,
      padding: spacing.xl,
      alignItems: "center",
      gap: spacing.md,
      ...shadows.card,
    },
    sendingTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
    },
    sendingText: {
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 21,
    },
  });
}
