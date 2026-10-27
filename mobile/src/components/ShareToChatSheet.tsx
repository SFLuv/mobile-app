import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";
import { Avatar } from "./BulletinParts";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { BulletinRequestError, Conversation } from "../types/bulletin";

/**
 * "Send this to…" — the Instagram-style share sheet.
 *
 * ── What it shares ──────────────────────────────────────────────────────────
 *
 * A reference, not a screenshot and not a link: a merchant, a volunteer event or
 * a transaction goes into the chat as the same card the chat already knows how
 * to render, which means the recipient taps it and lands on the real thing
 * inside the app rather than on a URL.
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

export function ShareToChatSheet({
  target,
  backendClient,
  hapticsEnabled,
  onClose,
  onShared,
  onToast,
}: {
  /** What to share, or null when the sheet is closed. */
  target: ShareTarget | null;
  backendClient: AppBackendClient | null;
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
              style={[styles.send, (selected.length === 0 || sending) && styles.sendDisabled]}
              onPress={() => void share()}
              disabled={selected.length === 0 || sending}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              <Ionicons name="arrow-up" size={19} color={palette.white} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
      paddingBottom: spacing.xxl,
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
  });
}
