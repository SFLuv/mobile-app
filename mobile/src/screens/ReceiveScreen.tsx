import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { ethers } from "ethers";
import { mobileConfig } from "../config";
import { buildEIP681TransferQR } from "../utils/qr";
import { palette, radii, spacing } from "../theme";

type Props = {
  accountAddress: string;
  chainId: number;
  tokenAddress: string;
};

export function ReceiveScreen({ accountAddress, chainId, tokenAddress }: Props) {
  const [amountSFLUV, setAmountSFLUV] = useState("");
  const [memo, setMemo] = useState("");

  const amountWei = useMemo(() => {
    const trimmed = amountSFLUV.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      return ethers.utils.parseUnits(trimmed, mobileConfig.tokenDecimals).toString();
    } catch {
      return undefined;
    }
  }, [amountSFLUV]);

  const qr = useMemo(
    () =>
      buildEIP681TransferQR({
        recipient: accountAddress,
        token: tokenAddress,
        amountWei,
        chainId,
        memo,
      }),
    [accountAddress, amountWei, chainId, memo, tokenAddress],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Receive SFLUV</Text>
      <Text style={styles.subtitle}>Share a clean payment request with an optional amount and note.</Text>

      <Pressable
        style={styles.copyButton}
        onPress={async () => {
          await Clipboard.setStringAsync(accountAddress);
          Alert.alert("Copied", "Address copied to clipboard.");
        }}
      >
        <Text style={styles.copyButtonText}>Copy Address</Text>
      </Pressable>

      <Text style={styles.address}>{accountAddress}</Text>

      <View style={styles.card}>
        <QRCode value={qr} size={220} />
      </View>

      <TextInput
        style={styles.input}
        value={amountSFLUV}
        onChangeText={setAmountSFLUV}
        placeholder="Optional amount in SFLUV"
        keyboardType="decimal-pad"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        value={memo}
        onChangeText={setMemo}
        placeholder="Optional payment note"
      />

      {amountSFLUV.trim() && !amountWei ? <Text style={styles.error}>Invalid SFLUV amount.</Text> : null}

      <Text style={styles.mono}>{qr}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  copyButton: {
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: palette.primary,
  },
  copyButtonText: { color: palette.white, fontWeight: "800" },
  address: {
    fontSize: 12,
    fontFamily: "Courier",
    color: palette.textMuted,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.sm,
    padding: 10,
  },
  card: {
    alignSelf: "center",
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.border,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.surface,
    color: palette.text,
  },
  error: { color: palette.danger },
  mono: { fontSize: 12, fontFamily: "Courier", color: palette.textMuted },
});
