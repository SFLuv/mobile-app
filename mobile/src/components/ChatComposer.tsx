import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { fileTypeIconFor } from "../utils/attachmentFiles";

/** SFLuv's own mark, so a staged payment names the currency it is in. */
const SFLUV_MARK = require("../../assets/qr-logo.png");

/**
 * The bottom of a chat: a text field, an attachment tray, and an amount pad.
 *
 * ── Three modes, one bar ────────────────────────────────────────────────────
 *
 * The composer is one row that becomes one of three things, rather than a row
 * with a growing collection of buttons crammed beside the text field:
 *
 *   "text"    the field and a send button
 *   "attach"  the field is REPLACED by a grid of options
 *   "amount"  the field is REPLACED by an amount pad
 *
 * Replacing rather than expanding is the iMessage/Telegram behaviour and the
 * reason it works on a small phone: the options get the full width instead of
 * three icons squeezed next to a shrinking text field. Tapping anywhere off the
 * tray brings the text field back, so no mode is a trap.
 *
 * ── Why "Send SFLUV" is a mode and not a screen ─────────────────────────────
 *
 * It used to open the wallet's send screen, which meant leaving the
 * conversation, filling in a form designed for paying a merchant, and coming
 * back. For paying the person you are already talking to, the amount is the only
 * thing not already known — so the composer becomes a keypad, the way Apple Cash
 * does it, and the transfer arrives as a message in the thread.
 *
 * Direct threads only. There is no single recipient in a group, so the option is
 * absent — and the server refuses it there too, rather than trusting this.
 */

export type ComposerMode = "text" | "attach" | "amount";

export type AttachmentOption = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Shown greyed with a reason, for anything this build cannot do. */
  disabledReason?: string;
};

export function ChatComposer({
  mode,
  onModeChange,
  draft,
  onDraftChange,
  onSend,
  sending,
  attachmentOptions,
  /** Omitted in groups, which removes the amount mode entirely. */
  onStageAmount,
  stagedPayment,
  onRemoveStagedPayment,
  tokenSymbol,
  availableBalance,
  replyingTo,
  onCancelReply,
  linkPreview,
  onDismissLinkPreview,
  stagedAttachments,
  onRemoveStaged,
  onCaretChange,
  hapticsEnabled,
  inputRef,
  placeholder = "Message",
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  attachmentOptions: AttachmentOption[];
  /**
   * Hands a composed amount back to be staged — it does NOT pay.
   *
   * The pad used to send straight from its own button, which made a transfer
   * the one thing in this composer with no review step. Now it stages, the
   * chip shows what will be sent, and the composer's send button is what
   * actually spends.
   */
  onStageAmount?: (amount: string, note: string) => void;
  /** A payment composed and waiting on the send button. */
  stagedPayment?: { amount: string; note: string } | null;
  onRemoveStagedPayment?: () => void;
  tokenSymbol: string;
  availableBalance?: string;
  replyingTo?: { id: number; senderName: string; body: string } | null;
  onCancelReply?: () => void;
  /**
   * A link found in the draft, with whatever metadata was scraped.
   *
   * Shown above the input, so the sender sees the card the recipient will get
   * before sending it. Replaces a "Link" button in the attachment tray — see
   * the note on linkPreview in ChatScreen for why detecting beats asking.
   */
  linkPreview?: {
    url: string;
    title: string;
    description: string;
    imageUrl: string;
    siteName: string;
  } | null;
  onDismissLinkPreview?: () => void;
  /**
   * Attachments picked but not yet sent, shown as thumbnails above the input.
   *
   * Picking used to send immediately, which left no moment to say anything
   * about the thing being sent. These sit here until the send button is
   * pressed, alongside whatever is typed.
   */
  stagedAttachments?: Array<{
    uri: string;
    fileName?: string | null;
    mimeType?: string | null;
    isImage: boolean;
  }>;
  onRemoveStaged?: (index: number) => void;
  /**
   * The caret position, reported on every selection change.
   *
   * It is what lets the draft be split around an attachment: text before where
   * the photo was inserted becomes its own message before it, text after
   * becomes its own after.
   */
  onCaretChange?: (position: number) => void;
  hapticsEnabled: boolean;
  inputRef?: React.RefObject<TextInput | null>;
  placeholder?: string;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  /**
   * The tray's entrance.
   *
   * ── Why it slides DOWN into view, not up ─────────────────────────────────
   *
   * Opening the tray dismisses the keyboard, and the keyboard leaves downward.
   * A tray that rose up as the keyboard fell would be two things crossing in
   * opposite directions in the same strip of screen, which is the "funky" part
   * — it reads as a fight rather than a handover.
   *
   * So the tray enters from above its own resting position and settles down
   * into the space the keyboard is vacating, travelling the same way the
   * keyboard is. The timing is matched to iOS's keyboard animation (250ms,
   * ease-out) rather than chosen for its own sake.
   */
  const trayEnter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const opening = mode !== "text";
    Animated.timing(trayEnter, {
      toValue: opening ? 1 : 0,
      duration: opening ? 250 : 160,
      easing: opening ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [mode, trayEnter]);

  const trayStyle = {
    opacity: trayEnter,
    transform: [
      {
        translateY: trayEnter.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }),
      },
    ],
  };

  return (
    <View style={styles.wrap}>
      {/* A composed payment, waiting on send. Deliberately the loudest chip in
          the composer: it is the only staged thing that spends money, and the
          amount should be unmissable before the send button is pressed. */}
      {stagedPayment ? (
        <View style={styles.stagedRow}>
          <View style={styles.paymentChip}>
            <View style={styles.paymentChipIcon}>
              <Image source={SFLUV_MARK} style={styles.paymentChipMark} resizeMode="contain" />
            </View>
            <View style={styles.paymentChipText}>
              <Text style={styles.paymentChipAmount} numberOfLines={1}>
                {stagedPayment.amount} {tokenSymbol}
              </Text>
              <Text style={styles.paymentChipMeta} numberOfLines={1}>
                {stagedPayment.note || "Sends when you hit send"}
              </Text>
            </View>
            <Pressable
              onPress={onRemoveStagedPayment}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove payment"
            >
              <Ionicons name="close" size={16} color={palette.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Staged attachments, as thumbnails. Topmost in the stack because they
          are the thing being sent; everything below is about it. */}
      {stagedAttachments?.length ? (
        <View style={styles.stagedRow}>
          {stagedAttachments.map((item, index) => (
            <View key={`${item.uri}:${index}`} style={styles.stagedItem}>
              {item.isImage ? (
                <Image source={{ uri: item.uri }} style={styles.stagedThumb} resizeMode="cover" />
              ) : (
                // ── Why a file chip is not a square thumbnail ────────────────
                //
                // It was: a 60pt box with the name at 8pt on one line, which
                // for "Richmond-DPW-invoice-2026-03.pdf" rendered as an
                // ellipsis. A file has no thumbnail to show, so the name IS
                // the preview and it has to be readable — hence a wider chip
                // with the type icon beside two lines of name.
                <View style={styles.stagedFile}>
                  <View style={styles.stagedFileIcon}>
                    <Ionicons
                      name={
                        fileTypeIconFor({
                          contentType: item.mimeType,
                          fileName: item.fileName,
                        }).icon as keyof typeof Ionicons.glyphMap
                      }
                      size={18}
                      color={palette.primaryStrong}
                    />
                  </View>
                  <View style={styles.stagedFileText}>
                    <Text style={styles.stagedFileName} numberOfLines={2}>
                      {item.fileName || "File"}
                    </Text>
                    <Text style={styles.stagedFileKind} numberOfLines={1}>
                      {
                        fileTypeIconFor({
                          contentType: item.mimeType,
                          fileName: item.fileName,
                        }).label
                      }
                    </Text>
                  </View>
                </View>
              )}
              <Pressable
                style={styles.stagedRemove}
                onPress={() => onRemoveStaged?.(index)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.fileName || "attachment"}`}
              >
                <Ionicons name="close" size={12} color={palette.white} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* The detected link's card. Above the reply bar so the stack reads
          bottom-up as: what I am sending, what I am replying to, the input. */}
      {linkPreview && mode === "text" ? (
        <View style={styles.linkCard}>
          {linkPreview.imageUrl ? (
            <Image source={{ uri: linkPreview.imageUrl }} style={styles.linkImage} resizeMode="cover" />
          ) : (
            <View style={[styles.linkImage, styles.linkImageFallback]}>
              <Ionicons name="link-outline" size={18} color={palette.textMuted} />
            </View>
          )}
          <View style={styles.linkText}>
            <Text style={styles.linkTitle} numberOfLines={1}>
              {/* A link whose page we could not read still shows, as the bare
                  host — so "recognised but not previewable" is visibly
                  different from "not recognised". */}
              {linkPreview.title || hostOf(linkPreview.url)}
            </Text>
            <Text style={styles.linkMeta} numberOfLines={2}>
              {linkPreview.description || linkPreview.siteName || linkPreview.url}
            </Text>
          </View>
          <Pressable
            onPress={onDismissLinkPreview}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Don't send a link preview"
          >
            <Ionicons name="close" size={16} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {replyingTo ? (
        <View style={styles.replyBar}>
          <View style={styles.replyStripe} />
          <View style={styles.replyText}>
            <Text style={styles.replyName} numberOfLines={1}>
              {replyingTo.senderName}
            </Text>
            <Text style={styles.replyBody} numberOfLines={1}>
              {replyingTo.body}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={16} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {mode === "amount" && onStageAmount ? (
        <Animated.View style={trayStyle}>
        <AmountPad
          tokenSymbol={tokenSymbol}
          availableBalance={availableBalance}
          hapticsEnabled={hapticsEnabled}
          onCancel={() => onModeChange("text")}
          onStage={onStageAmount}
        />
        </Animated.View>
      ) : mode === "attach" ? (
        <Animated.View style={[styles.tray, trayStyle]}>
          <View style={styles.trayGrid}>
            {attachmentOptions.map((option) => (
              <Pressable
                key={option.id}
                style={[styles.trayOption, option.disabledReason ? styles.trayOptionDisabled : undefined]}
                onPress={() => {
                  if (option.disabledReason) {
                    return;
                  }
                  triggerClickHaptic(hapticsEnabled);
                  option.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityHint={option.disabledReason}
              >
                <View style={styles.trayIcon}>
                  <Ionicons name={option.icon} size={22} color={palette.primaryStrong} />
                </View>
                <Text style={styles.trayLabel} numberOfLines={2}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.trayClose}
            onPress={() => onModeChange("text")}
            accessibilityRole="button"
            accessibilityLabel="Close attachment options"
          >
            <Text style={styles.trayCloseText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      ) : (
        <View style={styles.bar}>
          <Pressable
            style={styles.plusButton}
            onPress={() => {
              triggerClickHaptic(hapticsEnabled);
              onModeChange("attach");
            }}
            accessibilityRole="button"
            accessibilityLabel="Attach something"
          >
            <Ionicons name="add" size={22} color={palette.primaryStrong} />
          </Pressable>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={onDraftChange}
            onSelectionChange={(event) => onCaretChange?.(event.nativeEvent.selection.start)}
            placeholder={placeholder}
            placeholderTextColor={palette.textMuted}
            multiline
            maxLength={2000}
          />
          <Pressable
            // Sendable with staged attachments and no text: a photo on its own
            // is a message.
            style={[
              styles.sendButton,
              (!draft.trim() && !stagedAttachments?.length && !stagedPayment) || sending
                ? styles.sendButtonIdle
                : undefined,
            ]}
            onPress={() => void onSend()}
            disabled={(!draft.trim() && !stagedAttachments?.length && !stagedPayment) || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Ionicons name="arrow-up" size={18} color={palette.white} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * The amount pad.
 *
 * Its own keypad rather than a TextInput with a numeric keyboard, for the reason
 * Apple Cash has one: the amount is the whole interaction, so it should be the
 * whole screen area, in digits big enough to check at a glance before sending
 * money. A system number pad would also put a "done" key where a decimal point
 * belongs on some locales.
 */
function AmountPad({
  tokenSymbol,
  availableBalance,
  hapticsEnabled,
  onCancel,
  onStage,
}: {
  tokenSymbol: string;
  availableBalance?: string;
  hapticsEnabled: boolean;
  onCancel: () => void;
  onStage: (amount: string, note: string) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const press = (key: string) => {
    triggerClickHaptic(hapticsEnabled);
    setError(null);
    setAmount((current) => {
      if (key === "del") {
        return current.slice(0, -1);
      }
      if (key === ".") {
        // One decimal point, and never a leading one.
        return current.includes(".") ? current : current === "" ? "0." : current + ".";
      }
      // Two decimal places: the token has six, but nobody hands somebody
      // 1.234567 of anything, and a long tail here is almost always a slip.
      const [, decimals] = current.split(".");
      if (decimals !== undefined && decimals.length >= 2) {
        return current;
      }
      if (current === "0" && key !== ".") {
        return key;
      }
      // A cap on digits, so the display cannot be pushed out of its own row.
      if (current.replace(".", "").length >= 9) {
        return current;
      }
      return current + key;
    });
  };

  const numeric = Number(amount);
  const balance = availableBalance ? Number(availableBalance) : undefined;
  const overBalance = balance !== undefined && Number.isFinite(balance) && numeric > balance;
  const ready = Number.isFinite(numeric) && numeric > 0 && !overBalance;

  const stage = () => {
    if (!ready) {
      return;
    }
    setError(null);
    onStage(amount, note.trim());
  };

  return (
    <View style={styles.pad}>
      <View style={styles.padHeader}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Cancel payment">
          <Ionicons name="chevron-down" size={22} color={palette.textMuted} />
        </Pressable>
        <Text style={styles.padTitle}>Send {tokenSymbol}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.padAmountRow}>
        <Text style={styles.padAmount} numberOfLines={1} adjustsFontSizeToFit>
          {amount || "0"}
        </Text>
        <Text style={styles.padSymbol}>{tokenSymbol}</Text>
      </View>
      {overBalance ? (
        <Text style={styles.padError}>That&apos;s more than your balance.</Text>
      ) : availableBalance ? (
        <Text style={styles.padBalance}>
          {availableBalance} {tokenSymbol} available
        </Text>
      ) : null}

      <TextInput
        style={styles.padNote}
        value={note}
        onChangeText={setNote}
        placeholder="What's it for? (optional)"
        placeholderTextColor={palette.textMuted}
        maxLength={200}
      />

      <View style={styles.padKeys}>
        {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "del"]].map((row) => (
          <View key={row.join()} style={styles.padRow}>
            {row.map((key) => (
              <Pressable
                key={key}
                style={styles.padKey}
                onPress={() => press(key)}
                accessibilityRole="button"
                accessibilityLabel={key === "del" ? "Delete" : key}
              >
                {key === "del" ? (
                  <Ionicons name="backspace-outline" size={20} color={palette.text} />
                ) : (
                  <Text style={styles.padKeyText}>{key}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      {error ? <Text style={styles.padError}>{error}</Text> : null}

      {/* "Attach", not "Send": nothing is spent by this button. It is the same
          word the rest of the composer uses for staging something, and the
          send button below is the one that moves money. */}
      <Pressable
        style={[styles.padSend, !ready && styles.padSendDisabled]}
        onPress={stage}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={`Attach a payment of ${amount || "0"} ${tokenSymbol}`}
      >
        <Text style={styles.padSendText}>{`Attach ${amount || "0"} ${tokenSymbol}`}</Text>
      </Pressable>
    </View>
  );
}

/** The host of a URL, for a card with no scraped title. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    wrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      backgroundColor: palette.background,
    },
    bar: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    plusButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      minHeight: 36,
      maxHeight: 120,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === "ios" ? 9 : 6,
      fontSize: 15,
      color: palette.text,
    },
    sendButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonIdle: { opacity: 0.4 },

    paymentChip: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.primarySoft,
      backgroundColor: palette.primaryMuted,
    },
    paymentChipIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surface,
    },
    paymentChipMark: { width: 20, height: 20 },
    paymentChipText: { flex: 1 },
    paymentChipAmount: { fontSize: 15, fontWeight: "800", color: palette.text },
    paymentChipMeta: { fontSize: 11, color: palette.textMuted, marginTop: 1 },

    stagedRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    stagedItem: { position: "relative" },
    stagedThumb: {
      width: 60,
      height: 60,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceStrong,
    },
    stagedFile: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      // Wide enough for a real filename on two lines, and the same height as
      // an image thumbnail so a mixed batch sits on one baseline.
      width: 176,
      height: 60,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceStrong,
    },
    stagedFileIcon: {
      width: 32,
      height: 32,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryMuted,
    },
    stagedFileText: { flex: 1 },
    stagedFileName: { fontSize: 11, fontWeight: "600", color: palette.text },
    stagedFileKind: { fontSize: 10, color: palette.textMuted, marginTop: 1 },
    stagedRemove: {
      position: "absolute",
      top: -5,
      right: -5,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: palette.navy,
      alignItems: "center",
      justifyContent: "center",
    },
    linkCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.xs,
      borderRadius: radii.md,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    linkImage: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: palette.surfaceStrong },
    linkImageFallback: { alignItems: "center", justifyContent: "center" },
    linkText: { flex: 1 },
    linkTitle: { fontSize: 13, fontWeight: "600", color: palette.text },
    linkMeta: { fontSize: 12, color: palette.textMuted, marginTop: 1 },
    replyBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    replyStripe: { width: 3, height: 32, borderRadius: 2, backgroundColor: palette.primary },
    replyText: { flex: 1 },
    replyName: { fontSize: 12, fontWeight: "700", color: palette.primaryStrong },
    replyBody: { fontSize: 13, color: palette.textMuted, marginTop: 1 },

    tray: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    trayGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    trayOption: {
      // Four across on a narrow phone, with the gap accounted for, so nothing
      // is clipped on a 320pt screen.
      width: "22%",
      minWidth: 68,
      alignItems: "center",
      paddingVertical: spacing.sm,
    },
    trayOptionDisabled: { opacity: 0.35 },
    trayIcon: {
      width: 48,
      height: 48,
      borderRadius: radii.md,
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    trayLabel: { fontSize: 11, color: palette.textMuted, textAlign: "center" },
    trayClose: { alignItems: "center", paddingVertical: spacing.sm },
    trayCloseText: { fontSize: 14, color: palette.textMuted, fontWeight: "600" },

    pad: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
    padHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
    },
    padTitle: { fontSize: 15, fontWeight: "700", color: palette.text },
    padAmountRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "center",
      gap: 6,
      marginTop: spacing.xs,
    },
    padAmount: { fontSize: 44, fontWeight: "700", color: palette.text, fontVariant: ["tabular-nums"] },
    padSymbol: { fontSize: 18, fontWeight: "600", color: palette.textMuted },
    padBalance: { fontSize: 12, color: palette.textMuted, textAlign: "center", marginTop: 4 },
    padError: { fontSize: 12, color: palette.danger, textAlign: "center", marginTop: 4 },
    padNote: {
      marginTop: spacing.sm,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 14,
      paddingVertical: 9,
      fontSize: 14,
      color: palette.text,
    },
    padKeys: { marginTop: spacing.sm },
    padRow: { flexDirection: "row" },
    padKey: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 11 },
    padKeyText: { fontSize: 24, fontWeight: "500", color: palette.text, fontVariant: ["tabular-nums"] },
    padSend: {
      marginTop: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingVertical: 13,
      alignItems: "center",
    },
    padSendDisabled: { opacity: 0.4 },
    padSendText: { color: palette.white, fontWeight: "700", fontSize: 15 },
  });
}
