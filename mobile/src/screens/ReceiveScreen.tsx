import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Constants from "expo-constants";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { ScannerCornerGuide } from "../components/ScannerCornerGuide";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { buildUniversalPayLink, parseSfluvUniversalLink } from "../utils/universalLinks";

type Props = {
  accountAddress: string;
  onRedeemCodeScanned?: (code: string) => void;
};

type ReceiveMode = "link" | "address";

function shortAddress(address: string): string {
  if (!address) {
    return "";
  }
  if (address.length <= 20) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

function shortLink(rawValue: string): string {
  try {
    const parsed = new URL(rawValue);
    if (parsed.pathname.startsWith("/pay/")) {
      const encodedAddress = decodeURIComponent(parsed.pathname.slice(5));
      return `${parsed.host}/pay/${shortAddress(encodedAddress)}`;
    }
    const compact = `${parsed.host}${parsed.pathname}${parsed.search}`;
    if (compact.length <= 44) {
      return compact;
    }
    return `${compact.slice(0, 22)}...${compact.slice(-18)}`;
  } catch {
    if (rawValue.length <= 44) {
      return rawValue;
    }
    return `${rawValue.slice(0, 22)}...${rawValue.slice(-18)}`;
  }
}

export function ReceiveScreen({ accountAddress, onRedeemCodeScanned }: Props) {
  const { palette, shadows } = useAppTheme();
  const windowFrame = useWindowDimensions();
  const compactLayout = windowFrame.height < 740;
  const styles = useMemo(() => createStyles(palette, shadows, compactLayout), [compactLayout, palette, shadows]);
  const topInset = Math.max(Constants.statusBarHeight, Platform.OS === "ios" ? spacing.md : 0);
  const qrSize = Math.min(
    Math.max(
      Math.min(windowFrame.width - (compactLayout ? 116 : 136), windowFrame.height * (compactLayout ? 0.24 : 0.28)),
      compactLayout ? 156 : 176,
    ),
    compactLayout ? 190 : 216,
  );

  const [mode, setMode] = useState<ReceiveMode>("link");
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

  useEffect(() => {
    setCopied(false);
  }, [mode]);

  const paymentLink = useMemo(() => buildUniversalPayLink({ address: accountAddress }), [accountAddress]);
  const qrValue = mode === "link" ? paymentLink : accountAddress;
  const qrCaption = mode === "link" ? shortLink(paymentLink) : shortAddress(accountAddress);

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

  const copyQrValue = async () => {
    await Clipboard.setStringAsync(qrValue);
    setCopied(true);
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyResetTimeoutRef.current = null;
    }, 2200);
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.modeToggle}>
            <Pressable
              style={[styles.modeButton, mode === "link" ? styles.modeButtonActive : undefined]}
              onPress={() => setMode("link")}
            >
              <Text style={[styles.modeButtonText, mode === "link" ? styles.modeButtonTextActive : undefined]}>Link</Text>
            </Pressable>
            <Pressable
              style={[styles.modeButton, mode === "address" ? styles.modeButtonActive : undefined]}
              onPress={() => setMode("address")}
            >
              <Text style={[styles.modeButtonText, mode === "address" ? styles.modeButtonTextActive : undefined]}>
                Address
              </Text>
            </Pressable>
          </View>

          {scanError ? (
            <View style={styles.scanErrorCard}>
              <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
              <Text style={styles.scanErrorText}>{scanError}</Text>
            </View>
          ) : null}

          <View style={styles.qrCard}>
            <View style={styles.qrHeader}>
              <Text style={styles.qrTitle}>{mode === "link" ? "Payment link" : "Wallet address"}</Text>
              <Pressable style={styles.copyButton} onPress={() => void copyQrValue()}>
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={palette.primaryStrong} />
                <Text style={styles.copyButtonText}>{copied ? "Copied" : "Copy"}</Text>
              </Pressable>
            </View>

            <View style={styles.qrFrame}>
              <QRCode value={qrValue} size={qrSize} backgroundColor={palette.white} color="#111111" />
            </View>

            <Text style={styles.qrCaption} numberOfLines={1} ellipsizeMode="middle">
              {qrCaption}
            </Text>
          </View>
        </View>

        <Pressable style={styles.redeemButton} onPress={() => void openRedeemScanner()}>
          <Ionicons name="scan-outline" size={18} color={palette.white} />
          <Text style={styles.redeemButtonText}>Redeem code</Text>
        </Pressable>
      </View>

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
          <View style={[styles.scannerHeader, { paddingTop: topInset + spacing.xxl + spacing.md }]}>
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
            <ScannerCornerGuide color={palette.primaryStrong} />
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

function createStyles(
  palette: Palette,
  shadows: ReturnType<typeof getShadows>,
  compactLayout = false,
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: compactLayout ? spacing.sm : spacing.md,
      paddingBottom: compactLayout ? spacing.sm : spacing.lg,
      gap: compactLayout ? spacing.sm : spacing.md,
    },
    content: {
      flex: 1,
      minHeight: 0,
      gap: compactLayout ? spacing.sm : spacing.md,
    },
    modeToggle: {
      flexDirection: "row",
      gap: spacing.xs,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    modeButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
    },
    modeButtonActive: {
      backgroundColor: palette.primary,
    },
    modeButtonText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },
    modeButtonTextActive: {
      color: palette.white,
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
    qrCard: {
      flex: 1,
      minHeight: 0,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: compactLayout ? spacing.sm : spacing.md,
      gap: compactLayout ? spacing.xs : spacing.sm,
      justifyContent: "space-between",
      ...shadows.soft,
    },
    qrHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    qrTitle: {
      flex: 1,
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
    },
    copyButton: {
      minHeight: 40,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      backgroundColor: palette.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    copyButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 13,
    },
    qrFrame: {
      alignSelf: "center",
      maxWidth: "100%",
      backgroundColor: palette.white,
      borderRadius: radii.lg,
      padding: compactLayout ? 12 : 16,
      borderWidth: 1,
      borderColor: palette.border,
    },
    qrCaption: {
      color: palette.textMuted,
      fontSize: 11,
      lineHeight: 14,
      textAlign: "center",
    },
    redeemButton: {
      minHeight: compactLayout ? 48 : 52,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      backgroundColor: palette.primary,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      ...shadows.soft,
    },
    redeemButtonText: {
      color: palette.white,
      fontWeight: "800",
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
