import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Avatar, BadgeLine } from "../components/BulletinParts";
import {
  MessageAttachmentCard,
  attachmentKindLabel,
  type AttachmentHandlers,
} from "../components/MessageAttachmentCard";
import { ChatComposer, type AttachmentOption, type ComposerMode } from "../components/ChatComposer";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { pickDocuments } from "../utils/documentPicker";
import type { RealtimeEvent } from "../services/realtime";
import { useTypingIndicators, useTypingReporter } from "../hooks/useRealtime";
import {
  BulletinRequestError,
  ChatMessage,
  Conversation,
  MessageAttachment,
} from "../types/bulletin";

/**
 * One conversation, as a screen.
 *
 * ── Why this is a screen and not the modal it replaces ──────────────────────
 *
 * It was a pageSheet modal, which brought three problems that are all really the
 * same problem — a modal is not part of the navigation stack:
 *
 *   - It could not be swiped back, only pulled down by its handle.
 *   - The app's top bar stayed visible above it, so the chat had two headers.
 *   - The keyboard fought it. A transparent-background modal is not moved by
 *     iOS for the keyboard, which is why the composer overlapped it on some
 *     devices.
 *
 * As a screen it gets the swipe-back gesture every other pushed screen has, one
 * header, and a KeyboardAvoidingView that works.
 *
 * ── The inverted list, which is the keyboard fix ────────────────────────────
 *
 * The list is `inverted`, so index 0 is the NEWEST message and the list's
 * natural resting position is the bottom. That is what makes the Telegram
 * behaviour fall out for free: whatever is bottom-most stays pinned just above
 * the composer, the keyboard opening pushes the composer up and the content with
 * it, and scrolling up through history still works while the keyboard is open.
 *
 * The version this replaces was a normal list with
 * `onContentSizeChange -> scrollToEnd`, which is the thing that misbehaved: the
 * keyboard changes the content size, so opening it fired a scroll, which fought
 * whatever the person was reading. Inverting removes the scroll-to-bottom call
 * entirely rather than trying to time it better.
 *
 * ── Opens with the keyboard up ─────────────────────────────────────────────
 *
 * Because opening a chat is nearly always opening it to say something. The
 * exception is a thread reached from a notification, where the person came to
 * READ — so that case is passed `autoFocus: false` by the shell.
 */

/** iMessage's six, which cover almost every reaction anybody actually sends. */
const DEFAULT_REACTIONS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

/** A wider set behind "more", so the picker needs no native dependency. */
const MORE_REACTIONS = [
  "🙏", "🎉", "🔥", "😮", "😢", "😡", "👀", "💪", "🤝", "✅",
  "🌮", "☕", "🚲", "🌱", "🏡", "💰", "⭐", "🫶", "😅", "🤔",
];

const THREAD_POLL_MS = 15_000;

type Props = {
  conversationId: number;
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled: boolean;
  /** Available balance, for the amount pad. Already display-formatted. */
  availableBalance?: string;
  /** False when the chat was reached from a notification: they came to read. */
  autoFocus?: boolean;
  /**
   * A line to prefill the composer with, applied once.
   *
   * Used by the support-reply flow: a staff member pressing "Message" on a
   * support alert gets an opening sentence to edit rather than a blank field,
   * and the ticket itself is already in the thread as a reference card.
   */
  initialDraft?: string | null;
  onInitialDraftApplied?: () => void;
  onBack: () => void;
  onOpenInfo: (conversation: Conversation) => void;
  /**
   * Signs and broadcasts a transfer, then attaches it. Lives in the shell
   * because it needs the wallet signer, which this screen has no business
   * holding.
   */
  onSendPayment?: (input: {
    conversationId: number;
    payAddress: string;
    amount: string;
    note: string;
  }) => Promise<void>;
  onOpenTransaction?: (txHash: string) => void;
  onOpenMerchant?: (locationId: number) => void;
  onOpenEvent?: (eventId: string) => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  sendTyping: (conversationId: number, typing: boolean) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
  /** Reported so the inbox and the dock badge can clear without a round trip. */
  onRead?: (conversationId: number) => void;
};

export function ChatScreen({
  conversationId,
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  availableBalance,
  autoFocus = true,
  initialDraft,
  onInitialDraftApplied,
  onBack,
  onOpenInfo,
  onSendPayment,
  onOpenTransaction,
  onOpenMerchant,
  onOpenEvent,
  subscribe,
  sendTyping,
  onToast,
  onRead,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("text");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<ChatMessage | null>(null);
  const [viewerImage, setViewerImage] = useState<{ uri: string; name?: string } | null>(null);

  const inputRef = useRef<TextInput | null>(null);
  const firstPageLoaded = useRef(false);

  const typing = useTypingIndicators(conversationId, subscribe);
  const reportTyping = useTypingReporter(conversationId, sendTyping);

  // The list is inverted, so it wants newest-first. Memoized because a fresh
  // array on every render defeats FlatList's own bail-out and re-renders every
  // bubble on each keystroke in the composer.
  const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const isGroup = conversation?.kind === "group";

  // ── Loading ───────────────────────────────────────────────────────────────

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!backendClient || !conversationId) {
        return;
      }
      try {
        const [conv, page] = await Promise.all([
          backendClient.getConversation(conversationId),
          backendClient.getConversationMessages(conversationId),
        ]);
        setConversation(conv);
        setMessages((current) => {
          // The newest page replaces its own range; older pages already loaded
          // are kept, so a poll does not discard history somebody scrolled to.
          const newest = new Set(page.messages.map((m) => m.id));
          const oldestInPage = page.messages[0]?.id ?? Number.POSITIVE_INFINITY;
          const older = current.filter((m) => !newest.has(m.id) && m.id < oldestInPage);
          return [...older, ...page.messages];
        });
        if (!firstPageLoaded.current) {
          firstPageLoaded.current = true;
          setHasMore(page.has_more);
        }
        void backendClient.markConversationRead(conversationId).catch(() => {});
        onRead?.(conversationId);
      } catch (e) {
        if (e instanceof BulletinRequestError && e.status === 404) {
          onToast(e.message, "error");
          onBack();
          return;
        }
        if (!options?.silent) {
          // A failed load leaves whatever was already on screen. An empty
          // thread and an unreachable one are different things, and showing
          // the first for the second is how a chat looks deleted.
          onToast("Couldn't refresh this conversation.", "error");
        }
      }
    },
    [backendClient, conversationId, onBack, onRead, onToast],
  );

  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setDraft("");
    setReplyingTo(null);
    setMode("text");
    firstPageLoaded.current = false;
    void refresh({ silent: true });
  }, [conversationId, refresh]);

  // Applied after the reset above rather than with it, so switching threads
  // cannot wipe a draft that was handed in for the thread being opened. Cleared
  // immediately so it is used once: it is an opening line, not a saved draft,
  // and it must not reappear after the person sends or deletes it.
  useEffect(() => {
    if (!initialDraft) {
      return;
    }
    setDraft(initialDraft);
    onInitialDraftApplied?.();
  }, [initialDraft, onInitialDraftApplied]);

  // A slow safety net rather than the main source: the socket carries new
  // messages, and this catches a thread whose socket dropped without the client
  // noticing. Four seconds became fifteen when the socket arrived.
  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void refresh({ silent: true });
      }
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Live updates ──────────────────────────────────────────────────────────

  useEffect(() => {
    return subscribe((event) => {
      if (event.conversation_id !== conversationId) {
        return;
      }
      if (event.kind === "message.new") {
        const incoming = event.data as ChatMessage | undefined;
        if (!incoming?.id) {
          return;
        }
        setMessages((current) =>
          current.some((m) => m.id === incoming.id) ? current : [...current, incoming],
        );
        // Reading it is implied by having it on screen, so the unread state is
        // cleared here rather than waiting for the next poll.
        void backendClient?.markConversationRead(conversationId).catch(() => {});
        onRead?.(conversationId);
        return;
      }
      if (event.kind === "message.reaction") {
        const data = event.data as
          | { message_id?: number; reactions?: ChatMessage["reactions"] }
          | undefined;
        if (!data?.message_id) {
          return;
        }
        setMessages((current) =>
          current.map((m) =>
            m.id === data.message_id ? { ...m, reactions: data.reactions ?? [] } : m,
          ),
        );
        return;
      }
      if (event.kind === "conversation.updated") {
        // Membership, title or picture. Re-read rather than patched: the event
        // says what changed, not to what.
        void refresh({ silent: true });
      }
    });
  }, [backendClient, conversationId, onRead, refresh, subscribe]);

  // Chats open ready to type. See the header note on why this is the default
  // and when it is not.
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, [autoFocus, conversationId]);

  const loadOlder = async () => {
    if (!backendClient || !hasMore || loadingOlder || messages.length === 0) {
      return;
    }
    setLoadingOlder(true);
    try {
      const page = await backendClient.getConversationMessages(conversationId, messages[0].id);
      setMessages((current) => [...page.messages, ...current]);
      setHasMore(page.has_more);
    } catch {
      // Older messages are a nicety; the thread works without them.
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── Sending ───────────────────────────────────────────────────────────────

  const send = async () => {
    const body = draft.trim();
    if (!body || !backendClient || sending) {
      return;
    }
    setSending(true);
    const replyTo = replyingTo?.id ?? null;
    try {
      const message = await backendClient.sendConversationMessage(conversationId, body, replyTo);
      setMessages((current) => [...current, message]);
      setDraft("");
      setReplyingTo(null);
      reportTyping(false);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't send. Try again.", "error");
    } finally {
      setSending(false);
    }
  };

  const sendAttachments = async (
    files: Array<{ uri: string; mimeType?: string | null; fileName?: string | null }>,
  ) => {
    if (!backendClient || files.length === 0) {
      return;
    }
    setMode("text");
    setSending(true);
    try {
      const message = await backendClient.uploadConversationAttachments(conversationId, files, {
        body: draft.trim() || undefined,
        replyToId: replyingTo?.id ?? null,
      });
      setMessages((current) => [...current, message]);
      setDraft("");
      setReplyingTo(null);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't send that.", "error");
    } finally {
      setSending(false);
    }
  };

  const sendLink = async (url: string) => {
    if (!backendClient) {
      return;
    }
    setMode("text");
    setSending(true);
    try {
      const message = await backendClient.attachConversationReference(conversationId, {
        kind: "link",
        link_url: url,
        body: draft.trim() || undefined,
        reply_to_id: replyingTo?.id ?? null,
      });
      setMessages((current) => [...current, message]);
      setDraft("");
      setReplyingTo(null);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't share that link.", "error");
    } finally {
      setSending(false);
    }
  };

  // ── Attachment options ────────────────────────────────────────────────────

  const attachmentOptions: AttachmentOption[] = useMemo(() => {
    const options: AttachmentOption[] = [
      {
        id: "photo",
        label: "Photos",
        icon: "image-outline",
        onPress: () => {
          void (async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              onToast("SFLuv needs photo access to send a picture.", "error");
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsMultipleSelection: true,
              selectionLimit: 10,
              quality: 0.85,
            });
            if (result.canceled) {
              return;
            }
            await sendAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: asset.fileName,
              })),
            );
          })();
        },
      },
      {
        id: "camera",
        label: "Camera",
        icon: "camera-outline",
        onPress: () => {
          void (async () => {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              onToast("SFLuv needs camera access to take a picture.", "error");
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
            if (result.canceled) {
              return;
            }
            await sendAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: asset.fileName,
              })),
            );
          })();
        },
      },
      {
        id: "file",
        label: "File",
        icon: "document-outline",
        onPress: () => {
          void (async () => {
            const picked = await pickDocuments();
            if (picked === "unavailable") {
              onToast("Sending files needs a newer version of SFLuv.", "info");
              return;
            }
            if (picked.length > 0) {
              await sendAttachments(picked);
            }
          })();
        },
      },
      {
        id: "link",
        label: "Link",
        icon: "link-outline",
        onPress: () => {
          void (async () => {
            // Offered from the clipboard rather than as a text field: somebody
            // attaching a link has almost always just copied one, and a field
            // would mean typing a URL on a phone.
            const clip = (await Clipboard.getStringAsync()).trim();
            if (!clip) {
              onToast("Copy a link first, then tap Link.", "info");
              return;
            }
            Alert.alert("Share this link?", clip, [
              { text: "Cancel", style: "cancel" },
              { text: "Share", onPress: () => void sendLink(clip) },
            ]);
          })();
        },
      },
    ];

    // Direct threads only — there is no single recipient in a group. The server
    // refuses it there as well rather than trusting this.
    if (!isGroup && conversation?.pay_address && onSendPayment) {
      options.push({
        id: "pay",
        label: `Send ${tokenSymbol}`,
        icon: "cash-outline",
        onPress: () => setMode("amount"),
      });
    }

    return options;
  }, [
    conversation?.pay_address,
    isGroup,
    onSendPayment,
    onToast,
    sendAttachments,
    sendLink,
    tokenSymbol,
  ]);

  // ── Message actions ───────────────────────────────────────────────────────

  const toggleReaction = async (message: ChatMessage, emoji: string) => {
    if (!backendClient) {
      return;
    }
    triggerClickHaptic(hapticsEnabled);
    setActionTarget(null);
    setReactionPickerFor(null);
    try {
      const result = await backendClient.toggleMessageReaction(conversationId, message.id, emoji);
      setMessages((current) =>
        current.map((m) => (m.id === message.id ? { ...m, reactions: result.reactions } : m)),
      );
    } catch {
      onToast("Couldn't react to that message.", "error");
    }
  };

  const copyMessage = async (message: ChatMessage) => {
    setActionTarget(null);
    const text = message.body?.trim();
    if (!text) {
      onToast("There's no text to copy.", "info");
      return;
    }
    await Clipboard.setStringAsync(text);
    onToast("Copied.", "success");
  };

  // ── Rendering ─────────────────────────────────────────────────────────────

  const attachmentHandlers: AttachmentHandlers = useMemo(
    () => ({
      onOpenImage: (_attachment, uri) => setViewerImage({ uri, name: _attachment.file_name }),
      onOpenFile: (attachment) => {
        // Nothing opens a stored file in place yet. Saying so is better than a
        // tap that does nothing — and better than pretending, which is what an
        // empty handler would do.
        onToast(
          `${attachment.file_name || "This file"} — opening files in the app is coming soon.`,
          "info",
        );
      },
      onOpenTransaction,
      onOpenMerchant,
      onOpenEvent,
      onOpenSupport: () => {
        // The card is the context, not a destination: the person reading it is
        // either the sender of the request or the staff member answering it,
        // and both already know what it says.
      },
    }),
    [onOpenEvent, onOpenMerchant, onOpenTransaction, onToast],
  );

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    if (item.kind === "system") {
      return (
        <View style={styles.systemLine}>
          <Text style={styles.systemText}>{item.body}</Text>
        </View>
      );
    }

    // The list is rendered reversed, so a higher index is an OLDER message.
    // A run of messages from one person shows their name once, on the oldest of
    // the run — which is the one with a different sender above it.
    const olderNeighbour = messages[messages.length - index - 2];
    const showSender =
      isGroup &&
      !item.is_mine &&
      (!olderNeighbour || olderNeighbour.sender_id !== item.sender_id || olderNeighbour.kind === "system");

    const isPayment = item.kind === "payment";

    return (
      <View style={[styles.messageRow, item.is_mine ? styles.messageRowMine : undefined]}>
        <View style={styles.messageColumn}>
          {showSender ? <Text style={styles.senderName}>{item.sender_name}</Text> : null}

          <Pressable
            onLongPress={() => {
              triggerClickHaptic(hapticsEnabled);
              setActionTarget(item);
            }}
            delayLongPress={280}
          >
            {item.reply_to ? (
              <View style={[styles.quote, item.is_mine ? styles.quoteMine : undefined]}>
                <View style={styles.quoteStripe} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.quoteName} numberOfLines={1}>
                    {item.reply_to.sender_name || "Message"}
                  </Text>
                  <Text style={styles.quoteBody} numberOfLines={2}>
                    {item.reply_to.body?.trim() || attachmentKindLabel(item.reply_to.attachment_kind)}
                  </Text>
                </View>
              </View>
            ) : null}

            {isPayment ? (
              <Pressable
                style={styles.paymentBubble}
                onPress={() => item.tx_hash && onOpenTransaction?.(item.tx_hash)}
                accessibilityRole="button"
                accessibilityLabel="Payment"
              >
                <Ionicons
                  name={item.payment_verified ? "checkmark-circle" : "time-outline"}
                  size={18}
                  color={item.payment_verified ? palette.success : palette.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>
                    {item.is_mine ? "You sent" : "Sent you"}{" "}
                    {formatSfluvAmount(item.amount_sfluv_base) || ""} {tokenSymbol}
                  </Text>
                  {item.body ? <Text style={styles.paymentNote}>{item.body}</Text> : null}
                  {!item.payment_verified ? (
                    <Text style={styles.paymentPending}>Confirming on the network…</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={15} color={palette.textMuted} />
              </Pressable>
            ) : (
              <View
                style={[
                  styles.bubble,
                  item.is_mine ? styles.bubbleMine : styles.bubbleTheirs,
                  // An attachment supplies its own surface, so the bubble around
                  // it drops its fill and padding rather than framing it twice.
                  item.attachments?.length ? styles.bubbleBare : undefined,
                ]}
              >
                {item.attachments?.length ? (
                  <View style={styles.attachments}>
                    {item.attachments.map((attachment: MessageAttachment) => (
                      <MessageAttachmentCard
                        key={attachment.id}
                        attachment={attachment}
                        conversationId={conversationId}
                        client={backendClient}
                        tokenSymbol={tokenSymbol}
                        mine={item.is_mine}
                        handlers={attachmentHandlers}
                      />
                    ))}
                  </View>
                ) : null}
                {item.body ? (
                  <Text
                    style={[
                      item.is_mine ? styles.bubbleTextMine : styles.bubbleText,
                      item.attachments?.length ? styles.caption : undefined,
                    ]}
                  >
                    {item.body}
                  </Text>
                ) : null}
              </View>
            )}
          </Pressable>

          {item.reactions?.length ? (
            <View style={[styles.reactionRow, item.is_mine ? styles.reactionRowMine : undefined]}>
              {item.reactions.map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  style={[styles.reactionChip, reaction.mine ? styles.reactionChipMine : undefined]}
                  onPress={() => void toggleReaction(item, reaction.emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`${reaction.emoji} ${reaction.count}${reaction.mine ? ", yours" : ""}`}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  {reaction.count > 1 ? (
                    <Text style={styles.reactionCount}>{reaction.count}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const headerTitle = isGroup
    ? conversation?.title || "Group"
    : conversation?.other_user.public_name || "";
  const headerSubtitle = isGroup
    ? `${conversation?.member_count ?? 0} ${conversation?.member_count === 1 ? "person" : "people"}`
    : null;

  const composerDisabledReason = conversation?.blocked_by_me
    ? `You blocked ${conversation.other_user.public_name}.`
    : conversation?.other_user_inactive
      ? `${conversation.other_user.public_name} can't receive messages right now.`
      : null;

  return (
    <SwipeBack onBack={onBack} style={styles.screen} enabled={mode === "text"}>
      {/* The chat's own header. The shell hides its top bar for this screen, so
          this is the only one — see the note at the top of the file. */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={palette.text} />
        </Pressable>
        <Pressable
          style={styles.headerIdentity}
          onPress={() => conversation && onOpenInfo(conversation)}
          accessibilityRole="button"
          accessibilityLabel={isGroup ? "Group info" : "Contact info"}
        >
          <Avatar name={headerTitle || "?"} size={32} />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            {headerSubtitle ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {headerSubtitle}
              </Text>
            ) : conversation ? (
              <BadgeLine user={conversation.other_user} />
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => conversation && onOpenInfo(conversation)}
          hitSlop={10}
          accessibilityRole="button"
          // Replaces the "..." this had: a menu glyph promises a list of
          // actions, and what is actually behind it is a screen about this
          // conversation. The actions moved onto that screen.
          accessibilityLabel={isGroup ? "Group info" : "Conversation info"}
        >
          <Ionicons name="information-circle-outline" size={24} color={palette.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          // Inverted: index 0 is the newest message, so the resting position is
          // the bottom and the keyboard cannot fight a scroll-to-end. See the
          // note at the top of the file.
          inverted
          data={orderedMessages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          // "End" on an inverted list is the TOP, which is where older messages
          // are — so this is the infinite scroll backwards through history.
          onEndReached={() => void loadOlder()}
          ListFooterComponent={
            loadingOlder ? (
              <View style={styles.loadingOlder}>
                <ThemedActivityIndicator />
              </View>
            ) : null
          }
          ListEmptyComponent={
            conversation ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={30} color={palette.textMuted} />
                <Text style={styles.emptyText}>Say hello.</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <ThemedActivityIndicator />
              </View>
            )
          }
          // The typing bubble lives in the header of an inverted list, which is
          // its visual bottom — directly above the composer, where it belongs.
          ListHeaderComponent={
            typing.length > 0 ? (
              <View style={styles.typingRow}>
                <View style={styles.typingBubble}>
                  <TypingDots />
                </View>
                {isGroup ? (
                  <Text style={styles.typingWho} numberOfLines={1}>
                    {typing.length === 1
                      ? `${typing[0].userName} is typing`
                      : `${typing.length} people are typing`}
                  </Text>
                ) : null}
              </View>
            ) : null
          }
        />

        {composerDisabledReason ? (
          <View style={styles.blockedBar}>
            <Text style={styles.blockedText}>{composerDisabledReason}</Text>
          </View>
        ) : (
          <ChatComposer
            mode={mode}
            onModeChange={setMode}
            draft={draft}
            onDraftChange={(value) => {
              setDraft(value);
              reportTyping(value.trim().length > 0);
            }}
            onSend={() => void send()}
            sending={sending}
            attachmentOptions={attachmentOptions}
            onSendAmount={
              !isGroup && conversation?.pay_address && onSendPayment
                ? async (amount, note) => {
                    await onSendPayment({
                      conversationId,
                      payAddress: conversation.pay_address!,
                      amount,
                      note,
                    });
                    setMode("text");
                    await refresh({ silent: true });
                  }
                : undefined
            }
            tokenSymbol={tokenSymbol}
            availableBalance={availableBalance}
            replyingTo={
              replyingTo
                ? {
                    id: replyingTo.id,
                    senderName: replyingTo.is_mine
                      ? "You"
                      : replyingTo.sender_name || conversation?.other_user.public_name || "Message",
                    body: replyingTo.body?.trim() || attachmentKindLabel(replyingTo.attachments?.[0]?.kind),
                  }
                : null
            }
            onCancelReply={() => setReplyingTo(null)}
            hapticsEnabled={hapticsEnabled}
            inputRef={inputRef}
          />
        )}
      </KeyboardAvoidingView>

      {/* ── Long-press actions ────────────────────────────────────────────── */}
      <Modal
        visible={Boolean(actionTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionTarget(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionTarget(null)}>
          <Pressable style={styles.actionCard} onPress={() => {}}>
            <View style={styles.quickReactions}>
              {DEFAULT_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.quickReaction}
                  onPress={() => actionTarget && void toggleReaction(actionTarget, emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.quickReaction}
                onPress={() => {
                  setReactionPickerFor(actionTarget);
                  setActionTarget(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="More reactions"
              >
                <Ionicons name="add" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <ActionRow
              icon="arrow-undo-outline"
              label="Reply"
              onPress={() => {
                setReplyingTo(actionTarget);
                setActionTarget(null);
                setMode("text");
                setTimeout(() => inputRef.current?.focus(), 120);
              }}
            />
            <ActionRow
              icon="copy-outline"
              label="Copy"
              onPress={() => actionTarget && void copyMessage(actionTarget)}
            />
            {actionTarget && !actionTarget.is_mine ? (
              <ActionRow
                icon="flag-outline"
                label="Report"
                destructive
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  if (!target || !backendClient) {
                    return;
                  }
                  Alert.alert(
                    "Report this message?",
                    "An SFLuv admin will review it. The sender isn't told who reported them.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Report",
                        style: "destructive",
                        onPress: () =>
                          void backendClient
                            .reportContent({
                              target_type: "message",
                              target_id: String(target.id),
                              reason: "other",
                            })
                            .then(() => onToast("Thanks. We'll take a look.", "success"))
                            .catch(() => onToast("Couldn't send that report.", "error")),
                      },
                    ],
                  );
                }}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── The wider emoji set ───────────────────────────────────────────── */}
      <Modal
        visible={Boolean(reactionPickerFor)}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionPickerFor(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setReactionPickerFor(null)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <Text style={styles.pickerTitle}>React</Text>
            <View style={styles.pickerGrid}>
              {[...DEFAULT_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.pickerCell}
                  onPress={() => reactionPickerFor && void toggleReaction(reactionPickerFor, emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Full-size photo ──────────────────────────────────────────────── */}
      <Modal
        visible={Boolean(viewerImage)}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerImage(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerImage(null)}>
          {viewerImage ? (
            <ImageViewer uri={viewerImage.uri} onClose={() => setViewerImage(null)} />
          ) : null}
        </Pressable>
      </Modal>
    </SwipeBack>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingVertical: 13,
        paddingHorizontal: spacing.md,
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color={destructive ? palette.danger : palette.text} />
      <Text style={{ fontSize: 15, color: destructive ? palette.danger : palette.text }}>{label}</Text>
    </Pressable>
  );
}

/** Three dots that fade in sequence, which is what "typing" looks like. */
function TypingDots() {
  const { palette } = useAppTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setStep((current) => (current + 1) % 3), 320);
    return () => clearInterval(interval);
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: palette.textMuted,
            opacity: index === step ? 1 : 0.35,
          }}
        />
      ))}
    </View>
  );
}

function ImageViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { palette } = useAppTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      {/* The Pressable wrapping this fills the backdrop, so a tap anywhere
          outside the photo closes the viewer. */}
      <Image
        source={{ uri }}
        style={{ width: "92%", height: "70%" }}
        resizeMode="contain"
        accessibilityLabel="Photo"
      />
      <Pressable
        onPress={onClose}
        style={{ position: "absolute", top: 48, right: 24 }}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close photo"
      >
        <Ionicons name="close" size={28} color={palette.white} />
      </Pressable>
    </View>
  );
}

export function formatSfluvAmount(base?: string | null): string {
  if (!base) return "";
  const value = Number(base) / 1_000_000;
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      backgroundColor: palette.background,
    },
    headerIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
    headerText: { flex: 1 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    headerSubtitle: { fontSize: 12, color: palette.textMuted, marginTop: 1 },

    body: { flex: 1 },
    listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 3 },

    messageRow: { flexDirection: "row", marginVertical: 2 },
    messageRowMine: { justifyContent: "flex-end" },
    messageColumn: { maxWidth: "84%" },
    senderName: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primaryStrong,
      marginBottom: 2,
      marginLeft: 10,
    },

    bubble: { borderRadius: radii.lg, paddingHorizontal: 13, paddingVertical: 9 },
    bubbleMine: { backgroundColor: palette.primary, borderBottomRightRadius: 6 },
    bubbleTheirs: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderBottomLeftRadius: 6,
    },
    bubbleBare: { backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0 },
    bubbleText: { fontSize: 15, color: palette.text, lineHeight: 20 },
    bubbleTextMine: { fontSize: 15, color: palette.white, lineHeight: 20 },
    caption: { marginTop: 6, color: palette.text },
    attachments: { gap: 6 },

    quote: {
      flexDirection: "row",
      gap: 7,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.sm,
      padding: 7,
      marginBottom: 3,
      maxWidth: 268,
    },
    quoteMine: { backgroundColor: palette.surfaceStrong },
    quoteStripe: { width: 3, borderRadius: 2, backgroundColor: palette.primary },
    quoteName: { fontSize: 11, fontWeight: "700", color: palette.primaryStrong },
    quoteBody: { fontSize: 12, color: palette.textMuted, marginTop: 1 },

    paymentBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.primarySoft,
      borderRadius: radii.md,
      paddingHorizontal: 11,
      paddingVertical: 10,
      minWidth: 210,
    },
    paymentAmount: { fontSize: 15, fontWeight: "700", color: palette.text },
    paymentNote: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
    paymentPending: { fontSize: 11, color: palette.textMuted, marginTop: 3 },

    reactionRow: { flexDirection: "row", gap: 4, marginTop: 3, marginLeft: 8 },
    reactionRowMine: { justifyContent: "flex-end", marginLeft: 0, marginRight: 8 },
    reactionChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    reactionChipMine: { borderColor: palette.primary, backgroundColor: palette.primaryMuted },
    reactionEmoji: { fontSize: 13 },
    reactionCount: { fontSize: 11, color: palette.textMuted, fontWeight: "600" },

    systemLine: { alignItems: "center", paddingVertical: spacing.sm },
    systemText: { fontSize: 12, color: palette.textMuted, textAlign: "center" },

    typingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
    typingBubble: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.lg,
      borderBottomLeftRadius: 6,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    typingWho: { fontSize: 12, color: palette.textMuted, flex: 1 },

    empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm, transform: [{ scaleY: -1 }] },
    emptyText: { fontSize: 14, color: palette.textMuted },
    loadingOlder: { paddingVertical: spacing.md, alignItems: "center" },

    blockedBar: {
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      alignItems: "center",
    },
    blockedText: { fontSize: 13, color: palette.textMuted, textAlign: "center" },

    sheetBackdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      justifyContent: "center",
      padding: spacing.lg,
    },
    actionCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      paddingVertical: spacing.sm,
      overflow: "hidden",
    },
    quickReactions: {
      flexDirection: "row",
      justifyContent: "space-around",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      marginBottom: 4,
    },
    quickReaction: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    quickReactionEmoji: { fontSize: 22 },

    pickerCard: { backgroundColor: palette.surface, borderRadius: radii.xl, padding: spacing.md },
    pickerTitle: { fontSize: 15, fontWeight: "700", color: palette.text, marginBottom: spacing.sm },
    pickerGrid: { flexDirection: "row", flexWrap: "wrap" },
    pickerCell: { width: "16.6%", alignItems: "center", paddingVertical: 9 },
    pickerEmoji: { fontSize: 24 },

    viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  });
}
