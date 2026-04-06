import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { ethers } from "ethers";
import { AppContact } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { buildUniversalPayLink, parseSendTarget } from "../utils/universalLinks";

type Props = {
  contacts: AppContact[];
  shareAddress?: string;
  syncNotice?: string | null;
  onAddContact: (name: string, address: string) => Promise<void>;
  onUpdateContact: (contact: AppContact) => Promise<void>;
  onToggleFavorite: (contact: AppContact) => Promise<void>;
  onDeleteContact: (contactID: number) => Promise<void>;
};

type ContactMode = "my-qr" | "scan";

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function validateContactInput(name: string, address: string): string | null {
  if (!name.trim()) {
    return "Enter a contact name.";
  }
  if (!ethers.utils.isAddress(address.trim())) {
    return "Enter a valid wallet address.";
  }
  return null;
}

function resolveScannedAddress(rawValue: string): string | null {
  const parsedTarget = parseSendTarget(rawValue);
  if (parsedTarget) {
    return ethers.utils.getAddress(parsedTarget.recipient);
  }

  const trimmed = rawValue.trim();
  if (ethers.utils.isAddress(trimmed)) {
    return ethers.utils.getAddress(trimmed);
  }

  return null;
}

export function ContactsScreen({
  contacts,
  shareAddress,
  syncNotice,
  onAddContact,
  onUpdateContact,
  onToggleFavorite,
  onDeleteContact,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [contactMode, setContactMode] = useState<ContactMode>("my-qr");
  const [editingID, setEditingID] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingAddress, setEditingAddress] = useState("");
  const [busyID, setBusyID] = useState<number | "scan" | null>(null);
  const [listErrorMessage, setListErrorMessage] = useState<string | null>(null);
  const [scanErrorMessage, setScanErrorMessage] = useState<string | null>(null);
  const [pendingScannedAddress, setPendingScannedAddress] = useState<string | null>(null);
  const [pendingScannedName, setPendingScannedName] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const scanCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLockedRef = useRef(false);

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((left, right) => {
      if (left.isFavorite !== right.isFavorite) {
        return left.isFavorite ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [contacts]);

  const shareQRValue = useMemo(() => {
    if (!shareAddress || !ethers.utils.isAddress(shareAddress)) {
      return null;
    }
    return buildUniversalPayLink({ address: shareAddress });
  }, [shareAddress]);

  useEffect(() => {
    if (contactMode !== "scan") {
      return;
    }
    if (permission?.status === "granted") {
      return;
    }
    void requestPermission();
  }, [contactMode, permission?.status, requestPermission]);

  useEffect(() => {
    return () => {
      if (scanCooldownRef.current) {
        clearTimeout(scanCooldownRef.current);
      }
    };
  }, []);

  const beginEdit = (contact: AppContact) => {
    setEditingID(contact.id);
    setEditingName(contact.name);
    setEditingAddress(contact.address);
    setListErrorMessage(null);
  };

  const clearPendingScan = () => {
    setPendingScannedAddress(null);
    setPendingScannedName("");
    setScanErrorMessage(null);
  };

  const handleScannedValue = (rawValue: string) => {
    if (scanLockedRef.current || pendingScannedAddress) {
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

    const resolvedAddress = resolveScannedAddress(rawValue);
    if (!resolvedAddress) {
      setScanErrorMessage("That QR code does not contain a valid wallet address.");
      return;
    }

    const existingContact = contacts.find((contact) => contact.address.toLowerCase() === resolvedAddress.toLowerCase());
    if (existingContact) {
      setScanErrorMessage(`${existingContact.name} is already saved in your contacts.`);
      return;
    }

    setPendingScannedAddress(resolvedAddress);
    setPendingScannedName("");
    setScanErrorMessage(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Contact QR</Text>
          <Text style={styles.meta}>{contactMode === "my-qr" ? "Share" : "Scan"}</Text>
        </View>

        <View style={styles.segmentWrap}>
          <Pressable
            style={[styles.segmentButton, contactMode === "my-qr" ? styles.segmentButtonActive : undefined]}
            onPress={() => {
              setContactMode("my-qr");
              clearPendingScan();
            }}
          >
            <Text style={[styles.segmentText, contactMode === "my-qr" ? styles.segmentTextActive : undefined]}>My QR</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, contactMode === "scan" ? styles.segmentButtonActive : undefined]}
            onPress={() => {
              setContactMode("scan");
              setScanErrorMessage(null);
            }}
          >
            <Text style={[styles.segmentText, contactMode === "scan" ? styles.segmentTextActive : undefined]}>Scan QR</Text>
          </Pressable>
        </View>

        {contactMode === "my-qr" ? (
          shareQRValue ? (
            <View style={styles.qrCard}>
              <Text style={styles.body}>Show this code to let someone save your current wallet as a contact.</Text>
              <View style={styles.qrFrame}>
                <QRCode value={shareQRValue} size={216} backgroundColor={palette.white} color="#111111" />
              </View>
              <Text style={styles.qrAddress}>{shortAddress(shareAddress || "")}</Text>
            </View>
          ) : (
            <View style={styles.emptyStateCard}>
              <Ionicons name="wallet-outline" size={20} color={palette.textMuted} />
              <Text style={styles.body}>Your wallet is still loading. Once it is ready, your contact QR will appear here.</Text>
            </View>
          )
        ) : (
          <View style={styles.scanCard}>
            <Text style={styles.body}>Scan a SFLUV contact, pay, request, or wallet QR to save that address as a contact.</Text>

            {permission?.status === "granted" ? (
              <View style={styles.scannerFrame}>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={
                    pendingScannedAddress
                      ? undefined
                      : (result) => {
                          handleScannedValue(result.data);
                        }
                  }
                />
              </View>
            ) : (
              <View style={styles.permissionCard}>
                <Ionicons name="camera-outline" size={24} color={palette.primaryStrong} />
                <Text style={styles.permissionText}>
                  {permission?.status === "undetermined"
                    ? "Allow camera access to scan contact QR codes here."
                    : "Camera access is required to scan contact QR codes here."}
                </Text>
                <Pressable style={styles.permissionButton} onPress={() => void requestPermission()}>
                  <Text style={styles.permissionButtonText}>Enable Camera</Text>
                </Pressable>
              </View>
            )}

            {pendingScannedAddress ? (
              <View style={styles.pendingCard}>
                <Text style={styles.sectionTitle}>Save scanned contact</Text>
                <Text style={styles.meta}>{shortAddress(pendingScannedAddress)}</Text>
                <TextInput
                  style={styles.input}
                  value={pendingScannedName}
                  onChangeText={setPendingScannedName}
                  placeholder="Contact name"
                  placeholderTextColor={palette.textMuted}
                />
                {scanErrorMessage ? <Text style={styles.errorText}>{scanErrorMessage}</Text> : null}
                <View style={styles.inlineActions}>
                  <Pressable
                    style={[styles.primaryButton, busyID === "scan" ? styles.buttonDisabled : undefined]}
                    disabled={busyID === "scan"}
                    onPress={async () => {
                      const scannedAddress = pendingScannedAddress;
                      if (!scannedAddress) {
                        return;
                      }

                      const validationError = validateContactInput(pendingScannedName, scannedAddress);
                      if (validationError) {
                        setScanErrorMessage(validationError);
                        return;
                      }

                      setBusyID("scan");
                      setScanErrorMessage(null);
                      try {
                        await onAddContact(pendingScannedName.trim(), ethers.utils.getAddress(scannedAddress.trim()));
                        clearPendingScan();
                      } catch (error) {
                        setScanErrorMessage((error as Error).message || "Unable to add contact.");
                      } finally {
                        setBusyID(null);
                      }
                    }}
                  >
                    {busyID === "scan" ? (
                      <ActivityIndicator size="small" color={palette.white} />
                    ) : (
                      <Text style={styles.primaryButtonText}>Save contact</Text>
                    )}
                  </Pressable>
                  <Pressable style={styles.inlineButtonMuted} onPress={clearPendingScan}>
                    <Text style={styles.inlineButtonMutedText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {scanErrorMessage && !pendingScannedAddress ? <Text style={styles.errorText}>{scanErrorMessage}</Text> : null}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Saved contacts</Text>
          <Text style={styles.meta}>{sortedContacts.length}</Text>
        </View>

        {listErrorMessage ? <Text style={styles.errorText}>{listErrorMessage}</Text> : null}

        {sortedContacts.length === 0 ? (
          <Text style={styles.body}>No contacts saved yet.</Text>
        ) : (
          sortedContacts.map((contact) => {
            const editing = editingID === contact.id;
            const busy = busyID === contact.id;

            return (
              <View key={contact.id} style={styles.contactCard}>
                <View style={styles.contactHeader}>
                  <View style={styles.contactTitleWrap}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.meta}>{shortAddress(contact.address)}</Text>
                  </View>
                  <Pressable
                    style={[styles.favoriteChip, contact.isFavorite ? styles.favoriteChipActive : undefined]}
                    onPress={async () => {
                      setBusyID(contact.id);
                      setListErrorMessage(null);
                      try {
                        await onToggleFavorite(contact);
                      } catch (error) {
                        setListErrorMessage((error as Error).message || "Unable to update favorite.");
                      } finally {
                        setBusyID(null);
                      }
                    }}
                  >
                    <Ionicons
                      name={contact.isFavorite ? "star" : "star-outline"}
                      size={14}
                      color={contact.isFavorite ? palette.primaryStrong : palette.textMuted}
                    />
                    <Text style={[styles.favoriteChipText, contact.isFavorite ? styles.favoriteChipTextActive : undefined]}>
                      {contact.isFavorite ? "Favorite" : "Mark favorite"}
                    </Text>
                  </Pressable>
                </View>

                {editing ? (
                  <View style={styles.formStack}>
                    <TextInput
                      style={styles.input}
                      value={editingName}
                      onChangeText={setEditingName}
                      placeholder="Contact name"
                      placeholderTextColor={palette.textMuted}
                    />
                    <TextInput
                      style={styles.input}
                      value={editingAddress}
                      onChangeText={setEditingAddress}
                      placeholder="0x address"
                      placeholderTextColor={palette.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <View style={styles.inlineActions}>
                      <Pressable
                        style={[styles.inlineButton, busy ? styles.buttonDisabled : undefined]}
                        disabled={busy}
                        onPress={async () => {
                          const validationError = validateContactInput(editingName, editingAddress);
                          if (validationError) {
                            setListErrorMessage(validationError);
                            return;
                          }

                          setBusyID(contact.id);
                          setListErrorMessage(null);
                          try {
                            await onUpdateContact({
                              ...contact,
                              name: editingName.trim(),
                              address: ethers.utils.getAddress(editingAddress.trim()),
                            });
                            setEditingID(null);
                            setEditingName("");
                            setEditingAddress("");
                          } catch (error) {
                            setListErrorMessage((error as Error).message || "Unable to save contact.");
                          } finally {
                            setBusyID(null);
                          }
                        }}
                      >
                        <Text style={styles.inlineButtonText}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={styles.inlineButtonMuted}
                        onPress={() => {
                          setEditingID(null);
                          setEditingName("");
                          setEditingAddress("");
                          setListErrorMessage(null);
                        }}
                      >
                        <Text style={styles.inlineButtonMutedText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.inlineButton} onPress={() => beginEdit(contact)}>
                      <Text style={styles.inlineButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.inlineButtonDanger, busy ? styles.buttonDisabled : undefined]}
                      disabled={busy}
                      onPress={async () => {
                        setBusyID(contact.id);
                        setListErrorMessage(null);
                        try {
                          await onDeleteContact(contact.id);
                          if (editingID === contact.id) {
                            setEditingID(null);
                          }
                        } catch (error) {
                          setListErrorMessage((error as Error).message || "Unable to delete contact.");
                        } finally {
                          setBusyID(null);
                        }
                      }}
                    >
                      <Text style={styles.inlineButtonDangerText}>Delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
      paddingBottom: 120,
    },
    noticeCard: {
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    noticeTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 16,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    listHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
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
    qrCard: {
      gap: spacing.md,
      alignItems: "center",
    },
    qrFrame: {
      alignSelf: "center",
      backgroundColor: palette.white,
      borderRadius: radii.lg,
      padding: 18,
      borderWidth: 1,
      borderColor: palette.border,
    },
    qrAddress: {
      color: palette.text,
      fontWeight: "800",
      fontFamily: "Courier",
    },
    emptyStateCard: {
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: "flex-start",
    },
    scanCard: {
      gap: spacing.md,
    },
    scannerFrame: {
      alignSelf: "center",
      width: 230,
      height: 230,
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    permissionCard: {
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: "center",
    },
    permissionText: {
      color: palette.textMuted,
      lineHeight: 20,
      textAlign: "center",
    },
    permissionButton: {
      minHeight: 44,
      minWidth: 150,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    permissionButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    pendingCard: {
      backgroundColor: palette.primarySoft,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.primary,
      padding: spacing.md,
      gap: spacing.sm,
    },
    formStack: {
      gap: spacing.sm,
    },
    input: {
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: palette.text,
    },
    primaryButton: {
      flex: 1,
      minHeight: 48,
      backgroundColor: palette.primary,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    primaryButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    contactCard: {
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 14,
      gap: spacing.sm,
    },
    contactHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    contactTitleWrap: {
      flex: 1,
      gap: 4,
    },
    contactName: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 16,
    },
    favoriteChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    favoriteChipActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    favoriteChipText: {
      color: palette.textMuted,
      fontWeight: "700",
      fontSize: 12,
    },
    favoriteChipTextActive: {
      color: palette.primaryStrong,
    },
    inlineActions: {
      flexDirection: "row",
      gap: 8,
    },
    inlineButton: {
      flex: 1,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonText: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 12,
    },
    inlineButtonMuted: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonMutedText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 12,
    },
    inlineButtonDanger: {
      flex: 1,
      backgroundColor: palette.primaryMuted,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonDangerText: {
      color: palette.danger,
      fontWeight: "800",
      fontSize: 12,
    },
    body: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    meta: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    errorText: {
      color: palette.danger,
      lineHeight: 20,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
}
