import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { useStuckWatch } from "../services/observability";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { BadgeLine, CATEGORY_ICONS, formatAgo } from "../components/BulletinParts";
import { ChatAvatar } from "../components/ChatAvatar";
import { cachedInbox, forgetThread, saveInbox } from "../services/chatCache";
import { peekLinkPreview } from "../services/linkPreviews";
import { firstLink, hostOf, isSameLink } from "../utils/links";
import { attachmentKindLabel } from "../components/MessageAttachmentCard";
import { SwipeableRow } from "../components/SwipeableRow";
import { useDockLift } from "../hooks/useDockLift";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { useContactNames } from "../services/contactOverrides";
import { triggerClickHaptic } from "../utils/haptics";
import type { RealtimeEvent } from "../services/realtime";
import { BulletinRequestError, Conversation, MessageAttachment, PublicUser } from "../types/bulletin";
import { displayFileName } from "../utils/attachmentFiles";

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
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
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
  onToast,
  subscribe,
}: Props) {
  const { palette, shadows } = useAppTheme();
  // What you saved people as in Contacts wins over their own name.
  const nameFor = useContactNames();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const { ref: screenRef, onLayout, lift } = useDockLift();

  const [segment, setSegment] = useState<Segment>(requestedSegment ?? "chats");
  // Drawn from the chat cache on the first frame, so the tab opens on the
  // inbox it showed last time rather than a spinner — on a cold start and on
  // every return to the tab, since tabs remount. The network replaces it.
  const [conversations, setConversations] = useState<Conversation[] | null>(() => cachedInbox());
  /**
   * Whether `conversations` is something worth writing back: a server answer,
   * the cache itself, or a local patch to either. Not the empty list a failed
   * first load falls back to — saving that would open the next launch on an
   * empty inbox that was never true.
   */
  const inboxTrusted = useRef(conversations !== null);
  useEffect(() => {
    if (conversations && inboxTrusted.current) {
      saveInbox(conversations);
    }
  }, [conversations]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[] | null>(null);
  useStuckWatch("messages: load conversations", segment === "chats" && conversations === null);
  const [merchantResults, setMerchantResults] = useState<
    Array<{ location_id: number; name: string; owner_user_id: string }>
  >([]);
  /**
   * The conversation a swipe action is asking about.
   *
   * Every action here is destructive or sticky enough to confirm — deleting for
   * everybody removes a thread from somebody else's phone, and "mute forever"
   * is easy to forget you did. The sheet names what each option actually does
   * rather than relying on the button's own label.
   */
  const [rowAction, setRowAction] = useState<{
    conversation: Conversation;
    kind: "delete" | "mute";
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

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

  /**
   * Guards against an older inbox read landing after a newer one.
   *
   * Two things call `loadInbox`: a 15-second poll and every `message.new`,
   * `conversation.read` or `conversation.updated` frame off the socket. In a
   * busy thread those overlap constantly, responses are not ordered, and
   * `setConversations` took whichever finished last. A read issued before the
   * newest message therefore overwrote one issued after it, and the row sat on
   * a preview one or two messages behind the thread until something happened to
   * trigger another read — which is exactly what it looked like from outside.
   *
   * A counter rather than an AbortController: the stale response is already
   * paid for by the time it is recognised, and all that matters is that it is
   * not allowed to win.
   */
  const inboxSeq = useRef(0);

  const loadInbox = useCallback(async () => {
    if (!backendClient) {
      return;
    }
    const seq = ++inboxSeq.current;
    try {
      const inbox = await backendClient.getConversations();
      if (seq !== inboxSeq.current) {
        return;
      }
      inboxTrusted.current = true;
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
  //
  // One read at a time, with at most one more queued behind it. Issued per
  // frame, a busy group's frames arrived faster than a round trip, every
  // response was superseded by the next request before it landed, and the
  // list did not move until the stream paused. Queued, every read completes
  // and the last one always starts after the latest frame.
  const inboxReading = useRef(false);
  const inboxReadAgain = useRef(false);
  const requestInboxRef = useRef<() => void>(() => {});
  requestInboxRef.current = () => {
    if (inboxReading.current) {
      inboxReadAgain.current = true;
      return;
    }
    inboxReading.current = true;
    void loadInbox().finally(() => {
      inboxReading.current = false;
      if (inboxReadAgain.current) {
        inboxReadAgain.current = false;
        requestInboxRef.current();
      }
    });
  };
  useEffect(() => {
    return subscribe((event) => {
      if (
        event.kind === "message.new" ||
        event.kind === "conversation.updated" ||
        event.kind === "conversation.read"
      ) {
        requestInboxRef.current();
      }
    });
  }, [subscribe]);

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

  /**
   * The one line under a conversation's name.
   *
   * ── Why every kind gets its own sentence ─────────────────────────────────
   *
   * A row whose preview is blank, or just "Attachment", tells somebody nothing
   * about whether it is worth opening — and most of what gets sent in this app
   * is not plain text. A shared merchant, a volunteer event, a payment, a
   * photo, somebody joining a group: each is a different reason to look, so
   * each says what it is.
   *
   * Written from the reader's side throughout. "You sent 5 SFLUV", not
   * "payment"; "Maria shared an event", not "attachment:event".
   */
  /** Mutes for a number of minutes, or clears it when minutes is 0. */
  const changeMute = async (conversation: Conversation, minutes: number) => {
    if (!backendClient || actionBusy) {
      return;
    }
    setActionBusy(true);
    try {
      await backendClient.muteConversation(conversation.id, minutes);
      // Patched locally so the row's bell flips immediately; the next inbox
      // read confirms it.
      setConversations((current) =>
        (current ?? []).map((entry) =>
          entry.id === conversation.id ? { ...entry, muted: minutes > 0 } : entry,
        ),
      );
      setRowAction(null);
    } catch {
      onToast("Couldn't change notifications for that conversation.", "error");
    } finally {
      setActionBusy(false);
    }
  };

  /** Removes a conversation from the inbox, by whichever route was chosen. */
  const runDelete = async (
    conversation: Conversation,
    mode: "me" | "everyone" | "leave" | "leave-and-clear",
  ) => {
    if (!backendClient || actionBusy) {
      return;
    }
    setActionBusy(true);
    try {
      if (mode === "me") {
        // Archiving. The thread and its history come back intact the moment
        // either person sends again, which is exactly what was asked for.
        await backendClient.archiveConversation(conversation.id);
      } else if (mode === "everyone") {
        await backendClient.deleteConversationForEveryone(conversation.id);
      } else {
        await backendClient.leaveGroup(conversation.id, mode === "leave-and-clear");
      }
      setConversations((current) => (current ?? []).filter((entry) => entry.id !== conversation.id));
      forgetThread(conversation.id);
      setRowAction(null);
      void loadInbox();
    } catch (e) {
      onToast(
        e instanceof BulletinRequestError ? e.message : "Couldn't do that. Try again.",
        "error",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const previewFor = (conversation: Conversation): string => {
    const last = conversation.last_message;
    if (!last) {
      return "";
    }

    // A reaction newer than the last message IS the latest activity, so it is
    // what the row describes. The server only sets this when that is the case.
    const reaction = conversation.latest_reaction;
    if (reaction) {
      const who = reaction.is_mine ? "You" : reaction.user_name || "Someone";
      const what = reaction.message_excerpt?.trim();
      return what
        ? `${who} reacted ${reaction.emoji} to "${what}"`
        : `${who} reacted ${reaction.emoji} to a message`;
    }

    // A system line is already a complete sentence about the thread —
    // "Maria added Sam" — so it is never prefixed with who caused it.
    if (last.kind === "system") {
      return last.body;
    }

    if (last.kind === "payment") {
      const amount = formatSfluvAmount(last.amount_sfluv_base);
      const sent = last.is_mine
        ? `You sent ${amount} ${tokenSymbol}`
        : `Sent you ${amount} ${tokenSymbol}`;
      // The note, when there is one, is the informative half.
      return last.body?.trim() ? `${sent} · ${last.body.trim()}` : sent.replace(/\s+/g, " ");
    }

    // In a group the speaker matters; in a direct thread the row's own name
    // already says who the other person is, so only "You" is worth marking.
    const who = last.is_mine
      ? "You: "
      : conversation.kind === "group" && last.sender_name
        ? `${nameFor(last.sender_id, last.sender_name)}: `
        : "";

    const attachment = last.attachments?.[0];
    if (attachment) {
      const caption = last.body?.trim();
      // A caption is what the sender chose to say, so it wins over our label —
      // with the kind kept as a prefix so the row still shows what came with it.
      const label = attachmentPreviewLabel(attachment, last.attachments?.length ?? 1);
      return who + (caption ? `${label} · ${caption}` : label);
    }

    return who + textPreview(last.body?.trim() ?? "");
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const isGroup = item.kind === "group";
    const title = isGroup ? item.title || "Group" : nameFor(item.other_user.user_id, item.other_user.public_name);
    const unread = item.unread_count > 0;

    return (
      <SwipeableRow
        hapticsEnabled={hapticsEnabled}
        actions={[
          {
            key: "mute",
            // The icon states the CURRENT state's inverse, which is what the
            // button does — a bell-off on an unmuted row, a bell on a muted one.
            label: item.muted ? "Unmute" : "Mute",
            icon: item.muted ? "notifications" : "notifications-off",
            tone: "neutral",
            onPress: () => {
              if (item.muted) {
                // Already muted: the action is simply to stop, so there is
                // nothing to ask.
                void changeMute(item, 0);
                return;
              }
              setRowAction({ conversation: item, kind: "mute" });
            },
          },
          {
            key: "delete",
            // A group is left, not deleted — the conversation belongs to
            // everybody in it, and the icon says which of the two this is.
            label: isGroup ? "Leave" : "Delete",
            icon: isGroup ? "exit-outline" : "trash-outline",
            tone: "danger",
            onPress: () => setRowAction({ conversation: item, kind: "delete" }),
          },
        ]}
      >
      <Pressable
        style={styles.row}
        onPress={() => {
          triggerClickHaptic(hapticsEnabled);
          onOpenConversation(item.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={unread ? `${title}, unread` : title}
      >
        {/* 48 rather than the default 36: an inbox row is the one place the
            picture does identification work, and iMessage's is about this
            size relative to its two lines of text. The person's own picture,
            or the group's, over their initials. */}
        <ChatAvatar
          client={backendClient}
          name={title}
          size={48}
          userId={isGroup ? null : item.other_user.user_id}
          conversationId={isGroup ? item.id : null}
          iconAttachmentId={isGroup ? item.icon_attachment_id : null}
        />
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
            <Text style={[styles.rowPreview, unread && styles.rowPreviewUnread]} numberOfLines={2}>
              {/* Greyed is not self-explanatory, so the row says why. */}
              {item.other_user_inactive
                ? "Can't receive messages right now"
                : `${item.post ? `${item.post.title} · ` : ""}${previewFor(item)}`}
            </Text>
          </View>
        </View>
        {/* The per-chat unread dot. The tab's own badge is the count of rows
            that have one, which the shell reads from onUnreadChange. */}
        {/* A muted thread still shows its unread count — muting silences the
            phone, it does not pretend nothing arrived. The bell says why it
            was quiet. */}
        {item.muted ? (
          <Ionicons name="notifications-off" size={14} color={palette.textMuted} />
        ) : null}
        {unread ? (
          <View style={[styles.unreadBadge, item.muted && styles.unreadBadgeMuted]}>
            <Text style={styles.unreadBadgeText}>
              {item.unread_count > 9 ? "9+" : item.unread_count}
            </Text>
          </View>
        ) : null}
      </Pressable>
      </SwipeableRow>
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

      {/* ── The swipe actions' confirmations ──────────────────────────────
          Centred sheets rather than Alerts, because each option needs a
          sentence explaining what it actually does: "delete for both" removes
          a conversation from somebody else's phone, and that is not obvious
          from a two-word button. */}
      <Modal
        visible={rowAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRowAction(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setRowAction(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {rowAction?.kind === "mute" ? (
              <>
                <Text style={styles.sheetTitle}>Mute notifications</Text>
                <Text style={styles.sheetBody}>
                  Messages still arrive and still show as unread — your phone just
                  won&apos;t buzz.
                </Text>
                {[
                  { label: "For one hour", minutes: 60 },
                  { label: "For a day", minutes: 60 * 24 },
                  // A hundred years. The server caps it; "forever" is a long
                  // deadline rather than a separate mode.
                  { label: "Until I turn it back on", minutes: 60 * 24 * 365 * 100 },
                ].map((option) => (
                  <Pressable
                    key={option.label}
                    style={styles.sheetOption}
                    disabled={actionBusy}
                    onPress={() => void changeMute(rowAction.conversation, option.minutes)}
                  >
                    <Ionicons name="notifications-off-outline" size={18} color={palette.text} />
                    <Text style={styles.sheetOptionText}>{option.label}</Text>
                  </Pressable>
                ))}
              </>
            ) : rowAction?.conversation.kind === "group" ? (
              <>
                <Text style={styles.sheetTitle}>Leave this group?</Text>
                <Text style={styles.sheetBody}>
                  You&apos;ll stop receiving its messages. The group carries on without
                  you.
                </Text>
                <Pressable
                  style={styles.sheetOption}
                  disabled={actionBusy}
                  onPress={() => void runDelete(rowAction.conversation, "leave")}
                >
                  <Ionicons name="exit-outline" size={18} color={palette.text} />
                  <Text style={styles.sheetOptionText}>Leave</Text>
                </Pressable>
                <Pressable
                  style={styles.sheetOption}
                  disabled={actionBusy}
                  onPress={() => void runDelete(rowAction.conversation, "leave-and-clear")}
                >
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetOptionText, { color: palette.danger }]}>
                      Delete my messages and leave
                    </Text>
                    <Text style={styles.sheetOptionHint}>
                      Everything you sent shows as deleted to the people still there.
                    </Text>
                  </View>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>Delete this conversation?</Text>
                <Pressable
                  style={styles.sheetOption}
                  disabled={actionBusy}
                  onPress={() => void runDelete(rowAction!.conversation, "me")}
                >
                  <Ionicons name="eye-off-outline" size={18} color={palette.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetOptionText}>Delete for me</Text>
                    <Text style={styles.sheetOptionHint}>
                      Hides it from your inbox. It comes back, with its history, if
                      either of you sends a message.
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.sheetOption}
                  disabled={actionBusy}
                  onPress={() => void runDelete(rowAction!.conversation, "everyone")}
                >
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetOptionText, { color: palette.danger }]}>
                      Delete for both of us
                    </Text>
                    <Text style={styles.sheetOptionHint}>
                      Removes it from their inbox too. This can&apos;t be undone.
                    </Text>
                  </View>
                </Pressable>
              </>
            )}
            <Pressable style={styles.sheetCancel} onPress={() => setRowAction(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
                  title: nameFor(user.user_id, user.public_name),
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
                  <ChatAvatar client={backendClient} name={item.title} userId={item.userId} />
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
              extraData={nameFor}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderConversation}
              // Hairlines between rows, inset past the avatar so the line
              // starts where the text does — the iMessage arrangement, and what
              // makes a list of rows read as discrete items rather than one
              // continuous block of text.
              ItemSeparatorComponent={() => <View style={styles.separator} />}
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

/**
 * What an attachment reads as in a one-line preview.
 *
 * Names the THING rather than the mechanism: somebody scanning their inbox
 * wants "Shared a merchant", not "attachment". The count is used only for
 * photos and files, where sending several at once is normal.
 */
function attachmentPreviewLabel(attachment: MessageAttachment, count: number): string {
  switch (attachment.kind) {
    case "image":
      return count > 1 ? `📷 ${count} photos` : "📷 Photo";
    case "file":
      return count > 1 ? `📎 ${count} files` : `📎 ${displayFileName(attachment.file_name) || "File"}`;
    case "link":
      return `🔗 ${attachment.link_title || attachment.link_site_name || "Link"}`;
    case "transaction":
      return "🧾 Shared a transaction";
    case "merchant":
      return `📍 Shared ${attachment.location_name || "a merchant"}`;
    case "event":
      return `📅 Shared ${attachment.event_title || "an event"}`;
    case "support":
      return "About your message to SFLuv";
    default:
      // A kind this build does not know, from a newer server. Named rather
      // than blank, so the row is still worth tapping.
      return attachmentKindLabel(attachment.kind);
  }
}

/**
 * A text message's one-line preview.
 *
 * Links are sent as plain text now and rendered as cards in the thread, so a
 * message that is nothing but a link would otherwise preview as a raw
 * "https://…". It reads as the link instead — the page's title if this device
 * has already fetched the card, its host if not — matching what the push for
 * the same message said. A link inside a sentence leaves the sentence alone.
 */
function textPreview(body: string): string {
  const link = firstLink(body);
  if (!link || !isSameLink(body, link)) {
    return body;
  }
  return `🔗 ${peekLinkPreview(link)?.title || hostOf(link)}`;
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

    row: {
      flexDirection: "row",
      // Top rather than centre: with two lines of preview, centring makes the
      // name float away from the top of the avatar.
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      minHeight: 72,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.border,
      // Inset by the avatar's width plus the row gap, so the line begins under
      // the text rather than cutting across the pictures.
      marginLeft: 48 + spacing.sm,
    },
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
    unreadBadgeMuted: { backgroundColor: palette.borderStrong },

    centerState: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    emptyBody: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 19,
      paddingHorizontal: spacing.lg,
    },

    sheetBackdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    sheet: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      padding: spacing.lg,
    },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: palette.text, marginBottom: 4 },
    sheetBody: { fontSize: 13, color: palette.textMuted, lineHeight: 19, marginBottom: spacing.sm },
    sheetOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 13,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    sheetOptionText: { fontSize: 15, fontWeight: "600", color: palette.text },
    sheetOptionHint: { fontSize: 12, color: palette.textMuted, marginTop: 2, lineHeight: 17 },
    sheetCancel: { alignItems: "center", paddingTop: spacing.md },
    sheetCancelText: { fontSize: 15, fontWeight: "600", color: palette.textMuted },
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
