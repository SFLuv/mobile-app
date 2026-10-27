import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Avatar, BadgeLine, CATEGORY_ICONS, formatAgo } from "../components/BulletinParts";
import { attachmentKindLabel } from "../components/MessageAttachmentCard";
import { useDockLift } from "../hooks/useDockLift";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import type { RealtimeEvent } from "../services/realtime";
import { Conversation, PublicUser } from "../types/bulletin";

/**
 * The inbox.
 *
 * ── What moved out of here ──────────────────────────────────────────────────
 *
 * The thread used to be a modal rendered by this screen. It is now a screen the
 * shell pushes, for the reasons in ChatScreen's own header — chiefly that a
 * modal cannot be swiped back and the app's top bar stayed above it.
 *
 * The consequence for this file is that it no longer owns "which conversation is
 * open". It reports a tap upward and the shell decides; this screen is a list.
 */

type Segment = "chats" | "contacts";

const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: "chats", label: "Chats" },
  { value: "contacts", label: "Contacts" },
];

/**
 * The safety net under the inbox, not its main source: the socket pushes new
 * messages the moment they land. Fifteen seconds rather than the four it was
 * before the socket existed.
 */
const INBOX_POLL_MS = 15_000;

type Props = {
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled: boolean;
  /** The existing contacts screen, shown under the Contacts segment. */
  contactsElement: React.ReactNode;
  requestedSegment?: Segment;
  requestedSegmentNonce?: number;
  /**
   * Whether the account has a public profile yet.
   *
   * The gate is the shell's to show — it is the thing that sends somebody back
   * to the tab they came from, which this screen cannot do — so all this screen
   * does is report that it was opened.
   */
  onChatsOpened?: () => void;
  /** How many conversations have something unread. Drives the dock badge. */
  onUnreadChange?: (count: number) => void;
  onOpenConversation: (conversationId: number) => void;
  onStartConversation: (userId: string) => void;
  onNewMessage: () => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
};

export function MessagesScreen({
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  contactsElement,
  requestedSegment,
  requestedSegmentNonce,
  onChatsOpened,
  onUnreadChange,
  onOpenConversation,
  onStartConversation,
  onNewMessage,
  subscribe,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const { ref: screenRef, onLayout, lift } = useDockLift();

  const [segment, setSegment] = useState<Segment>(requestedSegment ?? "chats");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [merchantResults, setMerchantResults] = useState<
    Array<{ location_id: number; name: string; owner_user_id: string }>
  >([]);

  useEffect(() => {
    if (requestedSegment) {
      setSegment(requestedSegment);
    }
  }, [requestedSegment, requestedSegmentNonce]);

  // Reported every time the Chats segment is looked at, so the shell can put
  // the profile gate up on the first one.
  useEffect(() => {
    if (segment === "chats") {
      onChatsOpened?.();
    }
  }, [onChatsOpened, segment]);

  const loadInbox = useCallback(async () => {
    if (!backendClient) {
      return;
    }
    try {
      const inbox = await backendClient.getConversations();
      setConversations(inbox);
      // Conversations with something unread, not messages: two unread messages
      // in one thread are one thing to go and read, and that is what the
      // server's own summary counts — so the number does not jump when the
      // shell takes the count back over.
      onUnreadChange?.(inbox.filter((conversation) => conversation.unread_count > 0).length);
    } catch {
      // Left as it was. A dropped request is not an empty inbox, and it is not
      // a cleared badge either.
      setConversations((current) => current ?? []);
    }
  }, [backendClient, onUnreadChange]);

  useEffect(() => {
    void loadInbox();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void loadInbox();
      }
    }, INBOX_POLL_MS);
    return () => clearInterval(interval);
  }, [loadInbox]);

  // A message, a read receipt or a membership change anywhere re-reads the
  // inbox. Cheap, and it means the list is never behind the thread.
  useEffect(() => {
    return subscribe((event) => {
      if (
        event.kind === "message.new" ||
        event.kind === "conversation.updated" ||
        event.kind === "conversation.read"
      ) {
        void loadInbox();
      }
    });
  }, [loadInbox, subscribe]);

  useEffect(() => {
    const text = query.trim();
    if (!backendClient || text.replace(/^@/, "").length < 2) {
      setResults(null);
      setMerchantResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void backendClient
        .searchSFLuvUsers(text)
        .then((found) => {
          setResults(found.users);
          setMerchantResults(found.merchants);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [backendClient, query]);

  const searching = query.trim().replace(/^@/, "").length >= 2;

  const previewFor = (conversation: Conversation): string => {
    const last = conversation.last_message;
    if (!last) {
      return "";
    }
    const who = last.is_mine
      ? "You: "
      : conversation.kind === "group" && last.sender_name
        ? `${last.sender_name}: `
        : "";
    if (last.kind === "system") {
      return last.body;
    }
    if (last.kind === "payment") {
      const amount = formatSfluvAmount(last.amount_sfluv_base);
      return last.is_mine
        ? `You sent ${amount} ${tokenSymbol}`.replace("  ", " ")
        : `Sent you ${amount} ${tokenSymbol}`.replace("  ", " ");
    }
    if (!last.body?.trim() && last.attachments?.length) {
      return who + attachmentKindLabel(last.attachments[0].kind);
    }
    return who + (last.body ?? "");
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const isGroup = item.kind === "group";
    const title = isGroup ? item.title || "Group" : item.other_user.public_name;
    const unread = item.unread_count > 0;

    return (
      <Pressable
        style={styles.row}
        onPress={() => {
          triggerClickHaptic(hapticsEnabled);
          onOpenConversation(item.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={unread ? `${title}, unread` : title}
      >
        <Avatar name={title} />
        <View style={[styles.rowBody, item.other_user_inactive ? styles.rowInactive : undefined]}>
          <View style={styles.rowTop}>
            <View style={styles.rowTitleWrap}>
              {isGroup ? (
                <Ionicons name="people" size={13} color={palette.textMuted} />
              ) : null}
              <Text style={[styles.rowName, unread && styles.rowNameUnread]} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <Text style={styles.rowTime}>{formatAgo(item.last_message_at)}</Text>
          </View>
          <View style={styles.rowPreviewLine}>
            {item.post ? (
              <Ionicons name={CATEGORY_ICONS[item.post.category]} size={13} color={palette.textMuted} />
            ) : null}
            <Text style={[styles.rowPreview, unread && styles.rowPreviewUnread]} numberOfLines={1}>
              {/* Greyed is not self-explanatory, so the row says why. */}
              {item.other_user_inactive
                ? "Can't receive messages right now"
                : `${item.post ? `${item.post.title} · ` : ""}${previewFor(item)}`}
            </Text>
          </View>
        </View>
        {/* The per-chat unread dot. The tab's own badge is the count of rows
            that have one, which the shell reads from onUnreadChange. */}
        {unread ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>
              {item.unread_count > 9 ? "9+" : item.unread_count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View ref={screenRef} style={styles.screen} onLayout={onLayout}>
      <View style={styles.top}>
        <SegmentedTabs
          segments={SEGMENTS}
          value={segment}
          onChange={setSegment}
          hapticsEnabled={hapticsEnabled}
        />
      </View>

      {segment === "contacts" ? (
        <View style={{ flex: 1 }}>{contactsElement}</View>
      ) : (
        <>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={palette.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people on SFLuv"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={palette.textMuted} />
              </Pressable>
            ) : null}
            {/* The profile icon that used to sit here is gone: editing your
                public profile now lives on the Profile tab, which is where
                somebody looks for it. */}
          </View>

          {searching ? (
            <FlatList
              data={[
                ...(results ?? []).map((user) => ({
                  key: `u:${user.user_id}`,
                  userId: user.user_id,
                  title: user.public_name,
                  user: user as PublicUser | null,
                })),
                ...merchantResults.map((merchant) => ({
                  key: `m:${merchant.location_id}`,
                  userId: merchant.owner_user_id,
                  title: merchant.name,
                  user: null as PublicUser | null,
                })),
              ]}
              keyExtractor={(item) => item.key}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: styles.listContent.paddingBottom + lift },
              ]}
              ListEmptyComponent={
                results === null ? (
                  <View style={styles.centerState}>
                    <ThemedActivityIndicator />
                  </View>
                ) : (
                  <Text style={styles.emptyBody}>
                    No one found. People only show up here if they&apos;ve chosen to be findable, if
                    you search their exact @username, or if they&apos;re already one of your
                    contacts.
                  </Text>
                )
              }
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => onStartConversation(item.userId)}>
                  <Avatar name={item.title} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{item.title}</Text>
                    {item.user?.saved_contact ? (
                      <Text style={styles.rowContact}>In your contacts</Text>
                    ) : item.user ? (
                      <BadgeLine user={item.user} />
                    ) : (
                      <Text style={styles.rowPreview}>Merchant</Text>
                    )}
                  </View>
                  <Ionicons name="chatbubble-outline" size={18} color={palette.textMuted} />
                </Pressable>
              )}
            />
          ) : (
            <FlatList
              data={conversations ?? []}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderConversation}
              contentContainerStyle={[
                styles.listContent,
                // Clears the floating button and, on a Home-button phone, the
                // dock as well. See useDockLift.
                { paddingBottom: styles.listContent.paddingBottom + lift + 72 },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  tintColor={palette.primary}
                  onRefresh={() => {
                    setRefreshing(true);
                    void loadInbox().finally(() => setRefreshing(false));
                  }}
                />
              }
              ListEmptyComponent={
                conversations === null ? (
                  <View style={styles.centerState}>
                    <ThemedActivityIndicator />
                  </View>
                ) : (
                  <View style={styles.centerState}>
                    <Ionicons name="chatbubbles-outline" size={32} color={palette.textMuted} />
                    <Text style={styles.emptyTitle}>No messages yet</Text>
                    <Text style={styles.emptyBody}>
                      Tap the button below to start a chat, or message someone from a Bulletin post.
                    </Text>
                  </View>
                )
              }
            />
          )}

          {/* The new-message button, matching the Contacts tab's.
              `lift` is what keeps it off the dock on a Home-button phone — the
              same measurement both tabs use, from one hook, so a fix to one is
              a fix to both. */}
          {!searching ? (
            <Pressable
              style={[styles.fab, { bottom: styles.fab.bottom + lift }]}
              onPress={() => {
                triggerClickHaptic(hapticsEnabled);
                onNewMessage();
              }}
              accessibilityRole="button"
              accessibilityLabel="New message"
            >
              <Ionicons name="create-outline" size={23} color={palette.white} />
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

export function formatSfluvAmount(base?: string | null): string {
  if (!base) return "";
  const value = Number(base) / 1_000_000;
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    top: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: palette.text },
    listContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },

    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    rowBody: { flex: 1 },
    rowInactive: { opacity: 0.55 },
    rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    rowTitleWrap: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
    rowName: { fontSize: 15, fontWeight: "600", color: palette.text, flexShrink: 1 },
    rowNameUnread: { fontWeight: "800" },
    rowTime: { fontSize: 12, color: palette.textMuted },
    rowPreviewLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
    rowPreview: { flex: 1, fontSize: 13, color: palette.textMuted },
    rowPreviewUnread: { color: palette.text, fontWeight: "600" },
    rowContact: { fontSize: 12, color: palette.primaryStrong, marginTop: 2, fontWeight: "600" },

    unreadBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 5,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    unreadBadgeText: { color: palette.white, fontSize: 11, fontWeight: "800" },

    centerState: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    emptyBody: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 19,
      paddingHorizontal: spacing.lg,
    },

    fab: {
      position: "absolute",
      right: spacing.lg,
      bottom: spacing.lg,
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      ...shadows.card,
    },
  });
}
