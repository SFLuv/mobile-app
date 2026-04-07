import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { ethers } from "ethers";
import { mobileConfig } from "../config";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { buildUniversalRequestLink, parseSfluvUniversalLink } from "../utils/universalLinks";

type Props = {
  accountAddress: string;
  onRedeemCodeScanned?: (code: string) => void;
};

function shortAddress(address: string): string {
  if (!address) {
    return "";
  }
  if (address.length <= 20) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

export function ReceiveScreen({ accountAddress, onRedeemCodeScanned }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const topInset = Math.max((Dimensions.get("window").height - Dimensions.get("screen").height) * -1, 0);
  const [amountSFLUV, setAmountSFLUV] = useState("");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
    };
  }, []);

  const requestAmount = useMemo(() => {
    const trimmed = amountSFLUV.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      ethers.utils.parseUnits(trimmed, mobileConfig.tokenDecimals);
      return trimmed;
    } catch {
      return undefined;
    }
  }, [amountSFLUV]);

  const qr = useMemo(
    () =>
      buildUniversalRequestLink({
        address: accountAddress,
        amount: requestAmount,
        memo,
      }),
    [accountAddress, memo, requestAmount],
  );

  const openRedeemScanner = async () => {
    const currentPermission = permission?.granted ? permission : await requestPermission();
    if (!currentPermission?.granted) {
      setScanError("Camera permission is required to scan faucet reward QRs.");
      return;
    }

    setScanError(null);
    setScanLocked(false);
    setScannerOpen(true);
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="download-outline" size={20} color={palette.white} />
            </View>
            <Pressable style={styles.redeemButton} onPress={() => void openRedeemScanner()}>
              <Ionicons name="scan-outline" size={16} color={palette.white} />
              <Text style={styles.redeemButtonText}>Redeem QR</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Show this QR or share the link to request payment instantly.</Text>
          <Text style={styles.heroCaption}>Scanning a faucet reward QR will redeem it into this wallet.</Text>
        </View>
        {scanError ? (
          <View style={styles.scanErrorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
            <Text style={styles.scanErrorText}>{scanError}</Text>
          </View>
        ) : null}

        <View style={styles.addressCard}>
          <View style={styles.addressHeader}>
            <View>
              <Text style={styles.sectionLabel}>Selected wallet</Text>
              <Text style={styles.addressText}>{shortAddress(accountAddress)}</Text>
            </View>
            <Pressable
              style={styles.copyButton}
              onPress={async () => {
                await Clipboard.setStringAsync(accountAddress);
                setCopied(true);
                if (copyResetTimeoutRef.current) {
                  clearTimeout(copyResetTimeoutRef.current);
                }
                copyResetTimeoutRef.current = setTimeout(() => {
                  setCopied(false);
                  copyResetTimeoutRef.current = null;
                }, 2200);
              }}
            >
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={palette.primaryStrong} />
              <Text style={styles.copyButtonText}>{copied ? "Copied" : "Copy"}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.qrCard}>
          <View style={styles.qrHeader}>
            <Text style={styles.qrTitle}>Payment QR</Text>
            <Text style={styles.qrMeta}>Ready to scan</Text>
          </View>
          <View style={styles.qrFrame}>
            <QRCode value={qr} size={228} backgroundColor={palette.white} color="#111111" />
          </View>
        </View>

        <View style={styles.requestCard}>
          <Text style={styles.sectionLabel}>Request details</Text>
          <TextInput
            style={styles.input}
            value={amountSFLUV}
            onChangeText={setAmountSFLUV}
            placeholder="Optional amount in SFLUV"
            placeholderTextColor={palette.textMuted}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            returnKeyType="done"
            blurOnSubmit
          />

          <TextInput
            style={styles.input}
            value={memo}
            onChangeText={setMemo}
            placeholder="Optional payment note"
            placeholderTextColor={palette.textMuted}
            returnKeyType="done"
            blurOnSubmit
          />

          {amountSFLUV.trim() && !requestAmount ? <Text style={styles.error}>Invalid SFLUV amount.</Text> : null}
        </View>

        <View style={styles.shareCard}>
          <Text style={styles.sectionLabel}>Share link</Text>
          <Text style={styles.mono}>{qr}</Text>
        </View>
      </ScrollView>

      <Modal
        visible={scannerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setScannerOpen(false);
          setScanLocked(false);
        }}
      >
        <View style={styles.scannerScreen}>
          <View style={[styles.scannerHeader, { paddingTop: topInset + spacing.sm }]}>
            <Text style={styles.scannerTitle}>Scan reward QR</Text>
            <Pressable
              style={styles.scannerClose}
              onPress={() => {
                setScannerOpen(false);
                setScanLocked(false);
              }}
            >
              <Ionicons name="close" size={20} color={palette.white} />
            </Pressable>
          </View>
          <View style={styles.scannerFrame}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
                onBarcodeScanned={(result) => {
                  if (!scannerOpen || scanLocked) {
                    return;
                  }

                  const universalLink = parseSfluvUniversalLink(result.data);
                  if (universalLink?.type === "redeem") {
                    setScanLocked(true);
                    setScanError(null);
                    setScannerOpen(false);
                    onRedeemCodeScanned?.(universalLink.code);
                    return;
                  }

                  setScanLocked(true);
                  setScanError("Unsupported QR. Scan a faucet reward QR code from the SFLUV web app.");
                  setTimeout(() => {
                    setScanLocked(false);
                  }, 900);
                }}
              />
            ) : (
              <View style={styles.permissionCard}>
                <Text style={styles.permissionTitle}>Camera access needed</Text>
                <Text style={styles.permissionBody}>Allow camera access to scan faucet reward QR codes here.</Text>
                <Pressable
                  style={styles.permissionButton}
                  onPress={() => {
                    void requestPermission();
                  }}
                >
                  <Text style={styles.permissionButtonText}>Enable camera</Text>
                </Pressable>
              </View>
            )}
            <View pointerEvents="none" style={styles.scannerGuide} />
          </View>
          <View style={styles.scannerFooter}>
            {scanLocked ? <ActivityIndicator size="small" color={palette.white} /> : null}
            <Text style={styles.scannerHint}>Center the faucet QR inside the frame to redeem it to this wallet.</Text>
          </View>
        </View>
      </Modal>
    </>
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
    heroCard: {
      backgroundColor: palette.primaryStrong,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadows.card,
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    heroIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.16)",
      alignItems: "center",
      justifyContent: "center",
    },
    subtitle: {
      color: "rgba(255,255,255,0.78)",
      lineHeight: 21,
    },
    heroCaption: {
      color: "rgba(255,255,255,0.68)",
      lineHeight: 20,
    },
    redeemButton: {
      minHeight: 42,
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      backgroundColor: "rgba(255,255,255,0.16)",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    redeemButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    scanErrorCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.danger,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      ...shadows.soft,
    },
    scanErrorText: {
      color: palette.danger,
      flex: 1,
      lineHeight: 20,
      fontWeight: "700",
    },
    addressCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      ...shadows.soft,
    },
    addressHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    sectionLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    addressText: {
      color: palette.text,
      marginTop: 8,
      fontSize: 16,
      fontWeight: "800",
      fontFamily: "Courier",
    },
    copyButton: {
      minHeight: 44,
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      backgroundColor: palette.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    copyButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    qrCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    qrHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    qrTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
    },
    qrMeta: {
      color: palette.textMuted,
      fontWeight: "700",
    },
    qrFrame: {
      alignSelf: "center",
      backgroundColor: palette.white,
      borderRadius: radii.lg,
      padding: 20,
      borderWidth: 1,
      borderColor: palette.border,
    },
    requestCard: {
      backgroundColor: palette.primarySoft,
      borderRadius: radii.lg,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: 14,
      paddingVertical: 14,
      backgroundColor: palette.surface,
      color: palette.text,
      fontSize: 16,
    },
    error: {
      color: palette.danger,
      fontWeight: "700",
    },
    shareCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: spacing.sm,
      ...shadows.soft,
    },
    mono: {
      color: palette.text,
      fontFamily: "Courier",
      lineHeight: 20,
    },
    scannerScreen: {
      flex: 1,
      backgroundColor: "rgba(8, 12, 20, 0.92)",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    scannerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
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
    permissionCard: {
      width: "100%",
      maxWidth: 320,
      backgroundColor: "rgba(255,255,255,0.08)",
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      alignItems: "center",
    },
    permissionTitle: {
      color: palette.white,
      fontSize: 18,
      fontWeight: "800",
    },
    permissionBody: {
      color: "rgba(255,255,255,0.76)",
      textAlign: "center",
      lineHeight: 20,
    },
    permissionButton: {
      marginTop: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryStrong,
    },
    permissionButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
  });
}
