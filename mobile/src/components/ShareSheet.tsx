import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { AppBackendClient } from "../services/appBackend";
import type { AppClientConfig } from "../types/app";
import {
  buildUniversalEventLink,
  buildUniversalMerchantLink,
  buildUniversalTransactionLink,
} from "../utils/universalLinks";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";
import { Avatar } from "./BulletinParts";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { BulletinRequestError, Conversation } from "../types/bulletin";

/**
 * The share sheet: three routes out of one tray.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * The Instagram/TikTok arrangement, because it is the one people already know:
 * a row of chats to send to across the top, then the generic actions — copy the
 * link, or hand off to the OS share menu.
 *
 * It replaces a sheet that could only do the first of those. "Send to a chat"
 * was the whole component, which made it useless to anybody sharing outside
 * SFLuv — the common case for a merchant or an event, where the point is
 * usually to tell somebody who is not on the app yet.
 *
 * ── What travels ────────────────────────────────────────────────────────────
 *
 * Internally: a reference, not a link. The chat renders the same card it
 * renders for anything else, so the recipient taps it and lands on the real
 * thing inside the app.
 *
 * Externally: a universal link. Someone with the app installed opens the thing;
 * someone without it gets the web page behind that path, or a prompt to install
 * for the kinds that have no public page. A transaction is deliberately in the
 * second group — see the note on the `transaction` link type.
 *
 * ── Why several chats at once ───────────────────────────────────────────────
 *
 * Because sharing an event is usually sharing it with the two people you would
 * go with. Doing them one at a time means opening this sheet twice, and the
 * second time is where people give up.
 *
 * Each goes as its own message, posted in sequence. A failure on one is reported
 * and the others still go: half-shared is better than nothing shared, and the
 * sheet says which ones did not make it.
 */

export type ShareTarget =
  | { kind: "merchant"; locationId: number; label: string }
  | { kind: "event"; eventId: string; label: string }
  | { kind: "transaction"; txHash: string; label: string };

/**
 * Whether a target has somewhere public to land.
 *
 * A merchant listing and a volunteer event are things we publish, so their
 * links are worth sending to somebody who does not have the app. A transaction
 * is not — there is no public page for one and inventing one would publish
 * somebody's payment history — so its link only makes sense to a person who
 * can open it in the app, and the sheet says so rather than implying otherwise.
 */
function hasPublicLanding(target: ShareTarget): boolean {
  return target.kind !== "transaction";
}

export function ShareSheet({
  target,
  backendClient,
  clientConfig,
  hapticsEnabled,
  onClose,
  onShared,
  onToast,
}: {
  /** What to share, or null when the sheet is closed. */
  target: ShareTarget | null;
  backendClient: AppBackendClient | null;
  /** Needed to build the universal link that copy and external share hand out. */
  clientConfig: AppClientConfig;
  hapticsEnabled: boolean;
  onClose: () => void;
  /** Lets the caller offer "View" — the sheet itself does not navigate. */
  onShared: (conversationIds: number[]) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!target || !backendClient) {
      return;
    }
    setSelected([]);
    setNote("");
    setConversations(null);
    let cancelled = false;
    void backendClient
      .getConversations()
      .then((inbox) => {
        if (!cancelled) {
          setConversations(inbox);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendClient, target]);

  /**
   * The universal link for whatever is being shared.
   *
   * Built here rather than passed in, so every entry point produces the same
   * link for the same thing — a caller that built its own would be a second
   * place for the URL shape to drift.
   */
  const shareLink = useMemo(() => {
    if (!target) {
      return "";
    }
    try {
      switch (target.kind) {
        case "event":
          return buildUniversalEventLink({ eventId: target.eventId }, clientConfig);
        case "merchant":
          return buildUniversalMerchantLink({ locationId: target.locationId }, clientConfig);
        case "transaction":
          return buildUniversalTransactionLink({ txHash: target.txHash }, clientConfig);
      }
    } catch {
      // A malformed id. Better to hide the link actions than hand out a URL
      // that goes nowhere.
      return "";
    }
  }, [clientConfig, target]);

  const copyLink = async () => {
    if (!shareLink) {
      return;
    }
    triggerClickHaptic(hapticsEnabled);
    await Clipboard.setStringAsync(shareLink);
    onToast(
      hasPublicLanding(target!)
        ? "Link copied."
        : "Link copied. It opens in SFLuv for people who have the app.",
      "success",
    );
    onClose();
  };

  const shareExternally = async () => {
    if (!shareLink || !target) {
      return;
    }
    triggerClickHaptic(hapticsEnabled);
    // Closed first: the OS share sheet is itself a presented view, and opening
    // it from under our own Modal is the same stacking problem that froze the
    // app when this sheet was opened from the merchant modal.
    onClose();
    requestAnimationFrame(() => {
      void Share.share({
        message: `${target.label} — ${shareLink}`,
        // iOS shows `url` separately and some targets prefer it; Android
        // ignores it and uses `message`.
        url: shareLink,
      }).catch(() => {
        // Dismissed, or no share targets. Nothing to recover.
      });
    });
  };

  const toggle = (id: number) => {
    triggerClickHaptic(hapticsEnabled);
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const share = async () => {
    if (!backendClient || !target || selected.length === 0 || sending) {
      return;
    }
    setSending(true);
    const sent: number[] = [];
    const failed: number[] = [];

    for (const conversationId of selected) {
      try {
        await backendClient.attachConversationReference(conversationId, {
          kind: target.kind,
          body: note.trim() || undefined,
          location_id: target.kind === "merchant" ? target.locationId : undefined,
          event_id: target.kind === "event" ? target.eventId : undefined,
          tx_hash: target.kind === "transaction" ? target.txHash : undefined,
        });
        sent.push(conversationId);
      } catch (e) {
        failed.push(conversationId);
        if (e instanceof BulletinRequestError && e.code === "blocked") {
          // Worth saying once rather than per chat: the reason is about that
          // relationship, not about what is being shared.
          onToast(e.message, "error");
        }
      }
    }

    setSending(false);
    if (sent.length > 0) {
      onToast(
        failed.length === 0
          ? `Sent to ${sent.length === 1 ? "1 chat" : `${sent.length} chats`}.`
          : `Sent to ${sent.length} of ${selected.length} chats.`,
        failed.length === 0 ? "success" : "info",
      );
      onShared(sent);
      onClose();
      return;
    }
    onToast("Couldn't share that. Try again.", "error");
  };

  const title = (conversation: Conversation) =>
    conversation.kind === "group"
      ? conversation.title || "Group"
      : conversation.other_user.public_name;

  return (
    <Modal
      visible={Boolean(target)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Send to…</Text>
              {target ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {target.label}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={palette.textMuted} />
            </Pressable>
          </View>

          <FlatList
            data={conversations ?? []}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              conversations === null ? (
                <View style={styles.empty}>
                  <ThemedActivityIndicator />
                </View>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="chatbubbles-outline" size={26} color={palette.textMuted} />
                  <Text style={styles.emptyText}>
                    No chats yet. Start one from Messages and you can share things into it.
                  </Text>
                </View>
              )
            }
            renderItem={({ item }) => {
              const chosen = selected.includes(item.id);
              // A chat with somebody who cannot read messages is not a place to
              // send something, so it is shown greyed rather than hidden —
              // hiding it would read as the chat having disappeared.
              const unavailable = item.kind === "direct" && item.other_user_inactive;
              return (
                <Pressable
                  style={[styles.row, unavailable && styles.rowDisabled]}
                  onPress={() => !unavailable && toggle(item.id)}
                  disabled={unavailable}
                  accessibilityRole="button"
                  accessibilityLabel={title(item)}
                >
                  <Avatar name={title(item)} size={38} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {title(item)}
                    </Text>
                    {item.kind === "group" ? (
                      <Text style={styles.rowMeta}>
                        {item.member_count ?? 0} people
                      </Text>
                    ) : unavailable ? (
                      <Text style={styles.rowMeta}>Can&apos;t receive messages right now</Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={chosen ? "checkmark-circle" : "ellipse-outline"}
                    size={21}
                    color={chosen ? palette.primary : palette.borderStrong}
                  />
                </Pressable>
              );
            }}
          />

          {/* The composer row only matters once a chat is picked. Hidden
              otherwise, so the sheet opens as "share this" rather than as a
              message form with an inert send button. */}
          {selected.length > 0 ? (
            <View style={styles.footer}>
              <TextInput
                style={styles.note}
                value={note}
                onChangeText={setNote}
                placeholder="Add a message (optional)"
                placeholderTextColor={palette.textMuted}
                maxLength={2000}
              />
              <Pressable
                style={[styles.send, sending && styles.sendDisabled]}
                onPress={() => void share()}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${selected.length === 1 ? "1 chat" : `${selected.length} chats`}`}
              >
                <Ionicons name="arrow-up" size={19} color={palette.white} />
              </Pressable>
            </View>
          ) : null}

          {/* The generic routes out. Always available, and the reason this is a
              share sheet rather than a send-to-chat sheet: for a merchant or an
              event the person you want to tell is often not on SFLuv yet. */}
          {shareLink ? (
            <View style={styles.actions}>
              <ShareAction icon="link-outline" label="Copy link" onPress={() => void copyLink()} />
              <ShareAction
                icon="share-outline"
                label="Share"
                onPress={() => void shareExternally()}
              />
            </View>
          ) : null}

          {target && !hasPublicLanding(target) ? (
            <Text style={styles.linkNote}>
              This link opens in SFLuv. People without the app will be asked to install it.
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function ShareAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      style={{ alignItems: "center", gap: 6, flex: 1, paddingVertical: spacing.sm }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: palette.surfaceStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={palette.text} />
      </View>
      <Text style={{ fontSize: 12, color: palette.textMuted }}>{label}</Text>
    </Pressable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" },
    card: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingTop: spacing.md,
      maxHeight: "80%",
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    title: { fontSize: 17, fontWeight: "700", color: palette.text },
    subtitle: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
    list: { paddingHorizontal: spacing.lg },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    rowDisabled: { opacity: 0.45 },
    rowBody: { flex: 1 },
    rowName: { fontSize: 15, fontWeight: "600", color: palette.text },
    rowMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    empty: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm },
    emptyText: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 19,
      paddingHorizontal: spacing.lg,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    note: {
      flex: 1,
      borderRadius: radii.lg,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: palette.text,
    },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },
    actions: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    linkNote: {
      fontSize: 12,
      color: palette.textMuted,
      textAlign: "center",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      marginTop: -spacing.lg,
    },
  });
}
