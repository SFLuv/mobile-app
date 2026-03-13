import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { AmountUnit, SendResult } from "../services/smartWallet";
import { parseTransferQR } from "../utils/qr";
import { AppContact } from "../types/app";
import { palette, radii, spacing } from "../theme";

type Props = {
  contacts: AppContact[];
  onPrepareSend: (
    recipient: string,
    amount: string,
    amountUnit: AmountUnit,
    memo: string,
  ) => Promise<SendResult>;
};

function shortAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function SendScreen({ contacts, onPrepareSend }: Props) {
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const parsed = useMemo(() => parseTransferQR(recipientInput), [recipientInput]);

  const filteredContacts = useMemo(() => {
    const query = recipientInput.trim().toLowerCase();
    if (!query) {
      return contacts.filter((contact) => contact.isFavorite).slice(0, 4);
    }
    return contacts
      .filter((contact) => {
        return (
          contact.name.toLowerCase().includes(query) ||
          contact.address.toLowerCase().includes(query)
        );
      })
      .slice(0, 5);
  }, [contacts, recipientInput]);

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

  const send = async () => {
    if (isSending) {
      return;
    }

    if (!parsed) {
      Alert.alert("Invalid address", "Enter a wallet address or scan a valid payment QR.");
      return;
    }

    const resolvedAmount = (parsed.amount ?? amountInput).trim();
    if (!resolvedAmount) {
      Alert.alert("Missing amount", "Enter an amount in SFLUV or scan a QR with a preset amount.");
      return;
    }

    try {
      setIsSending(true);
      const result = await onPrepareSend(
        parsed.recipient,
        resolvedAmount,
        parsed.amount ? "wei" : "token",
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
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Send SFLUV</Text>
        <Text style={styles.subtitle}>
          Start with a saved contact, paste an address, or scan any supported QR.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Recipient</Text>
          <TextInput
            style={[styles.input, styles.addressInput]}
            value={recipientInput}
            onChangeText={setRecipientInput}
            placeholder="Contact name, 0x address, or EIP-681 QR"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />

          {filteredContacts.length > 0 ? (
            <View style={styles.contactList}>
              {filteredContacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  style={styles.contactChip}
                  onPress={() => setRecipientInput(contact.address)}
                >
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactAddress}>{shortAddress(contact.address)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.row}>
          <View style={[styles.card, styles.cardHalf]}>
            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={styles.input}
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </View>

          <View style={[styles.card, styles.cardHalf]}>
            <Text style={styles.label}>Memo</Text>
            <TextInput
              style={styles.input}
              value={memoInput}
              onChangeText={setMemoInput}
              placeholder="Optional note"
            />
          </View>
        </View>

        {parsed ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Review</Text>
            <Text style={styles.previewText}>Recipient: {shortAddress(parsed.recipient)}</Text>
            <Text style={styles.previewText}>
              Amount ({parsed.amount ? "wei" : "SFLUV"}): {(parsed.amount ?? amountInput).trim() || "not set"}
            </Text>
            {(memoInput.trim() || parsed.memo) ? (
              <Text style={styles.previewText}>Memo: {memoInput.trim() || parsed.memo}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.secondaryButton, isSending ? styles.disabled : undefined]}
            onPress={openScanner}
            disabled={isSending}
          >
            <Text style={styles.secondaryButtonText}>Scan QR</Text>
          </Pressable>

          <Pressable
            style={[styles.primaryButton, isSending ? styles.disabled : undefined]}
            onPress={send}
            disabled={isSending}
          >
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>

        {scannerOpen ? (
          <View style={styles.scannerWrap}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => {
                if (!scannerOpen) {
                  return;
                }
                const scanned = parseTransferQR(result.data);
                setRecipientInput(result.data);
                if (scanned?.amount) {
                  setAmountInput(scanned.amount);
                }
                if (scanned?.memo) {
                  setMemoInput(scanned.memo);
                }
                setScannerOpen(false);
              }}
            />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={isSending} transparent animationType="fade">
        <View style={styles.sendingOverlay}>
          <View style={styles.sendingCard}>
            <ActivityIndicator size="large" color={palette.primary} />
            <Text style={styles.sendingTitle}>Confirming transaction...</Text>
            <Text style={styles.sendingText}>
              Submitting the user operation and waiting for on-chain confirmation.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 80,
  },
  title: {
    color: palette.text,
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: palette.textMuted,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cardHalf: {
    flex: 1,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 8,
  },
  label: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: palette.white,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  addressInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  contactList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  contactChip: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 116,
  },
  contactName: {
    color: palette.text,
    fontWeight: "700",
    fontSize: 13,
  },
  contactAddress: {
    color: palette.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  preview: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 6,
  },
  previewTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 14,
  },
  previewText: {
    color: palette.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: palette.surfaceStrong,
    borderColor: palette.borderStrong,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: palette.text,
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1,
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: palette.white,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.7,
  },
  scannerWrap: {
    marginTop: 4,
    height: 320,
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  sendingOverlay: {
    flex: 1,
    backgroundColor: "rgba(30,20,10,0.32)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sendingCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  sendingTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 12,
  },
  sendingText: {
    color: palette.textMuted,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
  },
});
