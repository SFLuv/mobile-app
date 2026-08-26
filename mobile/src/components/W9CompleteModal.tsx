import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Palette, radii, spacing, useAppTheme } from "../theme";

type Props = {
  visible: boolean;
  /**
   * What was being held when the form was opened, formatted, e.g. "100".
   * Empty when nothing was held — which is the common case for somebody who
   * files at the first warning, before anything has been withheld.
   */
  releasedSfluv: string;
  tokenSymbol: string;
  onDismiss: () => void;
};

/**
 * The end of the tax detour, and the only screen in it that is good news.
 *
 * Every other W-9 surface is a warning of some kind — approaching a limit,
 * money held, a reward refused. Somebody who has just filed has done the thing
 * all of those were asking for, and hearing nothing back is its own small
 * failure: they are left wondering whether it took, and whether the money that
 * was stuck is still stuck.
 *
 * Rendered in the view tree rather than as a Modal, and that is load-bearing.
 * A React Native Modal is a UIKit modal presentation, and iOS will present only
 * one at a time from the same view controller. This one arrives exactly as the
 * tier modal is dismissing — the filing clearing is what removes the tier —
 * so presenting it was silently refused, every time, through the button. The
 * state was correct and nothing was drawn.
 *
 * So this says three things, in order of what people actually want to know:
 * the form is in, the money that was held is on its way, and rewards work
 * normally again. The middle one is omitted rather than reworded when nothing
 * was held, because "0 SFLUV has been released" invites the question of where
 * it went.
 */
export function W9CompleteModal({ visible, releasedSfluv, tokenSymbol, onDismiss }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const released = releasedSfluv.trim();
  const hadEscrow = released !== "" && released !== "0";

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Pressable style={styles.overlay} onPress={onDismiss} accessible={false}>
        <Pressable style={styles.card} onPress={() => {}} accessible={false}>
          <View style={[styles.iconWrap, { backgroundColor: `${palette.success}1f` }]}>
            <Ionicons name="checkmark-circle" size={44} color={palette.success} />
          </View>

          <Text style={styles.title}>Your W-9 is on file</Text>

          {hadEscrow ? (
            <>
              <Text style={styles.amount}>
                {released} {tokenSymbol}
              </Text>
              <Text style={styles.body}>
                has been released from hold and sent to your wallet.
              </Text>
            </>
          ) : null}

          <Text style={styles.body}>
            {hadEscrow
              ? "Nothing is being held any more, and future rewards will arrive as normal."
              : "Nothing is being held, and your rewards will arrive as normal."}
          </Text>

          <Pressable
            style={styles.primaryButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    // Covers the window and sits above the app's own chrome. zIndex rather
    // than elevation: this only ever runs on iOS's renderer.
    host: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1000,
    },
    overlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      alignItems: "center",
      gap: spacing.md,
    },
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "900",
      textAlign: "center",
    },
    amount: {
      color: palette.success,
      fontSize: 26,
      fontWeight: "900",
      textAlign: "center",
    },
    body: {
      color: palette.textMuted,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
    },
    primaryButton: {
      marginTop: spacing.sm,
      alignSelf: "stretch",
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: "center",
      backgroundColor: palette.success,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 15,
      fontWeight: "800",
    },
  });
}
