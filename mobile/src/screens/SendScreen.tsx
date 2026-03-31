import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { AppContact } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { parseSendTarget, parseSfluvUniversalLink, SfluvUniversalLink } from "../utils/universalLinks";

type Props = {
  contacts: AppContact[];
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
};

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

export function SendScreen({ contacts, onPrepareSend, draft, onDraftApplied, onOpenUniversalLink }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const parsed = useMemo(() => parseSendTarget(recipientInput), [recipientInput]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    setRecipientInput(draft.recipient);
    setAmountInput(draft.amount ?? "");
    setMemoInput(draft.memo ?? "");
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  const filteredContacts = useMemo(() => {
    const query = recipientInput.trim().toLowerCase();
    if (!query) {
      return contacts.filter((contact) => contact.isFavorite).slice(0, 6);
    }
    return contacts
      .filter((contact) => {
        return contact.name.toLowerCase().includes(query) || contact.address.toLowerCase().includes(query);
      })
      .slice(0, 6);
  }, [contacts, recipientInput]);

  const resolvedAmount = (parsed?.amount ?? amountInput).trim();

  const openScanner = async () => {
    const status = permission?.status;
    if (status !== "granted") {
      const req = await requestPermission();
      if (!req.granted) {
        Alert.alert("Camera permission required");
        return;
      }
    }
    setScannerOpen(true);
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
      return;
    }
    setRecipientInput(value);
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
        Alert.alert("Transaction confirmed", `Transaction ID:\n${result.txHash}`);
      } else {
        Alert.alert("Submitted", `UserOp submitted:\n${result.userOpHash}`);
      }
    } catch (error) {
      Alert.alert("Send failed", (error as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topActionRow}>
          <View style={styles.toolRow}>
            <Pressable style={styles.toolButton} onPress={openScanner}>
              <Ionicons name="scan" size={18} color={palette.primaryStrong} />
            </Pressable>
            <Pressable style={styles.toolButton} onPress={() => void pasteClipboard()}>
              <Ionicons name="clipboard-outline" size={18} color={palette.primaryStrong} />
            </Pressable>
          </View>
        </View>

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
                <Pressable key={contact.id} style={styles.contactChip} onPress={() => setRecipientInput(contact.address)}>
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

        <Pressable
          style={[styles.sendButton, isSending ? styles.sendButtonDisabled : undefined]}
          onPress={send}
          disabled={isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? "Sending..." : "Send money"}</Text>
          <Ionicons name="arrow-forward" size={18} color={palette.white} />
        </Pressable>
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.scannerScreen}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan payment QR</Text>
            <Pressable style={styles.scannerClose} onPress={() => setScannerOpen(false)}>
              <Ionicons name="close" size={22} color={palette.primaryStrong} />
            </Pressable>
          </View>

          <View style={styles.scannerFrame}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => {
                if (!scannerOpen) {
                  return;
                }
                const universalLink = parseSfluvUniversalLink(result.data);
                if (universalLink?.type === "redeem") {
                  onOpenUniversalLink?.(universalLink);
                  setScannerOpen(false);
                  return;
                }
                const scanned = parseSendTarget(result.data);
                if (scanned) {
                  setRecipientInput(scanned.recipient);
                  setAmountInput(scanned.amount ?? "");
                  setMemoInput(scanned.memo ?? "");
                } else {
                  setRecipientInput(result.data);
                }
                setScannerOpen(false);
              }}
            />
          </View>
          <Text style={styles.scannerHint}>Point your camera at any supported SFLUV payment QR.</Text>
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
      paddingBottom: 96,
    },
    topActionRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
    },
    toolRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    toolButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
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
    sectionLabel: {
      color: palette.primaryStrong,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
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
    sendButton: {
      minHeight: 58,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 10,
      ...shadows.card,
    },
    sendButtonDisabled: {
      opacity: 0.72,
    },
    sendButtonText: {
      color: palette.white,
      fontSize: 16,
      fontWeight: "900",
    },
    scannerScreen: {
      flex: 1,
      backgroundColor: palette.background,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      gap: spacing.lg,
    },
    scannerHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    scannerTitle: {
      color: palette.primaryStrong,
      fontSize: 24,
      fontWeight: "900",
    },
    scannerClose: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    scannerFrame: {
      flex: 1,
      minHeight: 360,
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: palette.text,
    },
    scannerHint: {
      color: palette.textMuted,
      textAlign: "center",
      paddingBottom: spacing.xl,
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
      textAlign: "center",
    },
    sendingText: {
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
  });
}
