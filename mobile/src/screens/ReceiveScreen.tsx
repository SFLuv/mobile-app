import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { ethers } from "ethers";
import { mobileConfig } from "../config";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { buildUniversalRequestLink } from "../utils/universalLinks";

type Props = {
  accountAddress: string;
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

export function ReceiveScreen({ accountAddress }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [amountSFLUV, setAmountSFLUV] = useState("");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState(false);
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

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Ionicons name="download-outline" size={20} color={palette.white} />
        </View>
        <Text style={styles.subtitle}>Show this QR or share the link to request payment instantly.</Text>
      </View>

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
  });
}
