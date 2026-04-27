import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Easing,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { TransactionDetailPayload } from "../utils/transactions";

type Props = {
  visible: boolean;
  details: TransactionDetailPayload | null;
  onClose: () => void;
};

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function signedAmount(details: TransactionDetailPayload): string {
  return `${details.received ? "+" : "-"}${details.transaction.amountFormatted} SFLUV`;
}

function explorerUrl(hash: string): string {
  return `https://berascan.com/tx/${hash}`;
}

export function TransactionDetailsModal({ visible, details, onClose }: Props) {
  const { palette, shadows } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mounted, setMounted] = useState(visible && Boolean(details));
  const [renderedDetails, setRenderedDetails] = useState<TransactionDetailPayload | null>(details);
  const progress = useRef(new Animated.Value(visible && details ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!copiedField) {
      return;
    }
    const timeout = setTimeout(() => {
      setCopiedField(null);
    }, 2000);
    return () => {
      clearTimeout(timeout);
    };
  }, [copiedField]);

  useEffect(() => {
    if (visible && details) {
      setRenderedDetails(details);
      setMounted(true);
    }
  }, [details, visible]);

  useEffect(() => {
    progress.stopAnimation();
    dragY.stopAnimation();

    if (visible && details) {
      dragY.setValue(0);
      scrollYRef.current = 0;
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!mounted) {
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        dragY.setValue(0);
        setMounted(false);
        setRenderedDetails(null);
      }
    });
  }, [details, dragY, mounted, progress, visible]);

  const resetDrag = useMemo(
    () => () => {
      Animated.spring(dragY, {
        toValue: 0,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    },
    [dragY],
  );

  const createDismissPanResponder = useMemo(
    () => (allowFromScrolledContent: boolean) =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          visible &&
          gestureState.dy > 4 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) &&
          (allowFromScrolledContent || scrollYRef.current <= 1),
        onMoveShouldSetPanResponder: (_, gestureState) =>
          visible &&
          gestureState.dy > 4 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) &&
          (allowFromScrolledContent || scrollYRef.current <= 1),
        onPanResponderGrant: () => {
          dragY.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          dragY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          const shouldClose = gestureState.dy > 72 || (gestureState.dy > 24 && gestureState.vy > 0.65);
          if (shouldClose) {
            Animated.timing(dragY, {
              toValue: windowHeight,
              duration: 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => onClose());
            return;
          }
          resetDrag();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: resetDrag,
      }),
    [dragY, onClose, resetDrag, visible, windowHeight],
  );

  const headerPanResponder = useMemo(() => createDismissPanResponder(true), [createDismissPanResponder]);
  const sheetPanResponder = useMemo(() => createDismissPanResponder(false), [createDismissPanResponder]);

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [windowHeight, 0],
    }),
    dragY,
  );

  if (!mounted || !renderedDetails) {
    return null;
  }

  const copyField = async (value: string, field: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedField(field);
  };

  return (
    <Modal visible={mounted} animationType="none" presentationStyle="overFullScreen" statusBarTranslucent transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdropPressTarget} onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>

        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]} {...sheetPanResponder.panHandlers}>
          <View collapsable={false} style={styles.headerGestureZone} {...headerPanResponder.panHandlers}>
            <View style={styles.dragHandle} />
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Transaction Details</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{renderedDetails.typeLabel}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={palette.white} />
                    <Text style={styles.statusBadgeText}>{renderedDetails.statusLabel}</Text>
                  </View>
                </View>
              </View>
              <Pressable style={styles.closeIconButton} onPress={onClose}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollYRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
            }}
          >
            <View style={styles.amountCard}>
              <Text style={[styles.amountText, renderedDetails.received ? styles.amountReceive : styles.amountSend]}>
                {signedAmount(renderedDetails)}
              </Text>
              <Text style={styles.amountDate}>{formatDate(renderedDetails.transaction.timestamp)}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>From</Text>
              <Text style={styles.sectionTitle}>{renderedDetails.fromLabel}</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeText}>{renderedDetails.transaction.from}</Text>
                <Pressable style={styles.copyButton} onPress={() => void copyField(renderedDetails.transaction.from, "from")}>
                  <Ionicons
                    name={copiedField === "from" ? "checkmark-circle" : "copy-outline"}
                    size={16}
                    color={copiedField === "from" ? palette.success : palette.primaryStrong}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>To</Text>
              <Text style={styles.sectionTitle}>{renderedDetails.toLabel}</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeText}>{renderedDetails.transaction.to}</Text>
                <Pressable style={styles.copyButton} onPress={() => void copyField(renderedDetails.transaction.to, "to")}>
                  <Ionicons
                    name={copiedField === "to" ? "checkmark-circle" : "copy-outline"}
                    size={16}
                    color={copiedField === "to" ? palette.success : palette.primaryStrong}
                  />
                </Pressable>
              </View>
            </View>

            {renderedDetails.transaction.memo ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Memo</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.memoText}>{renderedDetails.transaction.memo}</Text>
                  <Pressable style={styles.copyButton} onPress={() => void copyField(renderedDetails.transaction.memo || "", "memo")}>
                    <Ionicons
                      name={copiedField === "memo" ? "checkmark-circle" : "copy-outline"}
                      size={16}
                      color={copiedField === "memo" ? palette.success : palette.primaryStrong}
                    />
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Transaction ID</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeText}>{renderedDetails.transaction.hash}</Text>
                <Pressable style={styles.copyButton} onPress={() => void copyField(renderedDetails.transaction.hash, "hash")}>
                  <Ionicons
                    name={copiedField === "hash" ? "checkmark-circle" : "copy-outline"}
                    size={16}
                    color={copiedField === "hash" ? palette.success : palette.primaryStrong}
                  />
                </Pressable>
              </View>
              <Pressable
                style={styles.inlineExplorerButton}
                onPress={() => {
                  void Linking.openURL(explorerUrl(renderedDetails.transaction.hash));
                }}
              >
                <Ionicons name="open-outline" size={16} color={palette.primaryStrong} />
                <Text style={styles.inlineExplorerButtonText}>View on Explorer</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    modalRoot: {
      flex: 1,
    },
    backdropPressTarget: {
      ...StyleSheet.absoluteFillObject,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: palette.overlay,
    },
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: palette.background,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      maxHeight: "90%",
      gap: spacing.md,
      ...shadows.card,
    },
    scrollArea: {
      flexShrink: 1,
    },
    container: {
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerGestureZone: {
      paddingTop: spacing.sm,
      gap: spacing.md,
    },
    dragHandle: {
      alignSelf: "center",
      width: 44,
      height: 5,
      borderRadius: radii.pill,
      backgroundColor: palette.borderStrong,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    headerCopy: {
      flex: 1,
      gap: spacing.sm,
    },
    title: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "900",
    },
    badgeRow: {
      flexDirection: "row",
      gap: spacing.xs,
      flexWrap: "wrap",
    },
    typeBadge: {
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    typeBadgeText: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 12,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      backgroundColor: palette.success,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    statusBadgeText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 12,
    },
    closeIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    amountCard: {
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: spacing.lg,
      gap: spacing.xs,
      alignItems: "center",
      ...shadows.soft,
    },
    amountText: {
      fontSize: 30,
      fontWeight: "900",
      textAlign: "center",
    },
    amountReceive: {
      color: palette.success,
    },
    amountSend: {
      color: palette.primaryStrong,
    },
    amountDate: {
      color: palette.textMuted,
      fontSize: 13,
      textAlign: "center",
    },
    section: {
      gap: spacing.xs,
    },
    sectionLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    codeRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    codeText: {
      flex: 1,
      color: palette.textMuted,
      fontFamily: "Courier",
      fontSize: 12,
      lineHeight: 18,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    memoText: {
      flex: 1,
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 19,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    copyButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    inlineExplorerButton: {
      marginTop: spacing.sm,
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    inlineExplorerButtonText: {
      color: palette.primaryStrong,
      fontWeight: "800",
      fontSize: 12,
    },
  });
}
