import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack, type SwipeBackHandle } from "../components/SwipeBack";
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
import type { RealtimeEvent } from "../services/realtime";
import { useTypingIndicators, useTypingReporter } from "../hooks/useRealtime";
import { useKeyboardLift } from "../hooks/useKeyboardLift";
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

/**
 * How far the thread slides to reveal timestamps, and how wide the column is.
 *
 * One constant for both, because they are the same measurement: the reveal is
 * complete exactly when the column is fully on screen.
 */
const STAMP_COLUMN_WIDTH = 56;

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
  /** The message being edited, if any. Its text is loaded into the composer. */
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  /**
   * Multi-select for bulk deletion.
   *
   * null means not in selection mode at all, which is different from an empty
   * set: entering the mode changes the header and the composer, so "no messages
   * picked yet" has to be distinguishable from "not selecting".
   */
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);

  const inputRef = useRef<TextInput | null>(null);
  const swipeRef = useRef<SwipeBackHandle>(null);

  /**
   * Swipe the thread left to reveal each message's time.
   *
   * iMessage's gesture, and the reason it is a gesture rather than a permanent
   * column: a timestamp on every bubble is clutter 95% of the time and exactly
   * what you want the other 5%. The whole list slides as one so the times line
   * up in a column, rather than each bubble growing a label.
   *
   * Horizontal-and-leftward only, and it gives up the touch unless the movement
   * is clearly sideways — the same ratio test SwipeBack uses, mirrored, so the
   * two gestures cannot both claim a drag. Released, it springs back.
   */
  const stampReveal = useRef(new Animated.Value(0)).current;
  const stampResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderMove: (_event, gesture) => {
          // Capped: past the width of the stamp column there is nothing more to
          // reveal, and letting it drag further just feels loose.
          stampReveal.setValue(Math.max(-STAMP_COLUMN_WIDTH, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: () => {
          Animated.spring(stampReveal, {
            toValue: 0,
            useNativeDriver: true,
            friction: 9,
            tension: 110,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(stampReveal, { toValue: 0, useNativeDriver: true, friction: 9, tension: 110 }).start();
        },
      }),
    [stampReveal],
  );
  const firstPageLoaded = useRef(false);

  /**
   * The parent's callbacks, held in refs.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * `refresh` is a useCallback. It used to list `onRead`, `onToast` and
   * `onBack` among its dependencies, and the reset effect below listed
   * `refresh` among its own. The shell passes `onRead` as an inline arrow and
   * `showToast` as a plain function, so both get a new identity on every shell
   * render — and the shell re-renders constantly: balance polls, transaction
   * polls, the notification feed, the unread poll, every AppState change.
   *
   * So several times a minute `refresh` changed identity, the reset effect
   * re-ran, and it does this:
   *
   *     setConversation(null); setMessages([]); setDraft(""); setMode("text");
   *
   * which blanks the thread and reloads it (the flicker), closes the send-SFLUV
   * pad or the attachment tray mid-use, and throws away whatever the person had
   * typed. The draft loss is the worst of it and was silent.
   *
   * Refs fix it at this end rather than by asking the shell to memoize
   * everything: a screen that resets itself when its parent re-renders is
   * broken regardless of how carefully the parent is written, and the next
   * callback added to the shell would have reintroduced it.
   */
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const {
    ref: keyboardRef,
    onLayout: measureKeyboardGap,
    lift,
  } = useKeyboardLift();

  /**
   * A link found in what the person is typing, and its scraped card.
   *
   * ── Why this replaced a tray option ──────────────────────────────────────
   *
   * "Link" used to be a button in the attachment tray that read the clipboard
   * and asked for confirmation. That is backwards: nobody decides to attach a
   * link, they paste one into the message they are already writing. So the
   * draft is watched instead, and the card appears above the composer the way
   * every other chat app does it — which also means the sender sees what the
   * recipient will see before sending, which the tray version never offered.
   *
   * `dismissed` is kept per URL so that closing a card does not just make it
   * reappear on the next keystroke.
   */
  const [linkPreview, setLinkPreview] = useState<{
    /**
     * The URL exactly as `firstURL` produced it from the draft.
     *
     * Kept alongside the server's normalized `url` because the two can differ
     * — the server may add a trailing slash, drop a default port, or follow a
     * redirect — and everything that compares a preview against the current
     * draft has to compare like with like. Keying on the server's version
     * instead caused two bugs: dismissing a card did not stick, and the
     * "already previewed this" guard never matched, so the effect refetched
     * every 600ms for as long as the link sat in the draft.
     */
    detectedUrl: string;
    url: string;
    title: string;
    description: string;
    imageUrl: string;
    siteName: string;
  } | null>(null);
  const [dismissedLinks, setDismissedLinks] = useState<string[]>([]);

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
        onReadRef.current?.(conversationId);
      } catch (e) {
        if (e instanceof BulletinRequestError && e.status === 404) {
          onToastRef.current(e.message, "error");
          onBackRef.current();
          return;
        }
        if (!options?.silent) {
          // A failed load leaves whatever was already on screen. An empty
          // thread and an unreachable one are different things, and showing
          // the first for the second is how a chat looks deleted.
          onToastRef.current("Couldn't refresh this conversation.", "error");
        }
      }
    },
    // Only what changes WHAT is fetched. The callbacks are read through refs
    // above precisely so they cannot land here — see the note on those refs.
    [backendClient, conversationId],
  );

  // Resets only when the THREAD changes. `refresh` is deliberately not a
  // dependency: it is stable now, but listing it here is what made a parent
  // re-render wipe the composer, and nothing should be able to do that again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setDraft("");
    setReplyingTo(null);
    setMode("text");
    firstPageLoaded.current = false;
    void refresh({ silent: true });
  }, [conversationId]);

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
        onReadRef.current?.(conversationId);
        return;
      }
      if (event.kind === "message.updated") {
        const updated = event.data as ChatMessage | undefined;
        if (!updated?.id) {
          return;
        }
        // Replaced in place, not appended: this is the same message with new
        // text, and appending would show it twice.
        setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
        return;
      }
      if (event.kind === "message.deleted") {
        const data = event.data as { message_id?: number } | undefined;
        if (!data?.message_id) {
          return;
        }
        // Turned into a tombstone rather than removed, matching what the
        // server's own read path returns.
        setMessages((current) =>
          current.map((m) =>
            m.id === data.message_id
              ? { ...m, deleted: true, body: "", attachments: [], reactions: [] }
              : m,
          ),
        );
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
    // onRead is read through its ref, for the reason given on those refs.
  }, [backendClient, conversationId, refresh, subscribe]);

  // Chats open ready to type. See the header note on why this is the default
  // and when it is not.
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, [autoFocus, conversationId]);

  /**
   * Watches the draft for a URL and fetches its card.
   *
   * Debounced, because this runs per keystroke and each fetch makes the server
   * reach out to somebody else's site. Only the FIRST url in the draft is
   * previewed: a message with three links is a message, not three cards, and
   * picking the first is both predictable and what the recipient's own card
   * will show.
   */
  useEffect(() => {
    const found = firstURL(draft);
    if (!found) {
      setLinkPreview(null);
      return;
    }
    if (dismissedLinks.includes(found)) {
      setLinkPreview(null);
      return;
    }
    if (linkPreview?.detectedUrl === found) {
      return;
    }
    if (!backendClient) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void backendClient
        .previewLink(found)
        .then((meta) => {
          if (cancelled) {
            return;
          }
          setLinkPreview({
            detectedUrl: found,
            // The server's normalized url is what gets stored on the message,
            // so that is what gets SENT; `found` is only for comparing against
            // the draft.
            url: meta.url || found,
            title: meta.title,
            description: meta.description,
            imageUrl: meta.image_url,
            siteName: meta.site_name,
          });
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          // A link we cannot read is still a link worth sending. The card shows
          // the bare URL rather than vanishing, so the sender can see it was
          // recognised.
          setLinkPreview({
            detectedUrl: found,
            url: found,
            title: "",
            description: "",
            imageUrl: "",
            siteName: "",
          });
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backendClient, dismissedLinks, draft, linkPreview?.detectedUrl]);

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
      // A detected link is sent as a link attachment with the message as its
      // caption, so the recipient gets the card rather than a bare URL. The
      // server re-scrapes and stores the metadata itself — what is sent here is
      // the url, not the preview, so a card cannot be forged by the sender.
      const message = linkPreview
        ? await backendClient.attachConversationReference(conversationId, {
            kind: "link",
            link_url: linkPreview.url,
            body,
            reply_to_id: replyTo,
          })
        : await backendClient.sendConversationMessage(conversationId, body, replyTo);
      setMessages((current) => [...current, message]);
      setDraft("");
      setReplyingTo(null);
      setLinkPreview(null);
      setDismissedLinks([]);
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
            const result = await DocumentPicker.getDocumentAsync({
              multiple: true,
              // Everything, filtered server-side against the allowlist in
              // app_chat_attachment.go. Restricting the picker here too would
              // mean two lists to keep in step, and the one that matters for
              // safety is the server's.
              type: "*/*",
              // Copied into the app's cache so the URI is still readable when
              // the upload runs: a document-provider URI can expire the moment
              // the picker closes.
              copyToCacheDirectory: true,
            });
            if (result.canceled || result.assets.length === 0) {
              return;
            }
            await sendAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: asset.name,
              })),
            );
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

  /** How long a message stays editable. Mirrors the server's EditWindow. */
  const EDIT_WINDOW_MS = 5 * 60 * 1000;

  const canEdit = (message: ChatMessage): boolean =>
    message.is_mine &&
    !message.deleted &&
    (message.kind === "text" || message.kind === "attachment") &&
    Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;

  const submitEdit = async () => {
    const target = editing;
    const body = draft.trim();
    if (!target || !body || !backendClient || sending) {
      return;
    }
    setSending(true);
    try {
      const updated = await backendClient.editConversationMessage(conversationId, target.id, body);
      setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
      setDraft("");
    } catch (e) {
      onToast(
        e instanceof BulletinRequestError ? e.message : "Couldn't save that edit.",
        "error",
      );
    } finally {
      setSending(false);
    }
  };

  const deleteMessages = async (ids: number[]) => {
    if (!backendClient || ids.length === 0) {
      return;
    }
    const failed: number[] = [];
    for (const id of ids) {
      try {
        await backendClient.deleteConversationMessage(conversationId, id);
        // Marked locally rather than removed: the server keeps a tombstone, and
        // dropping the row here would make the thread disagree with itself
        // until the next read.
        setMessages((current) =>
          current.map((m) =>
            m.id === id
              ? { ...m, deleted: true, body: "", attachments: [], reactions: [] }
              : m,
          ),
        );
      } catch {
        failed.push(id);
      }
    }
    setSelectedIds(null);
    if (failed.length > 0) {
      onToast(
        failed.length === ids.length
          ? "Couldn't delete that."
          : `Deleted ${ids.length - failed.length} of ${ids.length}.`,
        "error",
      );
    }
  };

  const confirmDelete = (ids: number[]) => {
    Alert.alert(
      ids.length === 1 ? "Delete this message?" : `Delete ${ids.length} messages?`,
      "This removes it for everyone in the chat. They'll see that a message was deleted.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteMessages(ids) },
      ],
    );
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
    // The list is rendered reversed, so the message BEFORE this one in time is
    // at the next index up.
    const previousInTime = orderedMessages[index + 1];
    // A centred date when a conversation picks up after a gap, the way iMessage
    // does it. Rendered as part of this row rather than as a separate list item
    // so the inverted list's ordering stays trivially correct.
    const separator = sessionSeparator(previousInTime, item);

    if (item.kind === "system") {
      return (
        <>
          {separator ? <Text style={styles.daySeparator}>{separator}</Text> : null}
          <View style={styles.systemLine}>
            <Text style={styles.systemText}>{item.body}</Text>
          </View>
        </>
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
      <Animated.View
        style={[
          styles.messageRow,
          item.is_mine ? styles.messageRowMine : undefined,
          { transform: [{ translateX: stampReveal }] },
        ]}
      >
        {separator ? <Text style={styles.daySeparator}>{separator}</Text> : null}
        <View style={styles.messageColumn}>
          {showSender ? <Text style={styles.senderName}>{item.sender_name}</Text> : null}

          <Pressable
            onLongPress={() => {
              // A deleted message has no actions worth offering.
              if (item.deleted) {
                return;
              }
              triggerClickHaptic(hapticsEnabled);
              setActionTarget(item);
            }}
            onPress={() => {
              // In selection mode a plain tap picks, so a long-press is not
              // needed for every message after the first.
              if (selectedIds === null || item.deleted) {
                return;
              }
              setSelectedIds((current) =>
                current?.includes(item.id)
                  ? current.filter((id) => id !== item.id)
                  : [...(current ?? []), item.id],
              );
            }}
            delayLongPress={280}
            style={selectedIds?.includes(item.id) ? styles.selectedRow : undefined}
          >
            {/* A deleted message keeps its place.
                Removing the row would turn any reply to it into a
                non-sequitur, and would quietly change what the conversation
                looks like it was. The body is already blanked by the server —
                there is nothing here to hide. */}
            {item.deleted ? (
              <View style={styles.deletedBubble}>
                <Text style={styles.deletedText}>Message was deleted</Text>
              </View>
            ) : null}

            {!item.deleted && item.reply_to ? (
              <View style={[styles.quote, item.is_mine ? styles.quoteMine : undefined]}>
                <View style={styles.quoteStripe} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.quoteName} numberOfLines={1}>
                    {item.reply_to.sender_name || "Message"}
                  </Text>
                  <Text
                    style={[styles.quoteBody, item.reply_to.deleted && styles.quoteBodyDeleted]}
                    numberOfLines={2}
                  >
                    {item.reply_to.deleted
                      ? "Message was deleted"
                      : item.reply_to.body?.trim() ||
                        attachmentKindLabel(item.reply_to.attachment_kind)}
                  </Text>
                </View>
              </View>
            ) : null}

            {item.deleted ? null : isPayment ? (
              // ── A PAYMENT, not a record ────────────────────────────────────
              //
              // Money moving inside this conversation. Deliberately shaped
              // nothing like the transaction-record card in
              // MessageAttachmentCard: a dollar sign rather than a receipt, and
              // the amount is the whole content rather than a subtitle under a
              // title. "I just paid you 5 SFLUV" and "here is a transfer from
              // March" are different claims and should not have to be told
              // apart by reading carefully.
              //
              // Both open the same transaction sheet, so the detail is one tap
              // away from either.
              <Pressable
                style={styles.paymentBubble}
                onPress={() => item.tx_hash && onOpenTransaction?.(item.tx_hash)}
                accessibilityRole="button"
                accessibilityLabel={`Payment, ${formatSfluvAmount(item.amount_sfluv_base)} ${tokenSymbol}`}
              >
                <View style={styles.paymentIcon}>
                  <Ionicons name="logo-usd" size={17} color={palette.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>
                    {formatSfluvAmount(item.amount_sfluv_base) || "—"} {tokenSymbol}
                  </Text>
                  {/* The sender's note, when they wrote one. Kept because the
                      amount pad offers the field — not a "detail" we added, but
                      something they chose to say. */}
                  {item.body ? <Text style={styles.paymentNote}>{item.body}</Text> : null}
                  {/* A state, not a detail: an unconfirmed amount must not read
                      as a settled one. */}
                  {!item.payment_verified ? (
                    <Text style={styles.paymentPending}>Confirming…</Text>
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

          {item.edited_at && !item.deleted ? (
            <Text style={[styles.editedMark, item.is_mine && styles.editedMarkMine]}>edited</Text>
          ) : null}

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

        {/* The revealed time. Positioned just off the right edge, so it slides
            into view as the thread moves left and occupies no space at rest. */}
        <Text style={styles.messageStamp}>{formatMessageStamp(item.created_at)}</Text>
      </Animated.View>
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
    <SwipeBack ref={swipeRef} onBack={onBack} style={styles.screen} enabled={mode === "text"}>
      {/* The chat's own header. The shell hides its top bar for this screen, so
          this is the only one — see the note at the top of the file. */}
      <View style={styles.header}>
        {/* The animated close, not onBack directly: a button that snaps the
            screen away while the swipe glides it away is the same exit looking
            like two different things. */}
        <Pressable
          onPress={() => swipeRef.current?.close()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
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

      {/* The measured keyboard lift, not a KeyboardAvoidingView.
          KAV with "padding" adds the keyboard height measured from the WINDOW
          bottom, but this view's bottom edge is already above it — the shell
          wraps every screen in a SafeAreaView — so it overshot by the bottom
          inset and left a band of background under the composer. See
          useKeyboardLift. */}
      <View ref={keyboardRef} onLayout={measureKeyboardGap} style={[styles.body, { paddingBottom: lift }]}>
        <FlatList
          {...stampResponder.panHandlers}
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

        {/* Selection mode replaces the composer: you are deleting, not
            writing, and leaving a text field up invites typing into a mode
            that would discard it. */}
        {selectedIds !== null ? (
          <View style={styles.selectionBar}>
            <Pressable onPress={() => setSelectedIds(null)} hitSlop={8}>
              <Text style={styles.selectionCount}>Cancel</Text>
            </Pressable>
            <Text style={styles.selectionCount}>
              {selectedIds.length} selected
            </Text>
            <Pressable
              style={[
                styles.selectionDelete,
                selectedIds.length === 0 && styles.selectionDeleteDisabled,
              ]}
              onPress={() => confirmDelete(selectedIds)}
              disabled={selectedIds.length === 0}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.length} messages`}
            >
              <Ionicons name="trash-outline" size={16} color={palette.white} />
              <Text style={styles.selectionDeleteText}>Delete</Text>
            </Pressable>
          </View>
        ) : composerDisabledReason ? (
          <View style={styles.blockedBar}>
            <Text style={styles.blockedText}>{composerDisabledReason}</Text>
          </View>
        ) : (
          <>
          {editing ? (
            <View style={styles.editBanner}>
              <Ionicons name="pencil" size={13} color={palette.primaryStrong} />
              <Text style={styles.editBannerText} numberOfLines={1}>
                Editing a message
              </Text>
              <Pressable
                onPress={() => {
                  setEditing(null);
                  setDraft("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Stop editing"
              >
                <Ionicons name="close" size={16} color={palette.textMuted} />
              </Pressable>
            </View>
          ) : null}
          <ChatComposer
            mode={mode}
            onModeChange={setMode}
            draft={draft}
            onDraftChange={(value) => {
              setDraft(value);
              reportTyping(value.trim().length > 0);
            }}
            onSend={() => void (editing ? submitEdit() : send())}
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
            linkPreview={linkPreview}
            onDismissLinkPreview={() => {
              // Remembered per URL, so dismissing does not just make the card
              // come back on the next keystroke.
              if (linkPreview) {
                // The DETECTED url, which is what the effect compares against.
                setDismissedLinks((current) => [...current, linkPreview.detectedUrl]);
              }
              setLinkPreview(null);
            }}
            hapticsEnabled={hapticsEnabled}
            inputRef={inputRef}
            placeholder={editing ? "Edit your message" : "Message"}
          />
          </>
        )}
      </View>

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
            {/* Editing is offered only inside the window, and the window is
                checked again by the server — this hides an option that would
                be refused rather than relying on the client's clock to
                enforce it. */}
            {actionTarget && canEdit(actionTarget) ? (
              <ActionRow
                icon="pencil-outline"
                label="Edit"
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  setEditing(target);
                  setDraft(target.body ?? "");
                  setReplyingTo(null);
                  setMode("text");
                  setTimeout(() => inputRef.current?.focus(), 120);
                }}
              />
            ) : null}
            {actionTarget?.is_mine ? (
              <ActionRow
                icon="trash-outline"
                label="Delete"
                destructive
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  if (target) {
                    confirmDelete([target.id]);
                  }
                }}
              />
            ) : null}
            {actionTarget?.is_mine ? (
              <ActionRow
                icon="checkmark-circle-outline"
                label="Select more…"
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  // Seeded with the message that was long-pressed, so the
                  // first tap after entering the mode adds a second rather
                  // than starting over.
                  setSelectedIds(target ? [target.id] : []);
                }}
              />
            ) : null}
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

/**
 * The centred date/time shown between two messages, or null for none.
 *
 * iMessage's rule, approximately: a line appears when the conversation resumes
 * after a real gap, not between every message. An hour is the threshold —
 * shorter than that is one sitting and a line would just be clutter; longer and
 * "when was this" becomes a question worth answering without making somebody
 * swipe for it.
 *
 * Always shown before the first message, so a thread never opens with no date
 * at all.
 */
function sessionSeparator(previous: ChatMessage | undefined, current: ChatMessage): string | null {
  const at = new Date(current.created_at);
  if (!previous) {
    return formatSessionStamp(at);
  }
  const gap = at.getTime() - new Date(previous.created_at).getTime();
  const SESSION_GAP_MS = 60 * 60 * 1000;
  if (gap < SESSION_GAP_MS) {
    return null;
  }
  return formatSessionStamp(at);
}

/** "Today 14:32", "Yesterday 09:10", "Mon 3 Mar 18:45". */
function formatSessionStamp(at: Date): string {
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`;
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  const day = at.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day} ${time}`;
}

/** The per-message time revealed by swiping the thread left. */
function formatMessageStamp(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The first URL in a draft, or null.
 *
 * Deliberately conservative. It matches an explicit http(s):// prefix, or a
 * bare `host.tld/...` with a recognisable dot — not every string containing a
 * dot, because "see you at 3.30" and "that costs 1.50" are not links and a card
 * appearing under them would be absurd. A sender whose link is not detected can
 * still send it as text; a false positive makes us fetch a URL that somebody
 * did not share, which is the worse error.
 */
function firstURL(text: string): string | null {
  const match = text.match(
    /(?:https?:\/\/[^\s<>"']+)|(?:\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/i,
  );
  if (!match) {
    return null;
  }
  const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
  if (!candidate) {
    return null;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
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
    quoteBodyDeleted: { fontStyle: "italic" },

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
    paymentIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: palette.success,
      alignItems: "center",
      justifyContent: "center",
    },
    // Larger than a record card's title: on a payment the amount IS the
    // content, so it carries the weight a title would.
    paymentAmount: { fontSize: 19, fontWeight: "800", color: palette.text },
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

    daySeparator: {
      textAlign: "center",
      fontSize: 11,
      fontWeight: "700",
      color: palette.textMuted,
      paddingVertical: spacing.sm,
      // No scaleY here, deliberately. An inverted FlatList applies the inverse
      // transform to each CELL, so anything inside renderItem is already the
      // right way up — adding one would flip the date upside down. Only
      // ListEmptyComponent misses that treatment, which is why `empty` below
      // carries the flip and this does not.
    },
    deletedBubble: {
      borderRadius: radii.lg,
      paddingHorizontal: 13,
      paddingVertical: 9,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      borderStyle: "dashed",
    },
    deletedText: { fontSize: 14, color: palette.textMuted, fontStyle: "italic" },
    editedMark: { fontSize: 10, color: palette.textMuted, marginTop: 3, marginLeft: 10 },
    editedMarkMine: { textAlign: "right", marginRight: 10, marginLeft: 0 },
    messageStamp: {
      fontSize: 10,
      color: palette.textMuted,
      alignSelf: "center",
      width: STAMP_COLUMN_WIDTH,
      textAlign: "right",
      fontVariant: ["tabular-nums"],
      // Parked off the right edge so it costs no width at rest; the row's
      // translateX is what brings it into view.
      position: "absolute",
      right: -STAMP_COLUMN_WIDTH,
    },
    selectedRow: { backgroundColor: palette.primaryMuted, borderRadius: radii.sm },
    selectionBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    selectionCount: { fontSize: 14, fontWeight: "600", color: palette.text },
    selectionDelete: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: palette.danger,
      borderRadius: radii.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    selectionDeleteText: { color: palette.white, fontWeight: "700", fontSize: 14 },
    selectionDeleteDisabled: { opacity: 0.4 },
    editBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    editBannerText: { flex: 1, fontSize: 12, color: palette.primaryStrong, fontWeight: "600" },
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
